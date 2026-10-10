import type { Gender, Student } from "./types";
import { round2 } from "./scoring";

export type { Gender };
export const GENDERS: Gender[] = ["boy", "girl"];
export type RoundKey = "walk" | "talent" | "qa";
export const ROUND_KEYS: RoundKey[] = ["walk", "talent", "qa"];

export interface FinalCriterion {
  label: string;
  max: number;
  order: number;
}

export interface FinalRound {
  label: string;
  order: number;
  status: "open" | "locked";
  /** Weight of this round in the combined final score. */
  weight: number;
  /** How many boys / girls with the LOWEST scores are eliminated after this round (walk, talent). */
  eliminateBoys?: number;
  eliminateGirls?: number;
  note?: string;
  openedAt?: number;
  lockedAt?: number;
  criteria: Record<string, FinalCriterion>;
}

export interface FinalConfig {
  activeRound: RoundKey;
  /** Finalists per gender (Final 20 = 10 boys + 10 girls). */
  perGender: number;
  rounds: Record<RoundKey, FinalRound>;
}

export interface Finalist {
  studentId: string;
  name: string;
  gender: Gender;
  number: number;
  programme?: string;
  class?: string;
  photo?: string;
  /** 3-day score at the time of selection (used for tie-breaks). */
  score3day?: number;
  selectedAt?: number;
  qualified?: Partial<Record<RoundKey, boolean>>;
}

export interface Judge {
  name: string;
  active: boolean;
  token: string;
  createdAt?: number;
}

export interface FinalScoreCorrection {
  originalTotal: number;
  original?: Record<string, number>;
  reason: string;
  correctedAt: number;
  correctedBy?: string;
  count: number;
}

/**
 * What a judge is allowed to know about a contestant: the number, the name and the gender grouping.
 * Stored at /contestants/{cid} (judge-readable). Student IDs, classes/departments and photos live only in
 * /finalists (admin-only), so they never reach a judge's browser.
 */
export interface Contestant {
  number: number;
  name: string;
  gender: Gender;
  qualified?: Partial<Record<RoundKey, boolean>>;
}

/** Opaque contestant id used for judge-facing data and score keys ("n7" for contestant #7). */
export const cidOf = (f: { number: number }) => `n${f.number}`;

export function contestantRecord(f: Finalist): Contestant {
  const c: Contestant = { number: f.number, name: f.name, gender: f.gender };
  if (f.qualified && Object.values(f.qualified).some(Boolean)) c.qualified = f.qualified;
  return c;
}

export interface FinalScore {
  scores: Record<string, number>;
  timestamp: number;
  judgeName: string;
  enteredByAdmin?: boolean;
  correction?: FinalScoreCorrection;
}

/** finalScores/{round}/{judgeId}/{cid}  — keyed by contestant id (cidOf), never by student ID */
export type FinalScores = Partial<Record<RoundKey, Record<string, Record<string, FinalScore>>>>;

export const ROUND_TITLES: Record<RoundKey, string> = { walk: "Fashion Walk", talent: "Talent Round", qa: "Question & Answer" };

export function defaultFinalConfig(): FinalConfig {
  const c = (label: string, order: number): FinalCriterion => ({ label, max: 10, order });
  return {
    activeRound: "walk",
    perGender: 10,
    rounds: {
      walk: {
        label: "Fashion Walk",
        order: 1,
        status: "locked",
        weight: 1,
        eliminateBoys: 3,
        eliminateGirls: 3,
        note: "Walk on stage",
        criteria: {
          c1: c("Confidence & Walk", 1),
          c2: c("Relevance to Theme", 2),
          c3: c("Overall Impact", 3),
        },
      },
      talent: {
        label: "Talent Round",
        order: 2,
        status: "locked",
        weight: 1,
        eliminateBoys: 3,
        eliminateGirls: 3,
        note: "Keep audios ready, if any",
        criteria: {
          c1: c("Creativity & Talent", 1),
          c2: c("Relevance to Theme", 2),
          c3: c("Overall Impact", 3),
        },
      },
      qa: {
        label: "Question & Answer",
        order: 3,
        status: "locked",
        weight: 1,
        note: "Questions are given on the spot",
        criteria: {
          c1: c("Content of Answer", 1),
          c2: c("Communication & Clarity", 2),
          c3: c("Confidence & Poise", 3),
          c4: c("Overall Impact", 4),
        },
      },
    },
  };
}

export function roundMax(round: FinalRound | undefined): number {
  return Object.values(round?.criteria ?? {}).reduce((s, c) => s + (Number(c.max) || 0), 0);
}

export function judgeTotal(score: FinalScore | undefined | null): number {
  return Object.values(score?.scores ?? {}).reduce((s, v) => s + (Number(v) || 0), 0);
}

export interface JudgePanelMember {
  id: string;
  judge: Judge;
}

