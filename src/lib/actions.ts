"use client";
import { child, get, push, ref, serverTimestamp, set, update } from "firebase/database";
import { deleteObject, getDownloadURL, ref as sref, uploadBytes } from "firebase/storage";
import { db, storage } from "./firebase";
import { DEFAULT_SETTINGS, defaultEvent } from "./constants";
import { dayKeys, dayLabel, emailKey, evaluatorDisplayName, studentKey } from "./keys";
import { toStudentRecord } from "./studentImport";
import { resizeImage } from "./image";
import { CRITERIA_KEYS, type EventInfo, type Evaluation, type Evaluator, type EvaluationsTree, type Scores, type Settings, type Student } from "./types";
import { sumScores } from "./scoring";

export interface AdminIdentity {
  uid: string;
  email: string;
}

export type Updates = Record<string, unknown>;

interface AuditFields {
  action: string;
  details: string;
  studentId?: string;
  evaluator?: string;
  day?: string;
  reason?: string;
  before?: string;
  after?: string;
}

/** Add an audit log entry to a multi-path update so the change and its log are written atomically. */
export function withAudit(updates: Updates, admin: AdminIdentity, fields: AuditFields): Updates {
  const key = push(ref(db(), "auditLogs")).key!;
  const entry: Record<string, unknown> = {
    adminUid: admin.uid,
    adminEmail: admin.email,
    timestamp: serverTimestamp(),
  };
  for (const [k, v] of Object.entries(fields)) if (v !== undefined && v !== "") entry[k] = String(v).slice(0, k === "details" ? 4000 : 500);
  updates[`auditLogs/${key}`] = entry;
  return updates;
}

export async function audit(admin: AdminIdentity, fields: AuditFields) {
  await update(ref(db()), withAudit({}, admin, fields));
}

// ───────────────────────── Admin bootstrap ─────────────────────────

export async function claimAdmin(uid: string, email: string) {
  await set(ref(db(), "admin"), { uid, email: email.toLowerCase(), role: "main_admin", claimedAt: serverTimestamp() });
}

export async function initializeEvent(admin: AdminIdentity) {
  const [ev, st] = await Promise.all([get(ref(db(), "event")), get(ref(db(), "settings"))]);
  const updates: Updates = {};
  if (!ev.exists()) updates["event"] = defaultEvent(3);
  if (!st.exists()) updates["settings"] = DEFAULT_SETTINGS;
  if (!Object.keys(updates).length) return;
  await update(ref(db()), withAudit(updates, admin, { action: "event_initialized", details: "Initialised Freshers 2026 with 3 days and default criteria." }));
}

// ───────────────────────── Settings ─────────────────────────

export async function saveSettings(admin: AdminIdentity, event: EventInfo, settings: Settings, eventName: string) {
  const updates: Updates = {
    "settings/criteria": settings.criteria,
    "settings/evaluatorCount": settings.evaluatorCount,
    "settings/totalDays": settings.totalDays,
    "event/name": eventName,
    "event/totalDays": settings.totalDays,
  };
  for (const d of dayKeys(settings.totalDays)) {
    if (!event.days?.[d]) updates[`event/days/${d}`] = { label: dayLabel(d), status: "locked" };
  }
  for (const d of Object.keys(event.days ?? {})) {
    if (!dayKeys(settings.totalDays).includes(d)) {
      if (event.activeDay === d) throw new Error(`${dayLabel(d)} is the active day — make another day active first.`);
      updates[`event/days/${d}`] = null;
    }
  }
  const crit = CRITERIA_KEYS.map((k) => `${settings.criteria[k].label} /${settings.criteria[k].max}`).join(", ");
  await update(
    ref(db()),
    withAudit(updates, admin, {
      action: "settings_updated",
      details: `Event "${eventName}", ${settings.totalDays} days, ${settings.evaluatorCount} evaluators expected. Criteria: ${crit}.`,
    }),
  );
}

// ───────────────────────── Days ─────────────────────────

export async function openDay(admin: AdminIdentity, event: EventInfo, day: string) {
  const updates: Updates = {
    activeDay: day,
    [`days/${day}/status`]: "open",
    [`days/${day}/openedAt`]: serverTimestamp(),
  };
  const locked: string[] = [];
  for (const [d, info] of Object.entries(event.days ?? {})) {
    if (d !== day && info.status === "open") {
      updates[`days/${d}/status`] = "locked";
      updates[`days/${d}/lockedAt`] = serverTimestamp();
      locked.push(dayLabel(d));
    }
  }
  const prefixed: Updates = {};
  for (const [k, v] of Object.entries(updates)) prefixed[`event/${k}`] = v;
  await update(
    ref(db()),
    withAudit(prefixed, admin, {
      action: "day_opened",
      day,
      details: `${dayLabel(day)} opened and set as the active day.${locked.length ? ` Automatically locked: ${locked.join(", ")}.` : ""}`,
    }),
  );
}

