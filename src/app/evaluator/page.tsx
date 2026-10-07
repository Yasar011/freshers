"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { onValue, ref } from "firebase/database";
import { Search, LogOut, CheckCircle2, Clock, XCircle, Lock, ChevronRight, ListChecks, ListTodo, CloudUpload, X } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useConnection } from "@/hooks/useConnection";
import { db, errorMessage } from "@/lib/firebase";
import { submitEvaluation } from "@/lib/actions";
import { compactId, dayLabel, evaluatorDisplayName, normalizeStudentId } from "@/lib/keys";
import { perEvaluatorMax, sumScores } from "@/lib/scoring";
import { CRITERIA_KEYS, type CriterionKey, type EventInfo, type Evaluation, type Settings, type Student } from "@/lib/types";
import { Alert, Button, FullPageSpinner, ProgressBar, cn } from "@/components/ui";
import { ConnectionBadge, OfflineBanner, ScoreSelector, StudentAvatar, formatTime } from "@/components/shared";

type ScoreState = Record<CriterionKey, number | null>;
const emptyScores = (): ScoreState => ({ makeup: null, presentation: null, styling: null, dressup: null });

interface Submission {
  studentKey: string;
  studentId: string;
  name: string;
  total: number;
  status: "pending" | "saved" | "failed";
  error?: string;
  at: number;
}

interface IndexedStudent {
  key: string;
  student: Student;
  id: string;
  compact: string;
  lastSegment: string;
  nameLower: string;
}

function rankMatches(index: IndexedStudent[], query: string): IndexedStudent[] {
  const q = normalizeStudentId(query);
  if (!q) return [];
  const cq = compactId(q);
  const ql = query.trim().toLowerCase();
  const exact: IndexedStudent[] = [];
  const lastSeg: IndexedStudent[] = [];
  const suffix: IndexedStudent[] = [];
  const contains: IndexedStudent[] = [];
  const byName: IndexedStudent[] = [];
  for (const s of index) {
    if (s.id === q || (cq && s.compact === cq)) exact.push(s);
    else if (s.lastSegment === q || (cq && compactId(s.lastSegment) === cq)) lastSeg.push(s);
    else if (cq && s.compact.endsWith(cq)) suffix.push(s);
    else if (cq && s.compact.includes(cq)) contains.push(s);
    else if (ql.length >= 2 && /[a-z]/.test(ql) && s.nameLower.includes(ql)) byName.push(s);
  }
  return [...exact, ...lastSeg, ...suffix, ...contains, ...byName].slice(0, 8);
}

