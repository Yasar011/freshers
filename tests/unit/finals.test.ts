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
/** Maps a finalist's key in the test data to its contestant id (scores are stored by "n<number>"). */
let REGISTRY: Record<string, Finalist> = {};
const reg = <T extends Record<string, Finalist>>(f: T): T => {
  REGISTRY = f;
  return f;
};
const judges: Record<string, Judge> = {
  j1: { name: "Judge A", active: true, token: "x" },
  j2: { name: "Judge B", active: true, token: "y" },
};

function fin(number: number, gender: Gender, extra: Partial<Finalist> = {}): Finalist {
  return { studentId: `S/${number}`, name: `N${number}`, gender, number, ...extra };
}

/** Give every judge the same score `perCrit` for each criterion of the round. */
function addScore(scores: FinalScores, round: "walk" | "talent" | "qa", finalistKey: string, perCrit: number, onlyJudge?: string) {
  const cid = "n" + REGISTRY[finalistKey].number;
  const crit = Object.keys(config.rounds[round].criteria);
  scores[round] ??= {};
  for (const j of Object.keys(judges)) {
    if (onlyJudge && j !== onlyJudge) continue;
    scores[round]![j] ??= {};
    scores[round]![j][cid] = { scores: Object.fromEntries(crit.map((c) => [c, perCrit])), timestamp: 1, judgeName: j };
  }
}

