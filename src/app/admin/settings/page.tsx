"use client";
import { useEffect, useMemo, useState } from "react";
import { Save, ShieldCheck } from "lucide-react";
import { useAdminData } from "@/context/AdminDataContext";
import { Alert, Button, Card, CardHeader, Field, Input } from "@/components/ui";
import { PageHeader } from "@/components/admin";
import { useToast } from "@/components/ui/Toast";
import { saveSettings } from "@/lib/actions";
import { DEFAULT_SETTINGS } from "@/lib/constants";
import { errorMessage } from "@/lib/firebase";
import { CRITERIA_KEYS, type Settings } from "@/lib/types";

export default function SettingsPage() {
  const { settings, event, admin, evaluations, panel } = useAdminData();
  const toast = useToast();
  const [draft, setDraft] = useState<Settings>(settings ?? DEFAULT_SETTINGS);
  const [name, setName] = useState(event?.name ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (settings) setDraft(settings);
  }, [settings]);
  useEffect(() => {
    if (event) setName(event.name);
  }, [event]);

  const scoringStarted = useMemo(() => Object.values(evaluations).some((d) => Object.values(d ?? {}).some((m) => Object.keys(m ?? {}).length)), [evaluations]);
  const perEval = CRITERIA_KEYS.reduce((s, k) => s + (Number(draft.criteria[k].max) || 0), 0);

  const save = async () => {
    if (!event) return;
    setError(null);
    if (!name.trim()) return setError("Event name is required.");
    for (const k of CRITERIA_KEYS) {
      const c = draft.criteria[k];
      if (!c.label.trim()) return setError("Every criterion needs a label.");
      if (!Number.isInteger(c.max) || c.max < 1 || c.max > 100) return setError("Maximum marks must be whole numbers between 1 and 100.");
    }
    if (!Number.isInteger(draft.evaluatorCount) || draft.evaluatorCount < 1) return setError("Expected evaluators must be at least 1.");
    if (!Number.isInteger(draft.totalDays) || draft.totalDays < 1 || draft.totalDays > 9) return setError("Number of days must be 1–9.");
    setBusy(true);
    try {
      await saveSettings(admin, event, { ...draft, criteria: Object.fromEntries(CRITERIA_KEYS.map((k) => [k, { ...draft.criteria[k], label: draft.criteria[k].label.trim() }])) as Settings["criteria"] }, name.trim());
      toast("Settings saved", "success");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-3xl">
      <PageHeader
        title="Settings"
        actions={
          <Button onClick={save} loading={busy}>
            <Save className="size-4" /> Save settings
          </Button>
        }
      />
      {error && (
        <Alert tone="red" className="mb-4">
          {error}
        </Alert>
      )}
      <div className="space-y-4">
        <Card>
          <CardHeader title="Event" />
          <div className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-3">
            <div className="sm:col-span-2">
              <Field label="Event name">{(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} />}</Field>
            </div>
            <Field label="Number of days" hint={scoringStarted ? "Locked: scoring has started" : undefined}>
              {(id) => (
                <Input id={id} type="number" min={1} max={9} value={draft.totalDays} disabled={scoringStarted} onChange={(e) => setDraft({ ...draft, totalDays: Number(e.target.value) })} />
              )}
            </Field>
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Evaluation criteria"
            subtitle={`One evaluator: ${perEval} marks · ${panel.length} evaluators: ${perEval * panel.length} marks → converted to 100.`}
          />
          <div className="space-y-3 p-5">
            {scoringStarted && <Alert>Maximum marks are locked because evaluations have already been submitted. Labels can still be renamed.</Alert>}
            {CRITERIA_KEYS.map((k) => (
              <div key={k} className="grid grid-cols-[1fr_7rem] gap-3">
                <Field label={`Criterion ${draft.criteria[k].order}`}>
                  {(id) => (
                    <Input id={id} value={draft.criteria[k].label} maxLength={40} onChange={(e) => setDraft({ ...draft, criteria: { ...draft.criteria, [k]: { ...draft.criteria[k], label: e.target.value } } })} />
                  )}
                </Field>
                <Field label="Max marks">
                  {(id) => (
                    <Input
                      id={id}
                      type="number"
                      min={1}
                      max={100}
                      value={draft.criteria[k].max}
                      disabled={scoringStarted}
                      onChange={(e) => setDraft({ ...draft, criteria: { ...draft.criteria, [k]: { ...draft.criteria[k], max: Number(e.target.value) } } })}
                    />
                  )}
                </Field>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <CardHeader title="Evaluators" />
          <div className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-3">
            <Field label="Expected number of evaluators" hint="Used for dashboard warnings. Scores always use all registered evaluators.">
              {(id) => <Input id={id} type="number" min={1} max={50} value={draft.evaluatorCount} onChange={(e) => setDraft({ ...draft, evaluatorCount: Number(e.target.value) })} />}
            </Field>
          </div>
        </Card>

        <Card>
          <CardHeader title="Main Admin" />
          <div className="flex items-start gap-3 p-5 text-sm">
            <ShieldCheck className="mt-0.5 size-5 text-emerald-600" />
            <div>
              <p className="font-semibold">{admin.email}</p>
              <p className="text-slate-500">Firebase UID: <code className="text-xs">{admin.uid}</code></p>
              <p className="mt-2 text-slate-500">
                Admin access is granted by the <code>/admin/uid</code> record and enforced by the Realtime Database security rules. There is no admin sign-up — it can only be changed from the Firebase console.
              </p>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
