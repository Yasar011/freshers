"use client";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { onValue, ref } from "firebase/database";
import { db, errorMessage } from "@/lib/firebase";
import { dayKeys } from "@/lib/keys";
import { panelOf, perEvaluatorMax, type PanelMember } from "@/lib/scoring";
import type { EventInfo, Evaluator, EvaluationsTree, Settings, Student } from "@/lib/types";
import type { AdminIdentity } from "@/lib/actions";

interface AdminData {
  admin: AdminIdentity;
  loading: boolean;
  error: string | null;
  event: EventInfo | null;
  settings: Settings | null;
  students: Record<string, Student>;
  evaluators: Record<string, Evaluator>;
  evaluations: EvaluationsTree;
  panel: PanelMember[];
  maxPerEvaluator: number;
  totalDays: number;
  days: string[];
  activeDay: string;
}

const Ctx = createContext<AdminData | null>(null);

/** Live (realtime) subscription to everything the admin dashboard needs. */
export function AdminDataProvider({ admin, children }: { admin: AdminIdentity; children: ReactNode }) {
  const [event, setEvent] = useState<EventInfo | null | undefined>(undefined);
  const [settings, setSettings] = useState<Settings | null | undefined>(undefined);
  const [students, setStudents] = useState<Record<string, Student> | undefined>(undefined);
  const [evaluators, setEvaluators] = useState<Record<string, Evaluator> | undefined>(undefined);
  const [evaluations, setEvaluations] = useState<EvaluationsTree | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onErr = (e: Error) => setError(errorMessage(e));
    const subs = [
      onValue(ref(db(), "event"), (s) => setEvent(s.val()), onErr),
      onValue(ref(db(), "settings"), (s) => setSettings(s.val()), onErr),
      onValue(ref(db(), "students"), (s) => setStudents(s.val() ?? {}), onErr),
      onValue(ref(db(), "evaluators"), (s) => setEvaluators(s.val() ?? {}), onErr),
      onValue(ref(db(), "evaluations"), (s) => setEvaluations(s.val() ?? {}), onErr),
    ];
    return () => subs.forEach((u) => u());
  }, []);

  const value = useMemo<AdminData>(() => {
    const totalDays = event?.totalDays ?? settings?.totalDays ?? 3;
    return {
      admin,
      loading: [event, settings, students, evaluators, evaluations].some((v) => v === undefined),
      error,
      event: event ?? null,
      settings: settings ?? null,
      students: students ?? {},
      evaluators: evaluators ?? {},
      evaluations: evaluations ?? {},
      panel: panelOf(evaluators),
      maxPerEvaluator: perEvaluatorMax(settings),
      totalDays,
      days: dayKeys(totalDays),
      activeDay: event?.activeDay ?? "day1",
    };
  }, [admin, event, settings, students, evaluators, evaluations, error]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAdminData() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAdminData must be used inside AdminDataProvider");
  return v;
}
