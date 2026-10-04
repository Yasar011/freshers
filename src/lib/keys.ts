/**
 * Realtime Database keys cannot contain . # $ [ ] /
 * Student IDs like "BFT/26/001" are percent-encoded into keys ("BFT%2F26%2F001").
 * '%' itself is encoded too, so the mapping is injective.
 */
export function normalizeStudentId(id: string): string {
  return String(id ?? "").trim().toUpperCase().replace(/\s+/g, "");
}

export function studentKey(id: string): string {
  return normalizeStudentId(id).replace(/[.#$\[\]\/%]/g, (c) =>
    "%" + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0"),
  );
}

/** Alphanumeric-only form used for forgiving search ("bft 26 001" → "BFT26001"). */
export function compactId(id: string): string {
  return normalizeStudentId(id).replace(/[^A-Z0-9]/g, "");
}

/** Mirrors the security rules: auth.token.email.toLowerCase().replace('.', ',') */
export function emailKey(email: string): string {
  return String(email ?? "").trim().toLowerCase().replace(/\./g, ",");
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@#$\[\]\/]+@[^\s@#$\[\]\/]+\.[^\s@#$\[\]\/]+$/.test(email.trim());
}

export function dayKeys(totalDays: number): string[] {
  return Array.from({ length: Math.max(1, totalDays || 3) }, (_, i) => `day${i + 1}`);
}

export function dayNumber(day: string): number {
  return Number(day.replace("day", "")) || 0;
}

export function dayLabel(day: string): string {
  return `Day ${dayNumber(day)}`;
}

export function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export function evaluatorDisplayName(e: { name?: string; number?: number } | undefined | null): string {
  if (!e) return "Unknown evaluator";
  return e.name?.trim() || `Evaluator ${pad2(e.number ?? 0)}`;
}
