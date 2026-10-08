"use client";
import { get, push, ref, serverTimestamp, set, update } from "firebase/database";
import { db } from "./firebase";
import { withAudit, type AdminIdentity, type Updates } from "./actions";
import { cidOf, contestantRecord, defaultFinalConfig, judgeTotal, roundMax, ROUND_KEYS, ROUND_TITLES, type FinalConfig, type FinalCriterion, type FinalScore, type FinalScores, type Finalist, type Gender, type Judge, type RoundKey } from "./finals";
import type { Student } from "./types";

// ───────────────────────── Setup ─────────────────────────

export async function initFinalConfig(admin: AdminIdentity) {
  const snap = await get(ref(db(), "finalConfig"));
  if (snap.exists()) return;
  await update(ref(db()), withAudit({ finalConfig: defaultFinalConfig() }, admin, { action: "finals_initialized", details: "Finals set up: Fashion Walk → Talent Round → Question & Answer." }));
}

// ───────────────────────── Gender ─────────────────────────

export async function setStudentGender(admin: AdminIdentity, key: string, student: Student, gender: Gender, finalist?: Finalist) {
  const updates: Updates = { [`students/${key}/gender`]: gender, [`students/${key}/genderConfirmed`]: true };
  if (finalist) {
    updates[`finalists/${key}/gender`] = gender;
    updates[`contestants/${cidOf(finalist)}/gender`] = gender;
  }
  await update(
    ref(db()),
    withAudit(updates, admin, {
      action: "gender_updated",
      studentId: student.studentId,
      details: `${student.studentId} — ${student.name}: set as ${gender === "boy" ? "Boy" : "Girl"}.`,
    }),
  );
}

export async function applyDetectedGenders(admin: AdminIdentity, entries: { key: string; gender: Gender; confident: boolean }[]) {
  const CHUNK = 400;
  for (let i = 0; i < entries.length; i += CHUNK) {
    const updates: Updates = {};
    for (const e of entries.slice(i, i + CHUNK)) {
      updates[`students/${e.key}/gender`] = e.gender;
      // Recognised first names are stored as confirmed; spelling-based guesses stay "unconfirmed" so they show in the review list.
      updates[`students/${e.key}/genderConfirmed`] = e.confident;
    }
    await update(ref(db()), updates);
  }
  const uncertain = entries.filter((e) => !e.confident).length;
  await update(
    ref(db()),
    withAudit({}, admin, {
      action: "gender_detected",
      details: `Auto-detected gender from names for ${entries.length} student(s); ${uncertain} need review.`,
    }),
  );
}

// ───────────────────────── Finalists ─────────────────────────

export function finalistRecord(student: Student, number: number, score3day: number | undefined, previous?: Finalist): Record<string, unknown> {
  const rec: Record<string, unknown> = {
    studentId: student.studentId,
    name: student.name,
    gender: student.gender,
    number,
    selectedAt: previous?.selectedAt ?? serverTimestamp(),
  };
  if (student.programme) rec.programme = student.programme;
  if (student.class) rec.class = student.class;
  if (student.photo) rec.photo = student.photo;
  if (score3day !== undefined) rec.score3day = score3day;
  if (previous?.qualified) rec.qualified = previous.qualified;
  return rec;
}

export async function selectFinalist(admin: AdminIdentity, key: string, student: Student, number: number, score3day: number | undefined) {
  if (!student.gender) throw new Error("Set the student's gender (Boy / Girl) first.");
  await update(
    ref(db()),
    withAudit(
      {
        [`finalists/${key}`]: finalistRecord(student, number, score3day),
        [`contestants/n${number}`]: contestantRecord({ number, gender: student.gender! } as Finalist),
      },
      admin,
      {
      action: "finalist_selected",
      studentId: student.studentId,
      details: `${student.studentId} — ${student.name} (${student.gender}) selected for the Finals as #${number}.`,
    }),
  );
}

/** Updates that delete every judge score given to a contestant (all rounds, all judges). */
function scoreDeletions(scores: FinalScores | null | undefined, cid: string): Updates {
  const u: Updates = {};
  for (const r of ROUND_KEYS) for (const [judgeId, byCid] of Object.entries(scores?.[r] ?? {})) if (byCid?.[cid]) u[`finalScores/${r}/${judgeId}/${cid}`] = null;
  return u;
}