describe("finals scoring", () => {
  it("round max is the sum of criteria maxima", () => {
    expect(roundMax(config.rounds.walk)).toBe(30);
    expect(roundMax(config.rounds.qa)).toBe(40);
  });

  it("round score is out of the whole judge panel", () => {
    const finalists = reg({ A: fin(1, "girl") });
    const scores: FinalScores = {};
    addScore(scores, "walk", "A", 8); // both judges: 24/30 each → 48/60 = 80
    const [s] = computeStandings(finalists, judges, scores, config);
    expect(s.rounds.walk.raw).toBe(48);
    expect(s.rounds.walk.max).toBe(60);
    expect(s.rounds.walk.score100).toBe(80);
    expect(s.rounds.walk.done).toBe(2);
  });

  it("a judge who has not scored yet adds nothing (fewer judges → fewer marks)", () => {
    const finalists = reg({ A: fin(1, "girl") });
    const scores: FinalScores = {};
    addScore(scores, "walk", "A", 10, "j1"); // only j1: 30/60
    const [s] = computeStandings(finalists, judges, scores, config);
    expect(s.rounds.walk.score100).toBe(50);
    expect(s.rounds.walk.done).toBe(1);
  });

  it("combined score averages the three rounds (equal weights) and ranks within gender", () => {
    const finalists = reg({
      B1: fin(1, "boy", { qualified: { talent: true, qa: true } }),
      B2: fin(2, "boy", { qualified: { talent: true, qa: true } }),
      G1: fin(3, "girl", { qualified: { talent: true, qa: true } }),
      G2: fin(4, "girl", { qualified: { talent: true, qa: true } }),
    });
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
    const finalists = reg({ A: fin(1, "boy"), B: fin(2, "boy", { qualified: { talent: true, qa: true } }) });
    const scores: FinalScores = {};
    addScore(scores, "walk", "A", 10);
    addScore(scores, "walk", "B", 5);
    const standings = computeStandings(finalists, judges, scores, config);
    expect(standings.find((s) => s.key === "A")!.rank).toBeNull();
    expect(computeWinners(standings, "boy").winner?.key).toBe("B");
  });

  it("breaks ties by Q&A score, then 3-day score, and flags a true tie", () => {
    const finalists = reg({
      A: fin(1, "boy", { qualified: { talent: true, qa: true }, score3day: 80 }),
      B: fin(2, "boy", { qualified: { talent: true, qa: true }, score3day: 90 }),
    });
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

  it("eliminates the 3 lowest boys and 3 lowest girls (6 → 3 each go through)", () => {
    const finalists: Record<string, Finalist> = reg({});
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
    expect(boys.eliminate).toBe(3);
    expect(boys.eliminated).toEqual(["B3", "B2", "B1"]);
    expect(girls.eliminated).toEqual(["G3", "G2", "G1"]);
  });

  it("flags a tie at the cut when the 3rd and 4th are level", () => {
    const finalists: Record<string, Finalist> = reg({
      B1: fin(1, "boy", { score3day: 70 }),
      B2: fin(2, "boy", { score3day: 70 }),
      B3: fin(3, "boy", { score3day: 70 }),
      B4: fin(4, "boy", { score3day: 70 }),
    });
    const scores: FinalScores = {};
    for (const k of Object.keys(finalists)) addScore(scores, "walk", k, 7);
    const cfg = defaultFinalConfig();
    cfg.rounds.walk.eliminateBoys = 1;
    const rec = recommendAdvance("walk", finalists, judges, scores, cfg).find((r) => r.gender === "boy")!;
    expect(rec.picks).toHaveLength(3);
    expect(rec.eliminated).toHaveLength(1);
    expect(rec.tieAtCut).toBe(true);
  });

  it("only talent finalists are considered after the walk round", () => {
    const finalists: Record<string, Finalist> = reg({
      B1: fin(1, "boy", { qualified: { talent: true } }),
      B2: fin(2, "boy"),
    });
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
    const finalists = reg({
      A: fin(1, "boy", { qualified: { talent: true, qa: true } }),
      B: fin(2, "boy", { qualified: { talent: true, qa: true } }),
      C: fin(3, "boy"),
    });
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

describe("round elimination counts (10 + 10 finalists)", () => {
  it("10 boys → 7 after the first round → 4 after the second", () => {
    const finalists: Record<string, Finalist> = {};
    const scores: FinalScores = {};
    for (let i = 1; i <= 10; i++) finalists["B" + i] = fin(i, "boy", { score3day: 50 + i });
    reg(finalists);
    for (let i = 1; i <= 10; i++) addScore(scores, "walk", "B" + i, i * 0.9); // B10 best … B1 worst
    const r1 = recommendAdvance("walk", finalists, judges, scores, config).find((r) => r.gender === "boy")!;
    expect(r1.candidates).toBe(10);
    expect(r1.wanted).toBe(7);
    expect([...r1.eliminated].sort()).toEqual(["B1", "B2", "B3"]);
    for (const k of r1.picks) finalists[k] = { ...finalists[k], qualified: { talent: true } };
    for (const k of r1.picks) addScore(scores, "talent", k, Number(k.slice(1)) * 0.9);
    const r2 = recommendAdvance("talent", finalists, judges, scores, config).find((r) => r.gender === "boy")!;
    expect(r2.candidates).toBe(7);
    expect(r2.wanted).toBe(4);
    expect([...r2.eliminated].sort()).toEqual(["B4", "B5", "B6"]);
    expect(r2.picks).toEqual(["B10", "B9", "B8", "B7"]);
  });

  it("never eliminates everyone when there are very few contestants", () => {
    const finalists: Record<string, Finalist> = { A: fin(1, "girl") };
    reg(finalists);
    const r = recommendAdvance("walk", finalists, {}, {}, config).find((x) => x.gender === "girl")!;
    expect(r.wanted).toBe(1);
    expect(r.eliminated).toEqual([]);
  });
});

describe("judge panel (3–6 judges, only active links count)", () => {
  it("a disabled judge is not part of the panel, so scores are out of the remaining judges", async () => {
    const { judgePanel } = await import("@/lib/finals");
    const four: Record<string, Judge> = {
      a: { name: "A", active: true, token: "x" },
      b: { name: "B", active: true, token: "x" },
      c: { name: "C", active: true, token: "x" },
      d: { name: "D", active: false, token: "x" }, // did not turn up
    };
    expect(judgePanel(four).map((m) => m.id)).toEqual(["a", "b", "c"]);
    const finalists: Record<string, Finalist> = { F: fin(1, "girl") };
    reg(finalists);
    const scores: FinalScores = {};
    for (const j of ["a", "b", "c"]) {
      scores.walk ??= {};
      scores.walk[j] = { n1: { scores: { c1: 10, c2: 10, c3: 10 }, timestamp: 1, judgeName: j } };
    }
    const [s] = computeStandings(finalists, four, scores, config);
    expect(s.rounds.walk.required).toBe(3);
    expect(s.rounds.walk.score100).toBe(100); // 90 / (3 × 30)
  });
});