/** Every judge link, active or not (for the Judges list). */
export function allJudges(judges: Record<string, Judge> | null | undefined): JudgePanelMember[] {
  return Object.entries(judges ?? {})
    .map(([id, judge]) => ({ id, judge }))
    .sort((a, b) => a.judge.name.localeCompare(b.judge.name) || a.id.localeCompare(b.id));
}

/**
 * The judging panel = judges whose link is ACTIVE (3–6 judges). Scores are calculated out of this panel, so
 * disabling the link of a judge who doesn't turn up means everyone is scored out of the judges who did.
 */
export function judgePanel(judges: Record<string, Judge> | null | undefined): JudgePanelMember[] {
  return allJudges(judges).filter((m) => m.judge.active);
}

export interface FinalistRoundResult {
  /** One entry per judge on the panel, in panel order. */
  entries: { member: JudgePanelMember; score: FinalScore | null }[];
  done: number;
  required: number;
  raw: number;
  max: number;
  /** raw / (judges × round max) × 100 — out of the whole panel, like the evaluator rule. */
  score100: number;
}

export function roundResult(
  cid: string,
  round: RoundKey,
  panel: JudgePanelMember[],
  scores: FinalScores | null | undefined,
  config: FinalConfig | null | undefined,
): FinalistRoundResult {
  const byJudge = scores?.[round] ?? {};
  const entries = panel.map((member) => ({ member, score: byJudge[member.id]?.[cid] ?? null }));
  const done = entries.filter((e) => e.score).length;
  const raw = entries.reduce((s, e) => s + judgeTotal(e.score), 0);
  const max = panel.length * roundMax(config?.rounds?.[round]);
  return { entries, done, required: panel.length, raw, max, score100: max > 0 ? round2((raw * 100) / max) : 0 };
}

/** Does this finalist take part in the given round? */
export function takesPart(f: { qualified?: Finalist["qualified"] }, round: RoundKey): boolean {
  return round === "walk" ? true : f.qualified?.[round] === true;
}

export interface FinalStanding {
  key: string;
  finalist: Finalist;
  rounds: Record<RoundKey, FinalistRoundResult>;
  /** Weighted combination of the three final rounds, out of 100. */
  combined: number;
  /** Walk + Talent only (used to pick who goes to Q&A). */
  walkTalent: number;
  inQA: boolean;
  rank: number | null;
  /** Another finalist of the same gender is level with this one on every tie-break. */
  tied: boolean;
}

function weighted(config: FinalConfig | null | undefined, per: Partial<Record<RoundKey, number>>, rounds: RoundKey[]): number {
  let num = 0;
  let den = 0;
  for (const r of rounds) {
    const w = Number(config?.rounds?.[r]?.weight) || 0;
    num += w * (per[r] ?? 0);
    den += w;
  }
  return den > 0 ? round2(num / den) : 0;
}

function compareStandings(a: FinalStanding, b: FinalStanding): number {
  return (
    b.combined - a.combined ||
    b.rounds.qa.score100 - a.rounds.qa.score100 ||
    (b.finalist.score3day ?? 0) - (a.finalist.score3day ?? 0) ||
    a.finalist.number - b.finalist.number
  );
}

function sameScore(a: FinalStanding, b: FinalStanding): boolean {
  return (
    a.combined === b.combined && a.rounds.qa.score100 === b.rounds.qa.score100 && (a.finalist.score3day ?? 0) === (b.finalist.score3day ?? 0)
  );
}

export function computeStandings(
  finalists: Record<string, Finalist> | null | undefined,
  judges: Record<string, Judge> | null | undefined,
  scores: FinalScores | null | undefined,
  config: FinalConfig | null | undefined,
): FinalStanding[] {
  const panel = judgePanel(judges);
  const list: FinalStanding[] = Object.entries(finalists ?? {}).map(([key, finalist]) => {
    const rounds = Object.fromEntries(ROUND_KEYS.map((r) => [r, roundResult(cidOf(finalist), r, panel, scores, config)])) as Record<RoundKey, FinalistRoundResult>;
    const per = { walk: rounds.walk.score100, talent: rounds.talent.score100, qa: rounds.qa.score100 };
    return {
      key,
      finalist,
      rounds,
      combined: weighted(config, per, ROUND_KEYS),
      walkTalent: weighted(config, per, ["walk", "talent"]),
      inQA: takesPart(finalist, "qa"),
      rank: null,
      tied: false,
    };
  });
  // Ranks: only Q&A finalists compete for the title, ranked within their gender.
  for (const g of GENDERS) {
    const group = list.filter((s) => s.finalist.gender === g && s.inQA).sort(compareStandings);
    group.forEach((s, i) => {
      s.rank = i > 0 && sameScore(group[i - 1], s) ? group[i - 1].rank : i + 1;
      s.tied = (i > 0 && sameScore(group[i - 1], s)) || (i < group.length - 1 && sameScore(group[i + 1], s));
    });
  }
  return list.sort(
    (a, b) =>
      Number(b.inQA) - Number(a.inQA) ||
      (a.rank ?? 99) - (b.rank ?? 99) ||
      b.walkTalent - a.walkTalent ||
      a.finalist.number - b.finalist.number,
  );
}

