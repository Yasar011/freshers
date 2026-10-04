/**
 * One-time / repeatable Firebase setup using a service-account key (never commit the key!).
 *
 *   GOOGLE_APPLICATION_CREDENTIALS=path/to/key.json node scripts/setup-firebase.mjs [options]
 *
 * Options:
 *   --rules                 Deploy database.rules.json to the Realtime Database
 *   --seed                  Create /event and /settings if they don't exist yet
 *   --students <file.csv>   Add students from a CSV (studentId,name,programme,year,semester,class,photo).
 *                           Existing students are left untouched.
 *   --domain <host>         Add an authorised domain for Google sign-in (e.g. freshers.vercel.app)
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { initializeApp, cert } = require("firebase-admin/app");
const { getDatabase, ServerValue } = require("firebase-admin/database");
const Papa = require("papaparse");

const PROJECT = "freshers-c63aa";
const DB_URL = `https://${PROJECT}-default-rtdb.firebaseio.com`;
const keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (!keyPath) {
  console.error("Set GOOGLE_APPLICATION_CREDENTIALS to the service-account JSON path.");
  process.exit(1);
}
const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n) => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined);

const app = initializeApp({ credential: cert(JSON.parse(readFileSync(keyPath, "utf8"))), databaseURL: DB_URL });
const db = getDatabase(app);
const token = async () => (await app.options.credential.getAccessToken()).access_token;

const studentKey = (id) =>
  String(id).trim().toUpperCase().replace(/\s+/g, "").replace(/[.#$\[\]\/%]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0"));

async function audit(details, action) {
  await db.ref("auditLogs").push({ action, adminUid: "setup-script", adminEmail: "setup script", timestamp: ServerValue.TIMESTAMP, details });
}

if (flag("--rules")) {
  const rules = readFileSync(new URL("../database.rules.json", import.meta.url), "utf8");
  const res = await fetch(`${DB_URL}/.settings/rules.json`, { method: "PUT", headers: { Authorization: `Bearer ${await token()}` }, body: rules });
  console.log(res.ok ? "✓ Database rules deployed" : `✗ Rules deploy failed: ${res.status} ${await res.text()}`);
  if (!res.ok) process.exit(1);
}

if (flag("--seed")) {
  const [ev, st] = await Promise.all([db.ref("event").get(), db.ref("settings").get()]);
  if (!ev.exists()) {
    await db.ref("event").set({
      name: "Freshers 2026",
      activeDay: "day1",
      totalDays: 3,
      status: "active",
      days: { day1: { label: "Day 1", status: "locked" }, day2: { label: "Day 2", status: "locked" }, day3: { label: "Day 3", status: "locked" } },
    });
    console.log("✓ /event created (3 days, all locked)");
  } else console.log("• /event already exists — left unchanged");
  if (!st.exists()) {
    await db.ref("settings").set({
      criteria: {
        makeup: { label: "Makeup", max: 10, order: 1 },
        presentation: { label: "Presentation", max: 10, order: 2 },
        styling: { label: "Styling", max: 10, order: 3 },
        dressup: { label: "Dress-up", max: 10, order: 4 },
      },
      evaluatorCount: 10,
      totalDays: 3,
    });
    console.log("✓ /settings created (4 criteria × 10 marks, 10 evaluators)");
  } else console.log("• /settings already exists — left unchanged");
  if (!ev.exists() || !st.exists()) await audit("Event and settings initialised by setup script.", "event_initialized");
}

const csvPath = opt("--students");
if (csvPath) {
  const { data } = Papa.parse(readFileSync(csvPath, "utf8").replace(/^﻿/, ""), { header: true, skipEmptyLines: true });
  const existing = (await db.ref("students").get()).val() ?? {};
  const updates = {};
  let added = 0;
  let skipped = 0;
  for (const r of data) {
    const id = String(r.studentId ?? "").trim().toUpperCase();
    const name = String(r.name ?? "").trim();
    if (!id || !name) continue;
    const key = studentKey(id);
    if (existing[key] || updates[key]) {
      skipped++;
      continue;
    }
    const s = { studentId: id, name, createdAt: ServerValue.TIMESTAMP, updatedAt: ServerValue.TIMESTAMP };
    for (const f of ["programme", "year", "semester", "class", "photo"]) if (String(r[f] ?? "").trim()) s[f] = String(r[f]).trim();
    updates[key] = s;
    added++;
  }
  if (added) await db.ref("students").update(updates);
  await audit(`Imported students from ${csvPath.split(/[\\/]/).pop()}: ${added} added, ${skipped} skipped (already existed).`, "students_imported");
  console.log(`✓ Students: ${added} added, ${skipped} already existed`);
}

const domain = opt("--domain");
if (domain) {
  const H = { Authorization: `Bearer ${await token()}`, "Content-Type": "application/json" };
  const base = `https://identitytoolkit.googleapis.com/admin/v2/projects/${PROJECT}/config`;
  const cfg = await (await fetch(base, { headers: H })).json();
  const domains = new Set(cfg.authorizedDomains ?? []);
  if (domains.has(domain)) console.log(`• ${domain} is already an authorised domain`);
  else {
    domains.add(domain);
    const res = await fetch(`${base}?updateMask=authorizedDomains`, { method: "PATCH", headers: H, body: JSON.stringify({ authorizedDomains: [...domains] }) });
    console.log(res.ok ? `✓ Authorised domain added: ${domain}` : `✗ Could not add domain: ${res.status} ${await res.text()}`);
  }
}

process.exit(0);
