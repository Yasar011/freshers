"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { Users, UserCheck, CalendarDays, Target, CheckCircle2, Clock, ChevronRight } from "lucide-react";
import { useAdminData } from "@/context/AdminDataContext";
import { Alert, Badge, Card, CardHeader, ProgressBar, Stat, cn } from "@/components/ui";
import { DayTabs, EvaluatorPendingModal, PageHeader } from "@/components/admin";
import { formatDateTimeShort } from "@/components/shared";
import { computeDaySummary, computeEvaluatorProgress, fmt, type EvaluatorProgress } from "@/lib/scoring";
import { dayLabel, evaluatorDisplayName } from "@/lib/keys";

export default function Dashboard() {
  const { students, panel, evaluations, event, settings, activeDay, days } = useAdminData();
  const [day, setDay] = useState(activeDay);
  const [drill, setDrill] = useState<EvaluatorProgress | null>(null);

  const summary = useMemo(() => computeDaySummary(day, students, panel, evaluations[day]), [day, students, panel, evaluations]);
  const progress = useMemo(() => computeEvaluatorProgress(students, panel, evaluations[day]), [students, panel, evaluations, day]);
  const allDays = useMemo(() => days.map((d) => computeDaySummary(d, students, panel, evaluations[d])), [days, students, panel, evaluations]);

  const activeEvaluators = panel.filter((p) => p.evaluator.active).length;
  const status = event?.days?.[activeDay]?.status;
  const expectedPanel = settings?.evaluatorCount ?? 10;

  return (
    <div>
      <PageHeader title="Dashboard" subtitle={`${event?.name} · live evaluation progress`} actions={<DayTabs value={day} onChange={setDay} />} />

      <div className="mb-4 space-y-2">
        {panel.length !== expectedPanel && (
          <Alert title={`${panel.length} evaluator${panel.length === 1 ? "" : "s"} registered — ${expectedPanel} expected`}>
            Every student must be evaluated by every registered evaluator. <Link href="/admin/evaluators" className="font-semibold underline">Manage evaluators</Link>
          </Alert>
        )}
        {activeEvaluators < panel.length && (
          <Alert>
            {panel.length - activeEvaluators} evaluator(s) are deactivated. They cannot sign in, but are still part of the panel — their students stay incomplete until they are reactivated or the admin enters their scores.
          </Alert>
        )}
        {Object.keys(students).length === 0 && (
          <Alert tone="blue">
            No students yet. <Link href="/admin/students" className="font-semibold underline">Import students</Link>
          </Alert>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Total students" value={summary.students} icon={<Users className="size-5" />} />
        <Stat label="Total evaluators" value={panel.length} sub={`${activeEvaluators} active`} icon={<UserCheck className="size-5" />} />
        <Stat
          label="Current day"
          value={dayLabel(activeDay)}
          sub={<Badge tone={status === "open" ? "green" : "red"}>{status === "open" ? "OPEN" : "LOCKED"}</Badge>}
          icon={<CalendarDays className="size-5" />}
        />
        <Stat label="Expected evaluations" value={summary.expected.toLocaleString()} sub={`${summary.students} × ${summary.evaluators}`} icon={<Target className="size-5" />} />
      </div>

      <Card className="mt-4 p-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-sm font-bold uppercase tracking-wider text-slate-500">{dayLabel(day)} progress</p>
            <p className="tabular mt-1 text-4xl font-extrabold tracking-tight">{fmt(summary.percent)}%</p>
          </div>
          <div className="grid grid-cols-3 gap-6 text-right">
            <div>
              <p className="flex items-center justify-end gap-1 text-sm text-slate-500">
                <CheckCircle2 className="size-4 text-emerald-500" /> Completed
              </p>
              <p className="tabular text-2xl font-bold">{summary.completed.toLocaleString()}</p>
            </div>
            <div>
              <p className="flex items-center justify-end gap-1 text-sm text-slate-500">
                <Clock className="size-4 text-amber-500" /> Pending
              </p>
              <p className="tabular text-2xl font-bold">{summary.pending.toLocaleString()}</p>
            </div>
            <div>
              <p className="text-sm text-slate-500">Students complete</p>
              <p className="tabular text-2xl font-bold">
                {summary.completeStudents}
                <span className="text-base font-medium text-slate-400">/{summary.students}</span>
              </p>
            </div>
          </div>
        </div>
        <ProgressBar value={summary.percent} className="mt-4 h-3" />
      </Card>

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title={`Evaluator progress · ${dayLabel(day)}`} subtitle="Click an evaluator to see which students are pending." />
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <tr className="border-b border-slate-100">
                  <th className="px-5 py-2.5">Evaluator</th>
                  <th className="px-3 py-2.5 text-right">Completed</th>
                  <th className="px-3 py-2.5 text-right">Pending</th>
                  <th className="w-48 px-5 py-2.5">Progress</th>
                  <th className="px-3 py-2.5">Last submission</th>
                  <th />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {progress.map((p) => (
                  <tr key={p.member.key} className="cursor-pointer hover:bg-slate-50" onClick={() => setDrill(p)}>
                    <td className="px-5 py-3">
                      <p className="font-semibold text-slate-900">
                        {evaluatorDisplayName(p.member.evaluator)} {!p.member.evaluator.active && <Badge tone="red">inactive</Badge>}
                      </p>
                      <p className="text-xs text-slate-500">{p.member.evaluator.email}</p>
                    </td>
                    <td className="tabular px-3 py-3 text-right font-semibold">{p.completed}</td>
                    <td className={cn("tabular px-3 py-3 text-right font-semibold", p.pending ? "text-amber-600" : "text-slate-400")}>{p.pending}</td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2">
                        <ProgressBar value={p.percent} />
                        <span className="tabular w-12 text-right text-xs font-semibold">{fmt(p.percent)}%</span>
                      </div>
                    </td>
                    <td className="px-3 py-3 text-xs text-slate-500">{formatDateTimeShort(p.lastAt)}</td>
                    <td className="pr-4 text-slate-300">
                      <ChevronRight className="size-4" />
                    </td>
                  </tr>
                ))}
                {progress.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-5 py-8 text-center text-slate-500">
                      No evaluators yet. <Link href="/admin/evaluators" className="font-semibold text-brand-600">Add evaluators</Link>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>

        <Card>
          <CardHeader title="All days" />
          <ul className="divide-y divide-slate-100">
            {allDays.map((s) => {
              const st = event?.days?.[s.day]?.status;
              return (
                <li key={s.day} className="px-5 py-4">
                  <div className="flex items-center justify-between">
                    <p className="font-semibold">
                      {dayLabel(s.day)} {s.day === activeDay && <Badge tone="violet">active</Badge>}
                    </p>
                    <Badge tone={st === "open" ? "green" : "slate"}>{st === "open" ? "OPEN" : "LOCKED"}</Badge>
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <ProgressBar value={s.percent} />
                    <span className="tabular w-14 text-right text-xs font-semibold">{fmt(s.percent)}%</span>
                  </div>
                  <p className="tabular mt-1 text-xs text-slate-500">
                    {s.completed.toLocaleString()} / {s.expected.toLocaleString()} evaluations · {s.completeStudents} students complete
                  </p>
                </li>
              );
            })}
          </ul>
        </Card>
      </div>

      <EvaluatorPendingModal progress={drill ? progress.find((p) => p.member.key === drill.member.key) ?? null : null} day={day} onClose={() => setDrill(null)} />
    </div>
  );
}
