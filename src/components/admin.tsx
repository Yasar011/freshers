"use client";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { CheckCircle2, Clock, Pencil, RotateCcw, PlusCircle, AlertTriangle } from "lucide-react";
import { useAdminData } from "@/context/AdminDataContext";
import { Alert, Badge, Button, ConfirmDialog, Field, Input, Modal, ProgressBar, Textarea, cn } from "@/components/ui";
import { ScoreSelector, StudentAvatar, formatDateTimeShort } from "@/components/shared";
import { useToast } from "@/components/ui/Toast";
import { adminEnterEvaluation, correctEvaluation, deleteEvaluation } from "@/lib/actions";
import { dayLabel, evaluatorDisplayName, pad2 } from "@/lib/keys";
import { computeStudentDay, fmt, type EvaluatorProgress, type PanelMember } from "@/lib/scoring";
import { errorMessage } from "@/lib/firebase";
import { CRITERIA_KEYS, type CriterionKey, type Evaluation, type Scores } from "@/lib/types";

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {actions && <div className="no-print flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function DayTabs({ value, onChange, extra }: { value: string; onChange: (d: string) => void; extra?: { key: string; label: string }[] }) {
  const { days, event } = useAdminData();
  const items = [...(extra ?? []), ...days.map((d) => ({ key: d, label: dayLabel(d) }))];
  return (
    <div className="inline-flex flex-wrap gap-1 rounded-xl bg-slate-100 p-1">
      {items.map((it) => (
        <button
          key={it.key}
          onClick={() => onChange(it.key)}
          className={cn("rounded-lg px-3.5 py-1.5 text-sm font-semibold transition-colors", value === it.key ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900")}
        >
          {it.label}
          {event?.days?.[it.key]?.status === "open" && <span className="ml-1.5 inline-block size-1.5 rounded-full bg-emerald-500 align-middle" />}
        </button>
      ))}
    </div>
  );
}

// ───────────────────────── Score edit (correct / enter on behalf) ─────────────────────────

export function ScoreEditModal({
  open,
  onClose,
  day,
  studentKey,
  member,
  current,
}: {
  open: boolean;
  onClose: () => void;
  day: string;
  studentKey: string;
  member: PanelMember;
  current: Evaluation | null;
}) {
  const { settings, students, admin, maxPerEvaluator } = useAdminData();
  const toast = useToast();
  const student = students[studentKey];
  const [scores, setScores] = useState<Record<CriterionKey, number | null>>({ makeup: null, presentation: null, styling: null, dressup: null });
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setScores(
      current
        ? { makeup: current.makeup, presentation: current.presentation, styling: current.styling, dressup: current.dressup }
        : { makeup: null, presentation: null, styling: null, dressup: null },
    );
    setReason("");
    setError(null);
    setBusy(false);
  }, [open, current]);

  if (!student || !settings) return null;
  const total = CRITERIA_KEYS.reduce((s, k) => s + (scores[k] ?? 0), 0);
  const complete = CRITERIA_KEYS.every((k) => scores[k] !== null);
  const unchanged = current && CRITERIA_KEYS.every((k) => scores[k] === current[k]);

  const save = async () => {
    if (!complete) return setError("Select all scores.");
    if (!reason.trim()) return setError("A reason is required for the audit log.");
    if (unchanged) return setError("The scores are unchanged.");
    setBusy(true);
    setError(null);
    try {
      const final = scores as Scores;
      if (current) await correctEvaluation(admin, day, member.key, studentKey, current, final, reason.trim(), maxPerEvaluator);
      else await adminEnterEvaluation(admin, day, member.key, member.evaluator, studentKey, student, final, reason.trim(), maxPerEvaluator);
      toast(current ? `Score corrected: ${current.total} → ${total}` : `Score ${total}/${maxPerEvaluator} entered`, "success");
      onClose();
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={() => !busy && onClose()}
      size="lg"
      title={current ? "Correct evaluation" : "Enter score on behalf of evaluator"}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={save} loading={busy} disabled={!complete}>
            {current ? "Save correction" : "Save score"}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-3 rounded-xl bg-slate-50 p-3 text-sm">
          <StudentAvatar student={student} size={40} />
          <div className="min-w-0 flex-1">
            <p className="font-semibold">
              {student.studentId} · {student.name}
            </p>
            <p className="text-slate-500">
              {dayLabel(day)} · {evaluatorDisplayName(member.evaluator)} ({member.evaluator.email})
            </p>
          </div>
          {current && (
            <div className="text-right">
              <p className="text-xs text-slate-500">Original</p>
              <p className="tabular font-bold">
                {current.total}/{maxPerEvaluator}
              </p>
            </div>
          )}
        </div>
        {CRITERIA_KEYS.map((k) => (
          <ScoreSelector key={k} criterion={settings.criteria[k]} value={scores[k]} onChange={(v) => setScores((s) => ({ ...s, [k]: v }))} />
        ))}
        <div className="flex items-baseline justify-between rounded-xl bg-brand-50 px-4 py-3">
          <span className="text-sm font-bold uppercase tracking-wider text-brand-800">{current ? "Changed to" : "Total"}</span>
          <span className="tabular text-2xl font-extrabold text-brand-900">
            {total} / {maxPerEvaluator}
          </span>
        </div>
        <Field label="Reason (saved in the audit log)">
          {(id) => <Textarea id={id} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} placeholder={current ? "e.g. Incorrect score entered" : "e.g. Evaluator's phone failed; scored on paper"} />}
        </Field>
        {error && <Alert tone="red">{error}</Alert>}
      </div>
    </Modal>
  );
}

