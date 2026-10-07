"use client";
import { useMemo, useState } from "react";
import { Crown, FileSpreadsheet, FileText, Medal, Printer } from "lucide-react";
import { Alert, Badge, Button, Card, CardHeader, EmptyState, cn } from "@/components/ui";
import { StudentAvatar } from "@/components/shared";
import { useToast } from "@/components/ui/Toast";
import { useFinals } from "./common";
import { computeWinners, GENDERS, ROUND_KEYS, type FinalStanding, type Gender, type Winners } from "@/lib/finals";
import { downloadCsv, downloadXlsx, fileStamp, finalsDetailedSheet, finalsStandingsSheet } from "@/lib/export";
import { fmt } from "@/lib/scoring";
import { recordExport } from "@/lib/actions";

function WinnerCard({ s, title, tone }: { s?: FinalStanding; title: string; tone: "gold" | "silver" }) {
  const { finalConfig } = useFinals();
  const ring = tone === "gold" ? "ring-amber-400 bg-amber-50" : "ring-slate-300 bg-slate-50";
  const medal = tone === "gold" ? "text-amber-500" : "text-slate-400";
  return (
    <div className={cn("rounded-2xl p-5 ring-2", ring)}>
      <p className="flex items-center gap-1.5 text-xs font-extrabold uppercase tracking-widest text-slate-600">
        {tone === "gold" ? <Crown className={cn("size-4", medal)} /> : <Medal className={cn("size-4", medal)} />} {title}
      </p>
      {s ? (
        <div className="mt-3 flex items-center gap-4">
          <StudentAvatar student={s.finalist} size={72} className="rounded-2xl" />
          <div className="min-w-0 flex-1">
            <p className="text-xl font-extrabold leading-tight">{s.finalist.name}</p>
            <p className="tabular text-sm text-slate-600">
              #{String(s.finalist.number).padStart(2, "0")} · {s.finalist.studentId}
            </p>
            <p className="tabular mt-1 text-2xl font-extrabold text-brand-800">
              {fmt(s.combined)}
              <span className="text-sm font-semibold text-slate-500"> / 100</span>
            </p>
            <p className="tabular text-xs text-slate-500">
              {ROUND_KEYS.map((r) => `${finalConfig?.rounds[r].label.split(" ")[0]} ${fmt(s.rounds[r].score100)}`).join(" · ")}
            </p>
          </div>
        </div>
      ) : (
        <p className="mt-4 text-sm text-slate-500">Not decided yet — needs contestants in the Q&amp;A round.</p>
      )}
    </div>
  );
}

function GenderResults({ gender, standings, winners }: { gender: Gender; standings: FinalStanding[]; winners: Winners }) {
  const { finalConfig } = useFinals();
  const group = standings.filter((s) => s.finalist.gender === gender);
  const qa = group.filter((s) => s.inQA);
  const out = group.filter((s) => !s.inQA);
  return (
    <div className="space-y-4">
      <h3 className="text-lg font-extrabold uppercase tracking-wide">{gender === "boy" ? "Boys" : "Girls"}</h3>
      {winners.tie && <Alert tone="red">Level on every tie-break (final score, Q&amp;A score and 3-day score) — the organisers need to decide this one.</Alert>}
      <div className="grid grid-cols-1 gap-3">
        <WinnerCard s={winners.winner} title="Winner" tone="gold" />
        <WinnerCard s={winners.runnerUp} title="Runner-up" tone="silver" />
      </div>
      <Card>
        <CardHeader title="Standings" subtitle="Final = weighted average of the three rounds. Ties: higher Q&A score, then 3-day score." />
        {group.length === 0 ? (
          <EmptyState title="No finalists" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <tr className="border-b border-slate-100">
                  <th className="px-4 py-2.5">Rank</th>
                  <th className="px-3 py-2.5">Contestant</th>
                  {ROUND_KEYS.map((r) => (
                    <th key={r} className="px-2 py-2.5 text-right">
                      {finalConfig?.rounds[r].label.split(" ")[0]}
                    </th>
                  ))}
                  <th className="px-4 py-2.5 text-right">Final</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {[...qa, ...out].map((s) => (
                  <tr key={s.key} className={cn(!s.inQA && "text-slate-500", s.rank === 1 && "bg-amber-50/50")}>
                    <td className="tabular px-4 py-2 font-bold">{s.rank ?? "—"}</td>
                    <td className="px-3 py-2">
                      <span className="tabular text-xs font-bold text-slate-400">#{String(s.finalist.number).padStart(2, "0")}</span> <span className="font-medium">{s.finalist.name}</span>
                      {s.tied && <Badge tone="amber" className="ml-1">tie</Badge>}
                    </td>
                    {ROUND_KEYS.map((r) => (
                      <td key={r} className="tabular px-2 py-2 text-right">
                        {s.rounds[r].done > 0 ? fmt(s.rounds[r].score100) : "—"}
                      </td>
                    ))}
                    <td className="tabular px-4 py-2 text-right text-base font-extrabold">{s.inQA ? fmt(s.combined) : <span className="text-xs font-normal">out</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

export default function ResultsTab() {
  const { standings, finalConfig, finalists, judgePanel, finalScores, admin } = useFinals();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const winners = useMemo(() => ({ boy: computeWinners(standings, "boy"), girl: computeWinners(standings, "girl") }), [standings]);
  const complete = winners.boy.complete && winners.girl.complete;

  const run = async (id: string, label: string, fn: () => Promise<void> | void) => {
    setBusy(id);
    try {
      await fn();
      recordExport(admin, label);
    } catch (e) {
      toast(`Export failed: ${(e as Error).message}`, "error");
    } finally {
      setBusy(null);
    }
  };
  const stamp = fileStamp();

  if (Object.keys(finalists).length === 0) return <EmptyState title="No results yet">Select finalists and run the rounds first.</EmptyState>;

  return (
    <div className="space-y-4">
      <Alert tone={complete ? "green" : "amber"} title={complete ? "Final results" : "Provisional results"}>
        {complete
          ? "Every Q&A finalist has a score from every judge in all three rounds."
          : "Some scores are still missing, so the positions can still change. Winners are chosen from the Q&A round finalists only."}
      </Alert>
      <div className="no-print flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => window.print()}>
          <Printer className="size-4" /> Print
        </Button>
        <Button
          loading={busy === "x"}
          onClick={() => run("x", "finals results (Excel)", () => downloadXlsx(`finals-results-${stamp}.xlsx`, [finalsStandingsSheet(standings, finalConfig, winners), finalsDetailedSheet(finalists, judgePanel, finalScores, finalConfig)]))}
        >
          <FileSpreadsheet className="size-4" /> Excel
        </Button>
        <Button variant="secondary" loading={busy === "c"} onClick={() => run("c", "finals standings (CSV)", () => downloadCsv(`finals-standings-${stamp}.csv`, finalsStandingsSheet(standings, finalConfig, winners).rows))}>
          <FileText className="size-4" /> Standings CSV
        </Button>
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {GENDERS.map((g) => (
          <GenderResults key={g} gender={g} standings={standings} winners={winners[g]} />
        ))}
      </div>
    </div>
  );
}
