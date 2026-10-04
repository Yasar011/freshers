/**
 * Verifies the DEPLOYED Realtime Database security rules end-to-end, using temporary test
 * users (rules-test-*@example.com), a temporary test student and a temporary /admin record.
 * Everything it creates is removed afterwards.
 *
 * Run ONLY before the real Main Admin has signed in for the first time, or while no evaluation
 * is in progress (it temporarily opens/locks Day 1 and restores it afterwards):
 *
 *   GOOGLE_APPLICATION_CREDENTIALS=path/to/key.json node scripts/verify-rules-live.mjs
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { initializeApp, cert } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getDatabase } = require("firebase-admin/database");

const PROJECT = "freshers-c63aa";
const DB_URL = `https://${PROJECT}-default-rtdb.firebaseio.com`;
const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
);
const API_KEY = env.NEXT_PUBLIC_FIREBASE_API_KEY;

const app = initializeApp({ credential: cert(JSON.parse(readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS, "utf8"))), databaseURL: DB_URL });
const auth = getAuth(app);
const db = getDatabase(app);

const emailKey = (e) => e.toLowerCase().replace(/\./g, ",");
const SK = "ZZTEST%2F1"; // studentKey("ZZTEST/1")
const users = {
  a: "rules-test-a@example.com",
  b: "rules-test-b@example.com",
  stranger: "rules-test-c@example.com",
  unverified: "rules-test-d@example.com",
  admin: "rules-test-e@example.com",
};

async function idToken(uid) {
  const custom = await auth.createCustomToken(uid);
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: custom, returnSecureToken: true }),
  });
  const j = await r.json();
  if (!j.idToken) throw new Error("token exchange failed: " + JSON.stringify(j));
  return j.idToken;
}

const enc = (path) => path.split("/").map(encodeURIComponent).join("/");
async function rest(method, path, token, body) {
  const url = `${DB_URL}/${enc(path)}.json${token ? `?auth=${token}` : ""}`;
  const r = await fetch(url, { method, body: body === undefined ? undefined : JSON.stringify(body) });
  return r.status;
}

let pass = 0;
let fail = 0;
async function expectOk(name, p) {
  const s = await p;
  if (s === 200) pass++, console.log(`  ✓ ${name}`);
  else fail++, console.log(`  ✗ ${name} — expected ALLOWED, got ${s}`);
}
async function expectDenied(name, p) {
  const s = await p;
  if (s === 401 || s === 403) pass++, console.log(`  ✓ ${name}`);
  else fail++, console.log(`  ✗ ${name} — expected DENIED, got ${s}`);
}

const uids = {};
const evalValue = (over = {}) => ({
  makeup: 8, presentation: 9, styling: 7, dressup: 10, total: 34,
  timestamp: { ".sv": "timestamp" }, studentId: "ZZTEST/1", evaluatorName: "Rules Test", evaluatorNumber: 98, ...over,
});

const before = (await db.ref("event").get()).val();
const adminBefore = (await db.ref("admin").get()).val();
if (adminBefore) {
  console.error("Refusing to run: /admin is already claimed. This script is for pre-event verification only.");
  process.exit(1);
}

try {
  console.log("Setting up temporary users and data…");
  for (const [k, email] of Object.entries(users)) {
    const existing = await auth.getUserByEmail(email).catch(() => null);
    if (existing) await auth.deleteUser(existing.uid);
    const u = await auth.createUser({ email, emailVerified: k !== "unverified" });
    uids[k] = u.uid;
  }
  await db.ref().update({
    [`evaluators/${emailKey(users.a)}`]: { email: users.a, name: "Rules Test A", number: 98, active: true },
    [`evaluators/${emailKey(users.b)}`]: { email: users.b, name: "Rules Test B", number: 99, active: true },
    [`evaluators/${emailKey(users.unverified)}`]: { email: users.unverified, name: "Rules Test D", number: 97, active: true },
    [`students/${SK}`]: { studentId: "ZZTEST/1", name: "Rules Test Student" },
    "event/activeDay": "day1",
    "event/days/day1/status": "open",
    admin: { uid: uids.admin, email: users.admin, role: "main_admin" },
  });
  const t = {};
  for (const k of Object.keys(users)) t[k] = await idToken(uids[k]);
  const A = emailKey(users.a);
  const B = emailKey(users.b);

  console.log("\nUnauthenticated / unauthorised");
  await expectDenied("anonymous cannot read students", rest("GET", "students", null));
  await expectDenied("anonymous cannot read root", rest("GET", "", null));
  await expectDenied("stranger cannot read students", rest("GET", "students", t.stranger));
  await expectDenied("stranger cannot read event", rest("GET", "event", t.stranger));
  await expectDenied("stranger cannot read /admin", rest("GET", "admin", t.stranger));
  await expectDenied("stranger cannot write an evaluation", rest("PUT", `evaluations/day1/${emailKey(users.stranger)}/${SK}`, t.stranger, evalValue()));
  await expectDenied("unverified-email evaluator cannot read students", rest("GET", "students", t.unverified));

  console.log("\nEvaluator reads");
  await expectOk("evaluator reads students", rest("GET", "students", t.a));
  await expectOk("evaluator reads event", rest("GET", "event", t.a));
  await expectOk("evaluator reads settings", rest("GET", "settings", t.a));
  await expectOk("evaluator reads own evaluator record", rest("GET", `evaluators/${A}`, t.a));
  await expectDenied("evaluator cannot list evaluators", rest("GET", "evaluators", t.a));
  await expectDenied("evaluator cannot read another evaluator", rest("GET", `evaluators/${B}`, t.a));
  await expectDenied("evaluator cannot read /admin", rest("GET", "admin", t.a));
  await expectDenied("evaluator cannot read all evaluations", rest("GET", "evaluations", t.a));
  await expectDenied("evaluator cannot read whole day", rest("GET", "evaluations/day1", t.a));
  await expectOk("evaluator reads own evaluations", rest("GET", `evaluations/day1/${A}`, t.a));
  await expectDenied("evaluator cannot read other evaluator's scores", rest("GET", `evaluations/day1/${B}`, t.a));
  await expectDenied("evaluator cannot read audit logs", rest("GET", "auditLogs", t.a));

  console.log("\nEvaluator writes");
  await expectOk("evaluator submits own evaluation", rest("PUT", `evaluations/day1/${A}/${SK}`, t.a, evalValue()));
  await expectDenied("duplicate submission is rejected", rest("PUT", `evaluations/day1/${A}/${SK}`, t.a, evalValue({ makeup: 10, total: 36 })));
  await expectDenied("evaluator cannot edit own score", rest("PATCH", `evaluations/day1/${A}/${SK}`, t.a, { makeup: 10, total: 36 }));
  await expectDenied("evaluator cannot delete own score", rest("DELETE", `evaluations/day1/${A}/${SK}`, t.a));
  await expectDenied("evaluator cannot write as another evaluator", rest("PUT", `evaluations/day1/${B}/${SK}`, t.a, evalValue()));
  await expectDenied("score above max (11) rejected", rest("PUT", `evaluations/day1/${B}/${SK}`, t.b, evalValue({ makeup: 11, total: 37 })));
  await expectDenied("negative score rejected", rest("PUT", `evaluations/day1/${B}/${SK}`, t.b, evalValue({ makeup: -1, total: 25 })));
  await expectDenied("fractional score rejected", rest("PUT", `evaluations/day1/${B}/${SK}`, t.b, evalValue({ makeup: 7.5, total: 33.5 })));
  await expectDenied("wrong total rejected", rest("PUT", `evaluations/day1/${B}/${SK}`, t.b, evalValue({ total: 40 })));
  await expectDenied("client-chosen timestamp rejected", rest("PUT", `evaluations/day1/${B}/${SK}`, t.b, evalValue({ timestamp: 1 })));
  await expectDenied("extra field rejected", rest("PUT", `evaluations/day1/${B}/${SK}`, t.b, evalValue({ hacked: true })));
  await expectDenied("evaluator cannot fake an admin correction", rest("PUT", `evaluations/day1/${B}/${SK}`, t.b, evalValue({ correction: { originalTotal: 1, reason: "x", correctedAt: 1, count: 1 } })));
  await expectDenied("unknown student rejected", rest("PUT", `evaluations/day1/${B}/NOPE`, t.b, evalValue()));
  await expectDenied("non-active day rejected", rest("PUT", `evaluations/day2/${B}/${SK}`, t.b, evalValue()));
  await expectDenied("evaluator cannot modify students", rest("PUT", `students/${SK}/name`, t.a, "Hacked"));
  await expectDenied("evaluator cannot add students", rest("PUT", "students/NEW", t.a, { studentId: "NEW", name: "x" }));
  await expectDenied("evaluator cannot change settings", rest("PUT", "settings/evaluatorCount", t.a, 1));
  await expectDenied("evaluator cannot open/lock days", rest("PUT", "event/days/day2/status", t.a, "open"));
  await expectDenied("evaluator cannot activate themselves", rest("PUT", `evaluators/${A}/active`, t.a, true));
  await expectDenied("evaluator cannot write audit logs", rest("PUT", "auditLogs/x", t.a, { action: "x", adminUid: uids.a, timestamp: { ".sv": "timestamp" }, details: "x" }));
  await expectDenied("evaluator cannot claim /admin", rest("PUT", "admin", t.a, { uid: uids.a, email: users.a, role: "main_admin" }));
  await expectOk("evaluator may record own uid", rest("PUT", `evaluators/${A}/uid`, t.a, uids.a));
  await expectDenied("evaluator cannot record someone else's uid", rest("PUT", `evaluators/${A}/uid`, t.a, uids.b));

  console.log("\nLocking & deactivation");
  await db.ref("event/days/day1/status").set("locked");
  await expectDenied("submission rejected when day is locked", rest("PUT", `evaluations/day1/${B}/${SK}`, t.b, evalValue()));
  await db.ref("event/days/day1/status").set("open");
  await expectOk("submission accepted after unlock", rest("PUT", `evaluations/day1/${B}/${SK}`, t.b, evalValue()));
  await db.ref(`evaluators/${A}/active`).set(false);
  await expectDenied("deactivated evaluator cannot read students", rest("GET", "students", t.a));
  await expectDenied("deactivated evaluator cannot read own evaluations", rest("GET", `evaluations/day1/${A}`, t.a));
  await expectOk("deactivated evaluator can still see own (inactive) record", rest("GET", `evaluators/${A}`, t.a));

  console.log("\nMain Admin");
  await expectOk("admin reads /admin", rest("GET", "admin", t.admin));
  await expectOk("admin reads all evaluations", rest("GET", "evaluations", t.admin));
  await expectOk("admin reads evaluators", rest("GET", "evaluators", t.admin));
  await expectOk("admin corrects a score", rest("PATCH", `evaluations/day1/${A}/${SK}`, t.admin, { makeup: 10, total: 36, correction: { originalTotal: 34, reason: "test", correctedAt: Date.now(), count: 1 } }));
  await expectDenied("admin correction with wrong total rejected", rest("PATCH", `evaluations/day1/${A}/${SK}`, t.admin, { makeup: 9 }));
  await expectOk("admin deletes an evaluation", rest("DELETE", `evaluations/day1/${B}/${SK}`, t.admin));
  await expectOk("admin edits students", rest("PUT", `students/${SK}/class`, t.admin, "TEST"));
  await expectOk("admin changes settings", rest("PUT", "settings/evaluatorCount", t.admin, 10));
  await expectOk("admin writes an audit log", rest("PUT", "auditLogs/zz-rules-test", t.admin, { action: "test", adminUid: uids.admin, timestamp: { ".sv": "timestamp" }, details: "rules test" }));
  await expectDenied("audit log cannot be overwritten", rest("PUT", "auditLogs/zz-rules-test", t.admin, { action: "test2", adminUid: uids.admin, timestamp: { ".sv": "timestamp" }, details: "x" }));
  await expectDenied("audit log cannot be deleted", rest("DELETE", "auditLogs/zz-rules-test", t.admin));
  await expectDenied("admin cannot overwrite /admin from the client", rest("PUT", "admin", t.admin, { uid: uids.stranger, email: users.admin, role: "main_admin" }));
  await db.ref("admin").remove();
  await expectDenied("non-designated email cannot claim an empty /admin", rest("PUT", "admin", t.stranger, { uid: uids.stranger, email: users.stranger, role: "main_admin", claimedAt: { ".sv": "timestamp" } }));
  await expectDenied("ex-admin loses access once /admin no longer matches", rest("GET", "evaluations", t.admin));
} finally {
  console.log("\nCleaning up…");
  await db.ref().update({
    [`evaluators/${emailKey(users.a)}`]: null,
    [`evaluators/${emailKey(users.b)}`]: null,
    [`evaluators/${emailKey(users.unverified)}`]: null,
    [`students/${SK}`]: null,
    [`evaluations/day1/${emailKey(users.a)}`]: null,
    [`evaluations/day1/${emailKey(users.b)}`]: null,
    [`evaluations/day2/${emailKey(users.b)}`]: null,
    "auditLogs/zz-rules-test": null,
    admin: null,
    "event/activeDay": before?.activeDay ?? "day1",
    "event/days/day1": before?.days?.day1 ?? { label: "Day 1", status: "locked" },
    "settings/evaluatorCount": 10,
  });
  for (const uid of Object.values(uids)) await auth.deleteUser(uid).catch(() => undefined);
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
