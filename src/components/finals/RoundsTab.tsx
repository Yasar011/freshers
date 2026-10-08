"use client";
import { useEffect, useMemo, useState } from "react";
import { Lock, PlayCircle, Plus, RotateCcw, Settings2, Trash2, Unlock, Users } from "lucide-react";
import { Alert, Badge, Button, Card, ConfirmDialog, EmptyState, Field, Input, Modal, ProgressBar, Textarea, cn } from "@/components/ui";
import { ScoreSelector, StudentAvatar } from "@/components/shared";
import { useToast } from "@/components/ui/Toast";
import { GenderBadge, GenderFilter, matchesGender, useFinals, type GenderFilterValue } from "./common";
import {
  cidOf,
  GENDERS,
  judgeTotal,
  recommendAdvance,
  ROUND_KEYS,
  roundMax,
  roundResult,
  takesPart,
  type FinalCriterion,
  type FinalScore,
  type Finalist,
  type JudgePanelMember,
  type RoundKey,
} from "@/lib/finals";
import { adminEnterFinalScore, correctFinalScore, lockRound, openRound, resetFinalScore, saveRoundSettings, setQualified } from "@/lib/finalsActions";
import { errorMessage } from "@/lib/firebase";
import { fmt } from "@/lib/scoring";
import { formatDateTimeShort } from "@/components/shared";

