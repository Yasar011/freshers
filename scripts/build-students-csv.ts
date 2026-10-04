/**
 * Combine the NIFT batch attendance sheets into one clean CSV for import.
 * Usage: npx tsx scripts/build-students-csv.ts <file.xlsx>... > data/students-2026.csv
 */
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import * as XLSX from "xlsx";
import { mergeParsed, parseStudentRows, type Row } from "../src/lib/studentImport";
import { toCsv } from "../src/lib/export";

const files = process.argv.slice(2);
if (!files.length) {
  console.error("Usage: npx tsx scripts/build-students-csv.ts <file.xlsx>...");
  process.exit(1);
}
const results = files.flatMap((f) => {
  const wb = XLSX.read(readFileSync(f));
  return wb.SheetNames.map((s) =>
    parseStudentRows(XLSX.utils.sheet_to_json<Row>(wb.Sheets[s], { header: 1, defval: "", raw: false }), `${basename(f)} › ${s}`),
  );
});
const merged = mergeParsed(results);
merged.warnings.forEach((w) => console.error("warning:", w));
console.error(`${merged.students.length} students`);
process.stdout.write(
  toCsv([
    ["studentId", "name", "programme", "year", "semester", "class", "photo"],
    ...merged.students.map((s) => [s.studentId, s.name, s.programme ?? "", s.year ?? "", s.semester ?? "", s.class ?? "", s.photo ?? ""]),
  ]) + "\r\n",
);