// ───────────────────────── Student status for one day ─────────────────────────

export function StudentDayStatus({ studentKey, day, compact }: { studentKey: string; day: string; compact?: boolean }) {
  const { panel, evaluations, settings, maxPerEvaluator, admin } = useAdminData();
  const toast = useToast();
  const result = useMemo(() => computeStudentDay(studentKey, panel, evaluations[day], settings), [studentKey, panel, evaluations, day, settings]);
  const [edit, setEdit] = useState<{ member: PanelMember; current: Evaluation | null } | null>(null);
  const [reset, setReset] = useState<{ member: PanelMember; current: Evaluation } | null>(null);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-bold uppercase tracking-wider text-slate-600">{dayLabel(day)}</h3>
        {result.complete ? <Badge tone="green">Complete</Badge> : <Badge tone="amber">{result.completedCount}/{result.requiredCount} evaluated</Badge>}
      </div>
      <div className="overflow-x-auto rounded-xl ring-1 ring-slate-200">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2">Evaluator</th>
              {!compact && CRITERIA_KEYS.map((k) => <th key={k} className="px-2 py-2 text-right">{settings?.criteria?.[k]?.label ?? k}</th>)}
              <th className="px-3 py-2 text-right">Total</th>
              {!compact && <th className="px-3 py-2">Submitted</th>}
              <th className="no-print px-3 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {result.entries.map(({ member, evaluation }) => (
              <tr key={member.key} className={cn(!evaluation && "bg-amber-50/40")}>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    {evaluation ? <CheckCircle2 className="size-4 text-emerald-500" /> : <Clock className="size-4 text-amber-500" />}
                    <span className="font-medium">{evaluatorDisplayName(member.evaluator)}</span>
                    {!member.evaluator.active && <Badge tone="red">inactive</Badge>}
                  </div>
                </td>
                {!compact &&
                  CRITERIA_KEYS.map((k) => (
                    <td key={k} className="tabular px-2 py-2 text-right text-slate-600">
                      {evaluation ? evaluation[k] : ""}
                    </td>
                  ))}
                <td className="tabular px-3 py-2 text-right font-semibold">
                  {evaluation ? (
                    <span>
                      {evaluation.total}/{maxPerEvaluator}
                      {evaluation.correction && (
                        <span className="ml-1 text-xs font-normal text-amber-600" title={`Originally ${evaluation.correction.originalTotal}. ${evaluation.correction.reason}`}>
                          (was {evaluation.correction.originalTotal})
                        </span>
                      )}
                    </span>
                  ) : (
                    <span className="font-bold text-amber-600">PENDING</span>
                  )}
                </td>
                {!compact && (
                  <td className="px-3 py-2 text-xs text-slate-500">
                    {evaluation ? formatDateTimeShort(evaluation.timestamp) : ""}
                    {evaluation?.enteredByAdmin && <Badge tone="violet" className="ml-1">by admin</Badge>}
                  </td>
                )}
                <td className="no-print px-3 py-1.5 text-right">
                  {evaluation ? (
                    <div className="flex justify-end gap-1">
                      <Button size="sm" variant="ghost" onClick={() => setEdit({ member, current: evaluation })} title="Correct score">
                        <Pencil className="size-3.5" /> <span className="hidden sm:inline">Correct</span>
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setReset({ member, current: evaluation })} title="Delete so the evaluator can re-submit">
                        <RotateCcw className="size-3.5" />
                      </Button>
                    </div>
                  ) : (
                    <Button size="sm" variant="ghost" onClick={() => setEdit({ member, current: null })}>
                      <PlusCircle className="size-3.5" /> <span className="hidden sm:inline">Enter</span>
                    </Button>
                  )}
                </td>
              </tr>
            ))}
            {result.entries.length === 0 && (
              <tr>
                <td colSpan={9} className="px-3 py-6 text-center text-slate-500">
                  No evaluators registered.
                </td>
              </tr>
            )}
          </tbody>
          <tfoot className="bg-slate-50">
            <tr>
              <td className="px-3 py-2.5 font-bold" colSpan={compact ? 1 : 5}>
                TOTAL
              </td>
              <td className="tabular px-3 py-2.5 text-right font-bold" colSpan={1}>
                {result.rawTotal} / {result.rawMax}
              </td>
              <td colSpan={compact ? 1 : 2} className="px-3 py-2.5 text-right">
                <span className="text-xs font-semibold uppercase text-slate-500">Daily weightage </span>
                <span className="tabular font-extrabold text-brand-700">{fmt(result.score100)} / 100</span>
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
      {result.orphanEvaluations.length > 0 && (
        <Alert className="mt-2">
          <AlertTriangle className="mr-1 inline size-4" />
          {result.orphanEvaluations.length} evaluation(s) from removed evaluators are stored but not counted:{" "}
          {result.orphanEvaluations.map((o) => `${o.evaluation.evaluatorName} (${o.evaluation.total})`).join(", ")}.
        </Alert>
      )}

      {edit && <ScoreEditModal open onClose={() => setEdit(null)} day={day} studentKey={studentKey} member={edit.member} current={edit.current} />}
      <ConfirmDialog
        open={!!reset}
        onClose={() => setReset(null)}
        title="Delete evaluation and allow re-submission?"
        tone="danger"
        confirmLabel="Delete evaluation"
        requireReason
        message={
          reset && (
            <>
              This removes <b>{evaluatorDisplayName(reset.member.evaluator)}</b>&apos;s score of{" "}
              <b>
                {reset.current.total}/{maxPerEvaluator}
              </b>{" "}
              for <b>{reset.current.studentId}</b> on {dayLabel(day)}. The evaluator will be able to evaluate this student again (only while the day is open). This is recorded in the audit log.
            </>
          )
        }
        onConfirm={async (reason) => {
          if (!reset) return;
          await deleteEvaluation(admin, day, reset.member.key, studentKey, reset.current, reason, maxPerEvaluator);
          toast("Evaluation deleted — the evaluator can re-submit.", "success");
        }}
      />
    </div>
  );
}

