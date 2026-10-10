"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { Check, Pencil, Search, Sparkles, Trash2, UserPlus, X } from "lucide-react";
import { Alert, Badge, Button, Card, CardHeader, ConfirmDialog, EmptyState, Input, Modal } from "@/components/ui";
import { StudentAvatar } from "@/components/shared";
import { useToast } from "@/components/ui/Toast";
import { FinalistToggle, GenderBadge, GenderFilter, matchesGender, useFinals, useThreeDayScores, type GenderFilterValue } from "./common";
import { autoPickFinalists, ROUND_KEYS, takesPart } from "@/lib/finals";
import { removeFinalist, renumberFinalist, replaceFinalists, setPerGender } from "@/lib/finalsActions";
import { compactId, normalizeStudentId } from "@/lib/keys";
import { fmt } from "@/lib/scoring";
import { errorMessage } from "@/lib/firebase";

export default function FinalistsTab() {
  const { finalistList, counts, perGender, finalConfig, students, finalists, finalScores, admin } = useFinals();
  const toast = useToast();
  const [filter, setFilter] = useState<GenderFilterValue>("all");
  const [pickOpen, setPickOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [perDraft, setPerDraft] = useState<string>(String(perGender));

  const shown = finalistList.filter(({ f }) => matchesGender(f.gender, filter));
  const total = finalistList.length;

  const savePer = async () => {
    const n = Number(perDraft);
    if (!Number.isInteger(n) || n < 1 || n > 50) return toast("Enter a number from 1 to 50", "error");
    try {
      await setPerGender(admin, n);
      toast(`Finalists per gender set to ${n}`, "success");
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {(["boy", "girl"] as const).map((g) => (
          <Card key={g} className="p-5">
            <p className="text-sm font-medium text-slate-500">{g === "boy" ? "Boys" : "Girls"} selected</p>
            <p className="tabular mt-1 text-3xl font-bold">
              {counts[g]}
              <span className="text-lg font-medium text-slate-400"> / {perGender}</span>
            </p>
            {counts[g] > perGender && <p className="mt-1 text-xs font-semibold text-amber-600">{counts[g] - perGender} over the target</p>}
          </Card>
        ))}
        <Card className="p-5">
          <p className="text-sm font-medium text-slate-500">Finalists per gender</p>
          <div className="mt-2 flex gap-2">
            <Input type="number" min={1} max={50} value={perDraft} onChange={(e) => setPerDraft(e.target.value)} className="w-24" />
            <Button variant="secondary" onClick={savePer} disabled={Number(perDraft) === perGender}>
              Save
            </Button>
          </div>
          <p className="mt-1 text-xs text-slate-500">Total finalists: {total}</p>
        </Card>
      </div>

      {Object.values(students).some((s) => !s.gender) && (
        <Alert tone="blue">
          {Object.values(students).filter((s) => !s.gender).length} students have no gender set yet, so they cannot be auto-picked.{" "}
          <Link href="/admin/students" className="font-semibold underline">
            Auto-detect genders on the Students page
          </Link>
        </Alert>
      )}

      <Card>
        <CardHeader
          title="Finalists"
          subtitle="Selected from the 3-day results. You can also select students from their profile (Students page) or the Leaderboard."
          actions={
            <>
              <GenderFilter value={filter} onChange={setFilter} />
              <Button variant="secondary" onClick={() => setAddOpen(true)}>
                <UserPlus className="size-4" /> Add student
              </Button>
              <Button onClick={() => setPickOpen(true)}>
                <Sparkles className="size-4" /> Auto-pick top scorers
              </Button>
            </>
          }
        />
        {shown.length === 0 ? (
          <EmptyState title="No finalists selected yet">
            Use <b>Auto-pick top scorers</b> to select the top {perGender} boys and top {perGender} girls from the 3-day results, then adjust by hand.
          </EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <tr className="border-b border-slate-100">
                  <th className="px-5 py-2.5" title="Click a number to change it">#</th>
                  <th className="px-3 py-2.5">Finalist</th>
                  <th className="px-3 py-2.5">Gender</th>
                  <th className="px-3 py-2.5 text-right">3-day score</th>
                  <th className="px-3 py-2.5">Rounds</th>
                  <th className="px-5 py-2.5 text-right">Remove</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {shown.map(({ key, f }) => (
                  <tr key={key} className="hover:bg-slate-50">
                    <td className="px-5 py-2.5">
                      <NumberCell finalistKey={key} number={f.number} />
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-3">
                        <StudentAvatar student={f} size={36} />
                        <div>
                          <p className="font-semibold text-slate-900">{f.name}</p>
                          <p className="tabular text-xs text-slate-500">
                            {f.studentId} {f.class && `· ${f.class}`}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      <GenderBadge gender={f.gender} />
                    </td>
                    <td className="tabular px-3 py-2.5 text-right">{f.score3day !== undefined ? fmt(f.score3day) : "—"}</td>
                    <td className="px-3 py-2.5">
                      <div className="flex gap-1">
                        {ROUND_KEYS.map((r) => (
                          <Badge key={r} tone={takesPart(f, r) ? "green" : "slate"}>
                            {finalConfig?.rounds[r]?.label.split(" ")[0] ?? r}
                          </Badge>
                        ))}
                      </div>
                    </td>
                    <td className="px-5 py-2.5 text-right">
                      <Button size="sm" variant="ghost" className="text-rose-600 hover:bg-rose-50" onClick={() => setRemoving(key)}>
                        <Trash2 className="size-4" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {pickOpen && <AutoPickModal onClose={() => setPickOpen(false)} />}
      {addOpen && <AddFinalistModal onClose={() => setAddOpen(false)} />}
      <ConfirmDialog
        open={!!removing}
        onClose={() => setRemoving(null)}
        title="Remove from Finals?"
        tone="danger"
        confirmLabel="Remove finalist"
        message={removing && finalists[removing] ? <>{finalists[removing].name} will be removed from the Finals, together with any judge scores they received.</> : null}
        onConfirm={async () => {
          if (!removing) return;
          await removeFinalist(admin, removing, finalists[removing], finalScores);
          toast("Removed", "success");
        }}
      />
    </div>
  );
}

function AutoPickModal({ onClose }: { onClose: () => void }) {
  const { students, finalists, finalScores, perGender, admin } = useFinals();
  const results = useThreeDayScores();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { picks, withoutGender } = useMemo(() => autoPickFinalists(results.map((r) => ({ studentKey: r.studentKey, student: students[r.studentKey] ?? r.student, final: r.final })), perGender), [results, students, perGender]);
  const flat = picks.flatMap((p) => p.picks);
  const existing = Object.keys(finalists).length;

  const apply = async () => {
    setBusy(true);
    setError(null);
    try {
      await replaceFinalists(admin, flat, finalists, finalScores);
      toast(`${flat.length} finalists selected`, "success");
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
      title={`Auto-pick: top ${perGender} boys + top ${perGender} girls`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={apply} loading={busy} disabled={!flat.length}>
            {existing ? "Replace finalist list" : "Select these finalists"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-slate-600">Ranked by the 3-day final score (all days, all evaluators). You can still add or remove anyone afterwards.</p>
        {existing > 0 && <Alert>This replaces the current list of {existing} finalist(s). Finalists who stay keep their contestant number and round progress; anyone removed loses their judge scores.</Alert>}
        {withoutGender > 0 && (
          <Alert tone="blue">
            {withoutGender} students without a gender were skipped. Set genders on the Students page (Auto-detect) first for a complete pick.
          </Alert>
        )}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {picks.map((p) => (
            <div key={p.gender}>
              <div className="mb-2 flex items-center justify-between">
                <h4 className="font-bold">{p.gender === "boy" ? "Boys" : "Girls"}</h4>
                <Badge tone={p.picks.length < p.wanted ? "amber" : "green"}>
                  {p.picks.length} / {p.wanted}
                </Badge>
              </div>
              {p.tieAtCut && <Alert className="mb-2">The last place is tied with the next student — check the cut-off and adjust by hand if needed.</Alert>}
              <ul className="divide-y divide-slate-100 rounded-xl ring-1 ring-slate-200">
                {p.picks.map((x, i) => (
                  <li key={x.key} className="flex items-center gap-3 px-3 py-2 text-sm">
                    <span className="tabular w-6 font-bold text-slate-400">{i + 1}</span>
                    <StudentAvatar student={x.student} size={28} />
                    <span className="min-w-0 flex-1 truncate">
                      <b>{x.student.name}</b> <span className="tabular text-xs text-slate-500">{x.student.studentId}</span>
                    </span>
                    <span className="tabular font-semibold">{fmt(x.score)}</span>
                  </li>
                ))}
                {p.picks.length === 0 && <li className="px-3 py-4 text-center text-sm text-slate-500">No students with this gender.</li>}
              </ul>
            </div>
          ))}
        </div>
        {error && <Alert tone="red">{error}</Alert>}
      </div>
    </Modal>
  );
}

function AddFinalistModal({ onClose }: { onClose: () => void }) {
  const { students, finalists } = useFinals();
  const results = useThreeDayScores();
  const [q, setQ] = useState("");
  const matches = useMemo(() => {
    const qn = normalizeStudentId(q);
    const cq = compactId(q);
    const ql = q.trim().toLowerCase();
    if (!qn && !ql) return [];
    return Object.entries(students)
      .filter(([k, s]) => !finalists[k] && (s.studentId === qn || (cq && compactId(s.studentId).includes(cq)) || (ql.length > 1 && s.name.toLowerCase().includes(ql))))
      .slice(0, 12);
  }, [q, students, finalists]);

  return (
    <Modal open onClose={onClose} title="Add a finalist" size="lg">
      <div className="space-y-3">
        <div className="relative">
          <Search className="absolute left-3 top-2.5 size-5 text-slate-400" />
          <Input autoFocus className="pl-10" placeholder="Search Student ID or name…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <ul className="divide-y divide-slate-100">
          {matches.map(([k, s]) => (
            <li key={k} className="flex flex-wrap items-center gap-3 py-2.5">
              <StudentAvatar student={s} size={36} />
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{s.name}</p>
                <p className="tabular text-xs text-slate-500">
                  {s.studentId} · 3-day {fmt(results.find((r) => r.studentKey === k)?.final)}
                </p>
              </div>
              <GenderBadge gender={s.gender} />
              <FinalistToggle studentKey={k} student={s} score3day={results.find((r) => r.studentKey === k)?.final} />
            </li>
          ))}
          {q && matches.length === 0 && <li className="py-6 text-center text-sm text-slate-500">No matching student (finalists already selected are hidden).</li>}
        </ul>
      </div>
    </Modal>
  );
}

/** Click the contestant number to change it (typing a number that is already taken swaps the two). */
function NumberCell({ finalistKey, number }: { finalistKey: string; number: number }) {
  const { finalists, finalScores, admin } = useFinals();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(String(number));
  const [busy, setBusy] = useState(false);

  const save = async () => {
    const n = Number(value);
    if (n === number) return setEditing(false);
    setBusy(true);
    try {
      await renumberFinalist(admin, finalistKey, n, finalists, finalScores);
      toast(`Contestant number changed to #${n}`, "success");
      setEditing(false);
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  };

  if (!editing) {
    return (
      <button
        onClick={() => {
          setValue(String(number));
          setEditing(true);
        }}
        className="group tabular flex items-center gap-1.5 rounded-lg px-2 py-1 text-base font-extrabold text-slate-500 hover:bg-slate-100"
        title="Click to change this contestant's number"
      >
        {String(number).padStart(2, "0")}
        <Pencil className="size-3.5 text-slate-300 group-hover:text-slate-500" />
      </button>
    );
  }
  return (
    <div className="flex items-center gap-1">
      <Input
        type="number"
        min={1}
        max={999}
        value={value}
        autoFocus
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") save();
          if (e.key === "Escape") setEditing(false);
        }}
        className="h-9 w-20 tabular font-bold"
      />
      <Button size="sm" variant="success" onClick={save} loading={busy} aria-label="Save number">
        <Check className="size-4" />
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={busy} aria-label="Cancel">
        <X className="size-4" />
      </Button>
    </div>
  );
}