export default function RoundsTab() {
  const { finalConfig, judgePanel, finalists, finalScores, admin } = useFinals();
  const toast = useToast();
  const [action, setAction] = useState<{ kind: "open" | "lock"; round: RoundKey } | null>(null);
  const [settings, setSettings] = useState<RoundKey | null>(null);
  const [qualifiers, setQualifiers] = useState<"walk" | "talent" | null>(null);
  const [open, setOpen] = useState<RoundKey | null>(finalConfig?.activeRound ?? "walk");
  const [filter, setFilter] = useState<GenderFilterValue>("all");
  if (!finalConfig) return null;
  const rounds = ROUND_KEYS.map((r) => ({ key: r, info: finalConfig.rounds[r] })).sort((a, b) => a.info.order - b.info.order);

  return (
    <div className="space-y-4">
      {judgePanel.length === 0 && <Alert tone="amber">No judges yet — create judge links in the Judges tab before opening a round.</Alert>}
      {Object.keys(finalists).length === 0 && <Alert tone="blue">No finalists yet — select them in the Finalists tab.</Alert>}
      {rounds.map(({ key, info }) => {
        const part = Object.entries(finalists).filter(([, f]) => takesPart(f, key));
        const expected = part.length * judgePanel.length;
        const doneCount = judgePanel.reduce((n, m) => n + part.filter(([, f]) => finalScores[key]?.[m.id]?.[cidOf(f)]).length, 0);
        const pct = expected ? (doneCount * 100) / expected : 0;
        const isOpen = info.status === "open";
        const idx = ROUND_KEYS.indexOf(key);
        const prev = idx > 0 ? ROUND_KEYS[idx - 1] : null;
        const qualifiedCount = key === "walk" ? Object.keys(finalists).length : part.length;
        return (
          <Card key={key} className={cn(isOpen && "ring-2 ring-emerald-500")}>
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
              <div>
                <h2 className="flex flex-wrap items-center gap-2 text-lg font-bold">
                  Round {info.order}: {info.label}
                  <Badge tone={isOpen ? "green" : "slate"} className="px-2.5">
                    {isOpen ? (
                      <>
                        <Unlock className="size-3" /> OPEN
                      </>
                    ) : (
                      <>
                        <Lock className="size-3" /> LOCKED
                      </>
                    )}
                  </Badge>
                </h2>
                <p className="mt-0.5 text-sm text-slate-500">
                  {info.note && <span>{info.note} · </span>}
                  Criteria: {Object.values(info.criteria).sort((a, b) => a.order - b.order).map((c) => `${c.label} /${c.max}`).join(", ")} · weight {info.weight}
                </p>
                <p className="mt-0.5 text-xs text-slate-400">
                  {isOpen ? `Opened ${formatDateTimeShort(info.openedAt)}` : info.lockedAt ? `Locked ${formatDateTimeShort(info.lockedAt)}` : "Not opened yet"}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="ghost" size="sm" onClick={() => setSettings(key)}>
                  <Settings2 className="size-4" /> Settings
                </Button>
                {(key === "walk" || key === "talent") && (
                  <Button variant="secondary" size="sm" onClick={() => setQualifiers(key)}>
                    <Users className="size-4" /> Pick {info.advanceBoys ?? 3} boys + {info.advanceGirls ?? 3} girls for {finalConfig.rounds[ROUND_KEYS[idx + 1]].label}
                  </Button>
                )}
                {isOpen ? (
                  <Button variant="danger" onClick={() => setAction({ kind: "lock", round: key })}>
                    <Lock className="size-4" /> Lock round
                  </Button>
                ) : (
                  <Button variant={info.lockedAt ? "secondary" : "success"} onClick={() => setAction({ kind: "open", round: key })}>
                    {info.lockedAt ? <Unlock className="size-4" /> : <PlayCircle className="size-4" />} {info.lockedAt ? "Unlock round" : "Open round"}
                  </Button>
                )}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-4 px-5 py-3 text-sm">
              <span className="text-slate-600">
                <b className="tabular">{qualifiedCount}</b> contestant{qualifiedCount === 1 ? "" : "s"}
                {prev && qualifiedCount === 0 && <span className="text-amber-600"> — pick qualifiers after {finalConfig.rounds[prev].label}</span>}
              </span>
              <div className="flex min-w-48 flex-1 items-center gap-2">
                <ProgressBar value={pct} />
                <span className="tabular whitespace-nowrap text-xs text-slate-500">
                  {doneCount}/{expected} scores
                </span>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setOpen(open === key ? null : key)}>
                {open === key ? "Hide scores" : "Show scores"}
              </Button>
            </div>
            {open === key && (
              <div className="border-t border-slate-100 p-5">
                <div className="mb-3 flex justify-end">
                  <GenderFilter value={filter} onChange={setFilter} />
                </div>
                <RoundScoreboard round={key} filter={filter} />
              </div>
            )}
          </Card>
        );
      })}

      <ConfirmDialog
        open={!!action}
        onClose={() => setAction(null)}
        title={action ? `${action.kind === "open" ? "Open" : "Lock"} ${finalConfig.rounds[action.round].label}?` : ""}
        tone={action?.kind === "lock" ? "danger" : "success"}
        confirmLabel={action?.kind === "open" ? "Open round" : "Lock round"}
        message={
          action &&
          (action.kind === "open" ? (
            <>
              Judges will be able to score <b>{finalConfig.rounds[action.round].label}</b> straight away.
              {Object.entries(finalConfig.rounds).some(([r, i]) => r !== action.round && i.status === "open") && (
                <Alert className="mt-3">The round that is currently open will be locked automatically.</Alert>
              )}
              {action.round !== "walk" && Object.values(finalists).filter((f) => takesPart(f, action.round)).length === 0 && (
                <Alert tone="red" className="mt-3">No contestants are selected for this round yet — judges would see an empty list. Pick the qualifiers first.</Alert>
              )}
            </>
          ) : (
            <>Judges can no longer submit scores for {finalConfig.rounds[action.round].label}. You can unlock it again.</>
          ))
        }
        onConfirm={async () => {
          if (!action) return;
          if (action.kind === "open") await openRound(admin, finalConfig, action.round);
          else await lockRound(admin, finalConfig, action.round);
          toast(`${finalConfig.rounds[action.round].label} ${action.kind === "open" ? "opened" : "locked"}`, "success");
        }}
      />
      {settings && <RoundSettingsModal round={settings} onClose={() => setSettings(null)} />}
      {qualifiers && <QualifiersModal from={qualifiers} onClose={() => setQualifiers(null)} />}
    </div>
  );
}

// ───────────────────────── Scoreboard with per-judge cells ─────────────────────────

