"use client";
import { useMemo, useState } from "react";
import { Crown, Star } from "lucide-react";
import { useAdminData } from "@/context/AdminDataContext";
import { Badge, Button, cn, ConfirmDialog } from "@/components/ui";
import { useToast } from "@/components/ui/Toast";
import { computeStandings, GENDERS, type Finalist, type Gender } from "@/lib/finals";
import { computeFinalResults } from "@/lib/scoring";
import { removeFinalist, selectFinalist, setStudentGender } from "@/lib/finalsActions";
import { errorMessage } from "@/lib/firebase";
import type { Student } from "@/lib/types";

export function GenderBadge({ gender, className }: { gender?: Gender | null; className?: string }) {
  if (!gender) return <Badge tone="slate" className={className}>? gender</Badge>;
  return (
    <Badge tone={gender === "boy" ? "blue" : "violet"} className={className}>
      {gender === "boy" ? "Boy" : "Girl"}
    </Badge>
  );
}

export type GenderFilterValue = "all" | Gender | "unknown";

export function GenderFilter({ value, onChange, showUnknown }: { value: GenderFilterValue; onChange: (v: GenderFilterValue) => void; showUnknown?: boolean }) {
  const items: [GenderFilterValue, string][] = [
    ["all", "All"],
    ["boy", "Boys"],
    ["girl", "Girls"],
    ...(showUnknown ? ([["unknown", "Unknown"]] as [GenderFilterValue, string][]) : []),
  ];
  return (
    <div className="inline-flex gap-1 rounded-xl bg-slate-100 p-1">
      {items.map(([k, l]) => (
        <button
          key={k}
          onClick={() => onChange(k)}
          className={cn("rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors", value === k ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900")}
        >
          {l}
        </button>
      ))}
    </div>
  );
}

export function matchesGender(g: Gender | undefined | null, f: GenderFilterValue) {
  return f === "all" || (f === "unknown" ? !g : g === f);
}

/** All the derived finals data in one place. */
export function useFinals() {
  const d = useAdminData();
  const standings = useMemo(
    () => (d.finalConfig ? computeStandings(d.finalists, d.judges, d.finalScores, d.finalConfig) : []),
    [d.finalists, d.judges, d.finalScores, d.finalConfig],
  );
  const finalistList = useMemo(
    () => Object.entries(d.finalists).map(([key, f]) => ({ key, f })).sort((a, b) => a.f.number - b.f.number),
    [d.finalists],
  );
  const counts = useMemo(() => {
    const c: Record<Gender, number> = { boy: 0, girl: 0 };
    for (const f of Object.values(d.finalists)) c[f.gender]++;
    return c;
  }, [d.finalists]);
  return { ...d, standings, finalistList, counts, perGender: d.finalConfig?.perGender ?? 10 };
}

/** 3-day final score per student key (what the Final 20 is picked from). */
export function useThreeDayScores() {
  const { students, evaluators, evaluations, settings, totalDays } = useAdminData();
  return useMemo(() => computeFinalResults(students, evaluators, evaluations, settings, totalDays), [students, evaluators, evaluations, settings, totalDays]);
}

export function nextFinalistNumber(finalists: Record<string, Finalist>): number {
  return Math.max(0, ...Object.values(finalists).map((f) => f.number || 0)) + 1;
}

/**
 * "Select for Finals" button for a student (profile modal / leaderboard row).
 * Handles unknown gender, the per-gender limit and removal.
 */
export function FinalistToggle({ studentKey, student, compact, score3day }: { studentKey: string; student: Student; compact?: boolean; score3day?: number | null }) {
  const { finalists, counts, perGender, finalConfig, admin } = useFinals();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<"remove" | "over" | null>(null);
  const finalist = finalists[studentKey];

  const run = async (fn: () => Promise<void>, ok: string) => {
    setBusy(true);
    try {
      await fn();
      toast(ok, "success");
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  };

  const select = (gender: Gender) =>
    run(async () => {
      let s = student;
      if (!s.gender || s.gender !== gender) {
        await setStudentGender(admin, studentKey, student, gender);
        s = { ...student, gender };
      }
      await selectFinalist(admin, studentKey, s, nextFinalistNumber(finalists), score3day ?? undefined);
    }, `${student.name} selected for the Finals`);

  if (!finalConfig) {
    return compact ? null : <p className="text-xs text-slate-500">Set up the Finals first (Finals page) to select finalists.</p>;
  }

  if (finalist) {
    return (
      <>
        {compact ? (
          <button title={`Finalist #${finalist.number} — click to remove`} onClick={() => setConfirm("remove")} className="rounded-lg p-1.5 text-amber-500 hover:bg-amber-50">
            <Star className="size-5 fill-current" />
          </button>
        ) : (
          <Button variant="secondary" onClick={() => setConfirm("remove")} loading={busy}>
            <Crown className="size-4 text-amber-500" /> Finalist #{finalist.number} · Remove
          </Button>
        )}
        <ConfirmDialog
          open={confirm === "remove"}
          onClose={() => setConfirm(null)}
          title="Remove from Finals?"
          tone="danger"
          confirmLabel="Remove finalist"
          message={<>{finalist.name} ({finalist.studentId}) will be removed from the Finals. Any scores already given to them are kept but no longer counted.</>}
          onConfirm={() => run(() => removeFinalist(admin, studentKey, finalist), "Removed from the Finals")}
        />
      </>
    );
  }

  const gender = student.gender;
  const full = gender ? counts[gender] >= perGender : false;
  if (!gender) {
    return (
      <div className={cn("flex items-center gap-2", compact && "gap-1")}>
        {!compact && <span className="text-sm text-slate-500">Select for Finals as:</span>}
        {GENDERS.map((g) => (
          <Button key={g} size="sm" variant="secondary" loading={busy} onClick={() => select(g)}>
            {g === "boy" ? "Boy" : "Girl"}
          </Button>
        ))}
      </div>
    );
  }
  return (
    <>
      {compact ? (
        <button title="Select for Finals" onClick={() => (full ? setConfirm("over") : select(gender))} disabled={busy} className="rounded-lg p-1.5 text-slate-300 hover:bg-slate-100 hover:text-amber-500">
          <Star className="size-5" />
        </button>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={() => (full ? setConfirm("over") : select(gender))} loading={busy}>
            <Crown className="size-4" /> Select for Finals
          </Button>
          <span className={cn("text-xs", full ? "font-semibold text-amber-600" : "text-slate-500")}>
            {gender === "boy" ? "Boys" : "Girls"} selected: {counts[gender]} / {perGender}
          </span>
        </div>
      )}
      <ConfirmDialog
        open={confirm === "over"}
        onClose={() => setConfirm(null)}
        title={`Already ${perGender} ${gender === "boy" ? "boys" : "girls"} selected`}
        tone="warning"
        confirmLabel="Select anyway"
        message={<>The target is {perGender} {gender === "boy" ? "boys" : "girls"}. Add {student.name} as an extra finalist?</>}
        onConfirm={() => select(gender)}
      />
    </>
  );
}

/** Inline Boy / Girl switch for a student (one click saves; also updates the finalist copy). */
export function GenderSwitch({ studentKey, student, size = "sm" }: { studentKey: string; student: Student; size?: "sm" | "md" }) {
  const { finalists, admin } = useFinals();
  const toast = useToast();
  const [busy, setBusy] = useState<Gender | null>(null);
  const set = async (g: Gender) => {
    if (student.gender === g && student.genderConfirmed !== false) return;
    setBusy(g);
    try {
      await setStudentGender(admin, studentKey, student, g, finalists[studentKey]);
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(null);
    }
  };
  const unsure = student.gender && student.genderConfirmed === false;
  return (
    <div className="inline-flex items-center gap-1.5">
      <div className="inline-flex rounded-lg bg-slate-100 p-0.5">
        {GENDERS.map((g) => (
          <button
            key={g}
            disabled={busy !== null}
            onClick={() => set(g)}
            className={cn(
              "rounded-md font-semibold transition-colors",
              size === "sm" ? "px-2 py-0.5 text-xs" : "px-3 py-1 text-sm",
              student.gender === g ? (g === "boy" ? "bg-sky-600 text-white" : "bg-brand-600 text-white") : "text-slate-500 hover:text-slate-800",
            )}
          >
            {g === "boy" ? "Boy" : "Girl"}
          </button>
        ))}
      </div>
      {unsure && <span title="Guessed from the name — please confirm" className="size-2 rounded-full bg-amber-500" />}
    </div>
  );
}
