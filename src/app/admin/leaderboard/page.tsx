"use client";
import { useMemo, useState } from "react";
import { Trophy, Medal, Printer, Search } from "lucide-react";
import { useAdminData } from "@/context/AdminDataContext";
import { Badge, Button, Card, EmptyState, Input, Select, cn } from "@/components/ui";
import { DayTabs, PageHeader } from "@/components/admin";
import { StudentAvatar } from "@/components/shared";
import { dayLabel } from "@/lib/keys";
import { assignRanks, computeFinalResults, fmt, type FinalResult } from "@/lib/scoring";

function RankCell({ rank }: { rank: number | null }) {
  if (rank === null) return <span className="text-slate-300">—</span>;
  const medal = rank === 1 ? "text-amber-500" : rank === 2 ? "text-slate-400" : rank === 3 ? "text-orange-600" : "";
  return (
    <span className="tabular inline-flex items-center gap-1 font-bold">
      {rank <= 3 && <Medal className={cn("size-4", medal)} />}
      {rank}
    </span>
  );
}

export default function LeaderboardPage() {
  const { students, evaluators, evaluations, settings, totalDays, days, panel, maxPerEvaluator } = useAdminData();
  const [view, setView] = useState("final");
  const [q, setQ] = useState("");
  const [klass, setKlass] = useState("");
  const results = useMemo(() => computeFinalResults(students, evaluators, evaluations, settings, totalDays), [students, evaluators, evaluations, settings, totalDays]);
  const classes = useMemo(() => [...new Set(Object.values(students).map((s) => s.class).filter(Boolean))].sort() as string[], [students]);

  const rows = useMemo(() => {
    const score = (r: FinalResult) => (view === "final" ? r.final : r.days[view]?.score100 ?? null);
    // Ranks are computed within the current filter (e.g. per class) so "rank within batch" works.
    let list = results.filter((r) => !klass || r.student.class === klass).map((r) => ({ r, rank: null as number | null }));
    assignRanks(list, (x) => score(x.r), (x, rank) => (x.rank = rank));
    const ql = q.trim().toLowerCase();
    if (ql) list = list.filter(({ r }) => r.student.studentId.toLowerCase().includes(ql) || r.student.name.toLowerCase().includes(ql));
    return list.sort((a, b) => {
      const sa = score(a.r);
      const sb = score(b.r);
      if (sa !== null && sb !== null) return sb - sa || a.r.student.studentId.localeCompare(b.r.student.studentId, undefined, { numeric: true });
      if (sa !== null) return -1;
      if (sb !== null) return 1;
      return a.r.student.studentId.localeCompare(b.r.student.studentId, undefined, { numeric: true });
    });
  }, [results, view, q, klass]);

  const completeCount = rows.filter(({ rank }) => rank !== null).length;
  const rawMax = panel.length * maxPerEvaluator;

  return (
    <div>
      <PageHeader
        title="Leaderboard"
        subtitle={view === "final" ? `Final = Day 1 + Day 2 + Day 3 (out of ${totalDays * 100}). Each day counts the marks received out of /${rawMax}, so a student scored by fewer evaluators gets fewer marks.` : `${dayLabel(view)} weightage out of 100 (marks received out of /${rawMax}).`}
        actions={
          <Button variant="secondary" onClick={() => window.print()}>
            <Printer className="size-4" /> Print
          </Button>
        }
      />
      <div className="no-print mb-4 flex flex-wrap items-center gap-3">
        <DayTabs value={view} onChange={setView} extra={[{ key: "final", label: "Final" }]} />
        <div className="relative min-w-56 flex-1">
          <Search className="absolute left-3 top-2.5 size-5 text-slate-400" />
          <Input className="pl-10" placeholder="Search student…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <Select className="w-auto" value={klass} onChange={(e) => setKlass(e.target.value)}>
          <option value="">All classes</option>
          {classes.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </Select>
      </div>

      <Card>
        <div className="flex items-center gap-2 border-b border-slate-100 px-5 py-3 text-sm text-slate-600">
          <Trophy className="size-4 text-amber-500" />
          <b className="tabular">{completeCount}</b> students ranked
          {klass && <Badge tone="violet">{klass}</Badge>}
        </div>
        {rows.length === 0 ? (
          <EmptyState title="No students" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <tr className="border-b border-slate-100">
                  <th className="px-5 py-2.5">Rank</th>
                  <th className="px-3 py-2.5">Student</th>
                  {view === "final" ? (
                    <>
                      {days.map((d) => (
                        <th key={d} className="px-3 py-2.5 text-right">
                          {dayLabel(d)}
                        </th>
                      ))}
                      <th className="px-3 py-2.5 text-right">Final</th>
                      <th className="px-5 py-2.5 text-right">%</th>
                    </>
                  ) : (
                    <>
                      <th className="px-3 py-2.5 text-right">Evaluations</th>
                      <th className="px-3 py-2.5 text-right">Raw /{rawMax}</th>
                      <th className="px-5 py-2.5 text-right">/100</th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map(({ r, rank }) => (
                  <tr key={r.studentKey} className={cn(rank !== null && rank <= 3 && "bg-amber-50/40")}>
                    <td className="px-5 py-2.5">
                      <RankCell rank={rank} />
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-3">
                        <StudentAvatar student={r.student} size={32} />
                        <div>
                          <p className="font-semibold text-slate-900">{r.student.name}</p>
                          <p className="tabular text-xs text-slate-500">
                            {r.student.studentId} {r.student.class && `· ${r.student.class}`}
                          </p>
                        </div>
                      </div>
                    </td>
                    {view === "final" ? (
                      <>
                        {days.map((d) => (
                          <td key={d} className="tabular px-3 py-2.5 text-right">
                            {fmt(r.days[d].score100)}
                            {!r.days[d].complete && (
                              <span className="ml-1 text-[11px] font-normal text-slate-400">
                                ({r.days[d].completedCount}/{r.days[d].requiredCount})
                              </span>
                            )}
                          </td>
                        ))}
                        <td className="tabular px-3 py-2.5 text-right text-base font-extrabold">
                          {fmt(r.final)}
                        </td>
                        <td className="tabular px-5 py-2.5 text-right text-slate-600">{r.percentage !== null ? `${fmt(r.percentage)}%` : ""}</td>
                      </>
                    ) : (
                      <>
                        <td className="tabular px-3 py-2.5 text-right text-slate-500">
                          {r.days[view].completedCount}/{r.days[view].requiredCount}
                        </td>
                        <td className="tabular px-3 py-2.5 text-right">{r.days[view].rawTotal}</td>
                        <td className="tabular px-5 py-2.5 text-right text-base font-extrabold">
                          {fmt(r.days[view].score100)}
                        </td>
                      </>
                    )}
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
