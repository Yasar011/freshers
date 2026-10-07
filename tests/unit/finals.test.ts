import { describe, expect, it } from "vitest";
import {
  autoPickFinalists,
  computeStandings,
  computeWinners,
  defaultFinalConfig,
  recommendAdvance,
  roundMax,
  type FinalScores,
  type Finalist,
  type Gender,
  type Judge,
} from "@/lib/finals";
import { guessGender } from "@/lib/gender";

const config = defaultFinalConfig();
const judges: Record<string, Judge> = {
  j1: { name: "Judge A", active: true, token: "x" },
  j2: { name: "Judge B", active: true, token: "y" },
};

function fin(number: number, gender: Gender, extra: Partial<Finalist> = {}): Finalist {
  return { studentId: `S/${number}`, name: `N${number}`, gender, number, ...extra };
}

/** Give every judge the same score `perCrit` for each criterion of the round. */
function addScore(scores: FinalScores, round: "walk" | "talent" | "qa", studentKey: string, perCrit: number, onlyJudge?: string) {
  const crit = Object.keys(config.rounds[round].criteria);
  scores[round] ??= {};
  for (const j of Object.keys(judges)) {
    if (onlyJudge && j !== onlyJudge) continue;
    scores[round]![j] ??= {};
    scores[round]![j][studentKey] = { scores: Object.fromEntries(crit.map((c) => [c, perCrit])), timestamp: 1, studentId: studentKey, judgeName: j };
  }
}

