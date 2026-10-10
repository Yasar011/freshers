# Freshers 2026 — 3-Day Evaluation System

Next.js + Tailwind CSS + **Firebase Realtime Database** + **Firebase Authentication (Google)**, hosted on Vercel.

- **Main Admin** (`yasar.h@nift.ac.in`): dashboard, students, evaluators, day open/lock, evaluations & corrections, leaderboard, reports/export, audit logs, settings.
- **Evaluators** (Google accounts added by the admin): mobile-first scoring screen — search ID → student appears → 4 scores → submit → back to search.

## How scoring works

| | |
|---|---|
| One evaluator | Makeup + Presentation + Styling + Dress-up = **/40** |
| One day | sum of all evaluators (10 × 40 = **/400**) → **÷ 4 = /100** (e.g. 346/400 → 86.5) |
| Final | Day 1 + Day 2 + Day 3 = **/300**, percentage = final ÷ 3 |

- A day's score always counts the marks the student actually received, **out of the full panel** (10 × 40 = 400). A student seen by only 5 evaluators can get at most 200/400 = 50/100 — the more evaluators who score them, the more marks they can earn. The "x/10 evaluated" count is shown for information.
- The panel = every evaluator listed on the Evaluators page (active or deactivated). Deactivating only blocks sign-in; removing an evaluator drops their scores from the calculation (they stay in the database).
- Both the raw score (/400) and weightage (/100) are always shown and exported; the export status is "All evaluations done" or "Partial (x/y evaluations)".

## Security model (enforced in `database.rules.json`, not just the UI)

