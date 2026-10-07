import { normalizeStudentId, studentKey } from "./keys";
import type { Student } from "./types";

export type Cell = string | number | boolean | null | undefined;
export type Row = Cell[];

export interface ParsedStudent extends Student {
  key: string;
  source: string;
}

export interface ParseResult {
  students: ParsedStudent[];
  warnings: string[];
}

const ID_RE = /(unique\s*id|student\s*id|studentid|roll\s*(no|number)?|enrol+ment|^\s*id\s*$)/i;
const SERIAL_RE = /s\.?\s*no|serial/i;

const text = (c: Cell) => (c === null || c === undefined ? "" : String(c)).replace(/\s+/g, " ").trim();

function isIdHeader(c: string) {
  return ID_RE.test(c) && !SERIAL_RE.test(c);
}

function findHeader(rows: Row[]): number {
  const limit = Math.min(rows.length, 40);
  for (let i = 0; i < limit; i++) {
    const cells = (rows[i] ?? []).map(text);
    if (cells.some(isIdHeader) && cells.some((c) => /name/i.test(c))) return i;
  }
  return -1;
}

function findCol(header: string[], re: RegExp, exclude: number[] = []): number {
  return header.findIndex((h, i) => !exclude.includes(i) && h !== "" && re.test(h));
}

/**
 * Parse one sheet (array of rows) into students.
 * Supports plain CSV/Excel files with a header row (studentId, name, programme, year, semester, class, photo)
 * and the NIFT attendance-sheet layout (title rows, then "UNIQUE ID" / "STUDENT NAME" columns).
 */
export function parseStudentRows(rows: Row[], source: string): ParseResult {
  const warnings: string[] = [];
  const h = findHeader(rows);
  if (h < 0) {
    return { students: [], warnings: [`${source}: no header row with a Student ID and Name column was found.`] };
  }
  // Header cells may be bilingual ("यूनिक आईडी/ UNIQUE ID"), so test the whole text.
  const header = rows[h].map(text);
  const idCol = header.findIndex(isIdHeader);
  const studentNameCol = findCol(header, /student\s*name/i, [idCol]);
  const nameCol = studentNameCol >= 0 ? studentNameCol : findCol(header, /name/i, [idCol]);
  const used = [idCol, nameCol];
  const progCol = findCol(header, /(programme|program|course)/i, used);
  const semCol = findCol(header, /(semester|^\s*sem\b)/i, used);
  const yearCol = findCol(header, /^\s*(year|yr)\b/i, [...used, semCol]);
  const classCol = findCol(header, /(class|section|batch|group)/i, [...used, semCol]);
  const photoCol = findCol(header, /(photo|image|picture|avatar)/i, used);

  // Context from title rows above the header (NIFT sheets).
  const title = rows
    .slice(0, h)
    .map((r) => (r ?? []).map(text).join(" "))
    .join(" \n ");
  const semMatch = title.match(/semester\s*[–—-]?\s*(\d+)/i);
  const batchMatch = title.match(/batch\s*[–—_-]?\s*(\d+)/i);
  const ctxSemester = semMatch ? semMatch[1] : "";
  const ctxBatch = batchMatch ? batchMatch[1] : "";

  const students: ParsedStudent[] = [];
  for (let i = h + 1; i < rows.length; i++) {
    const r = rows[i] ?? [];
    const rawId = text(r[idCol]);
    const name = text(r[nameCol]);
    if (!rawId && !name) continue;
    if (!rawId || !name) {
      if (rawId) warnings.push(`${source} row ${i + 1}: student ${rawId} has no name — skipped.`);
      continue;
    }
    const studentId = normalizeStudentId(rawId);
    if (studentId.length > 60 || !/[A-Z0-9]/.test(studentId)) {
      warnings.push(`${source} row ${i + 1}: invalid student ID "${rawId}" — skipped.`);
      continue;
    }
    const prefix = studentId.includes("/") ? studentId.split("/")[0] : "";
    const programme = (progCol >= 0 ? text(r[progCol]) : "") || prefix;
    const semester = (semCol >= 0 ? text(r[semCol]) : "") || ctxSemester;
    const year =
      (yearCol >= 0 ? text(r[yearCol]) : "") ||
      (semester && /^\d+$/.test(semester) ? String(Math.ceil(Number(semester) / 2)) : "");
    const klass =
      (classCol >= 0 ? text(r[classCol]) : "") || (ctxBatch ? `${programme} Batch-${ctxBatch}`.trim() : programme);
    const photo = photoCol >= 0 ? text(r[photoCol]) : "";
    const s: ParsedStudent = { key: studentKey(studentId), source, studentId, name: name.slice(0, 200) };
    if (programme) s.programme = programme.slice(0, 60);
    if (year) s.year = year.slice(0, 20);
    if (semester) s.semester = semester.slice(0, 20);
    if (klass) s.class = klass.slice(0, 60);
    if (/^https?:\/\//i.test(photo)) s.photo = photo.slice(0, 2000);
    students.push(s);
  }
  return { students, warnings };
}

/** Merge students from many sheets/files. Identical duplicates are dropped; conflicting ones are reported. */
export function mergeParsed(results: ParseResult[]): ParseResult {
  const map = new Map<string, ParsedStudent>();
  const warnings = results.flatMap((r) => r.warnings);
  for (const r of results) {
    for (const s of r.students) {
      const prev = map.get(s.key);
      if (!prev) {
        map.set(s.key, s);
      } else if (prev.name.toLowerCase() !== s.name.toLowerCase()) {
        warnings.push(
          `Duplicate ID ${s.studentId}: "${prev.name}" (${prev.source}) vs "${s.name}" (${s.source}) — kept the first.`,
        );
      }
    }
  }
  const students = [...map.values()].sort((a, b) =>
    a.studentId.localeCompare(b.studentId, undefined, { numeric: true }),
  );
  return { students, warnings };
}

export const STUDENT_FIELDS = ["studentId", "name", "programme", "year", "semester", "class", "photo"] as const;

/** True when importing `incoming` would change any stored field of `existing`. */
export function studentChanged(existing: Student, incoming: Student): boolean {
  return STUDENT_FIELDS.some((f) => (incoming[f] ?? "") !== "" && (incoming[f] ?? "") !== (existing[f] ?? ""));
}

/** Plain student record to store (drops parser-only fields). */
export function toStudentRecord(s: ParsedStudent | Student): Student {
  const out: Student = { studentId: s.studentId, name: s.name };
  if (s.gender) {
    out.gender = s.gender;
    if (s.genderConfirmed) out.genderConfirmed = true;
  }
  for (const f of ["programme", "year", "semester", "class", "photo"] as const) if (s[f]) out[f] = s[f];
  return out;
}
