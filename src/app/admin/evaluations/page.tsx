"use client";
import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { useAdminData } from "@/context/AdminDataContext";
import { Badge, Button, Card, EmptyState, Input, Select, cn } from "@/components/ui";
import { DayTabs, PageHeader, StudentDayStatus } from "@/components/admin";
import { StudentAvatar, formatDateTimeShort } from "@/components/shared";
import { compactId, dayLabel, evaluatorDisplayName, normalizeStudentId } from "@/lib/keys";
import { computeStudentDay, fmt } from "@/lib/scoring";
import { CRITERIA_KEYS } from "@/lib/types";

type Tab = "lookup" | "pending" | "all";

export default function EvaluationsPage() {
  const { activeDay } = useAdminData();
  const [day, setDay] = useState(activeDay);
  const [tab, setTab] = useState<Tab>("lookup");
  return (
    <div>
      <PageHeader title="Evaluations" subtitle="Search a student, view every evaluator's score, correct scores and track what's pending." actions={<DayTabs value={day} onChange={setDay} />} />
      <div className="mb-4 inline-flex gap-1 rounded-xl bg-slate-100 p-1">
        {(
          [
            ["lookup", "Student status"],
            ["pending", "Pending evaluations"],
            ["all", "All evaluations"],
          ] as [Tab, string][]
        ).map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} className={cn("rounded-lg px-3.5 py-1.5 text-sm font-semibold", tab === k ? "bg-white shadow-sm" : "text-slate-600")}>
            {l}
          </button>
        ))}
      </div>
      {tab === "lookup" && <Lookup day={day} />}
      {tab === "pending" && <Incomplete day={day} />}
      {tab === "all" && <AllEvaluations day={day} />}
    </div>
  );
}

function Lookup({ day }: { day: string }) {
  const { students } = useAdminData();
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const matches = useMemo(() => {
    const qn = normalizeStudentId(q);
    const cq = compactId(q);
    const ql = q.trim().toLowerCase();
    if (!qn) return [];
    return Object.entries(students)
      .filter(([, s]) => s.studentId === qn || compactId(s.studentId).includes(cq) || (ql.length > 1 && s.name.toLowerCase().includes(ql)))
      .sort((a, b) => Number(b[1].studentId === qn) - Number(a[1].studentId === qn) || a[1].studentId.localeCompare(b[1].studentId, undefined, { numeric: true }))
      .slice(0, 10);
  }, [q, students]);
  const s = selected ? students[selected] : null;

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[22rem_minmax(0,1fr)]">
      <Card className="h-fit p-4">
        <form
          className="relative"
          onSubmit={(e) => {
            e.preventDefault();
            if (matches[0]) setSelected(matches[0][0]);
          }}
        >
          <Search className="absolute left-3 top-2.5 size-5 text-slate-400" />
          <Input className="pl-10" placeholder="Student ID or name (e.g. BFT/26/2077)" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
        </form>
        <ul className="mt-3 divide-y divide-slate-100">
          {matches.map(([k, st]) => (
            <li key={k}>
              <button className={cn("flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-slate-50", selected === k && "bg-brand-50")} onClick={() => setSelected(k)}>
                <StudentAvatar student={st} size={32} />
                <div className="min-w-0">
                  <p className="tabular text-sm font-semibold">{st.studentId}</p>
                  <p className="truncate text-xs text-slate-500">{st.name}</p>
                </div>
              </button>
            </li>
          ))}
          {q && matches.length === 0 && <li className="py-4 text-center text-sm text-slate-500">No student found.</li>}
        </ul>
      </Card>
      <Card className="p-5">
        {s && selected ? (
          <div className="space-y-4">
            <div className="flex items-center gap-4">
              <StudentAvatar student={s} size={64} className="rounded-2xl" />
              <div>
                <p className="text-lg font-bold">{s.name}</p>
                <p className="tabular font-semibold text-slate-600">{s.studentId}</p>
                <p className="text-sm text-slate-500">{[s.programme, s.class].filter(Boolean).join(" · ")}</p>
              </div>
            </div>
            <StudentDayStatus studentKey={selected} day={day} />
          </div>
        ) : (
          <EmptyState icon={<Search className="size-10" />} title="Search a student">
            See each evaluator&apos;s score for {dayLabel(day)}, the total out of 400 and the daily weightage out of 100. Correct, reset or enter missing scores from here.
          </EmptyState>
        )}
      </Card>
    </div>
  );
}