describe("finals scoring", () => {
  it("round max is the sum of criteria maxima", () => {
    expect(roundMax(config.rounds.walk)).toBe(30);
    expect(roundMax(config.rounds.qa)).toBe(40);
  });

  it("round score is out of the whole judge panel", () => {
    const finalists = { A: fin(1, "girl") };
    const scores: FinalScores = {};
    addScore(scores, "walk", "A", 8); // both judges: 24/30 each → 48/60 = 80
    const [s] = computeStandings(finalists, judges, scores, config);
    expect(s.rounds.walk.raw).toBe(48);
    expect(s.rounds.walk.max).toBe(60);
    expect(s.rounds.walk.score100).toBe(80);
    expect(s.rounds.walk.done).toBe(2);
  });

  it("a judge who has not scored yet adds nothing (fewer judges → fewer marks)", () => {
    const finalists = { A: fin(1, "girl") };
    const scores: FinalScores = {};
    addScore(scores, "walk", "A", 10, "j1"); // only j1: 30/60
    const [s] = computeStandings(finalists, judges, scores, config);
    expect(s.rounds.walk.score100).toBe(50);
    expect(s.rounds.walk.done).toBe(1);
  });

  it("combined score averages the three rounds (equal weights) and ranks within gender", () => {
    const finalists = {
      B1: fin(1, "boy", { qualified: { talent: true, qa: true } }),
      B2: fin(2, "boy", { qualified: { talent: true, qa: true } }),
      G1: fin(3, "girl", { qualified: { talent: true, qa: true } }),
      G2: fin(4, "girl", { qualified: { talent: true, qa: true } }),
    };
    const scores: FinalScores = {};
    for (const r of ["walk", "talent", "qa"] as const) {
      addScore(scores, r, "B1", 9);
      addScore(scores, r, "B2", 7);
      addScore(scores, r, "G1", 6);
      addScore(scores, r, "G2", 8);
    }
    const standings = computeStandings(finalists, judges, scores, config);
    const byKey = Object.fromEntries(standings.map((s) => [s.key, s]));
    expect(byKey.B1.rank).toBe(1);
    expect(byKey.B2.rank).toBe(2);
    expect(byKey.G2.rank).toBe(1);
    expect(byKey.G1.rank).toBe(2);
    const boys = computeWinners(standings, "boy");
    const girls = computeWinners(standings, "girl");
    expect(boys.winner?.key).toBe("B1");
    expect(boys.runnerUp?.key).toBe("B2");
    expect(girls.winner?.key).toBe("G2");
    expect(girls.runnerUp?.key).toBe("G1");
    expect(boys.complete).toBe(true);
    expect(boys.tie).toBe(false);
  });

  it("only Q&A finalists can win; others are unranked", () => {
    const finalists = { A: fin(1, "boy"), B: fin(2, "boy", { qualified: { talent: true, qa: true } }) };
    const scores: FinalScores = {};
    addScore(scores, "walk", "A", 10);
    addScore(scores, "walk", "B", 5);
    const standings = computeStandings(finalists, judges, scores, config);
    expect(standings.find((s) => s.key === "A")!.rank).toBeNull();
    expect(computeWinners(standings, "boy").winner?.key).toBe("B");
  });

  it("breaks ties by Q&A score, then 3-day score, and flags a true tie", () => {
    const finalists = {
      A: fin(1, "boy", { qualified: { talent: true, qa: true }, score3day: 80 }),
      B: fin(2, "boy", { qualified: { talent: true, qa: true }, score3day: 90 }),
    };
    const scores: FinalScores = {};
    // Same combined average (8), different Q&A: A walk 10 talent 8 qa 6 ; B walk 6 talent 8 qa 10
    addScore(scores, "walk", "A", 10);
    addScore(scores, "talent", "A", 8);
    addScore(scores, "qa", "A", 6);
    addScore(scores, "walk", "B", 6);
    addScore(scores, "talent", "B", 8);
    addScore(scores, "qa", "B", 10);
    let st = computeStandings(finalists, judges, scores, config);
    expect(st.find((s) => s.key === "A")!.combined).toBe(st.find((s) => s.key === "B")!.combined);
    expect(st[0].key).toBe("B"); // higher Q&A wins
    // Make everything equal → 3-day score decides
    const equal: FinalScores = {};
    for (const r of ["walk", "talent", "qa"] as const) {
      addScore(equal, r, "A", 8);
      addScore(equal, r, "B", 8);
    }
    st = computeStandings(finalists, judges, equal, config);
    expect(st[0].key).toBe("B");
    expect(st[0].tied).toBe(false);
    // Fully level → tie flagged
    const level = { ...finalists, B: { ...finalists.B, score3day: 80 } };
    st = computeStandings(level, judges, equal, config);
    expect(st[0].tied).toBe(true);
    expect(computeWinners(st, "boy").tie).toBe(true);
  });

  it("recommends the top 3 boys and top 3 girls to advance", () => {
    const finalists: Record<string, Finalist> = {};
    const scores: FinalScores = {};
    for (let i = 1; i <= 6; i++) {
      finalists[`B${i}`] = fin(i, "boy", { score3day: 50 + i });
      finalists[`G${i}`] = fin(10 + i, "girl", { score3day: 50 + i });
      addScore(scores, "walk", `B${i}`, i + 2);
      addScore(scores, "walk", `G${i}`, i + 2);
    }
    const rec = recommendAdvance("walk", finalists, judges, scores, config);
    const boys = rec.find((r) => r.gender === "boy")!;
    const girls = rec.find((r) => r.gender === "girl")!;
    expect(boys.picks).toEqual(["B6", "B5", "B4"]);
    expect(girls.picks).toEqual(["G6", "G5", "G4"]);
    expect(boys.tieAtCut).toBe(false);
    expect(girls.tieAtCut).toBe(false);
    expect(boys.wanted).toBe(3);
  });

  it("flags a tie at the cut when the 3rd and 4th are level", () => {
    const finalists: Record<string, Finalist> = {
      B1: fin(1, "boy", { score3day: 70 }),
      B2: fin(2, "boy", { score3day: 70 }),
      B3: fin(3, "boy", { score3day: 70 }),
      B4: fin(4, "boy", { score3day: 70 }),
    };
    const scores: FinalScores = {};
    for (const k of Object.keys(finalists)) addScore(scores, "walk", k, 7);
    const rec = recommendAdvance("walk", finalists, judges, scores, config).find((r) => r.gender === "boy")!;
    expect(rec.picks).toHaveLength(3);
    expect(rec.tieAtCut).toBe(true);
  });

  it("only talent finalists are considered after the walk round", () => {
    const finalists: Record<string, Finalist> = {
      B1: fin(1, "boy", { qualified: { talent: true } }),
      B2: fin(2, "boy"),
    };
    const scores: FinalScores = {};
    addScore(scores, "walk", "B1", 5);
    addScore(scores, "walk", "B2", 9);
    const rec = recommendAdvance("talent", finalists, judges, scores, config).find((r) => r.gender === "boy")!;
    expect(rec.candidates).toBe(1);
    expect(rec.picks).toEqual(["B1"]);
  });
});