export interface Winners {
  winner?: FinalStanding;
  runnerUp?: FinalStanding;
  /** True when the winner / runner-up positions are level even after every tie-break. */
  tie: boolean;
  /** Every Q&A finalist has a score from every judge in all rounds they took part in. */
  complete: boolean;
}

export function computeWinners(standings: FinalStanding[], gender: Gender): Winners {
  const group = standings.filter((s) => s.finalist.gender === gender && s.inQA).sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99) || a.finalist.number - b.finalist.number);
  const winner = group[0];
  const runnerUp = group[1];
  const tie = !!(winner && runnerUp && (winner.rank === runnerUp.rank || (group[2] && group[2].rank === runnerUp.rank)));
  const complete =
    group.length > 0 &&
    group.every((s) => ROUND_KEYS.every((r) => s.rounds[r].required > 0 && s.rounds[r].done === s.rounds[r].required));
  return { winner, runnerUp, tie, complete };
}

export interface AdvanceRecommendation {
  gender: Gender;
  /** Student keys recommended to go through, best first. */
  picks: string[];
  /** Student keys recommended to be eliminated (the lowest scorers), worst last. */
  eliminated: string[];
  /** How many go through = candidates − eliminations (at least 1). */
  wanted: number;
  /** How many are to be eliminated (from the settings). */
  eliminate: number;
  /** The last one going through is level with the first one eliminated — the admin must decide. */
  tieAtCut: boolean;
  /** How many contestants of this gender are in the round. */
  candidates: number;
}

/**
 * Who goes through after `round` (walk → talent, talent → qa)? In each gender the N lowest scorers
 * (default 3 boys + 3 girls) are eliminated; the rest go through. Ranked by the cumulative score so far
 * (walk; or walk + talent), ties broken by the 3-day score.
 */
export function recommendAdvance(
  round: "walk" | "talent",
  finalists: Record<string, Finalist> | null | undefined,
  judges: Record<string, Judge> | null | undefined,
  scores: FinalScores | null | undefined,
  config: FinalConfig | null | undefined,
): AdvanceRecommendation[] {
  const standings = computeStandings(finalists, judges, scores, config).filter((s) => takesPart(s.finalist, round));
  const rounds: RoundKey[] = round === "walk" ? ["walk"] : ["walk", "talent"];
  const panel = judgePanel(judges);
  const cumulative = (s: FinalStanding) => weighted(config, Object.fromEntries(rounds.map((r) => [r, roundResult(cidOf(s.finalist), r, panel, scores, config).score100])), rounds);
  return GENDERS.map((gender) => {
    const eliminate = Math.max(0, Number(gender === "boy" ? config?.rounds?.[round]?.eliminateBoys : config?.rounds?.[round]?.eliminateGirls) || 0);
    const group = standings
      .filter((s) => s.finalist.gender === gender)
      .map((s) => ({ s, score: cumulative(s) }))
      .sort((a, b) => b.score - a.score || (b.s.finalist.score3day ?? 0) - (a.s.finalist.score3day ?? 0) || a.s.finalist.number - b.s.finalist.number);
    // Never eliminate everybody: with very few contestants at least one goes through.
    const wanted = group.length === 0 ? 0 : Math.max(1, group.length - eliminate);
    const cutScore = group[wanted - 1];
    const next = group[wanted];
    const tieAtCut =
      !!cutScore && !!next && cutScore.score === next.score && (cutScore.s.finalist.score3day ?? 0) === (next.s.finalist.score3day ?? 0);
    return {
      gender,
      picks: group.slice(0, wanted).map((x) => x.s.key),
      eliminated: group.slice(wanted).map((x) => x.s.key),
      wanted,
      eliminate,
      tieAtCut,
      candidates: group.length,
    };
  });
}

export interface FinalistPick {
  gender: Gender;
  picks: { key: string; student: Student; score: number }[];
  wanted: number;
  tieAtCut: boolean;
}

/** Auto-pick the Final 20 (top N boys + top N girls by the 3-day final score). */
export function autoPickFinalists(
  results: { studentKey: string; student: Student; final: number | null }[],
  perGender: number,
): { picks: FinalistPick[]; withoutGender: number } {
  const withoutGender = results.filter((r) => !r.student.gender).length;
  const picks = GENDERS.map((gender) => {
    const group = results
      .filter((r) => r.student.gender === gender)
      .map((r) => ({ key: r.studentKey, student: r.student, score: r.final ?? 0 }))
      .sort((a, b) => b.score - a.score || a.student.studentId.localeCompare(b.student.studentId, undefined, { numeric: true }));
    const cut = group[perGender - 1];
    const next = group[perGender];
    return { gender, picks: group.slice(0, perGender), wanted: perGender, tieAtCut: !!cut && !!next && cut.score === next.score };
  });
  return { picks, withoutGender };
}
