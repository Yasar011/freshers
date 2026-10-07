"use client";
import { useMemo, useRef, useState } from "react";
import { Plus, Upload, Search, Pencil, Trash2, Eye, FileDown, ImagePlus, X, Wand2 } from "lucide-react";
import { useAdminData } from "@/context/AdminDataContext";
import { Alert, Badge, Button, Card, ConfirmDialog, EmptyState, Field, Input, Modal, Select } from "@/components/ui";
import { PageHeader, StudentDayStatus } from "@/components/admin";
import { FinalistToggle, GenderFilter, GenderSwitch, matchesGender, type GenderFilterValue } from "@/components/finals/common";
import { guessGender } from "@/lib/gender";
import { applyDetectedGenders } from "@/lib/finalsActions";
import { StudentAvatar } from "@/components/shared";
import { useToast } from "@/components/ui/Toast";
import { deleteStudent, importStudents, saveStudent, uploadStudentPhoto } from "@/lib/actions";
import { normalizeStudentId, studentKey } from "@/lib/keys";
import { parseStudentFiles } from "@/lib/readFiles";
import { studentChanged, type ParseResult } from "@/lib/studentImport";
import { downloadCsv } from "@/lib/export";
import { errorMessage } from "@/lib/firebase";
import { computeFinalResults, fmt } from "@/lib/scoring";
import type { Student } from "@/lib/types";

const PAGE = 50;

