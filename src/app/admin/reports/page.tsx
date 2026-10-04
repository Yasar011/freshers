"use client";
import { useMemo, useState } from "react";
import { FileSpreadsheet, FileText, Download } from "lucide-react";
import { useAdminData } from "@/context/AdminDataContext";
import { Alert, Badge, Button, Card, CardHeader } from "@/components/ui";
import { DayTabs, PageHeader } from "@/components/admin";
import { useToast } from "@/components/ui/Toast";
import { recordExport } from "@/lib/actions";
import { dailyResultsSheet, detailedEvaluationsSheet, downloadCsv, downloadXlsx, fileStamp, finalResultsSheet, type Sheet } from "@/lib/export";
import { computeDaySummary, computeFinalResults, fmt } from "@/lib/scoring";
import { dayLabel } from "@/lib/keys";

export default function ReportsPage() {
  const { students, evaluators, evaluations, settings, totalDays, days, admin, panel, activeDay, event, maxPerEvaluator } = useAdminData();
  const toast = useToast();
  const [day, setDay] = useState(activeDay);
  const [busy, setBusy] = useState<string | null>(null);
  const results = useMemo(() => computeFinalResults(students, evaluators, evaluations, settings, totalDays), [students, evaluators, evaluations, settings, totalDays]);
  const complete = results.filter((r) => r.complete).length;
  const slug = (event?.name ?? "freshers").toLowerCase().replace(/[^a-z0-9]+/g, "-");

  const sheets = {
    final: () => finalResultsSheet(results, settings, evaluators, totalDays),
    detailed: () => detailedEvaluationsSheet(students, evaluators, evaluations, settings, totalDays),
    daily: (d: string) => dailyResultsSheet(results, d),
  };

  const run = async (id: string, label: string, fn: () => Promise<void> | void) => {
    setBusy(id);
    try {
      await fn();
      recordExport(admin, label);
    } catch (e) {
      toast(`Export failed: ${(e as Error).message}`, "error");
    } finally {
      setBusy(null);
    }
  };

  const csv = (id: string, label: string, sheet: () => Sheet, name: string) => run(id, `${label} (CSV)`, () => downloadCsv(`${slug}-${name}-${fileStamp()}.csv`, sheet().rows));
  const xlsx = (id: string, label: string, list: () => Sheet[], name: string) => run(id, `${label} (Excel)`, () => downloadXlsx(`${slug}-${name}-${fileStamp()}.xlsx`, list()));

  const daySummary = computeDaySummary(day, students, panel, evaluations[day]);

  return (
    <div>
      <PageHeader title="Reports & Export" subtitle="Download results as CSV or Excel. Exports are recorded in the audit log." />
      {complete < results.length && (
        <Alert className="mb-4">
          {results.length - complete} of {results.length} students have not yet been scored by every evaluator on every day. Their scores count only the marks received so far (status <b>Partial</b> in the export).
        </Alert>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Final results" subtitle={`Day /${panel.length * maxPerEvaluator} and /100 for each day, Final /${totalDays * 100}, percentage and status.`} />
          <div className="flex flex-wrap gap-2 p-5">
            <Button loading={busy === "final-xlsx"} onClick={() => xlsx("final-xlsx", "final results", () => [sheets.final()], "final-results")}>
              <FileSpreadsheet className="size-4" /> Excel
            </Button>
            <Button variant="secondary" loading={busy === "final-csv"} onClick={() => csv("final-csv", "final results", sheets.final, "final-results")}>
              <FileText className="size-4" /> CSV
            </Button>
            <Badge tone="green" className="ml-auto self-center">
              {complete} fully evaluated
            </Badge>
          </div>
        </Card>

        <Card>
          <CardHeader title="Detailed evaluations" subtitle="Every score: student, day, evaluator, each criterion, total, timestamp and corrections." />
          <div className="flex flex-wrap gap-2 p-5">
            <Button loading={busy === "det-xlsx"} onClick={() => xlsx("det-xlsx", "detailed evaluations", () => [sheets.detailed()], "detailed-evaluations")}>
              <FileSpreadsheet className="size-4" /> Excel
            </Button>
            <Button variant="secondary" loading={busy === "det-csv"} onClick={() => csv("det-csv", "detailed evaluations", sheets.detailed, "detailed-evaluations")}>
              <FileText className="size-4" /> CSV
            </Button>
          </div>
        </Card>

        <Card>
          <CardHeader title="Daily results" subtitle="Ranked results for one day." actions={<DayTabs value={day} onChange={setDay} />} />
          <div className="space-y-3 p-5">
            <p className="tabular text-sm text-slate-600">
              {dayLabel(day)}: {daySummary.completeStudents}/{daySummary.students} students complete · {fmt(daySummary.percent)}% of evaluations done
            </p>
            <div className="flex flex-wrap gap-2">
              <Button loading={busy === "day-xlsx"} onClick={() => xlsx("day-xlsx", `${dayLabel(day)} results`, () => [sheets.daily(day)], `${day}-results`)}>
                <FileSpreadsheet className="size-4" /> Excel
              </Button>
              <Button variant="secondary" loading={busy === "day-csv"} onClick={() => csv("day-csv", `${dayLabel(day)} results`, () => sheets.daily(day), `${day}-results`)}>
                <FileText className="size-4" /> CSV
              </Button>
            </div>
          </div>
        </Card>

        <Card>
          <CardHeader title="Complete workbook" subtitle="One Excel file: final results, each day's results and every evaluation." />
          <div className="p-5">
            <Button
              variant="success"
              loading={busy === "all"}
              onClick={() => xlsx("all", "complete workbook", () => [sheets.final(), ...days.map((d) => sheets.daily(d)), sheets.detailed()], "complete-results")}
            >
              <Download className="size-4" /> Download workbook
            </Button>
          </div>
        </Card>
      </div>
    </div>
  );
}