export async function lockDay(admin: AdminIdentity, day: string) {
  await update(
    ref(db()),
    withAudit(
      { [`event/days/${day}/status`]: "locked", [`event/days/${day}/lockedAt`]: serverTimestamp() },
      admin,
      { action: "day_locked", day, details: `${dayLabel(day)} locked. Evaluators can no longer submit for this day.` },
    ),
  );
}

export async function setActiveDay(admin: AdminIdentity, event: EventInfo, day: string) {
  if (Object.entries(event.days).some(([d, i]) => d !== day && i.status === "open")) {
    throw new Error("Lock the currently open day before switching the active day.");
  }
  await update(
    ref(db()),
    withAudit({ "event/activeDay": day }, admin, { action: "active_day_changed", day, details: `Active day set to ${dayLabel(day)} (still locked).` }),
  );
}

// ───────────────────────── Students ─────────────────────────

export async function saveStudent(admin: AdminIdentity, student: Student, existingKey: string | null, existing?: Student) {
  const key = studentKey(student.studentId);
  if (existingKey && existingKey !== key) throw new Error("The Student ID cannot be changed. Delete and re-add the student instead.");
  if (!existingKey) {
    const snap = await get(child(ref(db(), "students"), key));
    if (snap.exists()) throw new Error(`Student ${student.studentId} already exists.`);
  }
  const record: Student = { ...toStudentRecord(student) };
  if (student.photoPath) record.photoPath = student.photoPath;
  const value = { ...record, createdAt: existing?.createdAt ?? serverTimestamp(), updatedAt: serverTimestamp() };
  const updates: Updates = { [`students/${key}`]: value };
  // Keep the finalist's copy of the name / gender / photo in sync.
  if (existingKey) {
    const fin = await get(ref(db(), `finalists/${key}`));
    if (fin.exists()) {
      updates[`finalists/${key}/name`] = student.name;
      updates[`contestants/n${fin.val().number}/name`] = student.name;
      if (student.gender) {
        updates[`finalists/${key}/gender`] = student.gender;
        updates[`contestants/n${fin.val().number}/gender`] = student.gender;
      }
      updates[`finalists/${key}/photo`] = student.photo ? student.photo : null;
    }
  }
  await update(
    ref(db()),
    withAudit(updates, admin, {
      action: existingKey ? "student_updated" : "student_added",
      studentId: student.studentId,
      details: `${existingKey ? "Updated" : "Added"} student ${student.studentId} — ${student.name}.`,
    }),
  );
  if (existing?.photoPath && existing.photoPath !== student.photoPath) {
    deleteObject(sref(storage(), existing.photoPath)).catch(() => undefined);
  }
}

export async function deleteStudent(admin: AdminIdentity, key: string, student: Student, evaluations: EvaluationsTree | null) {
  const updates: Updates = { [`students/${key}`]: null };
  let removed = 0;
  for (const [day, byEvaluator] of Object.entries(evaluations ?? {})) {
    for (const [ek, byStudent] of Object.entries(byEvaluator ?? {})) {
      if (byStudent?.[key]) {
        updates[`evaluations/${day}/${ek}/${key}`] = null;
        removed++;
      }
    }
  }
  // A deleted student can't stay in the Finals: drop the finalist, the judge-facing entry and any judge scores.
  const fin = await get(ref(db(), `finalists/${key}`));
  if (fin.exists()) {
    const cid = `n${fin.val().number}`;
    updates[`finalists/${key}`] = null;
    updates[`contestants/${cid}`] = null;
    const sc = (await get(ref(db(), "finalScores"))).val() ?? {};
    for (const [round, byJudge] of Object.entries(sc as Record<string, Record<string, Record<string, unknown>>>)) {
      for (const [judgeId, byCid] of Object.entries(byJudge ?? {})) if (byCid?.[cid]) updates[`finalScores/${round}/${judgeId}/${cid}`] = null;
    }
  }
  await update(
    ref(db()),
    withAudit(updates, admin, {
      action: "student_deleted",
      studentId: student.studentId,
      details: `Deleted student ${student.studentId} — ${student.name}${removed ? ` and ${removed} evaluation(s)` : ""}.`,
    }),
  );
  if (student.photoPath) deleteObject(sref(storage(), student.photoPath)).catch(() => undefined);
}

