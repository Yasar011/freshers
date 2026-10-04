"use client";
import { useMemo, useState } from "react";
import { Plus, Pencil, Trash2, Power, ChevronRight } from "lucide-react";
import { useAdminData } from "@/context/AdminDataContext";
import { Alert, Badge, Button, Card, CardHeader, ConfirmDialog, EmptyState, Field, Input, Modal, ProgressBar, cn } from "@/components/ui";
import { DayTabs, EvaluatorPendingModal, PageHeader } from "@/components/admin";
import { formatDateTimeShort } from "@/components/shared";
import { useToast } from "@/components/ui/Toast";
import { addEvaluator, removeEvaluator, updateEvaluator } from "@/lib/actions";
import { evaluatorDisplayName, isValidEmail, pad2 } from "@/lib/keys";
import { computeEvaluatorProgress, fmt, type EvaluatorProgress, type PanelMember } from "@/lib/scoring";
import { errorMessage } from "@/lib/firebase";
import { MAIN_ADMIN_EMAIL } from "@/lib/constants";

export default function EvaluatorsPage() {
  const { panel, students, evaluations, activeDay, settings, admin } = useAdminData();
  const toast = useToast();
  const [day, setDay] = useState(activeDay);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<PanelMember | null>(null);
  const [removing, setRemoving] = useState<PanelMember | null>(null);
  const [toggling, setToggling] = useState<PanelMember | null>(null);
  const [drill, setDrill] = useState<EvaluatorProgress | null>(null);

  const progress = useMemo(() => computeEvaluatorProgress(students, panel, evaluations[day]), [students, panel, evaluations, day]);
  const totalEvalsBy = (key: string) => Object.values(evaluations).reduce((n, byEval) => n + Object.keys(byEval?.[key] ?? {}).length, 0);
  const anyEvaluations = Object.values(evaluations).some((d) => Object.values(d ?? {}).some((m) => Object.keys(m ?? {}).length));
  const expected = settings?.evaluatorCount ?? 10;

  return (
    <div>
      <PageHeader
        title="Evaluators"
        subtitle={`${panel.length} of ${expected} evaluators registered · they sign in with Google`}
        actions={
          <Button onClick={() => setAdding(true)}>
            <Plus className="size-4" /> Add evaluator
          </Button>
        }
      />
      <Card>
        <CardHeader title="Evaluator panel" subtitle="Every student must be evaluated by every evaluator listed here, on each day." actions={<DayTabs value={day} onChange={setDay} />} />
        {panel.length === 0 ? (
          <EmptyState title="No evaluators yet">Add each evaluator&apos;s Google email address. They will be able to sign in immediately.</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <tr className="border-b border-slate-100">
                  <th className="px-5 py-2.5">#</th>
                  <th className="px-3 py-2.5">Evaluator</th>
                  <th className="px-3 py-2.5">Status</th>
                  <th className="px-3 py-2.5 text-right">Completed</th>
                  <th className="px-3 py-2.5 text-right">Pending</th>
                  <th className="w-44 px-3 py-2.5">Progress</th>
                  <th className="px-3 py-2.5">Last sign-in</th>
                  <th className="px-5 py-2.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {progress.map((p) => {
                  const e = p.member.evaluator;
                  return (
                    <tr key={p.member.key} className="hover:bg-slate-50">
                      <td className="tabular px-5 py-3 font-bold text-slate-400">{pad2(e.number)}</td>
                      <td className="px-3 py-3">
                        <button className="text-left" onClick={() => setDrill(p)}>
                          <p className="font-semibold text-slate-900">{evaluatorDisplayName(e)}</p>
                          <p className="text-xs text-slate-500">{e.email}</p>
                        </button>
                      </td>
                      <td className="px-3 py-3">{e.active ? <Badge tone="green">Active</Badge> : <Badge tone="red">Deactivated</Badge>}</td>
                      <td className="tabular px-3 py-3 text-right font-semibold">{p.completed}</td>
                      <td className={cn("tabular px-3 py-3 text-right font-semibold", p.pending ? "text-amber-600" : "text-slate-400")}>{p.pending}</td>
                      <td className="px-3 py-3">
                        <button className="flex w-full items-center gap-2" onClick={() => setDrill(p)}>
                          <ProgressBar value={p.percent} />
                          <span className="tabular w-12 text-right text-xs font-semibold">{fmt(p.percent)}%</span>
                          <ChevronRight className="size-4 text-slate-300" />
                        </button>
                      </td>
                      <td className="px-3 py-3 text-xs text-slate-500">{e.lastLoginAt ? formatDateTimeShort(e.lastLoginAt) : "Never"}</td>
                      <td className="px-5 py-3">
                        <div className="flex justify-end gap-1">
                          <Button size="sm" variant="ghost" onClick={() => setToggling(p.member)} title={e.active ? "Deactivate" : "Activate"}>
                            <Power className={cn("size-4", e.active ? "text-emerald-600" : "text-rose-600")} />
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setEditing(p.member)} title="Edit">
                            <Pencil className="size-4" />
                          </Button>
                          <Button size="sm" variant="ghost" className="text-rose-600 hover:bg-rose-50" onClick={() => setRemoving(p.member)} title="Remove">
                            <Trash2 className="size-4" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {adding && <EvaluatorForm onClose={() => setAdding(false)} warnScoring={anyEvaluations} />}
      {editing && <EvaluatorForm member={editing} onClose={() => setEditing(null)} />}
      <EvaluatorPendingModal progress={drill ? progress.find((p) => p.member.key === drill.member.key) ?? null : null} day={day} onClose={() => setDrill(null)} />

      <ConfirmDialog
        open={!!toggling}
        onClose={() => setToggling(null)}
        title={toggling?.evaluator.active ? "Deactivate evaluator?" : "Activate evaluator?"}
        tone={toggling?.evaluator.active ? "warning" : "success"}
        confirmLabel={toggling?.evaluator.active ? "Deactivate" : "Activate"}
        message={
          toggling &&
          (toggling.evaluator.active ? (
            <>
              <b>{evaluatorDisplayName(toggling.evaluator)}</b> will be signed out of the evaluator screen immediately and cannot submit evaluations. Their existing scores are kept, and they remain part of the panel.
            </>
          ) : (
            <>
              <b>{evaluatorDisplayName(toggling.evaluator)}</b> will be able to sign in and evaluate again.
            </>
          ))
        }
        onConfirm={async () => {
          if (!toggling) return;
          await updateEvaluator(admin, toggling.key, toggling.evaluator, { active: !toggling.evaluator.active });
          toast(toggling.evaluator.active ? "Evaluator deactivated" : "Evaluator activated", "success");
        }}
      />
      <ConfirmDialog
        open={!!removing}
        onClose={() => setRemoving(null)}
        title="Remove evaluator from the panel?"
        tone="danger"
        confirmLabel="Remove evaluator"
        message={
          removing && (
            <>
              <b>{evaluatorDisplayName(removing.evaluator)}</b> ({removing.evaluator.email}) will lose access and will no longer be part of the panel. Daily scores will then be calculated from the remaining evaluators.
              {totalEvalsBy(removing.key) > 0 && (
                <Alert tone="red" className="mt-3">
                  This evaluator has submitted {totalEvalsBy(removing.key)} evaluation(s). They stay in the database but will <b>not be counted</b>. To only block access, deactivate instead.
                </Alert>
              )}
            </>
          )
        }
        onConfirm={async () => {
          if (!removing) return;
          await removeEvaluator(admin, removing.key, removing.evaluator);
          toast("Evaluator removed", "success");
        }}
      />
    </div>
  );
}

function EvaluatorForm({ member, onClose, warnScoring }: { member?: PanelMember; onClose: () => void; warnScoring?: boolean }) {
  const { panel, admin } = useAdminData();
  const toast = useToast();
  const nextNumber = useMemo(() => {
    const used = new Set(panel.map((p) => p.evaluator.number));
    let n = 1;
    while (used.has(n)) n++;
    return n;
  }, [panel]);
  const [email, setEmail] = useState(member?.evaluator.email ?? "");
  const [number, setNumber] = useState(String(member?.evaluator.number ?? nextNumber));
  const [name, setName] = useState(member?.evaluator.name ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const num = Number(number);
  const numberTaken = panel.some((p) => p.evaluator.number === num && p.key !== member?.key);
  const defaultName = `Evaluator ${pad2(num || 0)}`;

  const save = async () => {
    if (!member && !isValidEmail(email)) return setError("Enter a valid Google email address.");
    if (!member && email.trim().toLowerCase() === MAIN_ADMIN_EMAIL) return setError("The Main Admin account cannot also be an evaluator.");
    if (!Number.isInteger(num) || num < 1 || num > 99) return setError("Evaluator number must be between 1 and 99.");
    if (numberTaken) return setError(`Evaluator number ${num} is already assigned.`);
    setBusy(true);
    setError(null);
    try {
      const finalName = name.trim() || defaultName;
      if (member) await updateEvaluator(admin, member.key, member.evaluator, { name: finalName, number: num });
      else await addEvaluator(admin, email, num, finalName);
      toast(member ? "Evaluator updated" : `${finalName} added`, "success");
      onClose();
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={() => !busy && onClose()}
      title={member ? `Edit ${evaluatorDisplayName(member.evaluator)}` : "Add evaluator"}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={save} loading={busy}>
            {member ? "Save" : "Add evaluator"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Google email" hint={member ? "The email cannot be changed — remove and re-add instead." : "The evaluator signs in with this Google account."}>
          {(id) => <Input id={id} type="email" value={email} onChange={(e) => setEmail(e.target.value)} disabled={!!member} placeholder="evaluator@gmail.com" autoFocus={!member} />}
        </Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Number" error={numberTaken ? "Taken" : null}>
            {(id) => <Input id={id} type="number" min={1} max={99} value={number} onChange={(e) => setNumber(e.target.value)} />}
          </Field>
          <div className="col-span-2">
            <Field label="Display name">{(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} placeholder={defaultName} />}</Field>
          </div>
        </div>
        {warnScoring && (
          <Alert>Evaluations have already been submitted. Adding an evaluator means every student also needs this evaluator&apos;s score before their day is complete.</Alert>
        )}
        {error && <Alert tone="red">{error}</Alert>}
      </div>
    </Modal>
  );
}