function RoundScoreboard({ round, filter }: { round: RoundKey; filter: GenderFilterValue }) {
  const { finalists, judgePanel, finalScores, finalConfig } = useFinals();
  const [cell, setCell] = useState<{ key: string; member: JudgePanelMember } | null>(null);
  const max = roundMax(finalConfig?.rounds[round]);
  const rows = useMemo(() => {
    const list = Object.entries(finalists)
      .filter(([, f]) => takesPart(f, round) && matchesGender(f.gender, filter))
      .map(([key, f]) => ({ key, f, r: roundResult(cidOf(f), round, judgePanel, finalScores, finalConfig) }));
    // rank within gender by this round's score
    const rank = new Map<string, number>();
    for (const g of GENDERS) {
      const grp = list.filter((x) => x.f.gender === g).sort((a, b) => b.r.score100 - a.r.score100);
      grp.forEach((x, i) => rank.set(x.key, i > 0 && grp[i - 1].r.score100 === x.r.score100 ? rank.get(grp[i - 1].key)! : i + 1));
    }
    return list.sort((a, b) => a.f.gender.localeCompare(b.f.gender) || (rank.get(a.key)! - rank.get(b.key)!) || a.f.number - b.f.number).map((x) => ({ ...x, rank: rank.get(x.key)! }));
  }, [finalists, round, filter, judgePanel, finalScores, finalConfig]);

  if (rows.length === 0) return <EmptyState title="No contestants in this round yet" />;
  return (
    <>
      <div className="overflow-x-auto rounded-xl ring-1 ring-slate-200">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2">Rank</th>
              <th className="px-3 py-2">Contestant</th>
              {judgePanel.map((m) => (
                <th key={m.id} className="px-3 py-2 text-center">
                  {m.judge.name}
                </th>
              ))}
              <th className="px-3 py-2 text-right">/100</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map(({ key, f, r, rank }) => (
              <tr key={key}>
                <td className="tabular px-3 py-2 font-bold">
                  {r.done > 0 ? rank : "—"}
                </td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span className="tabular text-xs font-bold text-slate-400">#{String(f.number).padStart(2, "0")}</span>
                    <StudentAvatar student={f} size={28} />
                    <span className="font-medium">{f.name}</span>
                    <GenderBadge gender={f.gender} />
                  </div>
                </td>
                {r.entries.map(({ member, score }) => (
                  <td key={member.id} className="px-3 py-2 text-center">
                    <button
                      onClick={() => setCell({ key, member })}
                      className={cn("tabular rounded-lg px-2.5 py-1 font-semibold hover:bg-slate-100", score ? "text-slate-900" : "text-amber-600")}
                    >
                      {score ? `${judgeTotal(score)}/${max}` : "pending"}
                      {score?.correction && <span className="ml-1 text-[10px] font-normal text-amber-600">(was {score.correction.originalTotal})</span>}
                    </button>
                  </td>
                ))}
                <td className="tabular px-3 py-2 text-right text-base font-extrabold">{fmt(r.score100)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-slate-500">Click a judge&apos;s cell to correct a score, reset it, or enter a missing one.</p>
      {cell && <FinalScoreModal round={round} studentKey={cell.key} member={cell.member} onClose={() => setCell(null)} />}
    </>
  );
}

function FinalScoreModal({ round, studentKey, member, onClose }: { round: RoundKey; studentKey: string; member: JudgePanelMember; onClose: () => void }) {
  const { finalists, finalScores, finalConfig, admin } = useFinals();
  const toast = useToast();
  const finalist = finalists[studentKey];
  const current: FinalScore | null = (finalist && finalScores[round]?.[member.id]?.[cidOf(finalist)]) || null;
  const crit = useMemo(() => Object.entries(finalConfig?.rounds[round]?.criteria ?? {}).sort((a, b) => a[1].order - b[1].order), [finalConfig, round]);
  const [scores, setScores] = useState<Record<string, number | null>>({});
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reset, setReset] = useState(false);

  useEffect(() => {
    setScores(Object.fromEntries(crit.map(([k]) => [k, current ? current.scores[k] ?? null : null])));
    setReason("");
    setError(null);
  }, [crit, current]);

  if (!finalist || !finalConfig) return null;
  const max = roundMax(finalConfig.rounds[round]);
  const total = crit.reduce((s, [k]) => s + (scores[k] ?? 0), 0);
  const complete = crit.every(([k]) => scores[k] !== null && scores[k] !== undefined);
  const unchanged = current && crit.every(([k]) => scores[k] === current.scores[k]);

  const save = async () => {
    if (!complete) return setError("Select every score.");
    if (!reason.trim()) return setError("A reason is required for the audit log.");
    if (unchanged) return setError("The scores are unchanged.");
    setBusy(true);
    setError(null);
    try {
      const final = Object.fromEntries(crit.map(([k]) => [k, scores[k] as number]));
      if (current) await correctFinalScore(admin, round, finalConfig, member.id, member.judge.name, finalist, current, final, reason.trim());
      else await adminEnterFinalScore(admin, round, finalConfig, member.id, member.judge.name, finalist, final, reason.trim());
      toast(current ? `Score corrected: ${judgeTotal(current)} → ${total}` : `Score ${total}/${max} entered`, "success");
      onClose();
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  return (
    <>
      <Modal
        open
        onClose={() => !busy && onClose()}
        size="lg"
        title={current ? "Correct judge's score" : "Enter score for judge"}
        footer={
          <>
            {current && (
              <Button variant="ghost" className="mr-auto text-rose-600" onClick={() => setReset(true)} disabled={busy}>
                <RotateCcw className="size-4" /> Reset
              </Button>
            )}
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
            <StudentAvatar student={finalist} size={40} />
            <div className="min-w-0 flex-1">
              <p className="font-semibold">
                #{finalist.number} · {finalist.name}
              </p>
              <p className="text-slate-500">
                {finalConfig.rounds[round].label} · judge {member.judge.name}
              </p>
            </div>
            {current && (
              <div className="text-right">
                <p className="text-xs text-slate-500">Original</p>
                <p className="tabular font-bold">
                  {judgeTotal(current)}/{max}
                </p>
              </div>
            )}
          </div>
          {crit.map(([k, c]) => (
            <ScoreSelector key={k} criterion={c as FinalCriterion} value={scores[k] ?? null} onChange={(v) => setScores((s) => ({ ...s, [k]: v }))} />
          ))}
          <div className="flex items-baseline justify-between rounded-xl bg-brand-50 px-4 py-3">
            <span className="text-sm font-bold uppercase tracking-wider text-brand-800">{current ? "Changed to" : "Total"}</span>
            <span className="tabular text-2xl font-extrabold text-brand-900">
              {total} / {max}
            </span>
          </div>
          <Field label="Reason (saved in the audit log)">{(id) => <Textarea id={id} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />}</Field>
          {error && <Alert tone="red">{error}</Alert>}
        </div>
      </Modal>
      <ConfirmDialog
        open={reset}
        onClose={() => setReset(false)}
        title="Reset this score?"
        tone="danger"
        confirmLabel="Reset score"
        requireReason
        message={<>The judge will be able to score {finalist.name} again (only while the round is open).</>}
        onConfirm={async (r) => {
          if (!current) return;
          await resetFinalScore(admin, round, finalConfig, member.id, member.judge.name, finalist, current, r);
          toast("Score reset", "success");
          onClose();
        }}
      />
    </>
  );
}

// ───────────────────────── Qualifiers (3 boys + 3 girls) ─────────────────────────

function QualifiersModal({ from, onClose }: { from: "walk" | "talent"; onClose: () => void }) {
  const { finalists, judges, finalScores, finalConfig, admin } = useFinals();
  const toast = useToast();
  const next: "talent" | "qa" = from === "walk" ? "talent" : "qa";
  const rec = useMemo(() => recommendAdvance(from, finalists, judges, finalScores, finalConfig), [from, finalists, judges, finalScores, finalConfig]);
  const initial = useMemo(() => {
    const cur = Object.entries(finalists).filter(([, f]) => f.qualified?.[next]).map(([k]) => k);
    return cur.length ? cur : rec.flatMap((r) => r.picks);
  }, [finalists, next, rec]);
  const [selected, setSelected] = useState<Set<string>>(new Set(initial));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!finalConfig) return null;

  const toggle = (k: string) => setSelected((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await setQualified(admin, next, Object.keys(finalists), [...selected], finalists);
      toast(`${selected.size} contestants selected for ${finalConfig.rounds[next].label}`, "success");
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
      size="xl"
      title={`Selected for ${finalConfig.rounds[next].label}`}
      footer={
        <>
          <Button variant="ghost" className="mr-auto" onClick={() => setSelected(new Set(rec.flatMap((r) => r.picks))) }>
            Use recommended
          </Button>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={save} loading={busy}>
            Save ({selected.size})
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-slate-600">
          Recommended: the top {finalConfig.rounds[from].advanceBoys ?? 3} boys and top {finalConfig.rounds[from].advanceGirls ?? 3} girls by{" "}
          {from === "walk" ? finalConfig.rounds.walk.label : "Walk + Talent"} score (ties broken by the 3-day score). Tick or untick to change the list.
        </p>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {rec.map((r) => {
            const group = Object.entries(finalists).filter(([, f]) => f.gender === r.gender && takesPart(f, from));
            const panel = judgeScoreMap(finalists, group, from, judges, finalScores, finalConfig);
            const sorted = group.sort((a, b) => (panel.get(b[0]) ?? 0) - (panel.get(a[0]) ?? 0) || (b[1].score3day ?? 0) - (a[1].score3day ?? 0));
            return (
              <div key={r.gender}>
                <div className="mb-2 flex items-center justify-between">
                  <h4 className="font-bold">{r.gender === "boy" ? "Boys" : "Girls"}</h4>
                  <Badge tone={[...selected].filter((k) => finalists[k]?.gender === r.gender).length === r.wanted ? "green" : "amber"}>
                    {[...selected].filter((k) => finalists[k]?.gender === r.gender).length} / {r.wanted}
                  </Badge>
                </div>
                {r.tieAtCut && <Alert className="mb-2">The last place is tied with the next contestant — you decide who goes through.</Alert>}
                <ul className="divide-y divide-slate-100 rounded-xl ring-1 ring-slate-200">
                  {sorted.map(([k, f], i) => (
                    <li key={k}>
                      <label className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-slate-50">
                        <input type="checkbox" className="size-4" checked={selected.has(k)} onChange={() => toggle(k)} />
                        <span className="tabular w-5 text-xs font-bold text-slate-400">{i + 1}</span>
                        <StudentAvatar student={f} size={28} />
                        <span className="min-w-0 flex-1 truncate">
                          <b>{f.name}</b> <span className="text-xs text-slate-500">#{f.number}</span>
                        </span>
                        <span className="tabular font-semibold">{fmt(panel.get(k) ?? 0)}</span>
                        {r.picks.includes(k) && <Badge tone="violet">recommended</Badge>}
                      </label>
                    </li>
                  ))}
                  {group.length === 0 && <li className="px-3 py-4 text-center text-sm text-slate-500">No contestants.</li>}
                </ul>
              </div>
            );
          })}
        </div>
        {error && <Alert tone="red">{error}</Alert>}
      </div>
    </Modal>
  );
}

function judgeScoreMap(
  finalists: Record<string, Finalist>,
  group: [string, Finalist][],
  from: "walk" | "talent",
  judges: ReturnType<typeof useFinals>["judges"],
  scores: ReturnType<typeof useFinals>["finalScores"],
  config: ReturnType<typeof useFinals>["finalConfig"],
) {
  const out = new Map<string, number>();
  const rounds: RoundKey[] = from === "walk" ? ["walk"] : ["walk", "talent"];
  const panel = Object.entries(judges).map(([id, judge]) => ({ id, judge }));
  for (const [k] of group) {
    let num = 0;
    let den = 0;
    for (const r of rounds) {
      const w = Number(config?.rounds[r]?.weight) || 0;
      num += w * roundResult(cidOf(finalists[k]), r, panel, scores, config).score100;
      den += w;
    }
    out.set(k, den > 0 ? Math.round((num / den) * 100) / 100 : 0);
  }
  return out;
}

// ───────────────────────── Round settings ─────────────────────────

function RoundSettingsModal({ round, onClose }: { round: RoundKey; onClose: () => void }) {
  const { finalConfig, finalScores, admin } = useFinals();
  const toast = useToast();
  const info = finalConfig!.rounds[round];
  const scored = Object.values(finalScores[round] ?? {}).some((m) => Object.keys(m ?? {}).length > 0);
  const [label, setLabel] = useState(info.label);
  const [note, setNote] = useState(info.note ?? "");
  const [weight, setWeight] = useState(String(info.weight));
  const [advB, setAdvB] = useState(String(info.advanceBoys ?? 3));
  const [advG, setAdvG] = useState(String(info.advanceGirls ?? 3));
  const [crit, setCrit] = useState<[string, FinalCriterion][]>(Object.entries(info.criteria).sort((a, b) => a[1].order - b[1].order));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasAdvance = round !== "qa";

  const save = async () => {
    setError(null);
    if (!label.trim()) return setError("Round name is required.");
    const w = Number(weight);
    if (!(w >= 0) || w > 100) return setError("Weight must be between 0 and 100.");
    if (!crit.length) return setError("Add at least one criterion.");
    for (const [, c] of crit) {
      if (!c.label.trim()) return setError("Every criterion needs a name.");
      if (!Number.isInteger(c.max) || c.max < 1 || c.max > 100) return setError("Maximum marks must be whole numbers from 1 to 100.");
    }
    const ab = Number(advB);
    const ag = Number(advG);
    if (hasAdvance && (!Number.isInteger(ab) || !Number.isInteger(ag) || ab < 0 || ag < 0)) return setError("Advance counts must be whole numbers.");
    setBusy(true);
    try {
      await saveRoundSettings(admin, round, {
        label,
        note,
        weight: w,
        advanceBoys: hasAdvance ? ab : undefined,
        advanceGirls: hasAdvance ? ag : undefined,
        criteria: Object.fromEntries(crit.map(([, c], i) => [`c${i + 1}`, { label: c.label.trim(), max: c.max, order: i + 1 }])),
      });
      toast("Round settings saved", "success");
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
      size="lg"
      title={`${info.label} — settings`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={save} loading={busy}>
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {scored && <Alert>Judges have already scored this round, so criteria cannot be added, removed or have their maximum changed. Names can still be edited.</Alert>}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="sm:col-span-2">
            <Field label="Round name">{(id) => <Input id={id} value={label} onChange={(e) => setLabel(e.target.value)} maxLength={60} />}</Field>
          </div>
          <Field label="Weight in final score" hint="1 = equal weight">
            {(id) => <Input id={id} type="number" min={0} step="0.1" value={weight} onChange={(e) => setWeight(e.target.value)} />}
          </Field>
        </div>
        <Field label="Note shown to judges">{(id) => <Input id={id} value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} />}</Field>
        {hasAdvance && (
          <div className="grid grid-cols-2 gap-4">
            <Field label="Boys advancing to the next round">{(id) => <Input id={id} type="number" min={0} value={advB} onChange={(e) => setAdvB(e.target.value)} />}</Field>
            <Field label="Girls advancing to the next round">{(id) => <Input id={id} type="number" min={0} value={advG} onChange={(e) => setAdvG(e.target.value)} />}</Field>
          </div>
        )}
        <div>
          <p className="mb-2 text-sm font-medium text-slate-700">Judging criteria</p>
          <div className="space-y-2">
            {crit.map(([k, c], i) => (
              <div key={k} className="grid grid-cols-[1fr_6rem_auto] items-center gap-2">
                <Input value={c.label} maxLength={60} onChange={(e) => setCrit((l) => l.map((x, j) => (j === i ? [x[0], { ...x[1], label: e.target.value }] : x)))} />
                <Input type="number" min={1} max={100} value={c.max} disabled={scored} onChange={(e) => setCrit((l) => l.map((x, j) => (j === i ? [x[0], { ...x[1], max: Number(e.target.value) }] : x)))} />
                <Button variant="ghost" size="sm" disabled={scored || crit.length <= 1} onClick={() => setCrit((l) => l.filter((_, j) => j !== i))}>
                  <Trash2 className="size-4" />
                </Button>
              </div>
            ))}
          </div>
          <Button
            variant="secondary"
            size="sm"
            className="mt-2"
            disabled={scored || crit.length >= 6}
            onClick={() => setCrit((l) => [...l, [`new${l.length}`, { label: "", max: 10, order: l.length + 1 }]])}
          >
            <Plus className="size-4" /> Add criterion (max 6)
          </Button>
          <p className="mt-2 text-xs text-slate-500">
            Total per judge: {crit.reduce((s, [, c]) => s + (Number(c.max) || 0), 0)} marks. A contestant&apos;s round score is calculated out of all judges ({"judges × total"}) and shown /100.
          </p>
        </div>
        {error && <Alert tone="red">{error}</Alert>}
      </div>
    </Modal>
  );
}

