import { CRITERIA_KEYS, type DayEvaluations, type Evaluation, type Evaluator, type EvaluationsTree, type Settings, type Student } from "./types";
import { dayKeys } from "./keys";

/** Round to at most 2 decimals without floating noise (86.5, 86.25, 91). */
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function fmt(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return String(round2(n));
}

/** Maximum marks one evaluator can give (default 4 × 10 = 40). */
export function perEvaluatorMax(settings: Settings | null | undefined): number {
  if (!settings) return 40;
  return CRITERIA_KEYS.reduce((s, k) => s + (Number(settings.criteria?.[k]?.max) || 0), 0);
}

export interface PanelMember {
  key: string;
  evaluator: Evaluator;
}

/**
 * The evaluation panel = every registered evaluator (active or not), ordered by number.
 * Every student must be evaluated by every panel member on each day.
 * Deactivating an evaluator only blocks their access; it does NOT drop them from scoring.
 */
export function panelOf(evaluators: Record<string, Evaluator> | null | undefined): PanelMember[] {
  return Object.entries(evaluators ?? {})
    .map(([key, evaluator]) => ({ key, evaluator }))
    .sort((a, b) => (a.evaluator.number ?? 0) - (b.evaluator.number ?? 0) || a.key.localeCompare(b.key));
}

export interface StudentDayResult {
  studentKey: string;
  /** One entry per panel member, in panel order. */
  entries: { member: PanelMember; evaluation: Evaluation | null }[];
  /** Evaluations from people no longer on the panel (removed evaluators) — shown but not counted. */
  orphanEvaluations: { evaluatorKey: string; evaluation: Evaluation }[];
  completedCount: number;
  requiredCount: number;
  /** Sum of the totals given by the evaluators who have scored this student so far. */
  rawTotal: number;
  /** requiredCount × perEvaluatorMax (default 10 × 40 = 400). */
  rawMax: number;
  /**
   * rawTotal / rawMax × 100, always out of the FULL panel (10 × 40 = 400).
   * A student scored by only some evaluators gets marks only from those evaluators
   * (e.g. 5 evaluators → at most 200/400 = 50/100): the more evaluators, the more marks.
   * null only when no evaluators are registered.
   */
  score100: number | null;
  complete: boolean;
}

export function computeStudentDay(
  studentKey: string,
  panel: PanelMember[],
  dayEvals: DayEvaluations | null | undefined,
  settings: Settings | null | undefined,
): StudentDayResult {
  const maxPer = perEvaluatorMax(settings);
  const panelKeys = new Set(panel.map((p) => p.key));
  const entries = panel.map((member) => ({
    member,
    evaluation: dayEvals?.[member.key]?.[studentKey] ?? null,
  }));
  const orphanEvaluations: StudentDayResult["orphanEvaluations"] = [];
  for (const [evaluatorKey, byStudent] of Object.entries(dayEvals ?? {})) {
    if (!panelKeys.has(evaluatorKey) && byStudent?.[studentKey]) {
      orphanEvaluations.push({ evaluatorKey, evaluation: byStudent[studentKey] });
    }
  }
  const done = entries.filter((e) => e.evaluation);
  const rawTotal = done.reduce((s, e) => s + (Number(e.evaluation!.total) || 0), 0);
  const requiredCount = panel.length;
  const rawMax = requiredCount * maxPer;
  const complete = requiredCount > 0 && done.length === requiredCount;
  // Multiply first so 346 × 100 / 400 = 86.5 exactly.
  const score100 = rawMax > 0 ? round2((rawTotal * 100) / rawMax) : null;
  return {
    studentKey,
    entries,
    orphanEvaluations,
    completedCount: done.length,
    requiredCount,
    rawTotal,
    rawMax,
    score100,
    complete,
  };
}

export interface DaySummary {
  day: string;
  students: number;
  evaluators: number;
  expected: number;
  completed: number;
  pending: number;
  percent: number;
  completeStudents: number;
}