export default function StudentsPage() {
  const { students, evaluations } = useAdminData();
  const [q, setQ] = useState("");
  const [klass, setKlass] = useState("");
  const [page, setPage] = useState(0);
  const [editing, setEditing] = useState<{ key: string | null; student: Student } | null>(null);
  const [viewing, setViewing] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [genderFilter, setGenderFilter] = useState<GenderFilterValue>("all");
  const [reviewOpen, setReviewOpen] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const { admin } = useAdminData();
  const toast = useToast();

  const unknownCount = useMemo(() => Object.values(students).filter((s) => !s.gender).length, [students]);
  const reviewCount = useMemo(() => Object.values(students).filter((s) => s.gender && s.genderConfirmed === false).length, [students]);
  const boysCount = useMemo(() => Object.values(students).filter((s) => s.gender === "boy").length, [students]);
  const girlsCount = useMemo(() => Object.values(students).filter((s) => s.gender === "girl").length, [students]);

  const detect = async () => {
    setDetecting(true);
    try {
      const entries = Object.entries(students)
        .filter(([, s]) => !s.gender)
        .map(([key, s]) => ({ key, guess: guessGender(s.name) }))
        .filter((x): x is { key: string; guess: NonNullable<ReturnType<typeof guessGender>> } => !!x.guess)
        .map((x) => ({ key: x.key, gender: x.guess.gender, confident: x.guess.confidence === "high" }));
      if (!entries.length) {
        toast("Nothing to detect — every student already has a gender.", "info");
        return;
      }
      await applyDetectedGenders(admin, entries);
      const unsure = entries.filter((e) => !e.confident).length;
      toast(`Detected ${entries.length} genders from names${unsure ? ` — ${unsure} need your review` : ""}`, unsure ? "warning" : "success");
      if (unsure) setReviewOpen(true);
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setDetecting(false);
    }
  };

  const classes = useMemo(() => [...new Set(Object.values(students).map((s) => s.class).filter(Boolean))].sort() as string[], [students]);
  const list = useMemo(() => {
    const ql = q.trim().toLowerCase();
    const qn = normalizeStudentId(q);
    return Object.entries(students)
      .filter(([, s]) => (!klass || s.class === klass) && matchesGender(s.gender, genderFilter) && (!ql || s.studentId.includes(qn) || s.name.toLowerCase().includes(ql)))
      .sort((a, b) => a[1].studentId.localeCompare(b[1].studentId, undefined, { numeric: true }));
  }, [students, q, klass, genderFilter]);
  const pageCount = Math.max(1, Math.ceil(list.length / PAGE));
  const shown = list.slice(page * PAGE, page * PAGE + PAGE);

  const evalCount = (key: string) =>
    Object.values(evaluations).reduce((n, byEval) => n + Object.values(byEval ?? {}).filter((m) => m?.[key]).length, 0);

  return (
    <div>
      <PageHeader
        title="Students"
        subtitle={`${Object.keys(students).length} registered · ${boysCount} boys · ${girlsCount} girls${unknownCount ? ` · ${unknownCount} without gender` : ""}`}
        actions={
          <>
            {reviewCount > 0 && (
              <Button variant="secondary" onClick={() => setReviewOpen(true)}>
                Review genders ({reviewCount})
              </Button>
            )}
            <Button variant="secondary" onClick={detect} loading={detecting} disabled={unknownCount === 0}>
              <Wand2 className="size-4" /> Auto-detect genders{unknownCount ? ` (${unknownCount})` : ""}
            </Button>
            <Button variant="secondary" onClick={() => setImportOpen(true)}>
              <Upload className="size-4" /> Import CSV / Excel
            </Button>
            <Button onClick={() => setEditing({ key: null, student: { studentId: "", name: "", year: "1", semester: "1" } })}>
              <Plus className="size-4" /> Add student
            </Button>
          </>
        }
      />

      <Card>
        <div className="flex flex-wrap gap-3 border-b border-slate-100 p-4">
          <div className="relative min-w-60 flex-1">
            <Search className="absolute left-3 top-2.5 size-5 text-slate-400" />
            <Input className="pl-10" placeholder="Search by ID or name…" value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} />
          </div>
          <GenderFilter value={genderFilter} onChange={(v) => { setGenderFilter(v); setPage(0); }} showUnknown={unknownCount > 0} />
          <Select className="w-auto" value={klass} onChange={(e) => { setKlass(e.target.value); setPage(0); }}>
            <option value="">All classes</option>
            {classes.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </Select>
        </div>
        {list.length === 0 ? (
          <EmptyState title={Object.keys(students).length ? "No matching students" : "No students yet"}>
            {!Object.keys(students).length && "Import the NIFT batch Excel sheets or a CSV file to register students in bulk."}
          </EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <tr className="border-b border-slate-100">
                  <th className="px-4 py-2.5">Student</th>
                  <th className="px-3 py-2.5">Gender</th>
                  <th className="px-3 py-2.5">Programme</th>
                  <th className="px-3 py-2.5">Year</th>
                  <th className="px-3 py-2.5">Sem</th>
                  <th className="px-3 py-2.5">Class</th>
                  <th className="px-4 py-2.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {shown.map(([key, s]) => (
                  <tr key={key} className="hover:bg-slate-50">
                    <td className="px-4 py-2">
                      <button className="flex items-center gap-3 text-left" onClick={() => setViewing(key)}>
                        <StudentAvatar student={s} size={36} />
                        <div>
                          <p className="tabular font-semibold text-slate-900">{s.studentId}</p>
                          <p className="text-slate-600">{s.name}</p>
                        </div>
                      </button>
                    </td>
                    <td className="px-3 py-2">
                      <GenderSwitch studentKey={key} student={s} />
                    </td>
                    <td className="px-3 py-2">{s.programme}</td>
                    <td className="px-3 py-2">{s.year}</td>
                    <td className="px-3 py-2">{s.semester}</td>
                    <td className="px-3 py-2">{s.class && <Badge>{s.class}</Badge>}</td>
                    <td className="px-4 py-2">
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="ghost" onClick={() => setViewing(key)} title="View">
                          <Eye className="size-4" />
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setEditing({ key, student: s })} title="Edit">
                          <Pencil className="size-4" />
                        </Button>
                        <Button size="sm" variant="ghost" className="text-rose-600 hover:bg-rose-50" onClick={() => setDeleting(key)} title="Delete">
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {pageCount > 1 && (
          <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3 text-sm text-slate-600">
            <span>
              {page * PAGE + 1}–{Math.min(list.length, (page + 1) * PAGE)} of {list.length}
            </span>
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" disabled={page === 0} onClick={() => setPage(page - 1)}>
                Previous
              </Button>
              <Button size="sm" variant="secondary" disabled={page >= pageCount - 1} onClick={() => setPage(page + 1)}>
                Next
              </Button>
            </div>
          </div>
        )}
      </Card>

      {editing && <StudentForm initial={editing.student} existingKey={editing.key} onClose={() => setEditing(null)} />}
      {viewing && students[viewing] && <StudentView studentKey={viewing} onClose={() => setViewing(null)} onEdit={() => { setEditing({ key: viewing, student: students[viewing] }); setViewing(null); }} />}
      {importOpen && <ImportModal onClose={() => setImportOpen(false)} />}
      {reviewOpen && <GenderReviewModal onClose={() => setReviewOpen(false)} />}
      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        title="Delete student?"
        tone="danger"
        confirmLabel="Delete student"
        message={
          deleting && students[deleting] ? (
            <>
              <b>{students[deleting].studentId}</b> — {students[deleting].name} will be removed.
              {evalCount(deleting) > 0 && (
                <Alert tone="red" className="mt-3">
                  This student has {evalCount(deleting)} submitted evaluation(s). They will be deleted too.
                </Alert>
              )}
            </>
          ) : null
        }
        onConfirm={async () => {
          if (!deleting) return;
          await deleteStudent(admin, deleting, students[deleting], evaluations);
          toast("Student deleted", "success");
        }}
      />
    </div>
  );
}

function StudentForm({ initial, existingKey, onClose }: { initial: Student; existingKey: string | null; onClose: () => void }) {
  const { admin, students } = useAdminData();
  const toast = useToast();
  const [s, setS] = useState<Student>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const set = (k: keyof Student, v: string) => setS((p) => ({ ...p, [k]: v }));

  const idTaken = !existingKey && s.studentId.trim() && !!students[studentKey(s.studentId)];

  const onPhoto = async (file: File | undefined) => {
    if (!file) return;
    if (!s.studentId.trim()) return setError("Enter the Student ID before uploading a photo.");
    setUploading(true);
    setError(null);
    try {
      const { url, path } = await uploadStudentPhoto(normalizeStudentId(s.studentId), file);
      setS((p) => ({ ...p, photo: url, photoPath: path }));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setUploading(false);
    }
  };

  const save = async () => {
    const studentId = normalizeStudentId(s.studentId);
    if (!studentId) return setError("Student ID is required.");
    if (!s.name.trim()) return setError("Name is required.");
    if (s.photo && !/^https?:\/\//i.test(s.photo)) return setError("Photo must be an http(s) URL.");
    setBusy(true);
    setError(null);
    try {
      const clean: Student = { studentId, name: s.name.trim() };
      if (s.gender) {
        clean.gender = s.gender;
        clean.genderConfirmed = true;
      }
      for (const f of ["programme", "year", "semester", "class", "photo", "photoPath"] as const) if (s[f]?.trim()) clean[f] = s[f]!.trim();
      if (!clean.photo) delete clean.photoPath;
      await saveStudent(admin, clean, existingKey, existingKey ? students[existingKey] : undefined);
      toast(existingKey ? "Student updated" : "Student added", "success");
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
      title={existingKey ? `Edit ${initial.studentId}` : "Add student"}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={save} loading={busy} disabled={uploading || !!idTaken}>
            {existingKey ? "Save changes" : "Add student"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="flex items-center gap-4">
          <StudentAvatar student={{ name: s.name || "?", studentId: s.studentId || "?", photo: s.photo }} size={80} className="rounded-2xl" />
          <div className="space-y-2">
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" onClick={() => fileRef.current?.click()} loading={uploading}>
                <ImagePlus className="size-4" /> Upload photo
              </Button>
              {s.photo && (
                <Button size="sm" variant="ghost" onClick={() => setS((p) => ({ ...p, photo: "", photoPath: "" }))}>
                  <X className="size-4" /> Remove
                </Button>
              )}
            </div>
            <p className="text-xs text-slate-500">Resized automatically. Requires Firebase Storage — or paste an image URL below.</p>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => onPhoto(e.target.files?.[0])} />
          </div>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Student ID *" error={idTaken ? "A student with this ID already exists." : null} hint={existingKey ? "The ID cannot be changed." : "e.g. BFT/26/001"}>
            {(id) => <Input id={id} value={s.studentId} onChange={(e) => set("studentId", e.target.value.toUpperCase())} disabled={!!existingKey} autoFocus={!existingKey} />}
          </Field>
          <Field label="Name *">{(id) => <Input id={id} value={s.name} onChange={(e) => set("name", e.target.value)} />}</Field>
          <Field label="Gender">
            {(id) => (
              <Select id={id} value={s.gender ?? ""} onChange={(e) => setS((p) => ({ ...p, gender: (e.target.value || undefined) as Student["gender"] }))}>
                <option value="">Not set</option>
                <option value="boy">Boy</option>
                <option value="girl">Girl</option>
              </Select>
            )}
          </Field>
          <Field label="Programme">{(id) => <Input id={id} value={s.programme ?? ""} onChange={(e) => set("programme", e.target.value)} placeholder="BFT / BD" />}</Field>
          <Field label="Class / Section">{(id) => <Input id={id} value={s.class ?? ""} onChange={(e) => set("class", e.target.value)} placeholder="BD Batch-1" />}</Field>
          <Field label="Year">{(id) => <Input id={id} value={s.year ?? ""} onChange={(e) => set("year", e.target.value)} />}</Field>
          <Field label="Semester">{(id) => <Input id={id} value={s.semester ?? ""} onChange={(e) => set("semester", e.target.value)} />}</Field>
        </div>
        <Field label="Photo URL">{(id) => <Input id={id} value={s.photo ?? ""} onChange={(e) => setS((p) => ({ ...p, photo: e.target.value, photoPath: "" }))} placeholder="https://…" />}</Field>
        {error && <Alert tone="red">{error}</Alert>}
      </div>
    </Modal>
  );
}

function StudentView({ studentKey: key, onClose, onEdit }: { studentKey: string; onClose: () => void; onEdit: () => void }) {
  const { students, days, evaluators, evaluations, settings, totalDays } = useAdminData();
  const s = students[key];
  const result = useMemo(
    () => computeFinalResults({ [key]: s }, evaluators, evaluations, settings, totalDays)[0],
    [key, s, evaluators, evaluations, settings, totalDays],
  );
  return (
    <Modal open onClose={onClose} title="Student" size="xl" footer={<Button variant="secondary" onClick={onEdit}><Pencil className="size-4" /> Edit</Button>}>
      <div className="space-y-6">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3 rounded-2xl bg-slate-50 p-4">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Gender</span>
            <GenderSwitch studentKey={key} student={s} size="md" />
          </div>
          <FinalistToggle studentKey={key} student={s} score3day={result.final} />
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <StudentAvatar student={s} size={96} className="rounded-2xl" />
          <div className="flex-1 text-sm">
            <p className="text-xl font-bold">{s.name}</p>
            <p className="tabular font-semibold text-slate-700">{s.studentId}</p>
            <p className="text-slate-500">{[s.programme, s.year && `Year ${s.year}`, s.semester && `Semester ${s.semester}`, s.class].filter(Boolean).join(" · ")}</p>
          </div>
          <div className="rounded-2xl bg-brand-50 px-5 py-3 text-right">
            <p className="text-xs font-bold uppercase tracking-wider text-brand-700">Final</p>
            <p className="tabular text-2xl font-extrabold text-brand-900">{fmt(result.final)} / {result.finalMax}</p>
            {result.percentage !== null && <p className="tabular text-sm text-brand-700">{fmt(result.percentage)}%</p>}
          </div>
        </div>
        {days.map((d) => (
          <StudentDayStatus key={d} studentKey={key} day={d} />
        ))}
      </div>
    </Modal>
  );
}

function ImportModal({ onClose }: { onClose: () => void }) {
  const { students, admin } = useAdminData();
  const toast = useToast();
  const [files, setFiles] = useState<File[]>([]);
  const [parsed, setParsed] = useState<ParseResult | null>(null);
  const [parsing, setParsing] = useState(false);
  const [overwrite, setOverwrite] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onFiles = async (list: FileList | null) => {
    const fs = Array.from(list ?? []);
    setFiles(fs);
    setParsed(null);
    setError(null);
    if (!fs.length) return;
    setParsing(true);
    try {
      setParsed(await parseStudentFiles(fs));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setParsing(false);
    }
  };

  const stats = useMemo(() => {
    if (!parsed) return null;
    let fresh = 0,
      changed = 0,
      same = 0;
    for (const s of parsed.students) {
      const prev = students[s.key];
      if (!prev) fresh++;
      else if (studentChanged(prev, s)) changed++;
      else same++;
    }
    return { fresh, changed, same };
  }, [parsed, students]);

  const run = async () => {
    if (!parsed) return;
    setBusy(true);
    setError(null);
    try {
      const r = await importStudents(admin, parsed.students, students, overwrite, files.map((f) => f.name));
      toast(`Import complete: ${r.added} added, ${r.updated} updated, ${r.skipped} skipped`, "success");
      onClose();
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  const sample = () =>
    downloadCsv("students-template.csv", [
      ["studentId", "name", "programme", "year", "semester", "class", "photo"],
      ["BFT/26/001", "Rahul", "BFT", "1", "1", "BFT-A", ""],
    ]);

  return (
    <Modal
      open
      onClose={() => !busy && onClose()}
      size="xl"
      title="Import students"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={run} loading={busy} disabled={!parsed?.students.length || (!stats?.fresh && !(overwrite && stats?.changed))}>
            Import {parsed ? (overwrite ? (stats?.fresh ?? 0) + (stats?.changed ?? 0) : stats?.fresh ?? 0) : ""} students
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-slate-600">
          Upload one or more <b>.xlsx</b> or <b>.csv</b> files. The NIFT batch attendance sheets (with <i>UNIQUE ID</i> and <i>STUDENT NAME</i> columns) are recognised automatically — programme comes from the ID prefix, class from the batch title, and duplicate sheets are merged. Plain CSVs need the columns{" "}
          <code className="rounded bg-slate-100 px-1">studentId, name, programme, year, semester, class, photo</code>.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-lg bg-brand-600 px-4 text-sm font-semibold text-white hover:bg-brand-700">
            <Upload className="size-4" /> Choose files
            <input type="file" multiple accept=".csv,.xlsx,.xls,.xlsm,.ods,.txt" className="hidden" onChange={(e) => onFiles(e.target.files)} />
          </label>
          <Button variant="ghost" size="sm" onClick={sample}>
            <FileDown className="size-4" /> CSV template
          </Button>
          {files.length > 0 && <span className="text-sm text-slate-500">{files.map((f) => f.name).join(", ")}</span>}
        </div>
        {parsing && <p className="text-sm text-slate-500">Reading files…</p>}
        {parsed && stats && (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-xl bg-slate-50 p-3 text-center">
                <p className="tabular text-2xl font-bold">{parsed.students.length}</p>
                <p className="text-xs text-slate-500">Found</p>
              </div>
              <div className="rounded-xl bg-emerald-50 p-3 text-center">
                <p className="tabular text-2xl font-bold text-emerald-700">{stats.fresh}</p>
                <p className="text-xs text-emerald-700">New</p>
              </div>
              <div className="rounded-xl bg-amber-50 p-3 text-center">
                <p className="tabular text-2xl font-bold text-amber-700">{stats.changed}</p>
                <p className="text-xs text-amber-700">Existing, changed</p>
              </div>
              <div className="rounded-xl bg-slate-50 p-3 text-center">
                <p className="tabular text-2xl font-bold text-slate-600">{stats.same}</p>
                <p className="text-xs text-slate-500">Already up to date</p>
              </div>
            </div>
            {stats.changed > 0 && (
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} className="size-4 rounded" />
                Update the {stats.changed} existing student(s) with the details from the file
              </label>
            )}
            {parsed.warnings.length > 0 && (
              <Alert title={`${parsed.warnings.length} warning(s)`}>
                <ul className="list-disc space-y-0.5 pl-5">
                  {parsed.warnings.slice(0, 20).map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </Alert>
            )}
            <div className="max-h-80 overflow-auto rounded-xl ring-1 ring-slate-200">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-slate-50 text-left text-xs font-semibold uppercase text-slate-500">
                  <tr>
                    <th className="px-3 py-2">Student ID</th>
                    <th className="px-3 py-2">Name</th>
                    <th className="px-3 py-2">Programme</th>
                    <th className="px-3 py-2">Year</th>
                    <th className="px-3 py-2">Sem</th>
                    <th className="px-3 py-2">Class</th>
                    <th className="px-3 py-2">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {parsed.students.map((s) => {
                    const prev = students[s.key];
                    return (
                      <tr key={s.key}>
                        <td className="tabular px-3 py-1.5 font-medium">{s.studentId}</td>
                        <td className="px-3 py-1.5">{s.name}</td>
                        <td className="px-3 py-1.5">{s.programme}</td>
                        <td className="px-3 py-1.5">{s.year}</td>
                        <td className="px-3 py-1.5">{s.semester}</td>
                        <td className="px-3 py-1.5">{s.class}</td>
                        <td className="px-3 py-1.5">{!prev ? <Badge tone="green">new</Badge> : studentChanged(prev, s) ? <Badge tone="amber">changed</Badge> : <Badge>exists</Badge>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
        {error && <Alert tone="red">{error}</Alert>}
      </div>
    </Modal>
  );
}

function GenderReviewModal({ onClose }: { onClose: () => void }) {
  const { students } = useAdminData();
  const list = useMemo(
    () => Object.entries(students).filter(([, s]) => s.gender && s.genderConfirmed === false).sort((a, b) => a[1].name.localeCompare(b[1].name)),
    [students],
  );
  return (
    <Modal open onClose={onClose} title="Review guessed genders" size="lg" footer={<Button onClick={onClose}>Done</Button>}>
      <div className="space-y-3">
        <p className="text-sm text-slate-600">These names could not be matched confidently. Tap Boy or Girl to confirm — each one disappears from this list once you do.</p>
        {list.length === 0 ? (
          <Alert tone="green">All genders confirmed.</Alert>
        ) : (
          <ul className="divide-y divide-slate-100 rounded-xl ring-1 ring-slate-200">
            {list.map(([k, s]) => (
              <li key={k} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                <StudentAvatar student={s} size={32} />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">{s.name}</p>
                  <p className="tabular text-xs text-slate-500">
                    {s.studentId} · guessed: {s.gender === "boy" ? "Boy" : "Girl"}
                  </p>
                </div>
                <GenderSwitch studentKey={k} student={s} size="md" />
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}
