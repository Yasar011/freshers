import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import * as XLSX from "xlsx";
import { mergeParsed, parseStudentRows, type Row } from "@/lib/studentImport";
import { compactId, emailKey, studentKey } from "@/lib/keys";

describe("keys", () => {
  it("encodes student IDs into valid, unique database keys", () => {
    expect(studentKey("bft/26/001")).toBe("BFT%2F26%2F001");
    expect(studentKey(" BD/26/AR/34 ")).toBe("BD%2F26%2FAR%2F34");
    expect(studentKey("A_1")).not.toBe(studentKey("A/1"));
    expect(studentKey("A%2F1")).not.toBe(studentKey("A/1"));
    expect(studentKey("X.Y#Z$[1]")).not.toMatch(/[.#$\[\]\/]/);
  });
  it("matches the security-rules email key", () => {
    expect(emailKey("Yasar.H@NIFT.ac.in")).toBe("yasar,h@nift,ac,in");
  });
  it("compacts IDs for forgiving search", () => {
    expect(compactId("bft 26 001")).toBe("BFT26001");
  });
});

describe("student import", () => {
  it("parses a plain CSV-style sheet", () => {
    const rows: Row[] = [
      ["studentId", "name", "programme", "year", "semester", "class", "photo"],
      ["BFT/26/001", "Rahul", "BFT", 1, 1, "BFT-A", ""],
      ["", "", "", "", "", "", ""],
      ["BFT/26/002", "Aisha", "BFT", 1, 1, "BFT-A", "https://example.com/a.jpg"],
    ];
    const r = parseStudentRows(rows, "test.csv");
    expect(r.students).toHaveLength(2);
    expect(r.students[0]).toMatchObject({ studentId: "BFT/26/001", name: "Rahul", programme: "BFT", year: "1", semester: "1", class: "BFT-A" });
    expect(r.students[1].photo).toBe("https://example.com/a.jpg");
  });

  it("parses the NIFT attendance layout", () => {
    const rows: Row[] = [
      ["National Institute of Fashion Technology, Jodhpur"],
      ["Foundation Program Department Design_Batch-2 (2026-2030)"],
      ["Semester –1 (July to December 2026)"],
      ["Faculty :", "", "", "Subject:"],
      ["क्र. स.\nS. No.", "यूनिक आईडी/\nUNIQUE ID", "विद्यार्थी का नाम/\nSTUDENT NAME", "सत्र 1\nSession 1"],
      ["", "", "", "     /     /26"],
      [1, "BD/26/9999", "Test Student  ", ""],
      [2, "BD/26/N9999", "Another Student", ""],
      ["", "", "", "", "दिनांक/Date-"],
    ];
    const r = parseStudentRows(rows, "Batch-2.xlsx");
    expect(r.warnings).toEqual([]);
    expect(r.students).toHaveLength(2);
    expect(r.students[0]).toMatchObject({ studentId: "BD/26/9999", name: "Test Student", programme: "BD", semester: "1", year: "1", class: "BD Batch-2" });
    expect(r.students[1].studentId).toBe("BD/26/N9999");
  });

  it("merges duplicate sheets", () => {
    const a = parseStudentRows([["Student ID", "Name"], ["X/1", "A"]], "a");
    const b = parseStudentRows([["Student ID", "Name"], ["X/1", "A"], ["X/2", "B"]], "b");
    const m = mergeParsed([a, b]);
    expect(m.students).toHaveLength(2);
    expect(m.warnings).toEqual([]);
  });

  const DOWNLOADS = "C:/Users/HP/Downloads";
  const files = ["Batch-FPT", "Batch-1", "Batch-2", "Batch-3", "Batch-4"].map((f) => `${DOWNLOADS}/${f}.xlsx`);
  it.skipIf(!files.every(existsSync))("parses the real NIFT batch files (189 students)", () => {
    const results = files.flatMap((f) => {
      const wb = XLSX.read(readFileSync(f));
      return wb.SheetNames.map((s) => parseStudentRows(XLSX.utils.sheet_to_json<Row>(wb.Sheets[s], { header: 1, defval: "", raw: false }), `${f} › ${s}`));
    });
    const merged = mergeParsed(results);
    expect(merged.warnings).toEqual([]);
    expect(merged.students).toHaveLength(189);
    const fpt = merged.students.filter((s) => s.programme === "BFT");
    expect(fpt).toHaveLength(31);
    expect(new Set(merged.students.map((s) => s.class))).toEqual(new Set(["BFT", "BD Batch-1", "BD Batch-2", "BD Batch-3", "BD Batch-4"]));
  });
});