export async function importStudents(
  admin: AdminIdentity,
  list: Student[],
  existing: Record<string, Student>,
  overwrite: boolean,
  sources: string[],
): Promise<{ added: number; updated: number; skipped: number }> {
  let added = 0;
  let updated = 0;
  let skipped = 0;
  const entries: [string, unknown][] = [];
  for (const s of list) {
    const key = studentKey(s.studentId);
    const prev = existing[key];
    const record = toStudentRecord(s);
    if (prev) {
      if (!overwrite) {
        skipped++;
        continue;
      }
      for (const [f, v] of Object.entries(record)) entries.push([`students/${key}/${f}`, v]);
      entries.push([`students/${key}/updatedAt`, serverTimestamp()]);
      updated++;
    } else {
      entries.push([`students/${key}`, { ...record, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }]);
      added++;
    }
  }
  // Chunk large imports to keep each atomic write reasonably small.
  const CHUNK = 400;
  for (let i = 0; i < entries.length; i += CHUNK) {
    await update(ref(db()), Object.fromEntries(entries.slice(i, i + CHUNK)));
  }
  await audit(admin, {
    action: "students_imported",
    details: `Imported students from ${sources.join(", ") || "file"}: ${added} added, ${updated} updated, ${skipped} skipped (already existed).`,
  });
  return { added, updated, skipped };
}

export async function uploadStudentPhoto(studentId: string, file: File): Promise<{ url: string; path: string }> {
  const blob = await resizeImage(file);
  const path = `students/${studentId.replace(/[^A-Za-z0-9_-]/g, "_")}-${Date.now()}.jpg`;
  const r = sref(storage(), path);
  await uploadBytes(r, blob, { contentType: "image/jpeg", cacheControl: "public, max-age=31536000" });
  return { url: await getDownloadURL(r), path };
}

// ───────────────────────── Evaluators ─────────────────────────

export async function addEvaluator(admin: AdminIdentity, email: string, number: number, name: string) {
  const key = emailKey(email);
  const snap = await get(child(ref(db(), "evaluators"), key));
  if (snap.exists()) throw new Error("This Google account is already an evaluator.");
  const value: Evaluator & { createdAt: object } = {
    email: email.trim().toLowerCase(),
    number,
    name: name.trim() || evaluatorDisplayName({ number }),
    active: true,
    createdAt: serverTimestamp(),
  } as never;
  await update(
    ref(db()),
    withAudit({ [`evaluators/${key}`]: value }, admin, {
      action: "evaluator_added",
      evaluator: value.name,
      details: `Added ${value.name} (${value.email}).`,
    }),
  );
}

export async function updateEvaluator(admin: AdminIdentity, key: string, before: Evaluator, changes: Partial<Pick<Evaluator, "name" | "number" | "active">>) {
  const updates: Updates = {};
  const parts: string[] = [];
  if (changes.name !== undefined && changes.name !== before.name) {
    updates[`evaluators/${key}/name`] = changes.name.trim();
    parts.push(`name "${before.name}" → "${changes.name.trim()}"`);
  }
  if (changes.number !== undefined && changes.number !== before.number) {
    updates[`evaluators/${key}/number`] = changes.number;
    parts.push(`number ${before.number} → ${changes.number}`);
  }
  if (changes.active !== undefined && changes.active !== before.active) {
    updates[`evaluators/${key}/active`] = changes.active;
    parts.push(changes.active ? "activated" : "deactivated");
  }
  if (!parts.length) return;
  const action = changes.active === undefined ? "evaluator_updated" : changes.active ? "evaluator_activated" : "evaluator_deactivated";
  await update(ref(db()), withAudit(updates, admin, { action, evaluator: evaluatorDisplayName(before), details: `${evaluatorDisplayName(before)} (${before.email}): ${parts.join(", ")}.` }));
}

export async function removeEvaluator(admin: AdminIdentity, key: string, before: Evaluator) {
  await update(
    ref(db()),
    withAudit({ [`evaluators/${key}`]: null }, admin, {
      action: "evaluator_removed",
      evaluator: evaluatorDisplayName(before),
      details: `Removed ${evaluatorDisplayName(before)} (${before.email}) from the panel. Their submitted evaluations are kept in the database but no longer counted.`,
    }),
  );
}

// ───────────────────────── Evaluations ─────────────────────────

