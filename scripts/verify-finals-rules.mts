/**
 * Live check of the FINALS / judge-link security rules against the deployed rules.
 * Uses real anonymous sign-ins for the "judges" and temporary users; everything it creates is removed.
 * Refuses to run if any finals data already exists (so it can never clobber a real event).
 *
 *   GOOGLE_APPLICATION_CREDENTIALS=key.json npx tsx scripts/verify-finals-rules.mts
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { defaultFinalConfig } from "../src/lib/finals";

const require = createRequire(import.meta.url);
const { initializeApp, cert } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getDatabase } = require("firebase-admin/database");

const DB_URL = "https://freshers-c63aa-default-rtdb.firebaseio.com";
const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split(/\r?\n/)
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
);
const API_KEY = env.NEXT_PUBLIC_FIREBASE_API_KEY;
const app = initializeApp({ credential: cert(JSON.parse(readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS!, "utf8"))), databaseURL: DB_URL });
const auth = getAuth(app);
const db = getDatabase(app);

const NOW = { ".sv": "timestamp" };
const enc = (p: string) => p.split("/").map(encodeURIComponent).join("/");
async function rest(method: string, path: string, token: string | null, body?: unknown): Promise<number> {
  const r = await fetch(`${DB_URL}/${enc(path)}.json${token ? `?auth=${token}` : ""}`, { method, body: body === undefined ? undefined : JSON.stringify(body) });
  return r.status;
}
async function anon(): Promise<{ token: string; uid: string }> {
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${API_KEY}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ returnSecureToken: true }) });
  const j = await r.json();
  if (!j.idToken) throw new Error("anonymous sign-up failed: " + JSON.stringify(j.error ?? j));
  return { token: j.idToken, uid: j.localId };
}
async function customToken(uid: string): Promise<string> {
  const c = await auth.createCustomToken(uid);
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${API_KEY}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: c, returnSecureToken: true }) });
  const j = await r.json();
  if (!j.idToken) throw new Error("custom token exchange failed");
  return j.idToken;
}

let pass = 0;
let fail = 0;
const ok = async (name: string, p: Promise<number>) => {
  const s = await p;
  if (s === 200) pass++, console.log(`  ✓ ${name}`);
  else fail++, console.log(`  ✗ ${name} — expected ALLOWED, got ${s}`);
};
const no = async (name: string, p: Promise<number>) => {
  const s = await p;
  if (s === 401 || s === 403) pass++, console.log(`  ✓ ${name}`);
  else fail++, console.log(`  ✗ ${name} — expected DENIED, got ${s}`);
};

const rand = (n: number) => Array.from({ length: n }, () => "abcdefghjkmnpqrstuvwxyz23456789"[Math.floor(Math.random() * 31)]).join("");
const T1 = "ZZT" + rand(25);
const T2 = "ZZT" + rand(25);
const T3 = "ZZT" + rand(25);
const SK = "ZZTESTSTU1";
const SK2 = "ZZTESTSTU2";
const ORDER = { c1: 8, c2: 9, c3: 7 };
const walkScore = (over: Record<string, unknown> = {}) => ({ scores: ORDER, timestamp: NOW, studentId: "ZZ/1", judgeName: "ZZ Judge One", ...over });

const adminUid: string = (await db.ref("admin/uid").get()).val();
if (!adminUid) throw new Error("no admin claimed");
for (const n of ["finalConfig", "finalists", "judges", "judgeTokens", "judgeSessions", "finalScores"]) {
  if ((await db.ref(n).get()).exists()) {
    console.error(`Refusing to run: /${n} already has data.`);
    process.exit(1);
  }
}

const cleanupUids: string[] = [];
try {
  console.log("Setting up (admin identity via custom token, anonymous judges)…");
  const admin = await customToken(adminUid);
  const j1 = await anon();
  const j2 = await anon();
  const stranger = await anon();
  cleanupUids.push(j1.uid, j2.uid, stranger.uid);
  await db.ref(`students/${SK}`).set({ studentId: "ZZ/1", name: "Rules Test" });
  const cfg = defaultFinalConfig();

  console.log("\nAdmin writes (validation)");
  await ok("admin writes finals config", rest("PUT", "finalConfig", admin, cfg));
  await no("config with an invalid round status rejected", rest("PUT", "finalConfig/rounds/walk/status", admin, "paused"));
  await no("config with unknown activeRound rejected", rest("PUT", "finalConfig/activeRound", admin, "nope"));
  await no("config with a bad criterion max rejected", rest("PUT", "finalConfig/rounds/walk/criteria/c1/max", admin, 1000));
  await ok("admin selects finalists", rest("PUT", `finalists/${SK}`, admin, { studentId: "ZZ/1", name: "Rules Test", gender: "girl", number: 1, score3day: 80 }));
  await ok("admin selects a second finalist", rest("PUT", `finalists/${SK2}`, admin, { studentId: "ZZ/2", name: "Rules Test Two", gender: "boy", number: 2 }));
  await no("finalist with an invalid gender rejected", rest("PUT", "finalists/ZZBAD", admin, { studentId: "ZZ/9", name: "x", gender: "other", number: 3 }));
  await ok("admin creates judge 1", rest("PUT", "judges/zzj1", admin, { name: "ZZ Judge One", active: true, token: T1 }));
  await ok("admin creates judge 2", rest("PUT", "judges/zzj2", admin, { name: "ZZ Judge Two", active: true, token: T2 }));
  await ok("admin creates a disabled judge 3", rest("PUT", "judges/zzj3", admin, { name: "ZZ Judge Three", active: false, token: T3 }));
  await no("judge with a short token rejected", rest("PUT", "judges/zzbad", admin, { name: "x", active: true, token: "short" }));
  await ok("admin registers token 1", rest("PUT", `judgeTokens/${T1}`, admin, "zzj1"));
  await ok("admin registers token 2", rest("PUT", `judgeTokens/${T2}`, admin, "zzj2"));
  await ok("admin registers token 3", rest("PUT", `judgeTokens/${T3}`, admin, "zzj3"));
  await ok("admin sets student gender", rest("PUT", `students/${SK}/gender`, admin, "girl"));
  await no("invalid student gender rejected", rest("PUT", `students/${SK}/gender`, admin, "x"));

  console.log("\nEvaluator regression (normal evaluators must be unaffected)");
  const evEmail = "rules-test-ev@example.com";
  const evKey = evEmail.replace(/\./g, ",");
  const evUser = await auth.createUser({ email: evEmail, emailVerified: true });
  cleanupUids.push(evUser.uid);
  await db.ref(`evaluators/${evKey}`).set({ email: evEmail, name: "Rules Test Ev", number: 97, active: true });
  const ev = await customToken(evUser.uid);
  await ok("evaluator reads students", rest("GET", "students", ev));
  await ok("evaluator reads event", rest("GET", "event", ev));
  await ok("evaluator reads settings", rest("GET", "settings", ev));
  await ok("evaluator reads own record", rest("GET", `evaluators/${evKey}`, ev));
  await no("evaluator cannot read finals config", rest("GET", "finalConfig", ev));
  await no("evaluator cannot read finalists", rest("GET", "finalists", ev));
  await no("evaluator cannot read judges", rest("GET", "judges", ev));
  await no("evaluator cannot read final scores", rest("GET", "finalScores", ev));
  await no("evaluator cannot set a student's gender", rest("PUT", `students/${SK}/gender`, ev, "boy"));
  await no("evaluator cannot read evaluations of others", rest("GET", "evaluations", ev));

  console.log("\nStrangers (anonymous, no valid session)");
  await no("cannot read finals config", rest("GET", "finalConfig", stranger.token));
  await no("cannot read finalists", rest("GET", "finalists", stranger.token));
  await no("cannot read judges", rest("GET", "judges", stranger.token));
  await no("cannot list tokens", rest("GET", "judgeTokens", stranger.token));
  await no("cannot read students", rest("GET", "students", stranger.token));
  await no("cannot read evaluations", rest("GET", "evaluations", stranger.token));
  await no("cannot read admin", rest("GET", "admin", stranger.token));
  await no("cannot read final scores", rest("GET", "finalScores", stranger.token));
  await no("cannot read sessions", rest("GET", "judgeSessions", stranger.token));
  await ok("can look up ONE token (needed for the link)", rest("GET", `judgeTokens/${T1}`, stranger.token));
  await no("cannot overwrite a token entry", rest("PUT", `judgeTokens/${T1}`, stranger.token, "zzj2"));
  await no("anonymous (not signed in) cannot look up a token", rest("GET", `judgeTokens/${T1}`, null));
  await no("cannot claim a session with a wrong token", rest("PUT", `judgeSessions/${stranger.uid}`, stranger.token, { judgeId: "zzj1", token: "x".repeat(30), claimedAt: NOW }));
  await no("cannot claim judge 2 using token 1", rest("PUT", `judgeSessions/${stranger.uid}`, stranger.token, { judgeId: "zzj2", token: T1, claimedAt: NOW }));
  await no("cannot claim a DISABLED judge's link", rest("PUT", `judgeSessions/${stranger.uid}`, stranger.token, { judgeId: "zzj3", token: T3, claimedAt: NOW }));
  await no("cannot claim a session for another user", rest("PUT", `judgeSessions/${j1.uid}`, stranger.token, { judgeId: "zzj1", token: T1, claimedAt: NOW }));
  await no("cannot write a score without a session", rest("PUT", `finalScores/walk/zzj1/${SK}`, stranger.token, walkScore()));

  console.log("\nJudge 1 (valid link)");
  await ok("claims a session with the right token", rest("PUT", `judgeSessions/${j1.uid}`, j1.token, { judgeId: "zzj1", token: T1, claimedAt: NOW }));
  await ok("judge 2 claims a session", rest("PUT", `judgeSessions/${j2.uid}`, j2.token, { judgeId: "zzj2", token: T2, claimedAt: NOW }));
  await ok("reads finals config", rest("GET", "finalConfig", j1.token));
  await ok("reads finalists", rest("GET", "finalists", j1.token));
  await ok("reads own judge record", rest("GET", "judges/zzj1", j1.token));
  await no("cannot read another judge's record", rest("GET", "judges/zzj2", j1.token));
  await no("cannot list judges", rest("GET", "judges", j1.token));
  await no("cannot read students", rest("GET", "students", j1.token));
  await no("cannot read evaluators", rest("GET", "evaluators", j1.token));
  await no("cannot read evaluations", rest("GET", "evaluations", j1.token));
  await no("cannot read audit logs", rest("GET", "auditLogs", j1.token));
  await no("cannot read all final scores", rest("GET", "finalScores", j1.token));
  await ok("reads own (empty) scores", rest("GET", "finalScores/walk/zzj1", j1.token));
  await no("cannot read judge 2's scores", rest("GET", "finalScores/walk/zzj2", j1.token));
  await no("cannot change finalists", rest("PUT", `finalists/${SK}/name`, j1.token, "Hacked"));
  await no("cannot change config", rest("PUT", "finalConfig/rounds/walk/status", j1.token, "open"));
  await no("cannot create judges", rest("PUT", "judges/zzevil", j1.token, { name: "x", active: true, token: "y".repeat(30) }));
  await no("cannot claim /admin", rest("PUT", "admin", j1.token, { uid: j1.uid, email: "x@y.z", role: "main_admin" }));

  console.log("\nScoring (round locked → open)");
  await no("score rejected while the round is LOCKED", rest("PUT", `finalScores/walk/zzj1/${SK}`, j1.token, walkScore()));
  await ok("admin opens the Fashion Walk", rest("PATCH", "finalConfig", admin, { activeRound: "walk", "rounds/walk/status": "open" }));
  await ok("judge 1 submits a score", rest("PUT", `finalScores/walk/zzj1/${SK}`, j1.token, walkScore()));
  await no("duplicate submission rejected", rest("PUT", `finalScores/walk/zzj1/${SK}`, j1.token, walkScore({ scores: { c1: 10, c2: 10, c3: 10 } })));
  await no("cannot edit own score", rest("PATCH", `finalScores/walk/zzj1/${SK}/scores`, j1.token, { c1: 10 }));
  await no("cannot delete own score", rest("DELETE", `finalScores/walk/zzj1/${SK}`, j1.token));
  await ok("reads own score back", rest("GET", `finalScores/walk/zzj1/${SK}`, j1.token));
  await no("cannot score as another judge", rest("PUT", `finalScores/walk/zzj2/${SK2}`, j1.token, walkScore({ judgeName: "ZZ Judge Two", studentId: "ZZ/2" })));
  await no("score above the criterion max rejected", rest("PUT", `finalScores/walk/zzj1/${SK2}`, j1.token, walkScore({ studentId: "ZZ/2", scores: { c1: 11, c2: 9, c3: 7 } })));
  await no("negative score rejected", rest("PUT", `finalScores/walk/zzj1/${SK2}`, j1.token, walkScore({ studentId: "ZZ/2", scores: { c1: -1, c2: 9, c3: 7 } })));
  await no("fractional score rejected", rest("PUT", `finalScores/walk/zzj1/${SK2}`, j1.token, walkScore({ studentId: "ZZ/2", scores: { c1: 7.5, c2: 9, c3: 7 } })));
  await no("missing criterion rejected", rest("PUT", `finalScores/walk/zzj1/${SK2}`, j1.token, walkScore({ studentId: "ZZ/2", scores: { c1: 8, c2: 9 } })));
  await no("unknown criterion rejected", rest("PUT", `finalScores/walk/zzj1/${SK2}`, j1.token, walkScore({ studentId: "ZZ/2", scores: { c1: 8, c2: 9, c3: 7, c4: 5 } })));
  await no("client-chosen timestamp rejected", rest("PUT", `finalScores/walk/zzj1/${SK2}`, j1.token, walkScore({ studentId: "ZZ/2", timestamp: 1 })));
  await no("wrong judge name rejected", rest("PUT", `finalScores/walk/zzj1/${SK2}`, j1.token, walkScore({ studentId: "ZZ/2", judgeName: "Somebody Else" })));
  await no("wrong student id rejected", rest("PUT", `finalScores/walk/zzj1/${SK2}`, j1.token, walkScore({ studentId: "ZZ/999" })));
  await no("fake correction/admin flags rejected", rest("PUT", `finalScores/walk/zzj1/${SK2}`, j1.token, walkScore({ studentId: "ZZ/2", enteredByAdmin: true })));
  await no("score for a non-finalist rejected", rest("PUT", "finalScores/walk/zzj1/NOTAFINALIST", j1.token, walkScore()));
  await no("score for a round that is not active rejected", rest("PUT", `finalScores/talent/zzj1/${SK}`, j1.token, { scores: { c1: 5, c2: 5, c3: 5 }, timestamp: NOW, studentId: "ZZ/1", judgeName: "ZZ Judge One" }));
  await ok("judge 1 scores the second finalist", rest("PUT", `finalScores/walk/zzj1/${SK2}`, j1.token, walkScore({ studentId: "ZZ/2" })));
  await ok("judge 2 submits their own score", rest("PUT", `finalScores/walk/zzj2/${SK}`, j2.token, walkScore({ judgeName: "ZZ Judge Two" })));

  console.log("\nTalent / Q&A gating");
  await ok("admin opens the Talent round", rest("PATCH", "finalConfig", admin, { activeRound: "talent", "rounds/talent/status": "open", "rounds/walk/status": "locked" }));
  const talent = (studentId: string) => ({ scores: { c1: 5, c2: 5, c3: 5 }, timestamp: NOW, studentId, judgeName: "ZZ Judge One" });
  await no("non-qualified finalist cannot be scored in Talent", rest("PUT", `finalScores/talent/zzj1/${SK}`, j1.token, talent("ZZ/1")));
  await ok("admin qualifies finalist 1 for Talent", rest("PUT", `finalists/${SK}/qualified/talent`, admin, true));
  await ok("qualified finalist can be scored in Talent", rest("PUT", `finalScores/talent/zzj1/${SK}`, j1.token, talent("ZZ/1")));
  await no("qualified flag must be true", rest("PUT", `finalists/${SK}/qualified/qa`, admin, false));

  console.log("\nLink management");
  await ok("admin regenerates judge 1's link", rest("PATCH", "judges/zzj1", admin, { token: "ZZN" + rand(25) }));
  await no("old session stops working after regeneration", rest("GET", "finalists", j1.token));
  await ok("judge 2 still works", rest("GET", "finalists", j2.token));
  await ok("admin disables judge 2", rest("PATCH", "judges/zzj2", admin, { active: false }));
  await no("disabled judge loses access immediately", rest("GET", "finalists", j2.token));
  await ok("admin re-enables judge 2", rest("PATCH", "judges/zzj2", admin, { active: true }));
  await ok("judge 2 works again", rest("GET", "finalists", j2.token));
  await ok("admin removes judge 2", rest("DELETE", "judges/zzj2", admin));
  await no("removed judge loses access", rest("GET", "finalists", j2.token));

  console.log("\nAdmin corrections");
  await ok("admin corrects a judge's score", rest("PATCH", `finalScores/walk/zzj1/${SK}`, admin, { "scores/c1": 10, correction: { originalTotal: 24, reason: "typo", correctedAt: Date.now(), count: 1 } }));
  await no("correction without a reason rejected", rest("PATCH", `finalScores/walk/zzj1/${SK}`, admin, { correction: { originalTotal: 24, correctedAt: Date.now(), count: 2 } }));
  await no("admin correction above max rejected", rest("PATCH", `finalScores/walk/zzj1/${SK}`, admin, { "scores/c1": 99 }));
  await ok("admin resets (deletes) a score", rest("DELETE", `finalScores/walk/zzj1/${SK}`, admin));
  await ok("admin enters a missing score", rest("PUT", `finalScores/walk/zzj1/${SK}`, admin, { scores: ORDER, timestamp: Date.now(), studentId: "ZZ/1", judgeName: "ZZ Judge One", enteredByAdmin: true }));
} finally {
  console.log("\nCleaning up…");
  await db.ref().update({
    finalConfig: null,
    finalists: null,
    judges: null,
    judgeTokens: null,
    judgeSessions: null,
    finalScores: null,
    [`students/${SK}`]: null,
    "evaluators/rules-test-ev@example,com": null,
  });
  for (const uid of cleanupUids) await auth.deleteUser(uid).catch(() => undefined);
  const left = await Promise.all(["finalConfig", "finalists", "judges", "judgeTokens", "judgeSessions", "finalScores", `students/${SK}`, "evaluators/rules-test-ev@example,com"].map(async (n) => (await db.ref(n).get()).exists()));
  console.log(left.some(Boolean) ? "⚠ some test data remains!" : "All test data removed.");
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