function Incomplete({ day }: { day: string }) {
  const { students, panel, evaluations, settings } = useAdminData();
  const [open, setOpen] = useState<string | null>(null);
  const [evaluatorFilter, setEvaluatorFilter] = useState("");
  const rows = useMemo(
    () =>
      Object.keys(students)
        .map((k) => computeStudentDay(k, panel, evaluations[day], settings))
        .filter((r) => !r.complete)
        .filter((r) => !evaluatorFilter || r.entries.some((e) => e.member.key === evaluatorFilter && !e.evaluation))
        .sort((a, b) => b.completedCount - a.completedCount || students[a.studentKey].studentId.localeCompare(students[b.studentKey].studentId, undefined, { numeric: true })),
    [students, panel, evaluations, day, settings, evaluatorFilter],
  );
  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-4">
        <p className="text-sm text-slate-600">
          <b className="tabular">{rows.length}</b> student(s) still waiting for evaluations on {dayLabel(day)}
        </p>
        <Select className="w-auto" value={evaluatorFilter} onChange={(e) => setEvaluatorFilter(e.target.value)}>
          <option value="">Missing from any evaluator</option>
          {panel.map((p) => (
            <option key={p.key} value={p.key}>
              Missing from {evaluatorDisplayName(p.evaluator)}
            </option>
          ))}
        </Select>
      </div>
      {rows.length === 0 ? (
        <EmptyState title="Nothing pending">Every student has been evaluated by every evaluator for {dayLabel(day)}.</EmptyState>
      ) : (
        <ul className="divide-y divide-slate-100">
          {rows.slice(0, 300).map((r) => {
            const s = students[r.studentKey];
            const missing = r.entries.filter((e) => !e.evaluation);
            return (
              <li key={r.studentKey} className="px-4 py-3">
                <button className="flex w-full flex-wrap items-center gap-3 text-left" onClick={() => setOpen(open === r.studentKey ? null : r.studentKey)}>
                  <StudentAvatar student={s} size={36} />
                  <div className="min-w-40">
                    <p className="tabular text-sm font-semibold">{s.studentId}</p>
                    <p className="text-xs text-slate-500">{s.name}</p>
                  </div>
                  <Badge tone="amber">
                    {r.completedCount}/{r.requiredCount}
                  </Badge>
                  <p className="flex-1 text-xs text-slate-500">
                    Pending: {missing.map((m) => evaluatorDisplayName(m.member.evaluator)).join(", ")}
                  </p>
                </button>
                {open === r.studentKey && (
                  <div className="mt-3">
                    <StudentDayStatus studentKey={r.studentKey} day={day} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

function AllEvaluations({ day }: { day: string }) {
  const { students, panel, evaluations, settings, maxPerEvaluator } = useAdminData();
  const [evaluatorFilter, setEvaluatorFilter] = useState("");
  const [onlyCorrected, setOnlyCorrected] = useState(false);
  const [limit, setLimit] = useState(200);
  const rows = useMemo(() => {
    const out: { key: string; studentKey: string; memberName: string; ev: NonNullable<ReturnType<typeof computeStudentDay>["entries"][number]["evaluation"]> }[] = [];
    for (const p of panel) {
      if (evaluatorFilter && p.key !== evaluatorFilter) continue;
      for (const [sk, ev] of Object.entries(evaluations[day]?.[p.key] ?? {})) {
        if (!students[sk]) continue;
        if (onlyCorrected && !ev.correction && !ev.enteredByAdmin) continue;
        out.push({ key: `${p.key}/${sk}`, studentKey: sk, memberName: evaluatorDisplayName(p.evaluator), ev });
      }
    }
    return out.sort((a, b) => (b.ev.timestamp ?? 0) - (a.ev.timestamp ?? 0));
  }, [panel, evaluations, day, students, evaluatorFilter, onlyCorrected]);

  return (
    <Card>
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 p-4">
        <Select className="w-auto" value={evaluatorFilter} onChange={(e) => setEvaluatorFilter(e.target.value)}>
          <option value="">All evaluators</option>
          {panel.map((p) => (
            <option key={p.key} value={p.key}>
              {evaluatorDisplayName(p.evaluator)}
            </option>
          ))}
        </Select>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="size-4" checked={onlyCorrected} onChange={(e) => setOnlyCorrected(e.target.checked)} /> Only corrected / admin-entered
        </label>
        <span className="ml-auto text-sm text-slate-500">
          <b className="tabular">{rows.length.toLocaleString()}</b> evaluations · newest first
        </span>
      </div>
      {rows.length === 0 ? (
        <EmptyState title="No evaluations yet" />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
              <tr className="border-b border-slate-100">
                <th className="px-4 py-2.5">Time</th>
                <th className="px-3 py-2.5">Student</th>
                <th className="px-3 py-2.5">Evaluator</th>
                {CRITERIA_KEYS.map((k) => (
                  <th key={k} className="px-2 py-2.5 text-right">
                    {settings?.criteria?.[k]?.label}
                  </th>
                ))}
                <th className="px-4 py-2.5 text-right">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.slice(0, limit).map((r) => (
                <tr key={r.key} className="hover:bg-slate-50">
                  <td className="whitespace-nowrap px-4 py-2 text-xs text-slate-500">{formatDateTimeShort(r.ev.timestamp)}</td>
                  <td className="px-3 py-2">
                    <span className="tabular font-semibold">{students[r.studentKey].studentId}</span>{" "}
                    <span className="text-slate-500">{students[r.studentKey].name}</span>
                  </td>
                  <td className="px-3 py-2">
                    {r.memberName}
                    {r.ev.correction && <Badge tone="amber" className="ml-1">corrected</Badge>}
                    {r.ev.enteredByAdmin && <Badge tone="violet" className="ml-1">by admin</Badge>}
                  </td>
                  {CRITERIA_KEYS.map((k) => (
                    <td key={k} className="tabular px-2 py-2 text-right">
                      {r.ev[k]}
                    </td>
                  ))}
                  <td className="tabular px-4 py-2 text-right font-bold">
                    {fmt(r.ev.total)}/{maxPerEvaluator}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length > limit && (
            <div className="p-4 text-center">
              <Button variant="secondary" onClick={() => setLimit(limit + 500)}>
                Show more
              </Button>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