- Nothing is public: every path requires sign-in.
- **Main Admin** is identified by `auth.uid === /admin/uid`. `/admin` can be created **once**, and only by the verified Google account `yasar.h@nift.ac.in` (this happens automatically on that account's first sign-in). It can't be changed from the app afterwards — only from the Firebase console.
- **Evaluators** are identified by their verified Google email (`/evaluators/{email with . → ,}`) and must be `active`. An evaluator can:
  - read students, the event and settings, and **only their own** evaluations;
  - create an evaluation **once** per student per day (no edits/deletes), only for the **active, open** day, only for an existing student, with integer scores within each criterion's max, a correct total, and a server timestamp.
- Evaluators cannot read other evaluators' scores, the evaluator list, admin data or audit logs, and cannot change students, settings or days.
- Audit logs are append-only (cannot be edited or deleted from any client).
- `scripts/verify-rules-live.mjs` checks all of the above (61 checks) against the deployed rules.

## Data structure (Realtime Database)

```
/admin                 { uid, email, role: "main_admin", claimedAt }
/event                 { name, activeDay, totalDays, status, days/{day1..3}/{label, status: open|locked, openedAt, lockedAt} }
/settings              { criteria/{makeup|presentation|styling|dressup}/{label, max, order}, evaluatorCount, totalDays }
/students/{studentKey} { studentId, name, programme, year, semester, class, photo, photoPath }
/evaluators/{emailKey} { email, name, number, active, uid, lastLoginAt }
/evaluations/{day}/{emailKey}/{studentKey}
                       { makeup, presentation, styling, dressup, total, timestamp, studentId,
                         evaluatorName, evaluatorNumber, evaluatorUid, enteredByAdmin?, correction? }
/auditLogs/{pushId}    { action, adminUid, adminEmail, timestamp, details, studentId?, evaluator?, day?, reason?, before?, after? }
```

`studentKey` is the upper-cased Student ID with `/ . # $ [ ] %` percent-encoded (`BFT/26/001` → `BFT%2F26%2F001`), because those characters aren't allowed in database keys.
Evaluations are grouped **day → evaluator → student** so the rules can let each evaluator read exactly their own subtree.

## Running locally

```bash
npm install
npm run dev
```

`.env.local` holds the Firebase web config (see `.env.example`). The web config is not a secret; security comes from the rules.

```bash
npm test          # scoring, ID-encoding and import unit tests
npm run typecheck
npm run build
```

## Deploying

### Vercel
1. Import the GitHub repo in Vercel (framework: Next.js, defaults are fine).
2. Add the 7 `NEXT_PUBLIC_FIREBASE_*` environment variables from `.env.example` (values are in `.env.local`).
3. Deploy, then add the Vercel domain (e.g. `freshers-xyz.vercel.app`) to **Firebase Console → Authentication → Settings → Authorized domains** — otherwise Google sign-in fails with `auth/unauthorized-domain`.
   (or: `GOOGLE_APPLICATION_CREDENTIALS=key.json npm run firebase:setup -- --domain freshers-xyz.vercel.app`)

### Firebase rules & seed data
With a service-account key (**never commit it**):

```bash
GOOGLE_APPLICATION_CREDENTIALS=path/to/key.json npm run firebase:setup -- --rules --seed --students data/students-2026.csv
GOOGLE_APPLICATION_CREDENTIALS=path/to/key.json npm run firebase:verify-rules   # only before the event / before admin first sign-in
```

or with the Firebase CLI: `firebase deploy --only database` (and `--only storage` once Storage is enabled).

### Student photos (optional)
Photo upload uses Firebase Storage, which must be enabled in the console (it requires the Blaze plan). Then deploy `storage.rules`. Without Storage you can still paste an image URL per student, or include a `photo` URL column in the CSV.

## Finals (Final 20 → winners)

Admin → **Finals** (4 steps):

1. **Finalists** — the Final 20 = top 10 boys + top 10 girls from the 3-day results. Use **Auto-pick top scorers**, add anyone by hand, or press the ⭐ / **Select for Finals** button on a student's profile (Students page) or on the Leaderboard. Boys/girls come from the student's gender (**Students → Auto-detect genders** reads the first names; guesses it isn't sure about go to a review list, and every gender can be changed with one tap).
2. **Judges** — create one personal link per judge (3 to 6). The judge opens it on a phone with **no login** (it signs them in anonymously and ties the browser to that judge) and sees only the finalists. Links can be copied, sent on WhatsApp, disabled, regenerated (old link stops working) or removed.
3. **Rounds** — Fashion Walk → Talent Round → Question & Answer. Open/lock each round like the days. After Walk and after Talent, **Eliminate lowest 3 boys + 3 girls** recommends who is out (the lowest scorers of each gender; you can change anyone by hand, and the count is editable in each round's *Settings*). With 10 boys + 10 girls that gives 10 → 7 → 4 of each, so Q&A has 4 boys + 4 girls. Criteria per round (each /10 by default, editable, max 6): Walk — Confidence & Walk, Relevance to Theme, Overall Impact; Talent — Creativity & Talent, Relevance to Theme, Overall Impact; Q&A — Content of Answer, Communication & Clarity, Confidence & Poise, Overall Impact. Judges confirm before submitting; scores can only be changed by the admin (correct / reset / enter, all audited).
4. **Results** — Winner and Runner-up for boys and for girls. Final = weighted average (equal weights by default) of the three rounds, each round out of the whole judge panel like the evaluator rule; ties → higher Q&A score → higher 3-day score. Print, or export Excel/CSV.

Contestant numbers can be edited by clicking the number in the Finalists table (typing a number that is taken swaps the two; not allowed once a judge has scored that contestant).

Finals security (see `database.rules.json`): judges are anonymous users whose session is bound to their link token; they can read only the finalists/config and their own scores, and write one score per contestant, only in the open round, only for contestants taking part, with integer scores inside each criterion's maximum. `npm run firebase:verify-finals` runs 100+ live checks against the deployed rules (it refuses to run if finals data already exists).

## Event-day checklist

1. Main Admin signs in with Google at the site → becomes Main Admin automatically.
2. **Students** — already imported (189 from the NIFT batch sheets). More can be imported from `.xlsx` / `.csv` (the NIFT attendance layout is recognised automatically) or added by hand.
3. **Evaluators** — add the 10 Google emails (numbers 01–10 are assigned automatically).
4. Ask each evaluator to sign in on their phone and check they see "Evaluator NN · DAY 1 · Locked".
5. **Day Management → Open Day 1.** Watch the dashboard. Click an evaluator to see who they still have to score.
6. When done: **Lock Day 1 → Open Day 2** … **Lock Day 3**.
7. **Leaderboard** and **Reports** → download the final results / complete workbook.

### Network problems
The top of every screen shows **Online ✓** or **Connection Lost**. If an evaluator submits while offline, the screen says *"Waiting for connection to sync"* — it is **not** shown as saved until the server confirms. Keep the page open; it syncs automatically when the connection returns (closing the tab warns before losing unsynced scores). If the server rejects a submission (day locked, already evaluated on another device), a red **NOT SAVED** card stays on screen.

## Regenerating the student CSV

```bash
npm run students:csv -- Batch-FPT.xlsx Batch-1.xlsx Batch-2.xlsx Batch-3.xlsx Batch-4.xlsx > data/students-2026.csv
```
