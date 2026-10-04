"use client";
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { CheckCircle2, AlertTriangle, XCircle, Info, X } from "lucide-react";

type ToastTone = "success" | "error" | "warning" | "info";
interface Toast {
  id: number;
  tone: ToastTone;
  message: string;
}

const Ctx = createContext<(message: string, tone?: ToastTone) => void>(() => undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);
  const remove = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const push = useCallback(
    (message: string, tone: ToastTone = "info") => {
      const id = ++seq.current;
      setToasts((t) => [...t.slice(-3), { id, tone, message }]);
      setTimeout(() => remove(id), tone === "error" ? 8000 : 4000);
    },
    [remove],
  );
  const value = useMemo(() => push, [push]);
  const icons = {
    success: <CheckCircle2 className="size-5 text-emerald-500" />,
    error: <XCircle className="size-5 text-rose-500" />,
    warning: <AlertTriangle className="size-5 text-amber-500" />,
    info: <Info className="size-5 text-sky-500" />,
  };
  return (
    <Ctx.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex flex-col items-center gap-2 px-4 sm:bottom-6 sm:items-end sm:px-6" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className="pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl bg-white px-4 py-3 text-sm shadow-lg ring-1 ring-slate-200">
            {icons[t.tone]}
            <p className="flex-1 text-slate-800">{t.message}</p>
            <button onClick={() => remove(t.id)} className="text-slate-400 hover:text-slate-600" aria-label="Dismiss">
              <X className="size-4" />
            </button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function useToast() {
  return useContext(Ctx);
}
