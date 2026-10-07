"use client";
import { useEffect, useMemo, useState } from "react";
import { limitToLast, onValue, orderByChild, query, ref } from "firebase/database";
import { Search, FileText } from "lucide-react";
import { Alert, Badge, Button, Card, EmptyState, Input, Select, Spinner } from "@/components/ui";
import { PageHeader } from "@/components/admin";
import { db, errorMessage } from "@/lib/firebase";
import { downloadCsv, fileStamp, formatDateTime } from "@/lib/export";
import { dayLabel } from "@/lib/keys";
import type { AuditLog } from "@/lib/types";

const ACTION_LABELS: Record<string, [string, "slate" | "green" | "amber" | "red" | "blue" | "violet"]> = {
  score_corrected: ["Score corrected", "amber"],
  evaluation_reset: ["Evaluation reset", "red"],
  evaluation_entered_by_admin: ["Score entered by admin", "violet"],
  day_opened: ["Day opened", "green"],
  day_locked: ["Day locked", "red"],
  active_day_changed: ["Active day changed", "blue"],
  student_added: ["Student added", "blue"],
  student_updated: ["Student updated", "blue"],
  student_deleted: ["Student deleted", "red"],
  students_imported: ["Students imported", "blue"],
  evaluator_added: ["Evaluator added", "green"],
  evaluator_updated: ["Evaluator updated", "slate"],
  evaluator_activated: ["Evaluator activated", "green"],
  evaluator_deactivated: ["Evaluator deactivated", "amber"],
  evaluator_removed: ["Evaluator removed", "red"],
  settings_updated: ["Settings updated", "slate"],
  event_initialized: ["Event initialised", "green"],
  export: ["Export", "slate"],
  gender_updated: ["Gender updated", "slate"],
  gender_detected: ["Genders auto-detected", "slate"],
  finals_initialized: ["Finals set up", "green"],
  finalist_selected: ["Finalist selected", "violet"],
  finalist_removed: ["Finalist removed", "red"],
  finalists_auto_picked: ["Finalists auto-picked", "violet"],
  round_qualifiers_set: ["Qualifiers set", "violet"],
  round_opened: ["Final round opened", "green"],
  round_locked: ["Final round locked", "red"],
  round_settings_updated: ["Final settings updated", "slate"],
  judge_created: ["Judge link created", "green"],
  judge_updated: ["Judge renamed", "slate"],
  judge_activated: ["Judge link enabled", "green"],
  judge_deactivated: ["Judge link disabled", "amber"],
  judge_link_regenerated: ["Judge link regenerated", "amber"],
  judge_removed: ["Judge removed", "red"],
  final_score_corrected: ["Final score corrected", "amber"],
  final_score_reset: ["Final score reset", "red"],
  final_score_entered_by_admin: ["Final score entered", "violet"],
};

export default function AuditPage() {
  const [logs, setLogs] = useState<(AuditLog & { id: string })[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [limit, setLimit] = useState(500);
  const [q, setQ] = useState("");
  const [action, setAction] = useState("");

  useEffect(() => {
    return onValue(
      query(ref(db(), "auditLogs"), orderByChild("timestamp"), limitToLast(limit)),
      (snap) => {
        const out: (AuditLog & { id: string })[] = [];
        snap.forEach((c) => {
          out.push({ id: c.key!, ...(c.val() as AuditLog) });
        });
        setLogs(out.reverse());
      },
      (e) => setError(errorMessage(e)),
    );
  }, [limit]);

  const filtered = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return (logs ?? []).filter(
      (l) => (!action || l.action === action) && (!ql || [l.details, l.studentId, l.evaluator, l.reason, l.adminEmail].some((v) => v?.toLowerCase().includes(ql))),
    );
  }, [logs, q, action]);

  const exportCsv = () =>
    downloadCsv(`audit-log-${fileStamp()}.csv`, [
      ["Timestamp", "Action", "Student", "Evaluator", "Day", "Original", "Changed to", "Reason", "Changed by", "Details"],
      ...filtered.map((l) => [
        formatDateTime(l.timestamp),
        ACTION_LABELS[l.action]?.[0] ?? l.action,
        l.studentId ?? "",
        l.evaluator ?? "",
        l.day ? dayLabel(l.day) : "",
        l.before ?? "",
        l.after ?? "",
        l.reason ?? "",
        l.adminEmail ? `Main Admin (${l.adminEmail})` : "Main Admin",
        l.details,
      ]),
    ]);

  return (
    <div>
      <PageHeader
        title="Audit Logs"
        subtitle="Every admin change is recorded here. Entries cannot be edited or deleted from the app."
        actions={
          <Button variant="secondary" onClick={exportCsv} disabled={!filtered.length}>
            <FileText className="size-4" /> Export CSV
          </Button>
        }
      />
      <Card>
        <div className="flex flex-wrap gap-3 border-b border-slate-100 p-4">
          <div className="relative min-w-60 flex-1">
            <Search className="absolute left-3 top-2.5 size-5 text-slate-400" />
            <Input className="pl-10" placeholder="Search student, evaluator, reason…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <Select className="w-auto" value={action} onChange={(e) => setAction(e.target.value)}>
            <option value="">All actions</option>
            {Object.entries(ACTION_LABELS).map(([k, [l]]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </Select>
        </div>
        {error ? (
          <Alert tone="red" className="m-4">
            {error}
          </Alert>
        ) : logs === null ? (
          <Spinner className="py-12" />
        ) : filtered.length === 0 ? (
          <EmptyState title="No audit entries" />
        ) : (
          <ul className="divide-y divide-slate-100">
            {filtered.map((l) => {
              const [label, tone] = ACTION_LABELS[l.action] ?? [l.action, "slate"];
              return (
                <li key={l.id} className="px-5 py-3.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={tone}>{label}</Badge>
                    <span className="text-xs text-slate-500">{formatDateTime(l.timestamp)}</span>
                    <span className="ml-auto text-xs text-slate-400">Main Admin · {l.adminEmail}</span>
                  </div>
                  <p className="mt-1.5 text-sm text-slate-800">{l.details}</p>
                  {(l.before || l.after || l.reason) && (
                    <dl className="mt-2 grid gap-x-6 gap-y-1 rounded-lg bg-slate-50 px-3 py-2 text-xs sm:grid-cols-3">
                      {l.before && (
                        <div>
                          <dt className="font-semibold text-slate-500">Original</dt>
                          <dd className="tabular text-slate-800">{l.before}</dd>
                        </div>
                      )}
                      {l.after && (
                        <div>
                          <dt className="font-semibold text-slate-500">Changed to</dt>
                          <dd className="tabular text-slate-800">{l.after}</dd>
                        </div>
                      )}
                      {l.reason && (
                        <div>
                          <dt className="font-semibold text-slate-500">Reason</dt>
                          <dd className="text-slate-800">{l.reason}</dd>
                        </div>
                      )}
                    </dl>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {logs && logs.length >= limit && (
          <div className="border-t border-slate-100 p-4 text-center">
            <Button variant="secondary" onClick={() => setLimit(limit + 1000)}>
              Load older entries
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}
