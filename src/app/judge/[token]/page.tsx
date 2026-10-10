"use client";
import { use, useCallback, useEffect, useMemo, useState } from "react";
import { signInAnonymously, signOut } from "firebase/auth";
import { get, onValue, ref, serverTimestamp, set } from "firebase/database";
import { CheckCircle2, Lock, ShieldAlert, X } from "lucide-react";
import { auth, db, errorMessage } from "@/lib/firebase";
import { useConnection } from "@/hooks/useConnection";
import { submitFinalScore } from "@/lib/finalsActions";
import { GENDERS, judgeTotal, roundMax, takesPart, type Contestant, type FinalConfig, type FinalScore, type Gender, type Judge, type RoundKey } from "@/lib/finals";
import { Alert, Button, FullPageSpinner, cn } from "@/components/ui";
import { ConnectionBadge, OfflineBanner, ScoreSelector, formatTime } from "@/components/shared";

type Gate =
  | { kind: "loading" }
  | { kind: "google" }
  | { kind: "invalid" }
  | { kind: "disabled" }
  | { kind: "notenabled" }
  | { kind: "error"; message: string }
  | { kind: "ready"; judgeId: string };

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-gradient-to-b from-brand-50 via-white to-white px-4 py-10">
      <div className="w-full max-w-sm text-center">{children}</div>
    </main>
  );
}

function Message({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <Shell>
      <div className="rounded-2xl bg-white p-7 shadow-sm ring-1 ring-slate-200">
        <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-amber-50 text-amber-600">
          <ShieldAlert className="size-7" />
        </div>
        <h1 className="mt-4 text-xl font-bold text-slate-900">{title}</h1>
        <div className="mt-2 text-sm text-slate-600">{children}</div>
        {action && <div className="mt-6">{action}</div>}
      </div>
    </Shell>
  );
}

/** Big number badge — judges see the contestant number and name only (no ID, class, photo or gender label). */
function NumberBadge({ number, gender, size = 64 }: { number: number; gender: Gender; size?: number }) {
  return (
    <div
      className={cn("tabular flex shrink-0 items-center justify-center rounded-2xl font-extrabold", gender === "girl" ? "bg-brand-100 text-brand-800" : "bg-sky-100 text-sky-800")}
      style={{ width: size, height: size, fontSize: size * 0.5 }}
    >
      {number}
    </div>
  );
}