export async function removeFinalist(admin: AdminIdentity, key: string, finalist: Finalist, scores?: FinalScores | null) {
  const cid = cidOf(finalist);
  const updates: Updates = { [`finalists/${key}`]: null, [`contestants/${cid}`]: null, ...scoreDeletions(scores, cid) };
  const n = Object.keys(updates).length - 2;
  await update(
    ref(db()),
    withAudit(updates, admin, {
      action: "finalist_removed",
      studentId: finalist.studentId,
      details: `${finalist.studentId} — ${finalist.name} (#${finalist.number}) removed from the Finals${n ? ` together with ${n} judge score(s)` : ""}.`,
    }),
  );
}

/** Replace the whole finalist list (auto-pick). Existing finalists that are kept retain their number and rounds. */
export async function replaceFinalists(
  admin: AdminIdentity,
  picks: { key: string; student: Student; score: number }[],
  current: Record<string, Finalist>,
  scores?: FinalScores | null,
) {
  const updates: Updates = {};
  const keep = new Set(picks.map((p) => p.key));
  for (const [k, f] of Object.entries(current)) {
    if (keep.has(k)) continue;
    updates[`finalists/${k}`] = null;
    updates[`contestants/${cidOf(f)}`] = null;
    Object.assign(updates, scoreDeletions(scores, cidOf(f)));
  }
  let next = Math.max(0, ...Object.values(current).map((f) => f.number || 0)) + 1;
  for (const p of picks) {
    const prev = current[p.key];
    const number = prev?.number ?? next++;
    updates[`finalists/${p.key}`] = finalistRecord(p.student, number, p.score, prev);
    updates[`contestants/n${number}`] = contestantRecord({ number, gender: p.student.gender!, qualified: prev?.qualified } as Finalist);
  }
  await update(
    ref(db()),
    withAudit(updates, admin, {
      action: "finalists_auto_picked",
      details: `Final list set to ${picks.length} finalists (${picks.filter((p) => p.student.gender === "boy").length} boys, ${picks.filter((p) => p.student.gender === "girl").length} girls) from the 3-day results.`,
    }),
  );
}

export async function setQualified(admin: AdminIdentity, round: "talent" | "qa", all: string[], selected: string[], finalists: Record<string, Finalist>) {
  const sel = new Set(selected);
  const updates: Updates = {};
  for (const k of all) {
    const v = sel.has(k) ? true : null;
    updates[`finalists/${k}/qualified/${round}`] = v;
    if (finalists[k]) updates[`contestants/${cidOf(finalists[k])}/qualified/${round}`] = v;
  }
  const names = selected.map((k) => finalists[k]?.name).filter(Boolean).join(", ");
  await update(
    ref(db()),
    withAudit(updates, admin, {
      action: "round_qualifiers_set",
      details: `${selected.length} finalist(s) selected for ${ROUND_TITLES[round]}: ${names || "none"}.`,
    }),
  );
}

// ───────────────────────── Judges ─────────────────────────

const ALPHABET = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(28));
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join("");
}

export function judgeLink(token: string): string {
  return `${window.location.origin}/judge/${token}`;
}

export async function createJudge(admin: AdminIdentity, name: string): Promise<string> {
  const id = push(ref(db(), "judges")).key!;
  const token = newToken();
  await update(
    ref(db()),
    withAudit(
      { [`judges/${id}`]: { name: name.trim(), active: true, token, createdAt: serverTimestamp() }, [`judgeTokens/${token}`]: id },
      admin,
      { action: "judge_created", evaluator: name.trim(), details: `Judge link created for ${name.trim()}.` },
    ),
  );
  return id;
}

export async function renameJudge(admin: AdminIdentity, id: string, judge: Judge, name: string) {
  await update(
    ref(db()),
    withAudit({ [`judges/${id}/name`]: name.trim() }, admin, { action: "judge_updated", evaluator: name.trim(), details: `Judge "${judge.name}" renamed to "${name.trim()}".` }),
  );
}

