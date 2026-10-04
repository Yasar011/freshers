"use client";
import { useState } from "react";
import { Wifi, WifiOff, Loader2 } from "lucide-react";
import { cn } from "./ui";
import type { ConnectionState } from "@/hooks/useConnection";
import type { Criterion, Student } from "@/lib/types";

export function ConnectionBadge({ state, compact }: { state: ConnectionState; compact?: boolean }) {
  if (state === "online")
    return (
      <span className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-200">
        <Wifi className="size-3.5" /> Online ✓
      </span>
    );
  if (state === "connecting")
    return (
      <span className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600 ring-1 ring-inset ring-slate-200">
        <Loader2 className="size-3.5 animate-spin" /> Connecting…
      </span>
    );
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full bg-rose-50 px-2.5 py-1 text-xs font-semibold text-rose-700 ring-1 ring-inset ring-rose-200">
      <WifiOff className="size-3.5" /> {compact ? "Offline" : "Connection lost"}
    </span>
  );
}

export function OfflineBanner({ state }: { state: ConnectionState }) {
  if (state !== "offline") return null;
  return (
    <div className="bg-rose-600 px-4 py-2 text-center text-sm font-semibold text-white" role="alert">
      <WifiOff className="mr-1.5 inline size-4" />
      Connection Lost — Waiting to reconnect…
    </div>
  );
}

const avatarColors = ["bg-brand-100 text-brand-700", "bg-emerald-100 text-emerald-700", "bg-amber-100 text-amber-800", "bg-rose-100 text-rose-700", "bg-sky-100 text-sky-700", "bg-violet-100 text-violet-700"];

export function StudentAvatar({ student, size = 48, className }: { student: Pick<Student, "name" | "photo" | "studentId">; size?: number; className?: string }) {
  const [broken, setBroken] = useState(false);
  const initials = student.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0])
    .join("")
    .toUpperCase();
  const color = avatarColors[(student.studentId.charCodeAt(student.studentId.length - 1) || 0) % avatarColors.length];
  if (student.photo && !broken) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={student.photo}
        alt={student.name}
        width={size}
        height={size}
        onError={() => setBroken(true)}
        className={cn("shrink-0 rounded-xl bg-slate-100 object-cover", className)}
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <div className={cn("flex shrink-0 items-center justify-center rounded-xl font-bold", color, className)} style={{ width: size, height: size, fontSize: size * 0.36 }} aria-hidden>
      {initials || "?"}
    </div>
  );
}

/** Large touch-friendly 0..max score selector. */
export function ScoreSelector({
  criterion,
  value,
  onChange,
  disabled,
}: {
  criterion: Criterion;
  value: number | null;
  onChange: (v: number) => void;
  disabled?: boolean;
}) {
  const options = Array.from({ length: criterion.max + 1 }, (_, i) => i);
  const cols = criterion.max <= 10 ? "grid-cols-6 sm:grid-cols-11" : "grid-cols-6 sm:grid-cols-11";
  return (
    <fieldset disabled={disabled} className="space-y-2">
      <div className="flex items-baseline justify-between">
        <legend className="text-sm font-bold uppercase tracking-wider text-slate-700">{criterion.label}</legend>
        <span className={cn("tabular text-lg font-bold", value === null ? "text-slate-300" : "text-brand-700")}>
          {value ?? "–"}
          <span className="text-sm font-medium text-slate-400"> / {criterion.max}</span>
        </span>
      </div>
      <div className={cn("grid gap-1.5", cols)} role="radiogroup" aria-label={criterion.label}>
        {options.map((n) => {
          const selected = value === n;
          return (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onChange(n)}
              className={cn(
                "tabular h-12 rounded-xl text-lg font-bold transition-colors active:scale-95 disabled:opacity-50",
                selected ? "bg-brand-600 text-white shadow-md ring-2 ring-brand-600 ring-offset-1" : "bg-slate-100 text-slate-700 hover:bg-slate-200",
              )}
            >
              {n}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

export function formatTime(ts?: number | null) {
  if (!ts) return "—";
  return new Date(ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function formatDateTimeShort(ts?: number | null) {
  if (!ts) return "—";
  return new Date(ts).toLocaleString([], { day: "2-digit", month: "short", hour: "numeric", minute: "2-digit" });
}
