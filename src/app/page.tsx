"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ShieldX, UserX, AlertTriangle, Copy, Check } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { Alert, Button, Card, FullPageSpinner } from "@/components/ui";
import { firebaseConfigured } from "@/lib/firebase";

function GoogleIcon() {
  return (
    <svg viewBox="0 0 48 48" className="size-5" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-gradient-to-b from-brand-50 via-white to-white px-4 py-10">
      <div className="w-full max-w-sm">{children}</div>
    </main>
  );
}

function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="text-left">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</p>
      <button
        className="mt-0.5 flex w-full items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 font-mono text-xs text-slate-700 ring-1 ring-slate-200"
        onClick={() => {
          navigator.clipboard?.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        <span className="truncate">{value}</span>
        {copied ? <Check className="size-4 text-emerald-600" /> : <Copy className="size-4 text-slate-400" />}
      </button>
    </div>
  );
}

export default function LoginPage() {
  const { state, signIn, signOut, retry, signInError, signingIn } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (state.status === "admin") router.replace("/admin");
    if (state.status === "evaluator") router.replace("/evaluator");
  }, [state.status, router]);

  if (!firebaseConfigured) {
    return (
      <Shell>
        <Alert tone="red" title="Firebase is not configured">
          Set the <code>NEXT_PUBLIC_FIREBASE_*</code> environment variables (see <code>.env.example</code>) and redeploy.
        </Alert>
      </Shell>
    );
  }

  if (state.status === "loading" || state.status === "checking" || state.status === "admin" || state.status === "evaluator") {
    return <FullPageSpinner label={state.status === "checking" ? "Checking your access…" : "Loading…"} />;
  }

  if (state.status === "denied") {
    return (
      <Shell>
        <Card className="p-7 text-center">
          <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-rose-50 text-rose-600">
            <ShieldX className="size-7" />
          </div>
          <h1 className="mt-4 text-xl font-bold text-slate-900">Access Denied</h1>
          <p className="mt-2 text-sm text-slate-600">
            Your Google account has not been authorized for the Freshers Evaluation System.
          </p>
          <p className="mt-2 text-sm font-medium text-slate-700">Please contact the Main Admin.</p>
          {state.note && <Alert className="mt-4 text-left">{state.note}</Alert>}
          <div className="mt-5 space-y-2">
            <CopyField label="Signed in as" value={state.user.email ?? "(no email)"} />
            <CopyField label="Firebase UID" value={state.user.uid} />
          </div>
          <div className="mt-6 grid gap-2">
            <Button variant="secondary" onClick={retry}>
              Check again
            </Button>
            <Button variant="ghost" onClick={signOut}>
              Use a different Google account
            </Button>
          </div>
        </Card>
      </Shell>
    );
  }

  if (state.status === "inactive") {
    return (
      <Shell>
        <Card className="p-7 text-center">
          <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-amber-50 text-amber-600">
            <UserX className="size-7" />
          </div>
          <h1 className="mt-4 text-xl font-bold text-slate-900">Account Deactivated</h1>
          <p className="mt-2 text-sm text-slate-600">
            {state.evaluator.name} ({state.user.email}) is currently deactivated. Please contact the Main Admin.
          </p>
          <p className="mt-2 text-xs text-slate-400">This page updates automatically when you are reactivated.</p>
          <Button variant="ghost" className="mt-6 w-full" onClick={signOut}>
            Sign out
          </Button>
        </Card>
      </Shell>
    );
  }

  if (state.status === "error") {
    return (
      <Shell>
        <Card className="p-7 text-center">
          <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-amber-50 text-amber-600">
            <AlertTriangle className="size-7" />
          </div>
          <h1 className="mt-4 text-xl font-bold text-slate-900">Could not verify access</h1>
          <p className="mt-2 text-sm text-slate-600">{state.message}</p>
          <div className="mt-6 grid gap-2">
            <Button onClick={retry}>Try again</Button>
            <Button variant="ghost" onClick={signOut}>
              Sign out
            </Button>
          </div>
        </Card>
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="text-center">
        <p className="text-sm font-bold uppercase tracking-[0.25em] text-brand-600">Freshers 2026</p>
        <h1 className="mt-2 text-3xl font-extrabold tracking-tight text-slate-900">Evaluation Portal</h1>
        <p className="mt-2 text-sm text-slate-500">Sign in with your authorised Google account.</p>
      </div>
      <Card className="mt-8 p-6">
        <Button variant="secondary" size="lg" className="w-full" onClick={signIn} loading={signingIn}>
          {!signingIn && <GoogleIcon />}
          Continue with Google
        </Button>
        {signInError && (
          <Alert tone="red" className="mt-4">
            {signInError}
          </Alert>
        )}
      </Card>
      <p className="mt-6 text-center text-xs text-slate-400">Access is limited to the Main Admin and authorised evaluators.</p>
    </Shell>
  );
}