export async function setJudgeActive(admin: AdminIdentity, id: string, judge: Judge, active: boolean) {
  await update(
    ref(db()),
    withAudit({ [`judges/${id}/active`]: active }, admin, {
      action: active ? "judge_activated" : "judge_deactivated",
      evaluator: judge.name,
      details: `${judge.name}'s link ${active ? "re-enabled" : "disabled"}.`,
    }),
  );
}

export async function regenerateJudgeLink(admin: AdminIdentity, id: string, judge: Judge) {
  const token = newToken();
  await update(
    ref(db()),
    withAudit({ [`judgeTokens/${judge.token}`]: null, [`judgeTokens/${token}`]: id, [`judges/${id}/token`]: token }, admin, {
      action: "judge_link_regenerated",
      evaluator: judge.name,
      details: `A new link was generated for ${judge.name}; the old link no longer works.`,
    }),
  );
}

export async function removeJudge(admin: AdminIdentity, id: string, judge: Judge) {
  await update(
    ref(db()),
    withAudit({ [`judges/${id}`]: null, [`judgeTokens/${judge.token}`]: null }, admin, {
      action: "judge_removed",
      evaluator: judge.name,
      details: `Judge ${judge.name} removed. Scores they already gave are kept but no longer counted.`,
    }),
  );
}

// ───────────────────────── Rounds ─────────────────────────

export async function openRound(admin: AdminIdentity, config: FinalConfig, round: RoundKey) {
  const updates: Updates = {
    "finalConfig/activeRound": round,
    [`finalConfig/rounds/${round}/status`]: "open",
    [`finalConfig/rounds/${round}/openedAt`]: serverTimestamp(),
  };
  const closed: string[] = [];
  for (const [r, info] of Object.entries(config.rounds)) {
    if (r !== round && info.status === "open") {
      updates[`finalConfig/rounds/${r}/status`] = "locked";
      updates[`finalConfig/rounds/${r}/lockedAt`] = serverTimestamp();
      closed.push(info.label);
    }
  }
  await update(
    ref(db()),
    withAudit(updates, admin, {
      action: "round_opened",
      details: `${config.rounds[round].label} opened for judging.${closed.length ? ` Automatically locked: ${closed.join(", ")}.` : ""}`,
    }),
  );
}

export async function lockRound(admin: AdminIdentity, config: FinalConfig, round: RoundKey) {
  await update(
    ref(db()),
    withAudit(
      { [`finalConfig/rounds/${round}/status`]: "locked", [`finalConfig/rounds/${round}/lockedAt`]: serverTimestamp() },
      admin,
      { action: "round_locked", details: `${config.rounds[round].label} locked. Judges can no longer submit scores for it.` },
    ),
  );
}

export interface RoundSettings {
  label: string;
  note: string;
  weight: number;
  advanceBoys?: number;
  advanceGirls?: number;
  criteria: Record<string, FinalCriterion>;
}

export async function saveRoundSettings(admin: AdminIdentity, round: RoundKey, s: RoundSettings, perGender?: number) {
  const updates: Updates = {
    [`finalConfig/rounds/${round}/label`]: s.label.trim(),
    [`finalConfig/rounds/${round}/note`]: s.note.trim(),
    [`finalConfig/rounds/${round}/weight`]: s.weight,
    [`finalConfig/rounds/${round}/criteria`]: s.criteria,
  };
  if (s.advanceBoys !== undefined) updates[`finalConfig/rounds/${round}/advanceBoys`] = s.advanceBoys;
  if (s.advanceGirls !== undefined) updates[`finalConfig/rounds/${round}/advanceGirls`] = s.advanceGirls;
  if (perGender !== undefined) updates["finalConfig/perGender"] = perGender;
  const crit = Object.values(s.criteria).sort((a, b) => a.order - b.order).map((c) => `${c.label} /${c.max}`).join(", ");
  await update(
    ref(db()),
    withAudit(updates, admin, { action: "round_settings_updated", details: `${s.label}: weight ${s.weight}, criteria ${crit}.` }),
  );
}

// ───────────────────────── Scores (admin) ─────────────────────────

export const finalScorePath = (round: RoundKey, judgeId: string, cid: string) => `finalScores/${round}/${judgeId}/${cid}`;