describe("auto-pick final 20", () => {
  it("picks the top N boys and top N girls and ignores students without a gender", () => {
    const results = [
      ...Array.from({ length: 5 }, (_, i) => ({ studentKey: `B${i}`, student: { studentId: `B/${i}`, name: "b", gender: "boy" as const }, final: 100 + i })),
      ...Array.from({ length: 5 }, (_, i) => ({ studentKey: `G${i}`, student: { studentId: `G/${i}`, name: "g", gender: "girl" as const }, final: 200 + i })),
      { studentKey: "X", student: { studentId: "X/1", name: "x" }, final: 999 },
    ];
    const { picks, withoutGender } = autoPickFinalists(results, 3);
    expect(withoutGender).toBe(1);
    expect(picks.find((p) => p.gender === "boy")!.picks.map((p) => p.key)).toEqual(["B4", "B3", "B2"]);
    expect(picks.find((p) => p.gender === "girl")!.picks.map((p) => p.key)).toEqual(["G4", "G3", "G2"]);
    expect(picks.every((p) => !p.tieAtCut)).toBe(true);
  });

  it("flags a tie at the cut-off", () => {
    const results = [1, 2, 3].map((i) => ({ studentKey: `B${i}`, student: { studentId: `B/${i}`, name: "b", gender: "boy" as const }, final: 50 }));
    const { picks } = autoPickFinalists(results, 2);
    expect(picks.find((p) => p.gender === "boy")!.tieAtCut).toBe(true);
  });
});

describe("gender detection", () => {
  const g = (n: string) => guessGender(n);
  it("recognises common first names", () => {
    expect(g("Aditi Sharma")).toEqual({ gender: "girl", confidence: "high" });
    expect(g("Rohit Verma")).toEqual({ gender: "boy", confidence: "high" });
    expect(g("Vedant Pund")).toEqual({ gender: "boy", confidence: "high" });
  });
  it("finds the first name when the surname is written first", () => {
    expect(g("Wagh Pranit Madhav")?.gender).toBe("boy");
    expect(g("Gore Samiksha Amrut")?.gender).toBe("girl");
    expect(g("Padwal Rohini Ganesh")?.gender).toBe("girl");
  });
  it("uses Kaur / Kumari and flags unisex names for review", () => {
    expect(g("Meher Kaur Sethi")).toEqual({ gender: "girl", confidence: "high" });
    expect(g("Keerat Kaur Khurana")?.gender).toBe("girl");
    expect(g("Pranjal Manish Fulzele")?.confidence).toBe("low");
  });
  it("falls back to spelling with low confidence", () => {
    expect(g("Zorvina Qux")).toEqual({ gender: "girl", confidence: "low" });
    expect(g("Zorvak Qux")).toEqual({ gender: "boy", confidence: "low" });
  });
});

describe("finals export", () => {
  it("builds a standings sheet with winners and eliminated finalists", async () => {
    const { finalsStandingsSheet } = await import("@/lib/export");
    const { computeWinners } = await import("@/lib/finals");
    const finalists = {
      A: fin(1, "boy", { qualified: { talent: true, qa: true } }),
      B: fin(2, "boy", { qualified: { talent: true, qa: true } }),
      C: fin(3, "boy"),
    };
    const scores: FinalScores = {};
    for (const r of ["walk", "talent", "qa"] as const) {
      addScore(scores, r, "A", 9);
      addScore(scores, r, "B", 7);
    }
    addScore(scores, "walk", "C", 4);
    const standings = computeStandings(finalists, judges, scores, config);
    const winners = { boy: computeWinners(standings, "boy"), girl: computeWinners(standings, "girl") };
    const sheet = finalsStandingsSheet(standings, config, winners);
    const status = Object.fromEntries(sheet.rows.slice(1).map((r) => [r[4], r[r.length - 1]]));
    expect(status).toEqual({ N1: "WINNER", N2: "RUNNER-UP", N3: "Out after Fashion Walk" });
    expect(sheet.rows[0]).toContain("Final /100");
  });
});