export default function EvaluatorPage() {
  const { state, signOut } = useAuth();
  const router = useRouter();
  const connection = useConnection();

  useEffect(() => {
    if (state.status === "signedOut" || state.status === "denied" || state.status === "inactive" || state.status === "error") router.replace("/");
    if (state.status === "admin") router.replace("/admin");
  }, [state.status, router]);

  const evaluatorKey = state.status === "evaluator" ? state.evaluatorKey : null;

  const [event, setEvent] = useState<EventInfo | null | undefined>(undefined);
  const [settings, setSettings] = useState<Settings | null | undefined>(undefined);
  const [students, setStudents] = useState<Record<string, Student> | undefined>(undefined);
  const [myEvals, setMyEvals] = useState<Record<string, Evaluation>>({});
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!evaluatorKey) return;
    const onErr = (e: Error) => setLoadError(errorMessage(e));
    const u1 = onValue(ref(db(), "event"), (s) => setEvent(s.val()), onErr);
    const u2 = onValue(ref(db(), "settings"), (s) => setSettings(s.val()), onErr);
    const u3 = onValue(ref(db(), "students"), (s) => setStudents(s.val() ?? {}), onErr);
    return () => {
      u1();
      u2();
      u3();
    };
  }, [evaluatorKey]);

  const day = event?.activeDay ?? null;
  const dayInfo = day ? event?.days?.[day] : undefined;
  const dayOpen = dayInfo?.status === "open";

  useEffect(() => {
    if (!evaluatorKey || !day) return;
    setMyEvals({});
    return onValue(
      ref(db(), `evaluations/${day}/${evaluatorKey}`),
      (s) => setMyEvals(s.val() ?? {}),
      (e) => setLoadError(errorMessage(e)),
    );
  }, [evaluatorKey, day]);

  const index = useMemo<IndexedStudent[]>(
    () =>
      Object.entries(students ?? {}).map(([key, student]) => {
        const id = normalizeStudentId(student.studentId);
        return { key, student, id, compact: compactId(id), lastSegment: id.split("/").pop() ?? id, nameLower: student.name.toLowerCase() };
      }),
    [students],
  );

  const [query, setQuery] = useState("");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [scores, setScores] = useState<ScoreState>(emptyScores);
  const [submissions, setSubmissions] = useState<Record<string, Submission>>({});
  const [lastSubmitted, setLastSubmitted] = useState<string | null>(null);
  const [listTab, setListTab] = useState<"none" | "done" | "remaining">("none");
  const [notFound, setNotFound] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const matches = useMemo(() => (selectedKey ? [] : rankMatches(index, query)), [index, query, selectedKey]);
  const selected = selectedKey ? students?.[selectedKey] : undefined;
  const existing = selectedKey ? myEvals[selectedKey] : undefined;

  const pendingCount = Object.values(submissions).filter((s) => s.status === "pending").length;
  const failed = Object.values(submissions).filter((s) => s.status === "failed");

  // Warn before closing the page while evaluations are still waiting to sync.
  useEffect(() => {
    if (!pendingCount) return;
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [pendingCount]);

  const focusSearch = useCallback(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const openStudent = useCallback((key: string) => {
    setSelectedKey(key);
    setScores(emptyScores());
    setNotFound(false);
    setListTab("none");
    inputRef.current?.blur();
    window.scrollTo({ top: 0 });
  }, []);

  const resetToSearch = useCallback(() => {
    setSelectedKey(null);
    setScores(emptyScores());
    setQuery("");
    setNotFound(false);
    focusSearch();
  }, [focusSearch]);

  const onSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const q = normalizeStudentId(query);
    if (!q) return;
    const cq = compactId(q);
    const exact = index.filter((s) => s.id === q || s.compact === cq);
    const bySegment = index.filter((s) => s.lastSegment === q);
    const pick = exact.length === 1 ? exact[0] : bySegment.length === 1 ? bySegment[0] : matches.length === 1 ? matches[0] : null;
    if (pick) openStudent(pick.key);
    else setNotFound(matches.length === 0);
  };

  const total = sumScores(scores as Record<string, number | null>);
  const maxTotal = perEvaluatorMax(settings);
  const allChosen = CRITERIA_KEYS.every((k) => scores[k] !== null);

  const onSubmit = () => {
    if (state.status !== "evaluator" || !day || !selectedKey || !selected || !allChosen || existing) return;
    const sk = selectedKey;
    const final = Object.fromEntries(CRITERIA_KEYS.map((k) => [k, scores[k] as number])) as Record<CriterionKey, number>;
    const sub: Submission = { studentKey: sk, studentId: selected.studentId, name: selected.name, total: sumScores(final), status: "pending", at: Date.now() };
    setSubmissions((m) => ({ ...m, [sk]: sub }));
    setLastSubmitted(sk);
    submitEvaluation(day, state.evaluatorKey, sk, selected, state.evaluator, state.user.uid, final)
      .then(() => setSubmissions((m) => ({ ...m, [sk]: { ...m[sk], status: "saved" } })))
      .catch((err) => {
        const msg = /permission/i.test(errorMessage(err))
          ? "Rejected by the server — the day may have been locked, or this student was already evaluated from another device."
          : errorMessage(err);
        setSubmissions((m) => ({ ...m, [sk]: { ...m[sk], status: "failed", error: msg } }));
      });
    // Return to search straight away (focus inside the tap so mobile keyboards open).
    setSelectedKey(null);
    setScores(emptyScores());
    setQuery("");
    focusSearch();
    window.scrollTo({ top: 0 });
  };

  // ─────────────── Render guards ───────────────
  if (state.status !== "evaluator") return <FullPageSpinner />;
  if (loadError) {
    return (
      <div className="mx-auto max-w-md p-4 pt-10">
        <Alert tone="red" title="Could not load evaluation data">
          {loadError}
        </Alert>
        <Button className="mt-4 w-full" onClick={() => window.location.reload()}>
          Reload
        </Button>
      </div>
    );
  }
  if (event === undefined || settings === undefined || students === undefined) {
    return <FullPageSpinner label={connection === "offline" ? "Waiting for connection…" : "Loading students…"} />;
  }

  const name = evaluatorDisplayName(state.evaluator);
  const totalStudents = index.length;
  const doneCount = Object.keys(myEvals).filter((k) => students[k]).length;
  const lastSub = lastSubmitted ? submissions[lastSubmitted] : null;

  return (
    <div className="mx-auto flex min-h-dvh max-w-xl flex-col bg-[#f6f7fb]">
      <OfflineBanner state={connection} />

      {/* Header */}
      <header className="bg-gradient-to-br from-brand-700 to-brand-900 px-4 pb-4 pt-4 text-white">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-brand-200">{event?.name ?? "Freshers"} Evaluation</p>
          <div className="flex items-center gap-2">
            <ConnectionBadge state={connection} compact />
            <button onClick={signOut} className="rounded-lg p-1.5 text-brand-200 hover:bg-white/10 hover:text-white" aria-label="Sign out">
              <LogOut className="size-5" />
            </button>
          </div>
        </div>
        <div className="mt-2 flex items-end justify-between gap-3">
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-extrabold tracking-tight">{name}</h1>
            <p className="truncate text-xs text-brand-200">{state.user.email}</p>
          </div>
          {day && (
            <div className="shrink-0 text-right">
              <p className="text-2xl font-extrabold uppercase tracking-tight">{dayLabel(day)}</p>
              <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold uppercase", dayOpen ? "bg-emerald-400/20 text-emerald-200" : "bg-rose-400/20 text-rose-200")}>
                {dayOpen ? "● Open" : <><Lock className="size-3" /> Locked</>}
              </span>
            </div>
          )}
        </div>
        {totalStudents > 0 && (
          <div className="mt-3">
            <div className="mb-1 flex justify-between text-xs font-medium text-brand-100">
              <span>Evaluated today</span>
              <span className="tabular">
                {doneCount} / {totalStudents}
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-white/15">
              <div className="h-full rounded-full bg-emerald-400 transition-[width]" style={{ width: `${totalStudents ? (doneCount * 100) / totalStudents : 0}%` }} />
            </div>
          </div>
        )}
      </header>

      {/* Sticky search */}
      <div className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur">
        <form onSubmit={onSearchSubmit} className="relative">
          <label htmlFor="sid" className="sr-only">
            Search Student ID
          </label>
          <input
            id="sid"
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setNotFound(false);
              if (selectedKey) setSelectedKey(null);
            }}
            disabled={!event || !dayOpen}
            placeholder={dayOpen ? "Search Student ID (e.g. BFT/26/2077 or 2077)" : "Evaluation is locked"}
            autoFocus
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="characters"
            spellCheck={false}
            enterKeyHint="search"
            className="tabular h-14 w-full rounded-2xl border-0 outline-none bg-slate-100 pl-4 pr-14 text-lg font-semibold uppercase tracking-wide text-slate-900 ring-2 ring-transparent placeholder:text-sm placeholder:font-normal placeholder:normal-case placeholder:tracking-normal placeholder:text-slate-400 focus:bg-white focus:ring-brand-500 disabled:opacity-60"
          />
          <button type="submit" className="absolute right-2 top-2 flex size-10 items-center justify-center rounded-xl bg-brand-600 text-white active:bg-brand-800 disabled:opacity-50" aria-label="Search" disabled={!dayOpen}>
            <Search className="size-5" />
          </button>
        </form>
        {pendingCount > 0 && (
          <p className="mt-2 flex items-center gap-1.5 text-xs font-semibold text-amber-700">
            <CloudUpload className="size-4" /> {pendingCount} evaluation{pendingCount > 1 ? "s" : ""} waiting to sync — keep this page open.
          </p>
        )}
      </div>

      <main className="flex-1 space-y-4 px-4 py-4 pb-40">
        {!event && <Alert title="The event has not been set up yet">Please wait for the Main Admin to initialise the event.</Alert>}

        {event && !dayOpen && (
          <div className="rounded-2xl bg-white p-6 text-center shadow-sm ring-1 ring-slate-200">
            <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-500">
              <Lock className="size-7" />
            </div>
            <h2 className="mt-3 text-lg font-bold text-slate-900">{day ? `${dayLabel(day)} is locked` : "No day is open"}</h2>
            <p className="mt-1 text-sm text-slate-500">Evaluations cannot be submitted right now. This screen will update automatically when the Main Admin opens the day.</p>
          </div>
        )}

        {/* Failed submissions — never hidden */}
        {failed.map((f) => (
          <div key={f.studentKey} className="rounded-2xl bg-rose-50 p-4 ring-1 ring-rose-200" role="alert">
            <div className="flex items-start gap-3">
              <XCircle className="mt-0.5 size-5 shrink-0 text-rose-600" />
              <div className="min-w-0 flex-1">
                <p className="font-bold text-rose-800">NOT SAVED — {f.studentId}</p>
                <p className="text-sm text-rose-700">{f.error}</p>
                <div className="mt-2 flex gap-2">
                  {dayOpen && !myEvals[f.studentKey] && (
                    <Button size="sm" variant="danger" onClick={() => { setSubmissions((m) => { const n = { ...m }; delete n[f.studentKey]; return n; }); openStudent(f.studentKey); }}>
                      Evaluate again
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" onClick={() => setSubmissions((m) => { const n = { ...m }; delete n[f.studentKey]; return n; })}>
                    Dismiss
                  </Button>
                </div>
              </div>
            </div>
          </div>
        ))}

        {/* Last submission status */}
        {!selectedKey && lastSub && lastSub.status !== "failed" && (
          <div className={cn("rounded-2xl p-5 text-center ring-1", lastSub.status === "saved" ? "bg-emerald-50 ring-emerald-200" : "bg-amber-50 ring-amber-200")}>
            {lastSub.status === "saved" ? (
              <>
                <CheckCircle2 className="mx-auto size-10 text-emerald-600" />
                <p className="mt-2 text-lg font-extrabold text-emerald-800">✓ Evaluation Saved</p>
              </>
            ) : (
              <>
                <Clock className="mx-auto size-10 animate-pulse text-amber-600" />
                <p className="mt-2 text-lg font-extrabold text-amber-800">{connection === "online" ? "Saving…" : "Waiting for connection to sync"}</p>
                <p className="text-xs text-amber-700">Stored on this phone only — not yet saved on the server. Keep this page open.</p>
              </>
            )}
            <p className="mt-2 text-sm text-slate-700">
              Student: <span className="font-semibold">{lastSub.studentId}</span> · {lastSub.name}
            </p>
            <p className="tabular text-sm text-slate-700">
              Score: <span className="font-bold">{lastSub.total} / {maxTotal}</span>
            </p>
            <Button size="lg" className="mt-4 w-full" onClick={() => { setLastSubmitted(null); resetToSearch(); }}>
              Evaluate next student
            </Button>
          </div>
        )}

        {/* Search suggestions */}
        {!selectedKey && query.trim() && dayOpen && (
          <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
            {matches.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-slate-500">{notFound ? "No student found with this ID." : "No matching student yet — keep typing or press Search."}</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {matches.map((m) => {
                  const done = myEvals[m.key];
                  return (
                    <li key={m.key}>
                      <button className="flex w-full items-center gap-3 px-4 py-3 text-left active:bg-slate-50" onClick={() => openStudent(m.key)}>
                        <StudentAvatar student={m.student} size={40} />
                        <div className="min-w-0 flex-1">
                          <p className="tabular font-bold text-slate-900">{m.student.studentId}</p>
                          <p className="truncate text-sm text-slate-500">{m.student.name}</p>
                        </div>
                        {done ? (
                          <span className="tabular rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-bold text-emerald-700">✓ {done.total}</span>
                        ) : (
                          <ChevronRight className="size-5 text-slate-300" />
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}

        {/* Student found */}
        {selectedKey && selected && (
          <>
            <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
              <div className="flex items-center justify-between">
                <p className={cn("text-sm font-bold", existing ? "text-amber-600" : "text-emerald-600")}>{existing ? "Already evaluated" : "Student Found ✓"}</p>
                <button onClick={resetToSearch} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100" aria-label="Close student">
                  <X className="size-5" />
                </button>
              </div>
              <div className="mt-3 flex items-center gap-4">
                <StudentAvatar student={selected} size={88} className="rounded-2xl" />
                <div className="min-w-0 space-y-0.5 text-sm">
                  <p className="text-lg font-bold leading-tight text-slate-900">{selected.name}</p>
                  <p className="tabular font-semibold text-slate-700">{selected.studentId}</p>
                  <p className="text-slate-500">
                    {[selected.programme, selected.year && `Year ${selected.year}`, selected.class].filter(Boolean).join(" · ")}
                  </p>
                </div>
              </div>
            </div>

            {existing ? (
              <div className="rounded-2xl bg-amber-50 p-5 text-center ring-1 ring-amber-200">
                <p className="text-xl font-extrabold tracking-wide text-amber-800">ALREADY EVALUATED</p>
                <p className="mt-2 text-sm text-slate-700">
                  Student: <span className="font-semibold">{selected.studentId}</span>
                </p>
                <p className="tabular text-sm text-slate-700">
                  Your Score: <span className="font-bold">{existing.total} / {maxTotal}</span>
                </p>
                <p className="text-sm text-slate-700">Submitted: {submissions[selectedKey]?.status === "pending" ? "pending sync" : formatTime(existing.timestamp)}</p>
                <p className="mt-3 text-xs text-slate-500">Only the Main Admin can correct a submitted evaluation.</p>
                <Button size="lg" className="mt-4 w-full" onClick={resetToSearch}>
                  Evaluate next student
                </Button>
              </div>
            ) : (
              <div className="space-y-6 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
                {CRITERIA_KEYS.map((k) =>
                  settings?.criteria?.[k] ? (
                    <ScoreSelector key={k} criterion={settings.criteria[k]} value={scores[k]} onChange={(v) => setScores((s) => ({ ...s, [k]: v }))} disabled={!dayOpen} />
                  ) : null,
                )}
              </div>
            )}
          </>
        )}

        {/* Own lists */}
        {!selectedKey && !query.trim() && totalStudents > 0 && (
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <Button variant={listTab === "done" ? "primary" : "secondary"} onClick={() => setListTab(listTab === "done" ? "none" : "done")}>
                <ListChecks className="size-4" /> Done ({doneCount})
              </Button>
              <Button variant={listTab === "remaining" ? "primary" : "secondary"} onClick={() => setListTab(listTab === "remaining" ? "none" : "remaining")}>
                <ListTodo className="size-4" /> Remaining ({Math.max(0, totalStudents - doneCount)})
              </Button>
            </div>
            {listTab !== "none" && (
              <ul className="divide-y divide-slate-100 overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
                {index
                  .filter((s) => (listTab === "done" ? !!myEvals[s.key] : !myEvals[s.key]))
                  .sort((a, b) =>
                    listTab === "done"
                      ? (myEvals[b.key]?.timestamp ?? 0) - (myEvals[a.key]?.timestamp ?? 0)
                      : a.id.localeCompare(b.id, undefined, { numeric: true }),
                  )
                  .map((s) => (
                    <li key={s.key}>
                      <button className="flex w-full items-center gap-3 px-4 py-2.5 text-left active:bg-slate-50" onClick={() => openStudent(s.key)}>
                        <div className="min-w-0 flex-1">
                          <p className="tabular text-sm font-bold text-slate-900">{s.student.studentId}</p>
                          <p className="truncate text-xs text-slate-500">{s.student.name}</p>
                        </div>
                        {myEvals[s.key] ? (
                          <span className="tabular text-sm font-bold text-emerald-700">
                            {myEvals[s.key].total}/{maxTotal}
                            <span className="ml-2 text-xs font-normal text-slate-400">{formatTime(myEvals[s.key].timestamp)}</span>
                          </span>
                        ) : (
                          <ChevronRight className="size-4 text-slate-300" />
                        )}
                      </button>
                    </li>
                  ))}
              </ul>
            )}
          </div>
        )}
        {totalStudents === 0 && event && <Alert>No students have been registered yet.</Alert>}
      </main>

      {/* Sticky total + submit */}
      {selectedKey && selected && !existing && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur">
          <div className="mx-auto max-w-xl">
            <div className="mb-2 flex items-baseline justify-between">
              <span className="text-sm font-bold uppercase tracking-wider text-slate-500">Total</span>
              <span className="tabular text-3xl font-extrabold text-slate-900">
                {total}
                <span className="text-lg font-semibold text-slate-400"> / {maxTotal}</span>
              </span>
            </div>
            <Button size="xl" variant="success" className="w-full" disabled={!allChosen || !dayOpen} onClick={onSubmit}>
              {allChosen ? "SUBMIT EVALUATION" : `Select all ${CRITERIA_KEYS.length} scores`}
            </Button>
            <ProgressBar value={(CRITERIA_KEYS.filter((k) => scores[k] !== null).length * 100) / CRITERIA_KEYS.length} className="mt-2 h-1" />
          </div>
        </div>
      )}
    </div>
  );
}