export function computeDaySummary(
  day: string,
  students: Record<string, Student>,
  panel: PanelMember[],
  dayEvals: DayEvaluations | null | undefined,
): DaySummary {
  const studentKeys = Object.keys(students ?? {});
  const expected = studentKeys.length * panel.length;
  let completed = 0;
  const perStudent = new Map<string, number>();
  for (const m of panel) {
    const mine = dayEvals?.[m.key] ?? {};
    for (const sk of Object.keys(mine)) {
      if (students[sk]) {
        completed++;
        perStudent.set(sk, (perStudent.get(sk) ?? 0) + 1);
      }
    }
  }
  let completeStudents = 0;
  if (panel.length > 0) for (const c of perStudent.values()) if (c === panel.length) completeStudents++;
  return {
    day,
    students: studentKeys.length,
    evaluators: panel.length,
    expected,
    completed,
    pending: expected - completed,
    percent: expected > 0 ? round2((completed * 100) / expected) : 0,
    completeStudents,
  };
}

export interface EvaluatorProgress {
  member: PanelMember;
  completed: number;
  pending: number;
  percent: number;
  pendingStudentKeys: string[];
  lastAt: number | null;
}

export function computeEvaluatorProgress(
  students: Record<string, Student>,
  panel: PanelMember[],
  dayEvals: DayEvaluations | null | undefined,
): EvaluatorProgress[] {
  const studentKeys = Object.keys(students ?? {});
  return panel.map((member) => {
    const mine = dayEvals?.[member.key] ?? {};
    const pendingStudentKeys = studentKeys.filter((sk) => !mine[sk]);
    const completed = studentKeys.length - pendingStudentKeys.length;
    let lastAt: number | null = null;
    for (const ev of Object.values(mine)) if (ev?.timestamp && (!lastAt || ev.timestamp > lastAt)) lastAt = ev.timestamp;
    return {
      member,
      completed,
      pending: pendingStudentKeys.length,
      percent: studentKeys.length ? round2((completed * 100) / studentKeys.length) : 0,
      pendingStudentKeys,
      lastAt,
    };
  });
}

export interface FinalResult {
  studentKey: string;
  student: Student;
  days: Record<string, StudentDayResult>;
  /** Sum of daily /100 scores (each day out of the full panel). null only when no evaluators exist. */
  final: number | null;
  finalMax: number;
  percentage: number | null;
  complete: boolean;
  rank: number | null;
}

/** Standard competition ranking (1, 2, 2, 4) on a numeric key, descending. */
export function assignRanks<T>(items: T[], score: (t: T) => number | null, setRank: (t: T, r: number | null) => void) {
  const ranked = items.filter((t) => score(t) !== null).sort((a, b) => score(b)! - score(a)!);
  let prev: number | null = null;
  let prevRank = 0;
  ranked.forEach((t, i) => {
    const s = score(t)!;
    const r = prev !== null && round2(s) === round2(prev) ? prevRank : i + 1;
    setRank(t, r);
    prev = s;
    prevRank = r;
  });
  items.filter((t) => score(t) === null).forEach((t) => setRank(t, null));
}

export function computeFinalResults(
  students: Record<string, Student>,
  evaluators: Record<string, Evaluator>,
  evaluations: EvaluationsTree | null | undefined,
  settings: Settings | null | undefined,
  totalDays: number,
): FinalResult[] {
  const panel = panelOf(evaluators);
  const days = dayKeys(totalDays);
  const results: FinalResult[] = Object.entries(students ?? {}).map(([studentKey, student]) => {
    const perDay: Record<string, StudentDayResult> = {};
    for (const d of days) perDay[d] = computeStudentDay(studentKey, panel, evaluations?.[d], settings);
    const complete = days.every((d) => perDay[d].complete);
    const finalMax = days.length * 100;
    const final = panel.length ? round2(days.reduce((s, d) => s + (perDay[d].score100 ?? 0), 0)) : null;
    return {
      studentKey,
      student,
      days: perDay,
      final,
      finalMax,
      percentage: final !== null ? round2((final * 100) / finalMax) : null,
      complete,
      rank: null,
    };
  });
  assignRanks(results, (r) => r.final, (r, rank) => (r.rank = rank));
  return sortResults(results, (r) => r.final);
}

export function sortResults<T extends { student: Student }>(items: T[], score: (t: T) => number | null): T[] {
  return [...items].sort((a, b) => {
    const sa = score(a);
    const sb = score(b);
    if (sa !== null && sb !== null) return sb - sa || a.student.studentId.localeCompare(b.student.studentId);
    if (sa !== null) return -1;
    if (sb !== null) return 1;
    return a.student.studentId.localeCompare(b.student.studentId, undefined, { numeric: true });
  });
}

export function sumScores(s: Partial<Record<string, number | null>>): number {
  return CRITERIA_KEYS.reduce((t, k) => t + (Number(s[k]) || 0), 0);
}
