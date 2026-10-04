"use client";
import { useMemo, useState } from "react";
import { Lock, Unlock, PlayCircle, CheckCircle2 } from "lucide-react";
import { useAdminData } from "@/context/AdminDataContext";
import { Alert, Badge, Button, Card, ConfirmDialog, ProgressBar, cn } from "@/components/ui";
import { PageHeader } from "@/components/admin";
import { formatDateTimeShort } from "@/components/shared";
import { useToast } from "@/components/ui/Toast";
import { lockDay, openDay } from "@/lib/actions";
import { dayLabel } from "@/lib/keys";
import { computeDaySummary, fmt } from "@/lib/scoring";

type PendingAction = { kind: "open" | "lock"; day: string } | null;

export default function DaysPage() {
  const { event, days, students, panel, evaluations, admin, activeDay } = useAdminData();
  const toast = useToast();
  const [action, setAction] = useState<PendingAction>(null);
  const summaries = useMemo(() => Object.fromEntries(days.map((d) => [d, computeDaySummary(d, students, panel, evaluations[d])])), [days, students, panel, evaluations]);
  if (!event) return null;
  const openDays = days.filter((d) => event.days?.[d]?.status === "open");

  return (
    <div>
      <PageHeader title="Day Management" subtitle="Only one day can be open at a time. Evaluators always see the active day." />
      <Alert tone="blue" className="mb-4">
        Flow: <b>Open Day 1</b> → monitor progress → <b>Lock Day 1</b> → <b>Open Day 2</b> → … When a day is locked, evaluators cannot submit or change anything for it, and the data stays visible to you. Re-opening a locked day unlocks it.
      </Alert>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {days.map((d) => {
          const info = event.days?.[d];
          const open = info?.status === "open";
          const s = summaries[d];
          const done = s.expected > 0 && s.completed === s.expected;
          return (
            <Card key={d} className={cn("flex flex-col p-6", open && "ring-2 ring-emerald-500")}>
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-2xl font-extrabold tracking-tight">{dayLabel(d)}</p>
                  {d === activeDay && <p className="text-xs font-semibold text-brand-600">Active day</p>}
                </div>
                <Badge tone={open ? "green" : "slate"} className="px-3 py-1 text-sm">
                  {open ? (
                    <>
                      <Unlock className="size-3.5" /> OPEN
                    </>
                  ) : (
                    <>
                      <Lock className="size-3.5" /> LOCKED
                    </>
                  )}
                </Badge>
              </div>
              <div className="mt-5">
                <div className="mb-1 flex justify-between text-sm">
                  <span className="text-slate-500">Progress</span>
                  <span className="tabular font-semibold">{fmt(s.percent)}%</span>
                </div>
                <ProgressBar value={s.percent} />
                <p className="tabular mt-2 text-xs text-slate-500">
                  {s.completed.toLocaleString()} / {s.expected.toLocaleString()} evaluations · {s.pending.toLocaleString()} pending
                </p>
              </div>
              <dl className="mt-4 space-y-1 text-xs text-slate-500">
                <div className="flex justify-between">
                  <dt>Last opened</dt>
                  <dd>{formatDateTimeShort(info?.openedAt)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt>Last locked</dt>
                  <dd>{formatDateTimeShort(info?.lockedAt)}</dd>
                </div>
              </dl>
              <div className="mt-auto pt-6">
                {open ? (
                  <Button variant="danger" size="lg" className="w-full" onClick={() => setAction({ kind: "lock", day: d })}>
                    <Lock className="size-5" /> Lock {dayLabel(d)}
                  </Button>
                ) : (
                  <Button variant={info?.lockedAt ? "secondary" : "success"} size="lg" className="w-full" onClick={() => setAction({ kind: "open", day: d })}>
                    {info?.lockedAt ? <Unlock className="size-5" /> : <PlayCircle className="size-5" />} {info?.lockedAt ? `Unlock ${dayLabel(d)}` : `Open ${dayLabel(d)}`}
                  </Button>
                )}
                {done && !open && info?.lockedAt && (
                  <p className="mt-2 flex items-center justify-center gap-1 text-xs font-semibold text-emerald-600">
                    <CheckCircle2 className="size-4" /> All evaluations complete
                  </p>
                )}
              </div>
            </Card>
          );
        })}
      </div>

      <ConfirmDialog
        open={!!action}
        onClose={() => setAction(null)}
        title={action ? (action.kind === "open" ? `Open ${dayLabel(action.day)}?` : `Lock ${dayLabel(action.day)}?`) : ""}
        tone={action?.kind === "lock" ? "danger" : "success"}
        confirmLabel={action ? (action.kind === "open" ? `Open ${dayLabel(action.day)}` : `Lock ${dayLabel(action.day)}`) : ""}
        message={
          action &&
          (action.kind === "open" ? (
            <>
              <p>
                {dayLabel(action.day)} becomes the active day and evaluators can start submitting scores for it.
              </p>
              {openDays.filter((d) => d !== action.day).length > 0 && (
                <Alert className="mt-3">
                  {openDays.filter((d) => d !== action.day).map(dayLabel).join(", ")} is currently open and will be <b>locked automatically</b>.
                </Alert>
              )}
            </>
          ) : (
            <>
              <p>Evaluators will no longer be able to submit evaluations for {dayLabel(action.day)}.</p>
              {summaries[action.day].pending > 0 && (
                <Alert tone="red" className="mt-3">
                  {summaries[action.day].pending.toLocaleString()} evaluation(s) are still pending for this day. Those students will be scored only on the marks they received (missing evaluations add nothing) unless you unlock the day or enter the missing scores.
                </Alert>
              )}
            </>
          ))
        }
        onConfirm={async () => {
          if (!action) return;
          if (action.kind === "open") await openDay(admin, event, action.day);
          else await lockDay(admin, action.day);
          toast(`${dayLabel(action.day)} ${action.kind === "open" ? "opened" : "locked"}`, "success");
        }}
      />
    </div>
  );
}