export default function JudgePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [gate, setGate] = useState<Gate>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    const set_ = (g: Gate) => !cancelled && setGate(g);
    (async () => {
      try {
        await auth().authStateReady();
        let user = auth().currentUser;
        if (user && !user.isAnonymous) return set_({ kind: "google" });
        if (!/^[A-Za-z0-9]{20,64}$/.test(token)) return set_({ kind: "invalid" });
        if (!user) {
          try {
            user = (await signInAnonymously(auth())).user;
          } catch (e) {
            const code = (e as { code?: string }).code;
            if (code === "auth/operation-not-allowed" || code === "auth/admin-restricted-operation") return set_({ kind: "notenabled" });
            return set_({ kind: "error", message: errorMessage(e) });
          }
        }
        const snap = await get(ref(db(), `judgeTokens/${token}`));
        const judgeId = snap.val() as string | null;
        if (!judgeId) return set_({ kind: "invalid" });
        try {
          await set(ref(db(), `judgeSessions/${user.uid}`), { judgeId, token, claimedAt: serverTimestamp() });
        } catch {
          return set_({ kind: "disabled" });
        }
        set_({ kind: "ready", judgeId });
      } catch (e) {
        set_({ kind: "error", message: errorMessage(e) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (gate.kind === "loading") return <FullPageSpinner label="Opening your judging link…" />;
  if (gate.kind === "google")
    return (
      <Message
        title="Signed in with Google"
        action={
          <Button className="w-full" onClick={async () => { await signOut(auth()); window.location.reload(); }}>
            Sign out and continue as judge
          </Button>
        }
      >
        This browser is signed in to the evaluation portal. Judges don&apos;t need to sign in — sign out here, or open the link in a private window.
      </Message>
    );
  if (gate.kind === "invalid") return <Message title="Link not valid">This judging link is not valid, or it has been replaced by a new one. Please ask the organiser for your current link.</Message>;
  if (gate.kind === "disabled") return <Message title="Link disabled">Your judging link has been switched off. Please contact the organiser.</Message>;
  if (gate.kind === "notenabled") return <Message title="Judging links not enabled yet">The organiser needs to enable judge links (Anonymous sign-in in Firebase). Please let them know.</Message>;
  if (gate.kind === "error") return <Message title="Something went wrong" action={<Button className="w-full" onClick={() => window.location.reload()}>Try again</Button>}>{gate.message}</Message>;
  return <JudgeConsole judgeId={gate.judgeId} />;
}

function JudgeConsole({ judgeId }: { judgeId: string }) {
  const connection = useConnection();
  const [judge, setJudge] = useState<Judge | null | undefined>(undefined);
  const [config, setConfig] = useState<FinalConfig | null | undefined>(undefined);
  const [contestants, setContestants] = useState<Record<string, Contestant> | undefined>(undefined);
  const [mine, setMine] = useState<Record<string, FinalScore>>({});
  const [revoked, setRevoked] = useState(false);
  const [tab, setTab] = useState<Gender>("girl");
  const [open, setOpen] = useState<string | null>(null);
  const [flash, setFlash] = useState<{ label: string; total: number; max: number } | null>(null);

  useEffect(() => {
    const onErr = () => setRevoked(true);
    const subs = [
      onValue(ref(db(), `judges/${judgeId}`), (s) => setJudge(s.val()), onErr),
      onValue(ref(db(), "finalConfig"), (s) => setConfig(s.val()), onErr),
      onValue(ref(db(), "contestants"), (s) => setContestants(s.val() ?? {}), onErr),
    ];
    return () => subs.forEach((u) => u());
  }, [judgeId]);

  const round = config?.activeRound;
  useEffect(() => {
    if (!round) return;
    setMine({});
    return onValue(ref(db(), `finalScores/${round}/${judgeId}`), (s) => setMine(s.val() ?? {}), () => setRevoked(true));
  }, [round, judgeId]);

  const roundInfo = round ? config?.rounds[round] : undefined;
  const isOpen = roundInfo?.status === "open";
  const max = roundMax(roundInfo);

  const inRound = useMemo(
    () => Object.entries(contestants ?? {}).filter(([, c]) => (round ? takesPart(c, round) : false)).sort((a, b) => a[1].number - b[1].number),
    [contestants, round],
  );
  const byGender = useMemo(() => Object.fromEntries(GENDERS.map((g) => [g, inRound.filter(([, c]) => c.gender === g)])) as Record<Gender, [string, Contestant][]>, [inRound]);
  const done = inRound.filter(([k]) => mine[k]).length;

  useEffect(() => {
    if (byGender.girl.length === 0 && byGender.boy.length > 0) setTab("boy");
    else if (byGender.boy.length === 0 && byGender.girl.length > 0) setTab("girl");
  }, [byGender.boy.length, byGender.girl.length]);

  const onSaved = useCallback(
    (label: string, total: number) => {
      setOpen(null);
      setFlash({ label, total, max });
      setTimeout(() => setFlash(null), 4000);
    },
    [max],
  );

  if (revoked) return <Message title="Link no longer active">Your judging link was switched off or replaced. Please ask the organiser for a new link.</Message>;
  if (judge === undefined || config === undefined || contestants === undefined) return <FullPageSpinner label={connection === "offline" ? "Waiting for connection…" : "Loading…"} />;
  if (!judge) return <Message title="Link no longer active">Your judging link was removed. Please contact the organiser.</Message>;
  if (!config) return <Message title="Finals not ready">The organiser has not set up the finals yet. This page will update automatically.</Message>;

  const list = byGender[tab];
  const openContestant = open ? contestants[open] : undefined;

  return (
    <div className="mx-auto flex min-h-dvh max-w-xl flex-col bg-[#f6f7fb]">
      <OfflineBanner state={connection} />
      <header className="bg-gradient-to-br from-brand-700 to-brand-900 px-4 pb-4 pt-4 text-white">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-brand-200">Freshers 2026 · Finals</p>
          <ConnectionBadge state={connection} compact />
        </div>
        <div className="mt-2 flex items-end justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs text-brand-200">Judge</p>
            <h1 className="truncate text-2xl font-extrabold tracking-tight">{judge.name}</h1>
          </div>
          {roundInfo && (
            <div className="shrink-0 text-right">
              <p className="text-lg font-extrabold leading-tight">{roundInfo.label}</p>
              <span className={cn("mt-0.5 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold uppercase", isOpen ? "bg-emerald-400/20 text-emerald-200" : "bg-rose-400/20 text-rose-200")}>
                {isOpen ? "● Open" : <><Lock className="size-3" /> Locked</>}
              </span>
            </div>
          )}
        </div>
        {roundInfo?.note && <p className="mt-2 rounded-lg bg-white/10 px-3 py-1.5 text-xs text-brand-100">{roundInfo.note}</p>}
        {inRound.length > 0 && (
          <p className="tabular mt-3 text-sm font-semibold text-brand-100">
            Scored {done} / {inRound.length}
          </p>
        )}
      </header>

      <div className="sticky top-0 z-20 grid grid-cols-2 gap-2 border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur">
        {(["girl", "boy"] as const).map((g) => (
          <button
            key={g}
            onClick={() => setTab(g)}
            className={cn("h-12 rounded-xl text-base font-bold transition-colors", tab === g ? "bg-brand-600 text-white shadow" : "bg-slate-100 text-slate-700")}
          >
            {g === "girl" ? "Girls" : "Boys"}{" "}
            <span className="tabular text-sm font-semibold opacity-80">
              {byGender[g].filter(([k]) => mine[k]).length}/{byGender[g].length}
            </span>
          </button>
        ))}
      </div>

      <main className="flex-1 space-y-3 px-4 py-4 pb-10">
        {flash && (
          <div className="flex items-center gap-3 rounded-2xl bg-emerald-50 p-4 ring-1 ring-emerald-200" role="status">
            <CheckCircle2 className="size-6 shrink-0 text-emerald-600" />
            <p className="text-sm text-emerald-900">
              <b>✓ Saved</b> — {flash.label}: <span className="tabular font-bold">{flash.total} / {flash.max}</span>
            </p>
          </div>
        )}
        {!isOpen && (
          <Alert tone="amber" title={`${roundInfo?.label ?? "This round"} is locked`}>
            You can view your scores. This screen updates automatically when the organiser opens the round.
          </Alert>
        )}
        {inRound.length === 0 && <Alert tone="blue">No contestants in this round yet.</Alert>}
        {list.map(([cid, c]) => {
          const sc = mine[cid];
          return (
            <button
              key={cid}
              onClick={() => setOpen(cid)}
              className={cn("flex w-full items-center gap-4 rounded-2xl p-3 text-left shadow-sm ring-1 active:scale-[0.99]", sc ? "bg-emerald-50 ring-emerald-200" : "bg-white ring-slate-200")}
            >
              <NumberBadge number={c.number} gender={c.gender} />
              <p className="min-w-0 flex-1 text-lg font-bold leading-snug text-slate-900">{c.name}</p>
              {sc ? (
                <span className="tabular flex items-center gap-1 rounded-full bg-white px-2.5 py-1 text-sm font-bold text-emerald-700">
                  <CheckCircle2 className="size-4" /> {judgeTotal(sc)}/{max}
                </span>
              ) : isOpen ? (
                <span className="text-sm font-semibold text-brand-600">Score ›</span>
              ) : null}
            </button>
          );
        })}
      </main>

      {open && openContestant && round && roundInfo && (
        <ScoreSheet
          cid={open}
          contestant={openContestant}
          round={round}
          config={config}
          judgeId={judgeId}
          judgeName={judge.name}
          existing={mine[open] ?? null}
          isOpen={!!isOpen}
          onClose={() => setOpen(null)}
          onSaved={onSaved}
        />
      )}
    </div>
  );
}

function ScoreSheet({
  cid,
  contestant,
  round,
  config,
  judgeId,
  judgeName,
  existing,
  isOpen,
  onClose,
  onSaved,
}: {
  cid: string;
  contestant: Contestant;
  round: RoundKey;
  config: FinalConfig;
  judgeId: string;
  judgeName: string;
  existing: FinalScore | null;
  isOpen: boolean;
  onClose: () => void;
  onSaved: (label: string, total: number) => void;
}) {
  const info = config.rounds[round];
  const crit = useMemo(() => Object.entries(info.criteria).sort((a, b) => a[1].order - b[1].order), [info.criteria]);
  const [scores, setScores] = useState<Record<string, number | null>>(() => Object.fromEntries(crit.map(([k]) => [k, null])));
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const max = roundMax(info);
  const total = crit.reduce((s, [k]) => s + (scores[k] ?? 0), 0);
  const complete = crit.every(([k]) => scores[k] !== null);
  const label = contestant.name;

  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, []);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const final = Object.fromEntries(crit.map(([k]) => [k, scores[k] as number]));
      await submitFinalScore(round, judgeId, cid, judgeName, final);
      onSaved(label, total);
    } catch (e) {
      const msg = errorMessage(e);
      setError(/permission/i.test(msg) ? "The server rejected this score — the round may have just been locked, or it was already scored." : msg);
      setBusy(false);
      setConfirm(false);
    }
  };

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-[#f6f7fb]">
      <div className="flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-3">
        <NumberBadge number={contestant.number} gender={contestant.gender} size={52} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-lg font-extrabold leading-tight">{label}</p>
          <p className="text-xs text-slate-500">{info.label}</p>
        </div>
        <button onClick={onClose} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100" aria-label="Close">
          <X className="size-6" />
        </button>
      </div>

      <div className="flex-1 space-y-6 overflow-y-auto px-4 py-4 pb-48">
        {existing ? (
          <div className="rounded-2xl bg-emerald-50 p-5 text-center ring-1 ring-emerald-200">
            <CheckCircle2 className="mx-auto size-9 text-emerald-600" />
            <p className="mt-2 text-lg font-extrabold text-emerald-800">Already scored</p>
            <p className="tabular text-sm text-slate-700">
              Your score: <b>{judgeTotal(existing)} / {max}</b> · {formatTime(existing.timestamp)}
            </p>
            <ul className="mx-auto mt-3 max-w-xs space-y-1 text-left text-sm">
              {crit.map(([k, c]) => (
                <li key={k} className="flex justify-between">
                  <span className="text-slate-600">{c.label}</span>
                  <span className="tabular font-bold">{existing.scores[k] ?? 0} / {c.max}</span>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-slate-500">Scores can only be changed by the organiser.</p>
            <Button size="lg" className="mt-4 w-full" onClick={onClose}>
              Back to list
            </Button>
          </div>
        ) : (
          <>
            {!isOpen && <Alert tone="amber" title="Round is locked">You cannot submit scores right now.</Alert>}
            <div className="space-y-6 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
              {crit.map(([k, c]) => (
                <ScoreSelector key={k} criterion={c} value={scores[k]} onChange={(v) => setScores((s) => ({ ...s, [k]: v }))} disabled={!isOpen || busy} />
              ))}
            </div>
            {error && <Alert tone="red">{error}</Alert>}
          </>
        )}
      </div>

      {!existing && (
        <div className="absolute inset-x-0 bottom-0 border-t border-slate-200 bg-white/95 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur">
          <div className="mx-auto max-w-xl">
            {confirm ? (
              <div className="space-y-2">
                <p className="text-center text-sm font-semibold text-slate-700">
                  Submit <span className="tabular text-lg font-extrabold text-slate-900">{total} / {max}</span> for {label}? You can&apos;t change it afterwards.
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <Button size="lg" variant="secondary" onClick={() => setConfirm(false)} disabled={busy}>
                    Back
                  </Button>
                  <Button size="lg" variant="success" onClick={submit} loading={busy}>
                    Confirm
                  </Button>
                </div>
              </div>
            ) : (
              <>
                <div className="mb-2 flex items-baseline justify-between">
                  <span className="text-sm font-bold uppercase tracking-wider text-slate-500">Total</span>
                  <span className="tabular text-3xl font-extrabold text-slate-900">
                    {total}
                    <span className="text-lg font-semibold text-slate-400"> / {max}</span>
                  </span>
                </div>
                <Button size="xl" variant="success" className="w-full" disabled={!complete || !isOpen} onClick={() => setConfirm(true)}>
                  {complete ? "SUBMIT SCORE" : `Select all ${crit.length} scores`}
                </Button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