/** Judge submission — resolves only once the server has accepted the write. */
export function submitFinalScore(round: RoundKey, judgeId: string, cid: string, judgeName: string, scores: Record<string, number>) {
  return set(ref(db(), finalScorePath(round, judgeId, cid)), {
    scores,
    timestamp: serverTimestamp(),
    judgeName,
  });
}

const scoreText = (c: Record<string, number>, crit: Record<string, FinalCriterion>) =>
  Object.entries(crit)
    .sort((a, b) => a[1].order - b[1].order)
    .map(([k]) => c[k] ?? 0)
    .join("/");

export async function correctFinalScore(
  admin: AdminIdentity,
  round: RoundKey,
  config: FinalConfig,
  judgeId: string,
  judgeName: string,
  finalist: Finalist,
  current: FinalScore,
  scores: Record<string, number>,
  reason: string,
) {
  const path = finalScorePath(round, judgeId, cidOf(finalist));
  const crit = config.rounds[round].criteria;
  const max = roundMax(config.rounds[round]);
  const total = Object.values(scores).reduce((s, v) => s + v, 0);
  const updates: Updates = {};
  for (const [k, v] of Object.entries(scores)) updates[`${path}/scores/${k}`] = v;
  updates[`${path}/correction`] = {
    originalTotal: current.correction?.originalTotal ?? judgeTotal(current),
    original: current.correction?.original ?? current.scores,
    reason,
    correctedAt: serverTimestamp(),
    correctedBy: admin.email,
    count: (current.correction?.count ?? 0) + 1,
  };
  await update(
    ref(db()),
    withAudit(updates, admin, {
      action: "final_score_corrected",
      day: round,
      studentId: finalist.studentId,
      evaluator: judgeName,
      reason,
      before: `${judgeTotal(current)}/${max} (${scoreText(current.scores, crit)})`,
      after: `${total}/${max} (${scoreText(scores, crit)})`,
      details: `${ROUND_TITLES[round]} · ${finalist.studentId} · judge ${judgeName}: ${judgeTotal(current)}/${max} → ${total}/${max}.`,
    }),
  );
}

export async function resetFinalScore(
  admin: AdminIdentity,
  round: RoundKey,
  config: FinalConfig,
  judgeId: string,
  judgeName: string,
  finalist: Finalist,
  current: FinalScore,
  reason: string,
) {
  const max = roundMax(config.rounds[round]);
  await update(
    ref(db()),
    withAudit({ [finalScorePath(round, judgeId, cidOf(finalist))]: null }, admin, {
      action: "final_score_reset",
      day: round,
      studentId: finalist.studentId,
      evaluator: judgeName,
      reason,
      before: `${judgeTotal(current)}/${max}`,
      after: "deleted — judge may re-submit",
      details: `${ROUND_TITLES[round]} · ${finalist.studentId} · judge ${judgeName}: score removed so it can be re-submitted.`,
    }),
  );
}

export async function adminEnterFinalScore(
  admin: AdminIdentity,
  round: RoundKey,
  config: FinalConfig,
  judgeId: string,
  judgeName: string,
  finalist: Finalist,
  scores: Record<string, number>,
  reason: string,
) {
  const max = roundMax(config.rounds[round]);
  const total = Object.values(scores).reduce((s, v) => s + v, 0);
  await update(
    ref(db()),
    withAudit(
      { [finalScorePath(round, judgeId, cidOf(finalist))]: { scores, timestamp: serverTimestamp(), judgeName, enteredByAdmin: true } },
      admin,
      {
        action: "final_score_entered_by_admin",
        day: round,
        studentId: finalist.studentId,
        evaluator: judgeName,
        reason,
        after: `${total}/${max} (${scoreText(scores, config.rounds[round].criteria)})`,
        details: `${ROUND_TITLES[round]} · ${finalist.studentId} · judge ${judgeName}: score ${total}/${max} entered by Main Admin.`,
      },
    ),
  );
}

export async function setPerGender(admin: AdminIdentity, n: number) {
  await update(
    ref(db()),
    withAudit({ "finalConfig/perGender": n }, admin, { action: "round_settings_updated", details: `Finalists per gender set to ${n} (${n * 2} in total).` }),
  );
}
