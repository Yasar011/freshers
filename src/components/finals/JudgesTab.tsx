"use client";
import { useMemo, useState } from "react";
import { Copy, ExternalLink, KeyRound, MessageCircle, Pencil, Plus, Power, Trash2 } from "lucide-react";
import { Alert, Badge, Button, Card, CardHeader, ConfirmDialog, EmptyState, Field, Input, Modal, ProgressBar } from "@/components/ui";
import { useToast } from "@/components/ui/Toast";
import { useFinals } from "./common";
import { createJudge, judgeLink, regenerateJudgeLink, removeJudge, renameJudge, setJudgeActive } from "@/lib/finalsActions";
import { cidOf, takesPart, type JudgePanelMember } from "@/lib/finals";
import { errorMessage } from "@/lib/firebase";

export default function JudgesTab() {
  const { judgePanel, allJudges, finalConfig, finalists, finalScores, admin } = useFinals();
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const [renaming, setRenaming] = useState<JudgePanelMember | null>(null);
  const [removing, setRemoving] = useState<JudgePanelMember | null>(null);
  const [regen, setRegen] = useState<JudgePanelMember | null>(null);

  const round = finalConfig?.activeRound;
  const participants = useMemo(
    () => (round ? Object.values(finalists).filter((f) => takesPart(f, round)).map((f) => cidOf(f)) : []),
    [round, finalists],
  );

  const copy = async (m: JudgePanelMember) => {
    const link = judgeLink(m.judge.token);
    try {
      await navigator.clipboard.writeText(link);
      toast(`Link copied for ${m.judge.name}`, "success");
    } catch {
      window.prompt("Copy this link:", link);
    }
  };
  const whatsapp = (m: JudgePanelMember) => {
    const text = `Hello ${m.judge.name}, here is your personal judging link for the Freshers 2026 Finals (please don't share it): ${judgeLink(m.judge.token)}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank", "noopener");
  };

  return (
    <div className="space-y-4">
      <Alert tone="blue">
        Create one link per judge — <b>3 to 6 judges</b> (you can add or remove them until the finals start). The judge opens the link on their phone — <b>no Google login needed</b> — and sees only each contestant&apos;s <b>number and name</b>, never IDs, departments or photos. Each link is personal: scores are saved under that judge&apos;s name. Scores are calculated out of the judges whose link is <b>active</b>, so if a judge doesn&apos;t turn up, just disable their link.
      </Alert>
      <Card>
        <CardHeader
          title="Judges"
          subtitle={`${allJudges.length} judge link${allJudges.length === 1 ? "" : "s"} · ${judgePanel.length} active (counted in the scores)${judgePanel.length < 3 && allJudges.length > 0 ? " — fewer than the usual 3" : ""}${judgePanel.length > 6 ? " — more than the usual 6" : ""}`}
          actions={
            <Button onClick={() => setAdding(true)}>
              <Plus className="size-4" /> Create judge link
            </Button>
          }
        />
        {allJudges.length === 0 ? (
          <EmptyState title="No judges yet">Click “Create judge link”, enter the judge&apos;s name, then copy or WhatsApp the link to them.</EmptyState>
        ) : (
          <ul className="divide-y divide-slate-100">
            {allJudges.map((m) => {
              const done = round ? participants.filter((k) => finalScores[round]?.[m.id]?.[k]).length : 0;
              const pct = participants.length ? (done * 100) / participants.length : 0;
              return (
                <li key={m.id} className="space-y-3 px-5 py-4">
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-2 text-base font-semibold text-slate-900">
                        {m.judge.name} {m.judge.active ? <Badge tone="green">Link active</Badge> : <Badge tone="red">Link disabled</Badge>}
                      </p>
                      <p className="mt-0.5 truncate font-mono text-xs text-slate-400">…/judge/{m.judge.token.slice(0, 6)}••••••••••••</p>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      <Button size="sm" onClick={() => copy(m)}>
                        <Copy className="size-4" /> Copy link
                      </Button>
                      <Button size="sm" variant="secondary" onClick={() => whatsapp(m)}>
                        <MessageCircle className="size-4" /> WhatsApp
                      </Button>
                      <Button size="sm" variant="secondary" onClick={() => window.open(judgeLink(m.judge.token), "_blank", "noopener")}>
                        <ExternalLink className="size-4" /> Open
                      </Button>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="flex min-w-48 flex-1 items-center gap-2">
                      <ProgressBar value={pct} />
                      <span className="tabular whitespace-nowrap text-xs text-slate-500">
                        {done}/{participants.length} scored{round && finalConfig ? ` · ${finalConfig.rounds[round].label}` : ""}
                      </span>
                    </div>
                    <div className="flex gap-1">
                      <Button size="sm" variant="ghost" title={m.judge.active ? "Disable link" : "Enable link"} onClick={async () => { try { await setJudgeActive(admin, m.id, m.judge, !m.judge.active); toast(m.judge.active ? "Link disabled" : "Link enabled", "success"); } catch (e) { toast(errorMessage(e), "error"); } }}>
                        <Power className={`size-4 ${m.judge.active ? "text-emerald-600" : "text-rose-600"}`} />
                      </Button>
                      <Button size="sm" variant="ghost" title="Rename" onClick={() => setRenaming(m)}>
                        <Pencil className="size-4" />
                      </Button>
                      <Button size="sm" variant="ghost" title="Generate a new link (old one stops working)" onClick={() => setRegen(m)}>
                        <KeyRound className="size-4" />
                      </Button>
                      <Button size="sm" variant="ghost" className="text-rose-600 hover:bg-rose-50" title="Remove" onClick={() => setRemoving(m)}>
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {adding && <JudgeNameModal title="Create judge link" onClose={() => setAdding(false)} onSave={async (name) => { await createJudge(admin, name); toast(`Link created for ${name}`, "success"); }} />}
      {renaming && <JudgeNameModal title="Rename judge" initial={renaming.judge.name} onClose={() => setRenaming(null)} onSave={async (name) => { await renameJudge(admin, renaming.id, renaming.judge, name); toast("Renamed", "success"); }} />}
      <ConfirmDialog
        open={!!regen}
        onClose={() => setRegen(null)}
        title="Generate a new link?"
        tone="warning"
        confirmLabel="New link"
        message={regen && <>The old link for <b>{regen.judge.name}</b> stops working immediately (the judge is signed out). Send them the new link.</>}
        onConfirm={async () => {
          if (!regen) return;
          await regenerateJudgeLink(admin, regen.id, regen.judge);
          toast("New link generated", "success");
        }}
      />
      <ConfirmDialog
        open={!!removing}
        onClose={() => setRemoving(null)}
        title="Remove this judge?"
        tone="danger"
        confirmLabel="Remove judge"
        message={removing && <>The link for <b>{removing.judge.name}</b> stops working. Scores they already gave are kept in the database but no longer counted in the results.</>}
        onConfirm={async () => {
          if (!removing) return;
          await removeJudge(admin, removing.id, removing.judge);
          toast("Judge removed", "success");
        }}
      />
    </div>
  );
}

function JudgeNameModal({ title, initial = "", onClose, onSave }: { title: string; initial?: string; onClose: () => void; onSave: (name: string) => Promise<void> }) {
  const [name, setName] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const go = async () => {
    if (!name.trim()) return setError("Enter the judge's name.");
    setBusy(true);
    setError(null);
    try {
      await onSave(name.trim());
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
      title={title}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={go} loading={busy}>
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Judge name" hint="Shown to the judge and in the score sheets.">
          {(id) => <Input id={id} value={name} maxLength={80} autoFocus onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && go()} placeholder="e.g. Prof. Sharma" />}
        </Field>
        {error && <Alert tone="red">{error}</Alert>}
      </div>
    </Modal>
  );
}
