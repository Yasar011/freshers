"use client";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { onValue, ref, update } from "firebase/database";
import { db, errorMessage } from "@/lib/firebase";
import { dayKeys } from "@/lib/keys";
import { panelOf, perEvaluatorMax, type PanelMember } from "@/lib/scoring";
import type { EventInfo, Evaluator, EvaluationsTree, Settings, Student } from "@/lib/types";
import type { AdminIdentity } from "@/lib/actions";
import { cidOf, contestantRecord, judgePanel, type Contestant, type FinalConfig, type FinalScores, type Finalist, type Judge, type JudgePanelMember } from "@/lib/finals";

interface AdminData {
  admin: AdminIdentity;
  loading: boolean;
  error: string | null;
  event: EventInfo | null;
  settings: Settings | null;
  students: Record<string, Student>;
  evaluators: Record<string, Evaluator>;
  evaluations: EvaluationsTree;
  /** Finals: null until the admin sets them up. */
  finalConfig: FinalConfig | null;
  finalists: Record<string, Finalist>;
  judges: Record<string, Judge>;
  judgePanel: JudgePanelMember[];
  finalScores: FinalScores;
  panel: PanelMember[];
  maxPerEvaluator: number;
  totalDays: number;
  days: string[];
  activeDay: string;
}

const Ctx = createContext<AdminData | null>(null);

/** Field-wise comparison (Firebase returns keys in a different order, so never compare JSON strings). */
function sameContestant(a: Contestant, b: Contestant | undefined): boolean {
  return !!b && a.number === b.number && a.gender === b.gender && (["talent", "qa"] as const).every((r) => !!a.qualified?.[r] === !!b.qualified?.[r]);
}

/** Live (realtime) subscription to everything the admin dashboard needs. */
export function AdminDataProvider({ admin, children }: { admin: AdminIdentity; children: ReactNode }) {
  const [event, setEvent] = useState<EventInfo | null | undefined>(undefined);
  const [settings, setSettings] = useState<Settings | null | undefined>(undefined);
  const [students, setStudents] = useState<Record<string, Student> | undefined>(undefined);
  const [evaluators, setEvaluators] = useState<Record<string, Evaluator> | undefined>(undefined);
  const [evaluations, setEvaluations] = useState<EvaluationsTree | undefined>(undefined);
  const [finalConfig, setFinalConfig] = useState<FinalConfig | null | undefined>(undefined);
  const [finalists, setFinalists] = useState<Record<string, Finalist> | undefined>(undefined);
  const [judges, setJudges] = useState<Record<string, Judge> | undefined>(undefined);
  const [finalScores, setFinalScores] = useState<FinalScores | undefined>(undefined);
  const [contestants, setContestants] = useState<Record<string, Contestant> | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onErr = (e: Error) => setError(errorMessage(e));
    const subs = [
      onValue(ref(db(), "event"), (s) => setEvent(s.val()), onErr),
      onValue(ref(db(), "settings"), (s) => setSettings(s.val()), onErr),
      onValue(ref(db(), "students"), (s) => setStudents(s.val() ?? {}), onErr),
      onValue(ref(db(), "evaluators"), (s) => setEvaluators(s.val() ?? {}), onErr),
      onValue(ref(db(), "evaluations"), (s) => setEvaluations(s.val() ?? {}), onErr),
      onValue(ref(db(), "finalConfig"), (s) => setFinalConfig(s.val()), onErr),
      onValue(ref(db(), "finalists"), (s) => setFinalists(s.val() ?? {}), onErr),
      onValue(ref(db(), "judges"), (s) => setJudges(s.val() ?? {}), onErr),
      onValue(ref(db(), "finalScores"), (s) => setFinalScores(s.val() ?? {}), onErr),
      onValue(ref(db(), "contestants"), (s) => setContestants(s.val() ?? {}), onErr),
    ];
    return () => subs.forEach((u) => u());
  }, []);

  // Self-heal: the judge-facing /contestants entries (number + gender + rounds only) must mirror /finalists.
  useEffect(() => {
    if (!finalists || !contestants) return;
    const expected: Record<string, Contestant> = {};
    for (const f of Object.values(finalists)) expected[cidOf(f)] = contestantRecord(f);
    const updates: Record<string, unknown> = {};
    for (const [cid, c] of Object.entries(expected)) if (!sameContestant(c, contestants[cid])) updates[`contestants/${cid}`] = c;
    for (const cid of Object.keys(contestants)) if (!expected[cid]) updates[`contestants/${cid}`] = null;
    if (Object.keys(updates).length) update(ref(db()), updates).catch(() => undefined);
  }, [finalists, contestants]);

  const value = useMemo<AdminData>(() => {
    const totalDays = event?.totalDays ?? settings?.totalDays ?? 3;
    return {
      admin,
      loading: [event, settings, students, evaluators, evaluations, finalConfig, finalists, judges, finalScores, contestants].some((v) => v === undefined),
      error,
      event: event ?? null,
      settings: settings ?? null,
      students: students ?? {},
      evaluators: evaluators ?? {},
      evaluations: evaluations ?? {},
      finalConfig: finalConfig ?? null,
      finalists: finalists ?? {},
      judges: judges ?? {},
      judgePanel: judgePanel(judges),
      finalScores: finalScores ?? {},
      panel: panelOf(evaluators),
      maxPerEvaluator: perEvaluatorMax(settings),
      totalDays,
      days: dayKeys(totalDays),
      activeDay: event?.activeDay ?? "day1",
    };
  }, [admin, event, settings, students, evaluators, evaluations, finalConfig, finalists, judges, finalScores, contestants, error]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAdminData() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAdminData must be used inside AdminDataProvider");
  return v;
}