// ───────────────────────── Evaluator pending drill-down ─────────────────────────

export function EvaluatorPendingModal({ progress, day, onClose }: { progress: EvaluatorProgress | null; day: string; onClose: () => void }) {
  const { students } = useAdminData();
  const [q, setQ] = useState("");
  if (!progress) return null;
  const list = progress.pendingStudentKeys
    .map((k) => ({ k, s: students[k] }))
    .filter(({ s }) => s && (!q || s.studentId.toLowerCase().includes(q.toLowerCase()) || s.name.toLowerCase().includes(q.toLowerCase())))
    .sort((a, b) => a.s.studentId.localeCompare(b.s.studentId, undefined, { numeric: true }));
  return (
    <Modal open onClose={onClose} size="lg" title={`${evaluatorDisplayName(progress.member.evaluator)} · ${dayLabel(day)} · pending students`}>
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-3 text-center text-sm">
          <div className="rounded-xl bg-emerald-50 p-3">
            <p className="tabular text-2xl font-bold text-emerald-700">{progress.completed}</p>
            <p className="text-emerald-700">Completed</p>
          </div>
          <div className="rounded-xl bg-amber-50 p-3">
            <p className="tabular text-2xl font-bold text-amber-700">{progress.pending}</p>
            <p className="text-amber-700">Pending</p>
          </div>
          <div className="rounded-xl bg-brand-50 p-3">
            <p className="tabular text-2xl font-bold text-brand-700">{fmt(progress.percent)}%</p>
            <p className="text-brand-700">Progress</p>
          </div>
        </div>
        <ProgressBar value={progress.percent} />
        <p className="text-xs text-slate-500">
          {progress.member.evaluator.email} · Evaluator {pad2(progress.member.evaluator.number)} · last submission {formatDateTimeShort(progress.lastAt)}
        </p>
        {progress.pending > 0 ? (
          <>
            <Input placeholder="Filter pending students…" value={q} onChange={(e) => setQ(e.target.value)} />
            <ul className="max-h-[50vh] divide-y divide-slate-100 overflow-y-auto rounded-xl ring-1 ring-slate-200">
              {list.map(({ k, s }) => (
                <li key={k} className="flex items-center gap-3 px-3 py-2 text-sm">
                  <StudentAvatar student={s} size={32} />
                  <span className="tabular font-semibold">{s.studentId}</span>
                  <span className="truncate text-slate-600">{s.name}</span>
                  <span className="ml-auto text-xs text-slate-400">{s.class}</span>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <Alert tone="green">All students evaluated by this evaluator for {dayLabel(day)}.</Alert>
        )}
      </div>
    </Modal>
  );
}
