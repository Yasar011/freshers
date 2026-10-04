import { describe, expect, it } from "vitest";
import { computeDaySummary, computeEvaluatorProgress, computeFinalResults, computeStudentDay, panelOf, perEvaluatorMax, round2 } from "@/lib/scoring";
import { DEFAULT_SETTINGS } from "@/lib/constants";
import type { Evaluation, Evaluator, EvaluationsTree, Student } from "@/lib/types";

const evaluators: Record<string, Evaluator> = Object.fromEntries(
  Array.from({ length: 10 }, (_, i) => [`e${i + 1}@x,com`, { email: `e${i + 1}@x.com`, name: `Evaluator ${i + 1}`, number: i + 1, active: true }]),
);

function ev(total: number, studentId = "BFT/26/001"): Evaluation {
  // Split total into four criteria ≤ 10.
  const parts = [0, 0, 0, 0];
  let left = total;
  for (let i = 0; i < 4; i++) {
    parts[i] = Math.min(10, left);
    left -= parts[i];
  }
  return { makeup: parts[0], presentation: parts[1], styling: parts[2], dressup: parts[3], total, timestamp: 1, studentId, evaluatorName: "x" };
}

const SPEC_TOTALS = [34, 36, 31, 35, 37, 33, 35, 34, 36, 35]; // = 346

function dayWith(studentKey: string, totals: (number | null)[]) {
  const day: EvaluationsTree[string] = {};
  panelOf(evaluators).forEach((m, i) => {
    if (totals[i] !== null && totals[i] !== undefined) day[m.key] = { [studentKey]: ev(totals[i]!) };
  });
  return day;
}

describe("scoring", () => {
  it("one evaluator max is 40 with default criteria", () => {
    expect(perEvaluatorMax(DEFAULT_SETTINGS)).toBe(40);
  });

  it("converts 346/400 to exactly 86.5/100 (spec example)", () => {
    const r = computeStudentDay("S1", panelOf(evaluators), dayWith("S1", SPEC_TOTALS), DEFAULT_SETTINGS);
    expect(r.rawTotal).toBe(346);
    expect(r.rawMax).toBe(400);
    expect(r.score100).toBe(86.5);
    expect(r.complete).toBe(true);
  });

  it("never treats a missing evaluation as zero", () => {
    const totals: (number | null)[] = [...SPEC_TOTALS];
    totals[6] = null; // Evaluator 07 pending
    const r = computeStudentDay("S1", panelOf(evaluators), dayWith("S1", totals), DEFAULT_SETTINGS);
    expect(r.complete).toBe(false);
    expect(r.score100).toBeNull();
    expect(r.completedCount).toBe(9);
    expect(r.entries[6].evaluation).toBeNull();
  });

  it("does not compute from a single evaluator", () => {
    const r = computeStudentDay("S1", panelOf(evaluators), dayWith("S1", [40]), DEFAULT_SETTINGS);
    expect(r.score100).toBeNull();
  });

  it("final = sum of three days, percentage over 300 (spec example)", () => {
    // Day scores 86.5, 91, 88 → raw 346, 364, 352
    const students: Record<string, Student> = { S1: { studentId: "BFT/26/001", name: "Rahul" } };
    const d2 = [36, 37, 36, 37, 36, 37, 36, 37, 36, 36]; // 364
    const d3 = [35, 35, 35, 35, 35, 35, 35, 35, 36, 36]; // 352
    const evaluations: EvaluationsTree = { day1: dayWith("S1", SPEC_TOTALS), day2: dayWith("S1", d2), day3: dayWith("S1", d3) };
    const [r] = computeFinalResults(students, evaluators, evaluations, DEFAULT_SETTINGS, 3);
    expect(r.days.day1.score100).toBe(86.5);
    expect(r.days.day2.score100).toBe(91);
    expect(r.days.day3.score100).toBe(88);
    expect(r.final).toBe(265.5);
    expect(r.finalMax).toBe(300);
    expect(r.percentage).toBe(88.5);
    expect(r.rank).toBe(1);
  });

  it("marks students with a missing day as INCOMPLETE and leaves them unranked", () => {
    const students: Record<string, Student> = {
      A: { studentId: "A", name: "A" },
      B: { studentId: "B", name: "B" },
      C: { studentId: "C", name: "C" },
    };
    const full = (k: string, t: number) => dayWith(k, Array(10).fill(t));
    const merge = (...days: EvaluationsTree[string][]) => {
      const out: EvaluationsTree[string] = {};
      for (const d of days) for (const [ek, m] of Object.entries(d)) out[ek] = { ...(out[ek] ?? {}), ...m };
      return out;
    };
    const evaluations: EvaluationsTree = {
      day1: merge(full("A", 30), full("B", 30), full("C", 40)),
      day2: merge(full("A", 30), full("B", 30), full("C", 40)),
      day3: merge(full("A", 30), full("B", 30)), // C missing day 3
    };
    const res = computeFinalResults(students, evaluators, evaluations, DEFAULT_SETTINGS, 3);
    const byKey = Object.fromEntries(res.map((r) => [r.studentKey, r]));
    expect(byKey.C.final).toBeNull();
    expect(byKey.C.complete).toBe(false);
    expect(byKey.C.rank).toBeNull();
    // A and B tie → same rank (competition ranking)
    expect(byKey.A.rank).toBe(1);
    expect(byKey.B.rank).toBe(1);
    expect(res[res.length - 1].studentKey).toBe("C");
  });

  it("tracks expected / completed / pending (100 students × 10 evaluators)", () => {
    const students: Record<string, Student> = Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`S${i}`, { studentId: `S${i}`, name: `S${i}` }]));
    const day: EvaluationsTree[string] = {};
    const panel = panelOf(evaluators);
    let n = 0;
    for (const m of panel) {
      day[m.key] = {};
      for (let i = 0; i < 100 && n < 873; i++, n++) day[m.key][`S${i}`] = ev(30, `S${i}`);
    }
    const s = computeDaySummary("day1", students, panel, day);
    expect(s.expected).toBe(1000);
    expect(s.completed).toBe(873);
    expect(s.pending).toBe(127);
    expect(s.percent).toBe(87.3);
    const prog = computeEvaluatorProgress(students, panel, day);
    expect(prog[0].completed).toBe(100);
    expect(prog[8].completed).toBe(73);
    expect(prog[8].pending).toBe(27);
    expect(prog[9].pendingStudentKeys.length).toBe(100);
  });

  it("ignores evaluations of removed evaluators and of deleted students", () => {
    const students: Record<string, Student> = { S1: { studentId: "S1", name: "x" } };
    const day = dayWith("S1", SPEC_TOTALS);
    day["ghost@x,com"] = { S1: ev(40), GONE: ev(40) };
    const r = computeStudentDay("S1", panelOf(evaluators), day, DEFAULT_SETTINGS);
    expect(r.rawTotal).toBe(346);
    expect(r.orphanEvaluations).toHaveLength(1);
    const s = computeDaySummary("day1", students, panelOf(evaluators), day);
    expect(s.completed).toBe(10);
  });

  it("round2 avoids floating noise", () => {
    expect(round2(0.1 + 0.2)).toBe(0.3);
    expect(round2(86.25)).toBe(86.25);
  });
});
