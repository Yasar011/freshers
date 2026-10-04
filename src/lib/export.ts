import { CRITERIA_KEYS, type Evaluator, type EvaluationsTree, type Settings, type Student } from "./types";
import { dayKeys, dayLabel, evaluatorDisplayName } from "./keys";
import { panelOf, perEvaluatorMax, round2, type FinalResult } from "./scoring";

export type SheetRow = (string | number | null)[];
export interface Sheet {
  name: string;
  rows: SheetRow[];
}

export function formatDateTime(ts?: number | null): string {
  if (!ts) return "";
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export function finalResultsSheet(
  results: FinalResult[],
  settings: Settings | null,
  evaluators: Record<string, Evaluator>,
  totalDays: number,
): Sheet {
  const days = dayKeys(totalDays);
  const rawMax = panelOf(evaluators).length * perEvaluatorMax(settings);
  const header: SheetRow = ["Rank", "Student ID", "Name", "Programme", "Class"];
  for (const d of days) header.push(`${dayLabel(d)} /${rawMax}`, `${dayLabel(d)} /100`);
  header.push(`Final /${days.length * 100}`, "Percentage", "Status");
  const rows: SheetRow[] = [header];
  for (const r of results) {
    const row: SheetRow = [r.rank ?? "", r.student.studentId, r.student.name, r.student.programme ?? "", r.student.class ?? ""];
    for (const d of days) {
      const dr = r.days[d];
      row.push(dr.rawTotal, dr.score100 ?? "");
    }
    const done = days.reduce((n, d) => n + r.days[d].completedCount, 0);
    const required = days.reduce((n, d) => n + r.days[d].requiredCount, 0);
    row.push(r.final ?? "", r.percentage ?? "", r.complete ? "All evaluations done" : `Partial (${done}/${required} evaluations)`);
    rows.push(row);
  }
  return { name: "Final Results", rows };
}

export function dailyResultsSheet(results: FinalResult[], day: string): Sheet {
  const header: SheetRow = ["Rank", "Student ID", "Name", "Programme", "Class", "Evaluations", "Raw Score", "Raw Max", "Daily /100", "Status"];
  const ranked = [...results].sort((a, b) => {
    const sa = a.days[day]?.score100 ?? null;
    const sb = b.days[day]?.score100 ?? null;
    if (sa !== null && sb !== null) return sb - sa;
    if (sa !== null) return -1;
    if (sb !== null) return 1;
    return a.student.studentId.localeCompare(b.student.studentId, undefined, { numeric: true });
  });
  const rows: SheetRow[] = [header];
  let prev: number | null = null;
  let prevRank = 0;
  ranked.forEach((r, i) => {
    const dr = r.days[day];
    let rank: number | string = "";
    if (dr.score100 !== null) {
      rank = prev !== null && dr.score100 === prev ? prevRank : i + 1;
      prev = dr.score100;
      prevRank = rank;
    }
    rows.push([
      rank,
      r.student.studentId,
      r.student.name,
      r.student.programme ?? "",
      r.student.class ?? "",
      `${dr.completedCount}/${dr.requiredCount}`,
      dr.rawTotal,
      dr.rawMax,
      dr.score100 ?? "",
      dr.complete ? "All evaluations done" : "Partial",
    ]);
  });
  return { name: `${dayLabel(day)} Results`, rows };
}

export function detailedEvaluationsSheet(
  students: Record<string, Student>,
  evaluators: Record<string, Evaluator>,
  evaluations: EvaluationsTree | null,
  settings: Settings | null,
  totalDays: number,
): Sheet {
  const labels = CRITERIA_KEYS.map((k) => settings?.criteria?.[k]?.label ?? k);
  const header: SheetRow = [
    "Student ID",
    "Student Name",
    "Day",
    "Evaluator",
    "Evaluator Email",
    ...labels,
    "Total",
    "Timestamp",
    "Corrected",
    "Correction Reason",
    "Entered By Admin",
  ];
  const rows: SheetRow[] = [header];
  const studentList = Object.entries(students).sort((a, b) =>
    a[1].studentId.localeCompare(b[1].studentId, undefined, { numeric: true }),
  );
  const panel = panelOf(evaluators);
  for (const d of dayKeys(totalDays)) {
    const dayEvals = evaluations?.[d] ?? {};
    const evaluatorKeys = [...panel.map((p) => p.key), ...Object.keys(dayEvals).filter((k) => !evaluators[k])];
    for (const [sk, s] of studentList) {
      for (const ek of evaluatorKeys) {
        const ev = dayEvals[ek]?.[sk];
        if (!ev) continue;
        const evaluator = evaluators[ek];
        rows.push([
          s.studentId,
          s.name,
          dayLabel(d),
          evaluator ? evaluatorDisplayName(evaluator) : `${ev.evaluatorName} (removed)`,
          evaluator?.email ?? ek.replace(/,/g, "."),
          ...CRITERIA_KEYS.map((k) => ev[k]),
          ev.total,
          formatDateTime(ev.timestamp),
          ev.correction ? `Yes (was ${ev.correction.originalTotal})` : "No",
          ev.correction?.reason ?? "",
          ev.enteredByAdmin ? "Yes" : "No",
        ]);
      }
    }
  }
  return { name: "Detailed Evaluations", rows };
}

function csvCell(v: string | number | null): string {
  if (v === null || v === undefined) return "";
  let s = typeof v === "number" ? String(round2(v)) : String(v);
  // Prevent spreadsheet formula injection from text cells.
  if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: SheetRow[]): string {
  return rows.map((r) => r.map(csvCell).join(",")).join("\r\n");
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function downloadCsv(filename: string, rows: SheetRow[]) {
  // BOM so Excel opens UTF-8 (Hindi names etc.) correctly.
  triggerDownload(new Blob(["﻿" + toCsv(rows)], { type: "text/csv;charset=utf-8" }), filename);
}

export async function downloadXlsx(filename: string, sheets: Sheet[]) {
  const XLSX = await import("xlsx");
  const wb = XLSX.utils.book_new();
  for (const s of sheets) {
    const ws = XLSX.utils.aoa_to_sheet(s.rows);
    const widths = s.rows[0]?.map((_, c) => ({
      wch: Math.min(40, Math.max(8, ...s.rows.slice(0, 200).map((r) => String(r[c] ?? "").length + 2))),
    }));
    ws["!cols"] = widths;
    XLSX.utils.book_append_sheet(wb, ws, s.name.slice(0, 31));
  }
  XLSX.writeFile(wb, filename);
}

export function fileStamp(): string {
  return formatDateTime(Date.now()).replace(/[: ]/g, "-");
}
