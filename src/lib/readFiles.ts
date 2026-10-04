import Papa from "papaparse";
import { mergeParsed, parseStudentRows, type ParseResult, type Row } from "./studentImport";

/** Read CSV / XLSX / XLS files (every sheet) and parse students from them. */
export async function parseStudentFiles(files: File[]): Promise<ParseResult> {
  const results: ParseResult[] = [];
  for (const file of files) {
    const name = file.name;
    try {
      if (/\.csv$|\.txt$/i.test(name)) {
        const text = await file.text();
        const parsed = Papa.parse<Row>(text, { skipEmptyLines: false });
        results.push(parseStudentRows(parsed.data, name));
      } else if (/\.xlsx?$|\.xlsm$|\.ods$/i.test(name)) {
        const XLSX = await import("xlsx");
        const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
        const sheets = wb.SheetNames.map((sheetName) =>
          parseStudentRows(
            XLSX.utils.sheet_to_json<Row>(wb.Sheets[sheetName], { header: 1, defval: "", raw: false }),
            `${name} › ${sheetName}`,
          ),
        );
        // Sheets without a student table (cover pages etc.) are ignored quietly when another sheet has data.
        const withData = sheets.filter((r) => r.students.length);
        if (withData.length) results.push(...withData);
        else results.push({ students: [], warnings: [`${name}: no student table found in any sheet.`] });
      } else {
        results.push({ students: [], warnings: [`${name}: unsupported file type (use .csv or .xlsx).`] });
      }
    } catch (e) {
      results.push({ students: [], warnings: [`${name}: could not be read (${(e as Error).message}).`] });
    }
  }
  return mergeParsed(results);
}