export function evaluationPath(day: string, evaluatorKey: string, sKey: string) {
  return `evaluations/${day}/${evaluatorKey}/${sKey}`;
}

/** Evaluator submission. Resolves only once the server has accepted the write. */
export function submitEvaluation(day: string, evaluatorKey: string, sKey: string, student: Student, evaluator: Evaluator, uid: string, scores: Scores) {
  const value = {
    ...scores,
    total: sumScores(scores),
    timestamp: serverTimestamp(),
    studentId: student.studentId,
    evaluatorName: evaluatorDisplayName(evaluator),
    evaluatorNumber: evaluator.number,
    evaluatorUid: uid,
  };
  return set(ref(db(), evaluationPath(day, evaluatorKey, sKey)), value);
}

const scoreText = (s: Partial<Scores> & { total?: number }) =>
  `${CRITERIA_KEYS.map((k) => s[k]).join("/")} = ${s.total ?? sumScores(s)}`;

export async function correctEvaluation(
  admin: AdminIdentity,
  day: string,
  evaluatorKey: string,
  sKey: string,
  current: Evaluation,
  scores: Scores,
  reason: string,
  perEvaluatorMax: number,
) {
  const total = sumScores(scores);
  const path = evaluationPath(day, evaluatorKey, sKey);
  const updates: Updates = {};
  for (const k of CRITERIA_KEYS) updates[`${path}/${k}`] = scores[k];
  updates[`${path}/total`] = total;
  updates[`${path}/correction`] = {
    // Keep the very first original score if corrected more than once.
    originalTotal: current.correction?.originalTotal ?? current.total,
    original: current.correction?.original ?? Object.fromEntries(CRITERIA_KEYS.map((k) => [k, current[k]])),
    reason,
    correctedAt: serverTimestamp(),
    correctedBy: admin.email,
    count: (current.correction?.count ?? 0) + 1,
  };
  await update(
    ref(db()),
    withAudit(updates, admin, {
      action: "score_corrected",
      day,
      studentId: current.studentId,
      evaluator: current.evaluatorName,
      reason,
      before: `${current.total}/${perEvaluatorMax} (${scoreText(current)})`,
      after: `${total}/${perEvaluatorMax} (${scoreText({ ...scores, total })})`,
      details: `${dayLabel(day)} · ${current.studentId} · ${current.evaluatorName}: ${current.total}/${perEvaluatorMax} → ${total}/${perEvaluatorMax}.`,
    }),
  );
}

export async function deleteEvaluation(admin: AdminIdentity, day: string, evaluatorKey: string, sKey: string, current: Evaluation, reason: string, perEvaluatorMax: number) {
  await update(
    ref(db()),
    withAudit({ [evaluationPath(day, evaluatorKey, sKey)]: null }, admin, {
      action: "evaluation_reset",
      day,
      studentId: current.studentId,
      evaluator: current.evaluatorName,
      reason,
      before: `${current.total}/${perEvaluatorMax} (${scoreText(current)})`,
      after: "deleted — evaluator may re-submit",
      details: `${dayLabel(day)} · ${current.studentId} · ${current.evaluatorName}: evaluation of ${current.total}/${perEvaluatorMax} removed so it can be re-submitted.`,
    }),
  );
}

export async function adminEnterEvaluation(
  admin: AdminIdentity,
  day: string,
  evaluatorKey: string,
  evaluator: Evaluator,
  sKey: string,
  student: Student,
  scores: Scores,
  reason: string,
  perEvaluatorMax: number,
) {
  const total = sumScores(scores);
  const value = {
    ...scores,
    total,
    timestamp: serverTimestamp(),
    studentId: student.studentId,
    evaluatorName: evaluatorDisplayName(evaluator),
    evaluatorNumber: evaluator.number,
    enteredByAdmin: true,
  };
  await update(
    ref(db()),
    withAudit({ [evaluationPath(day, evaluatorKey, sKey)]: value }, admin, {
      action: "evaluation_entered_by_admin",
      day,
      studentId: student.studentId,
      evaluator: evaluatorDisplayName(evaluator),
      reason,
      after: `${total}/${perEvaluatorMax} (${scoreText({ ...scores, total })})`,
      details: `${dayLabel(day)} · ${student.studentId} · ${evaluatorDisplayName(evaluator)}: score ${total}/${perEvaluatorMax} entered by Main Admin.`,
    }),
  );
}

export async function recordExport(admin: AdminIdentity, what: string) {
  await audit(admin, { action: "export", details: `Exported ${what}.` }).catch(() => undefined);
}
