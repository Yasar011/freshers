"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { GoogleAuthProvider, getRedirectResult, onAuthStateChanged, signInWithPopup, signInWithRedirect, signOut as fbSignOut, type User } from "firebase/auth";
import { get, onValue, ref, serverTimestamp, set } from "firebase/database";
import { auth, db, errorMessage, firebaseConfigured } from "@/lib/firebase";
import { claimAdmin } from "@/lib/actions";
import { emailKey } from "@/lib/keys";
import { MAIN_ADMIN_EMAIL } from "@/lib/constants";
import type { Evaluator } from "@/lib/types";

export type AuthState =
  | { status: "loading" }
  | { status: "signedOut" }
  | { status: "checking"; user: User }
  | { status: "admin"; user: User }
  | { status: "evaluator"; user: User; evaluatorKey: string; evaluator: Evaluator }
  | { status: "inactive"; user: User; evaluator: Evaluator }
  | { status: "denied"; user: User; note?: string }
  | { status: "error"; user: User; message: string };

interface AuthApi {
  state: AuthState;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  retry: () => void;
  signInError: string | null;
  signingIn: boolean;
}

const Ctx = createContext<AuthApi | null>(null);

function isPermissionDenied(e: unknown) {
  const s = `${(e as { code?: string })?.code ?? ""} ${(e as Error)?.message ?? ""}`;
  return /permission[_ -]denied/i.test(s);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: "loading" });
  const [user, setUser] = useState<User | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [signInError, setSignInError] = useState<string | null>(null);
  const [signingIn, setSigningIn] = useState(false);

  useEffect(() => {
    if (!firebaseConfigured) return;
    getRedirectResult(auth()).catch((e) => setSignInError(errorMessage(e)));
    return onAuthStateChanged(auth(), (u) => {
      setUser(u);
      if (!u) setState({ status: "signedOut" });
    });
  }, []);

  // Resolve role whenever the signed-in user changes (or on retry).
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    let unsubEvaluator: (() => void) | undefined;
    setState({ status: "checking", user });

    (async () => {
      const email = (user.email ?? "").toLowerCase();
      // 1. Main Admin — authoritative identity is /admin/uid (readable only by that uid).
      try {
        const snap = await get(ref(db(), "admin"));
        if (snap.exists() && snap.val().uid === user.uid) {
          if (!cancelled) setState({ status: "admin", user });
          return;
        }
      } catch (e) {
        if (!isPermissionDenied(e)) {
          if (!cancelled) setState({ status: "error", user, message: errorMessage(e) });
          return;
        }
        // Permission denied → not the admin (or /admin not claimed yet).
      }
      if (email === MAIN_ADMIN_EMAIL && user.emailVerified) {
        try {
          // First sign-in of the Main Admin: claim /admin once (rules allow only this email, only once).
          await claimAdmin(user.uid, email);
          if (!cancelled) setState({ status: "admin", user });
          return;
        } catch (e) {
          if (!cancelled)
            setState({
              status: "denied",
              user,
              note: isPermissionDenied(e)
                ? "The Main Admin record is already linked to a different Firebase account (UID). Update /admin/uid in the Firebase console to the UID shown below."
                : errorMessage(e),
            });
          return;
        }
      }
      // 2. Evaluator — keyed by Google email; watched live so deactivation applies instantly.
      const key = emailKey(email);
      if (!email || !user.emailVerified) {
        if (!cancelled) setState({ status: "denied", user });
        return;
      }
      unsubEvaluator = onValue(
        ref(db(), `evaluators/${key}`),
        (snap) => {
          if (cancelled) return;
          if (!snap.exists()) {
            setState({ status: "denied", user });
            return;
          }
          const evaluator = snap.val() as Evaluator;
          if (!evaluator.active) {
            setState({ status: "inactive", user, evaluator });
            return;
          }
          setState({ status: "evaluator", user, evaluatorKey: key, evaluator });
          if (evaluator.uid !== user.uid) set(ref(db(), `evaluators/${key}/uid`), user.uid).catch(() => undefined);
        },
        (err) => {
          if (cancelled) return;
          if (isPermissionDenied(err)) setState({ status: "denied", user });
          else setState({ status: "error", user, message: errorMessage(err) });
        },
      );
      set(ref(db(), `evaluators/${key}/lastLoginAt`), serverTimestamp()).catch(() => undefined);
    })();

    return () => {
      cancelled = true;
      unsubEvaluator?.();
    };
  }, [user, attempt]);

  const signIn = useCallback(async () => {
    setSignInError(null);
    setSigningIn(true);
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    try {
      await signInWithPopup(auth(), provider);
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code === "auth/popup-blocked" || code === "auth/operation-not-supported-in-this-environment") {
        await signInWithRedirect(auth(), provider);
        return;
      }
      if (code !== "auth/popup-closed-by-user" && code !== "auth/cancelled-popup-request") setSignInError(errorMessage(e));
    } finally {
      setSigningIn(false);
    }
  }, []);

  const signOut = useCallback(async () => {
    await fbSignOut(auth());
  }, []);

  const retry = useCallback(() => setAttempt((a) => a + 1), []);

  const value = useMemo(() => ({ state, signIn, signOut, retry, signInError, signingIn }), [state, signIn, signOut, retry, signInError, signingIn]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth must be used inside AuthProvider");
  return v;
}
