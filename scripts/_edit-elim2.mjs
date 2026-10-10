import { readFileSync, writeFileSync } from "node:fs";
// rules
const rules = JSON.parse(readFileSync("database.rules.json", "utf8"));
const r = rules.rules.finalConfig.rounds.$round;
r.eliminateBoys = r.advanceBoys;
r.eliminateGirls = r.advanceGirls;
delete r.advanceBoys;
delete r.advanceGirls;
// keep $other last
const other = r.$other;
delete r.$other;
r.$other = other;
writeFileSync("database.rules.json", JSON.stringify(rules, null, 2) + "\n");

// tests
let t = readFileSync("tests/unit/finals.test.ts", "utf8");
const rep = (a, b) => {
  if (!t.includes(a)) throw new Error("nf " + a.slice(0, 70));
  t = t.replace(a, b);
};
rep(`  it("recommends the top 3 boys and top 3 girls to advance", () => {`, `  it("eliminates the 3 lowest boys and 3 lowest girls (6 → 3 each go through)", () => {`);
rep(`    expect(boys.wanted).toBe(3);`, `    expect(boys.wanted).toBe(3);
    expect(boys.eliminate).toBe(3);
    expect(boys.eliminated).toEqual(["B3", "B2", "B1"]);
    expect(girls.eliminated).toEqual(["G3", "G2", "G1"]);`);
// 4-boy tie test: eliminate 1 so that 3 go through and the 3rd/4th are level
rep(`    const rec = recommendAdvance("walk", finalists, judges, scores, config).find((r) => r.gender === "boy")!;
    expect(rec.picks).toHaveLength(3);
    expect(rec.tieAtCut).toBe(true);`, `    const cfg = defaultFinalConfig();
    cfg.rounds.walk.eliminateBoys = 1;
    const rec = recommendAdvance("walk", finalists, judges, scores, cfg).find((r) => r.gender === "boy")!;
    expect(rec.picks).toHaveLength(3);
    expect(rec.eliminated).toHaveLength(1);
    expect(rec.tieAtCut).toBe(true);`);
t += `
describe("round elimination counts (10 + 10 finalists)", () => {
  it("10 boys → 7 after the first round → 4 after the second", () => {
    const finalists: Record<string, Finalist> = {};
    const scores: FinalScores = {};
    for (let i = 1; i <= 10; i++) {
      finalists["B" + i] = fin(i, "boy", { score3day: 50 + i });
    }
    reg(finalists);
    for (let i = 1; i <= 10; i++) addScore(scores, "walk", "B" + i, i * 0.9); // B10 best … B1 worst
    const r1 = recommendAdvance("walk", finalists, judges, scores, config).find((r) => r.gender === "boy")!;
    expect(r1.candidates).toBe(10);
    expect(r1.wanted).toBe(7);
    expect(r1.eliminated.sort()).toEqual(["B1", "B2", "B3"]);
    // seven go through to Talent
    for (const k of r1.picks) finalists[k] = { ...finalists[k], qualified: { talent: true } };
    for (const k of r1.picks) addScore(scores, "talent", k, Number(k.slice(1)) * 0.9);
    const r2 = recommendAdvance("talent", finalists, judges, scores, config).find((r) => r.gender === "boy")!;
    expect(r2.candidates).toBe(7);
    expect(r2.wanted).toBe(4);
    expect(r2.eliminated.sort()).toEqual(["B4", "B5", "B6"]);
    expect(r2.picks).toEqual(["B10", "B9", "B8", "B7"]);
  });

  it("never eliminates everyone when there are very few contestants", () => {
    const finalists: Record<string, Finalist> = { A: fin(1, "girl") };
    const scores: FinalScores = {};
    reg(finalists);
    const r = recommendAdvance("walk", finalists, judges, scores, config).find((x) => x.gender === "girl")!;
    expect(r.wanted).toBe(1);
    expect(r.eliminated).toEqual([]);
  });
});
`;
writeFileSync("tests/unit/finals.test.ts", t);
console.log("ok");
