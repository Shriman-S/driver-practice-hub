# DriveLab Technical Project Brief

## Goal and intended outcome

The goal is to replace a team's Google Form and Google Sheet workflow for FRC driver practice with a web application that is clear enough to use beside a practice field. The user wants each student's driving evidence organized by facet, accurately scored, easy to compare over time, accessible as a public website, and protected from casual exposure of students' full names and grade levels.

The system supports three current REBUILT-season facets: Speed Driving, Defensive Driving, and Offensive Driving. (Shooting Only was part of the original design and was removed in Update 47.) Defensive and offensive practice is one physical paired session but produces two independent driver records, so a defensive driver's performance never gets mixed into an offensive driver's analysis. The design also leaves room for future drills, layouts, calendar planning, and printable snapshots.

## Requirements translated into the implementation

- Build three preconfigured forms matching the supplied questions, including embedded stopwatch/countdown use (four originally; Shooting Only was removed in Update 47). Administrators can edit them (Update 50).
- Compute each facet score from the supplied benchmark and weighted scoring explanation.
- Rank drivers using the supplied coverage-first method so broad development outranks a single isolated result.
- Keep the public workflow limited to form submission and calendar viewing; require real administrator authorization for data analysis, course building, and form configuration.
- Provide a drag-and-drop wall-layout editor, with course families for speed and a shared defensive/offensive course (a shooting family existed until Update 47).
- Provide a monthly calendar, a browser-native PDF export path, name entry, comments, clean organization, GitHub-ready files, and no required paid tool.

## Methodologies and coding techniques

### Static-first deployment

The app is plain HTML, CSS, and JavaScript modules. It has no build process, framework lock-in, package installation, ads, analytics, server runtime, or secret embedded in source code. That makes GitHub Pages a practical free host and keeps the code inspectable in VS Code.

### Separation of concerns

`constants.js` stores the original form definitions (`drillforms.js` turns them into editable forms). `scoring.js` is a small collection of pure mathematical functions. `storage.js` abstracts persistence. `app.js` handles UI state and event binding. `styles.css` contains visual styling only. This structure prevents form-rendering logic, security logic, and numerical formulas from becoming a single hard-to-audit file.

### Auditable scoring

The score calculations cap components to a 0-10 range. Speed uses a linear 15-second excellent and 30-second slow cutoff, lap consistency, and penalty reduction. Defense benchmarks 6 score preventions, 4 fuel preventions, and 30 seconds wasted. Offense uses the supplied 30 shots, 20 scored, 5 evasions, and accuracy benchmarks. Overall ranking uses the coverage-first formula (with three facets: 10/3 × (K − 1) + 0.3233 × average + 0.01 when all three are complete; see Update 48) and the latest attempt within every completed facet. These defaults can be changed on the Scoring settings page.

### Privacy and security by design

Full names, grades, notes, and submissions are never included in source control, hardcoded sample data, a public list, or client-side search results. Local name convenience is a single browser's `localStorage` value. It deliberately does not construct a shared name directory, which would unnecessarily expose student information.

The production storage option uses Firebase Authentication and Firestore. Anonymous users receive a non-identifying Firebase identity solely to create a submission. Firestore rules permit them to create only an entry whose owner ID matches their identity and deny all reads. Google-authenticated accounts become administrators only when their UID appears in the `admins` collection. The Firestore rule is evaluated by Firebase's server, so inspecting or changing the page's JavaScript cannot grant access. The frontend's hidden admin navigation is therefore a usability layer, not the security control.

### Defensive client coding

User-provided strings are HTML-escaped before inclusion in generated views, form inputs are constrained and validated, note lengths are capped, and the Firestore rule restricts submitted keys and name length. The source contains no password, token, or personal data. HTTPS is provided automatically by GitHub Pages and Firebase.

### PDF technique

The browser's print implementation produces the PDF rather than relying on a commercial API or a large client-side PDF package. It presents the administrator's current analysis view, and the browser's generated PDF metadata/print header records the export time. This route is universally available in standard desktop browsers at no charge.

## Technical construction flow

1. The static page loads a dashboard shell and imports application modules using standard browser ES modules.
2. The storage adapter checks whether a Firebase configuration exists. With none, it loads a local data structure from `localStorage` for safe inspection. With a configuration, it imports version-pinned Firebase SDK modules over HTTPS and signs public recorders in anonymously.
3. The Practice view renders one of four data-driven form definitions. It adds grade and date fields, relevant facet fields, non-scoring coaching observations, and the appropriate native timer interface.
4. On submission, the app validates fields, computes a facet score without round-tripping to the network, remembers the just-entered name locally, and sends only the bounded submission document to the selected storage adapter.
5. An administrator reads submissions through Firestore rules. The analysis view groups entries by driver, retains the latest result in every facet, produces summary scores, sorts the leaderboard, and renders both a spreadsheet table and visual comparison bars.
6. The calendar uses normal date arithmetic to lay out a six-week monthly grid. Public readers can inspect events; an administrator can write events.
7. The course builder stores normalized wall coordinates and orientation. HTML drag events place and reposition wall pieces on a grid background; the layout is saved per course family.
8. Print export calls `window.print()` from the analysis view, keeping a portable PDF process entirely in the browser.

## Deployment boundary

GitHub Pages alone cannot securely enforce username/password authentication or protect a data collection because it has no private server runtime. This project does not pretend otherwise. A team should configure the included free Firebase layer and deploy `firestore.rules` before collecting real student data. The Spark plan may change and has finite no-cost quotas; the mentor should monitor it and avoid paid-only features. This is a purposeful tradeoff: strong server-enforced access control and shared data while retaining free static hosting.

## Updates

This section is a running log of changes made after the original brief above. Each entry states the problem with the previous version, a plain-language summary of the fix, the technical detail, and the files affected. The Firebase setup, testing, and secret-handling walkthrough was delivered as written guidance and needed no source change; Updates 3 to 5 are Firebase-mode defects that were found and fixed while preparing and testing that guidance.

### Update 1: "Lap Split" button on the Speed stopwatch

**Problem with the previous version:** The recorder had to watch the stopwatch, judge when the first lap ended, and type the first lap split, the second lap split, and the total drive time into the form by hand. This was slow and imprecise, because a person reading a running clock and then typing is always a little late.

**How it was fixed (simple):** The Speed stopwatch now has a large **Lap Split** button. The first press copies the current stopwatch reading into "First lap split (seconds)". The second press puts the current reading minus the first split into "Second lap split (seconds)". If the recorder presses **Stop** instead of a second Lap Split, the second split is filled in the same way. Pressing Stop always copies the final reading into "Total drive time (seconds)". Nothing needs to be typed, although every box can still be typed in or corrected by hand.

**How it was fixed (technical detail):**

- `timerHtml(kind)` now renders `<button id="timer-lap">Lap Split</button>` for the stopwatch only (countdown drills are unchanged). The button starts disabled, is enabled only while the stopwatch runs, and is disabled again once both splits exist or the timer is stopped. The help line under the timer has an `id` (`timer-help`) and is rewritten at each step to tell the recorder what to press next.
- `bindTimer()` was rewritten from a single dense line into a commented, multi-line function. New closure state: `lapsRecorded` (0, 1, or 2), `lap2FromStop` (whether lap 2 came from Stop rather than Lap Split), `firstSplit` (fallback copy of the first split), and `written` (the text this code last wrote into each box).
- A `settle()` helper adds the time since the last animation frame (`performance.now() - last`) to the stopwatch value immediately before any reading is taken. Animation frames only update the value about every 16 ms, so without this the recorded number could lag the actual button press.
- Readings are converted with `Math.round(ms / 10) / 100` and written with `toFixed(2)`, so boxes hold hundredths of a second (the on-screen display still shows tenths). Lap 2 is `Math.round((reading - firstSplit) * 100) / 100`, where the first split is read from the box if it is a valid number (so a manual correction is honored) and otherwise from the captured fallback value.
- On Stop (the toggle button, which now reads **Stop** while the stopwatch runs and **Pause** while a countdown runs), `finishRun()` writes `totalTime` and, only if exactly one split exists, writes `lap2` and sets `lap2FromStop`. A lap 2 already set by the second Lap Split press is never overwritten by Stop.
- If the stopwatch is started again after a Stop, `resumeRun()` treats the run as unfinished: it clears the total and any lap 2 that came from Stop (but keeps a lap 2 from the Lap Split button). It only clears text that still equals what the timer wrote, so values typed by a person are never erased.
- `resetTimer()` (used by the timer's Reset button, the form's Clear button via a `reset` event listener on `#practice-form`, and a successful submission, which calls `form.reset()`) returns the timer to zero, clears the three timing boxes, and resets the lap state. Previously Clear and submit left the timer showing the old time. This also applies to countdown drills, which now return to 01:30.0 after Clear or a successful submission.
- `cancelAnimationFrame(state.timer)` is called when stopping or resetting so a stray animation-frame callback cannot keep running.
- `js/constants.js`: the three field labels are unchanged; help text was added to the lap and total fields describing how the buttons fill them.
- `css/styles.css`: `.button-lap` (larger, blue, with a dimmed disabled state); `.timer` now wraps (`flex-wrap`) so the extra button fits on phone-width screens, and `.timer .help` flexes to fill the remaining space.

**Files affected:** `js/app.js`, `js/constants.js`, `css/styles.css`

### Update 2: "Second lap split" now means the length of lap 2, so the pace score was corrected

**Problem with the previous version:** The scoring code treated the "Second lap split" box as a running total and subtracted the first lap from it (`lap2 - lap1`). The Lap Split feature in Update 1 fills that box with the length of the second lap itself (current reading minus the first split). Leaving the scoring unchanged would have subtracted the first lap twice and quietly produced a wrong lap-consistency (pace) score, and therefore a wrong Speed score, for every submission.

**How it was fixed (simple):** Both lap boxes now hold the length of that lap, and the scoring uses the second box as it is, with no further subtraction.

**How it was fixed (technical detail):** In `scoreSubmission()` (speed branch) the line `const lapTwo = Number(d.lap2) - lapOne;` became `const lapTwo = Number(d.lap2);`, with a comment explaining the meaning of each box. The pace formula, weights (70% time, 10% pace, 20% penalties), and benchmarks are unchanged. Scores already saved were calculated and stored at submission time and are not recalculated, so past records are unaffected. Anyone who still types the second lap split by hand should now enter the length of lap 2 alone; the help text under the box says so.

**Files affected:** `js/scoring.js`, `js/constants.js` (help text)

### Update 3: Practice and calendar-event forms could not save anything

**Problem with the previous version:** Clicking "Submit practice" did nothing. The form builder helper `field()` gave every input an `id` but no `name`. Browsers' `FormData` only includes controls that have a `name`, so the submit handler received an empty object and failed with "Cannot read properties of undefined (reading 'trim')" before any score was calculated or saved. The "Add practice" calendar form used the same helper and had the same problem (its title and date came back empty).

**How it was fixed (simple):** Every form box now has a name that matches its id, and the notes box has a name too, so the entered values are collected and saved.

**How it was fixed (technical detail):** In `field()` the generated `<input>` and `<select>` now include `name="${name}"`, and the coaching-notes `<textarea>` in `renderPractice()` now includes `name="notes"`. `Object.fromEntries(new FormData(form))` therefore contains `driverName`, `grade`, `practiceDate`, the facet's fields, and `notes`, which the existing `submitPractice()`, `scoreSubmission()`, and event-form handlers already expected. The set of top-level keys sent to Firestore was verified to match the allow-list in `firestore.rules` exactly (`id, facet, driverName, grade, date, data, score, createdAt, userId`).

**Files affected:** `js/app.js`

### Update 4: The app stopped working for ordinary visitors once Firebase was configured

**Problem with the previous version:** With Firebase enabled, the page loaded all of its data before attaching the click handlers to the navigation and "Administrator sign in" buttons. The data load asked Firestore for the `courses` and `customForms` collections, which the security rules (correctly) deny to everyone except administrators. That request failed, the error aborted startup, and the handlers were never attached. The result was that the navigation did nothing and the sign-in dialog could not be opened, so nobody could ever sign in as an administrator.

**How it was fixed (simple):** The buttons are now wired up first, and visitors who are not administrators only request the public calendar data, which the rules allow.

**How it was fixed (technical detail):** In `init()` the `.nav-link` and `#admin-button` handlers are now bound before any network call, so a Firebase problem can no longer leave the interface dead. On failure, the sidebar status now reads "Storage setup failed - see browser console" in addition to the existing toast. In `storage.loadAll()`, `events` is always requested, while `courses`, `customForms`, and `submissions` are requested only when `remote.admin` is true (through a small `adminOnly()` helper that resolves to `null` otherwise), and `null` results map to empty values. Behavior for administrators and for local preview mode is unchanged.

**Files affected:** `js/app.js`, `js/storage.js`

### Update 5: Clear message for a Google account that is not an administrator

**Problem with the previous version:** After Google sign-in, the code read that account's document in the `admins` collection to find out whether it was an administrator. The security rules only allow that document to be read by an account that is already an administrator, so for anyone else the read was rejected and the person saw the raw "Missing or insufficient permissions" error instead of the intended "not on the administrator allow-list" message.

**How it was fixed (simple):** A rejected read is now correctly treated as "this account is not an administrator", and the intended message is shown.

**How it was fixed (technical detail):** In `storage.signInAdmin()` the `getDoc` call on `admins/{uid}` is wrapped in `try/catch`. An error whose `code` is `permission-denied` sets `remote.admin = false`; any other error (for example, a network failure) is re-thrown so it is not mistaken for a normal denial. The existing check in `openAdmin()` then displays "This Google account is not on the administrator allow-list." Access control itself is unchanged: it is enforced by `firestore.rules` on Firebase's servers.

**Files affected:** `js/storage.js`

### Update 6: Analysis tab view selector with General statistics and per-facet views

**Problem with the previous version:** The Analysis tab could only show detail for whichever drill was selected on the Practice form tab, so an administrator had to leave Analysis, change the Practice form's drill, and come back to look at a different facet. There was also no overview of statistics across all four facets.

**How it was fixed (simple):** Analysis now has its own **View** dropdown with five choices: General statistics (all facets), Speed driving, Defensive driving, Offensive driving, and Shooting only. General statistics shows summary numbers for every facet, the driver leaderboard that uses the coverage-first overall score, and a table explaining the score bands. Each facet choice shows that facet's standings, statistics, and every attempt with its raw values. The Analysis selection is independent of the Practice form.

**How it was fixed (technical detail):**

- New state value `state.analysisView` (default `"general"`), separate from `state.facet`, which still belongs to the Practice and Course builder screens. Changing the dropdown updates `state.analysisView` and calls `render()`; `bindAnalysis()` attaches that handler, the export button, and the Delete buttons (Update 9).
- The single-line `renderAnalysis()` was replaced by readable, commented functions: `renderAnalysis()` (header, dropdown, dispatch), `analysisGeneral()`, `analysisFacet()`, and helpers `driverRows()`, `facetStats()`, `attemptsTable()`, and `metricTile()`.
- General statistics: metric tiles (recorded attempts, drivers assessed, top overall score, drivers who completed all four facets); a per-facet table (attempts, distinct drivers, average score, best score and which driver); the leaderboard, now full width so the Overall column is no longer hidden by horizontal scrolling; Top performers; a reference table of score bands (1 facet 0.00-2.49, 2 facets 2.50-4.99, 3 facets 5.00-7.49, 4 facets 7.51-10.00); and a list of all attempts.
- The overall score still comes from `driverSummary()` in `scoring.js`, which was not changed: `2.5 x (K - 1) + 0.249 x A`, plus 0.01 when all four facets are complete, using each driver's most recent attempt in every completed facet. It was checked against the stated examples (a driver with only Speed = 10 scores 2.49; a driver with 6, 6, 6, 6 scores 9.00) and the band edges (7.49 for three perfect facets, 7.51 for four facets all scoring zero).
- Facet view: metric tiles (attempts, drivers, average, best), a standings table per driver (attempts, latest, best, average, ranked by latest attempt because that is the score that counts toward the overall ranking), and an attempts table whose columns are generated from that facet's numeric fields in `FACETS`, plus observations and notes.
- A driver's grade in the leaderboard now comes from their most recent attempt by `createdAt` (previously the last item in the list, which is arbitrary order when the data comes from Firestore).
- `css/styles.css`: `.hero-actions`, `.view-picker`, `.note-cell`, `.nowrap`, and a `@media print` rule that hides the dropdown, export button, and Delete buttons from the printed PDF.

**Files affected:** `js/app.js`, `css/styles.css`

### Update 7: "Log out" button for administrators

**Problem with the previous version:** After signing in as an administrator there was no way to return to guest recorder mode without closing the tab. The header button only said "Admin active" and did nothing, so analysis data stayed on screen on a shared device.

**How it was fixed (simple):** While signed in as an administrator, the header button now reads **Log out**. Clicking it signs the administrator out, returns the site to guest recorder mode, hides the administrator pages, clears administrator data from the page, and returns to the Practice form. The person can keep recording practices as a guest, and the administrator can sign back in.

**How it was fixed (technical detail):**

- `storage.signOutAdmin()` calls Firebase `signOut`, clears `remote.admin` and `remote.user`, and then creates a fresh anonymous guest identity through a new `ensureGuest()` helper. If the guest sign-in fails (for example, no network), logout still succeeds and `addSubmission()` calls `ensureGuest()` again before the next submission.
- `logout()` in `app.js` stores the returned guest session, reloads data with `storage.loadAll()` (which, for a non-administrator, requests only the public calendar, so submissions, courses, and custom forms are dropped from memory), calls `updateAccount()` (hiding `.admin-only` navigation and resetting the button and label), and calls `setRoute("practice")`.
- The `#admin-button` handler now chooses between `logout()` and `openAdmin()` based on `state.session.isAdmin`, and `updateAccount()` sets the button text to "Log out" or "Administrator sign in".
- Google sign-in now sets the provider parameter `prompt: "select_account"`, so after logging out the account chooser always appears instead of silently reusing the previous Google account.
- Access control is unchanged: it remains enforced by `firestore.rules` on Firebase's servers. Logging out removes the Firebase credential, so the browser can no longer read administrator-only data.

**Files affected:** `js/app.js`, `js/storage.js`

### Update 8: Lap Split can be pressed only once; Stop calculates lap 2 (replaces the second-press behavior from Update 1)

**Problem with the previous version:** Lap Split could be pressed a second time to record the end of lap 2, which let the recorder press it more than once and left more than one way to finish a run.

**How it was fixed (simple):** Lap Split can now be pressed only once per run, at the end of lap 1. When it is pressed, it fills "First lap split (seconds)" and then disappears. The only controls left are the Start/Stop button and Reset. When the recorder presses **Stop** after the driver finishes lap 2, the site calculates the length of lap 2 (final time minus first lap split) and fills it into "Second lap split (seconds)", and the final time is filled into "Total drive time (seconds)". Reset brings Lap Split back for the next run.

**How it was fixed (technical detail):**

- In `bindTimer()`, the `lapsRecorded` counter (0, 1, 2) and `lap2FromStop` flag were replaced by a single boolean `lapTaken`. The Lap Split handler now only handles the first press: it takes an exact reading with `settle()`, writes `lap1`, sets `lapTaken`, and returns early on any later call.
- A new `syncLapButton()` sets `lapButton.hidden = lapTaken` and `lapButton.disabled = !running`. The button is visible but disabled before Start, enabled while running, and hidden after its single use or until Reset. It is called from the Start/Stop handler, the Lap Split handler, and `resetTimer()`.
- `finishRun()` (on Stop) always writes `totalTime` and, when `lapTaken` is true, writes `lap2 = round2(total - firstSplit)`, where the first split is read from its box so a manual correction is honored. Stopping before ever pressing Lap Split fills only the total.
- If the stopwatch is started again after a Stop, `resumeRun()` withdraws the total and lap 2 (only if they still hold what the timer wrote, so typed values are never erased); the first split is kept and Lap Split stays hidden. Stopping again recalculates both.
- The help text under the timer and the help text for the lap fields in `constants.js` were updated to describe the new sequence. Scoring is unchanged: `scoring.js` still treats both lap boxes as lap lengths (Update 2).

**Files affected:** `js/app.js`, `js/constants.js`

### Update 9: Administrators can delete driver attempts

**Problem with the previous version:** There was no way to remove a mistaken or test attempt. Every attempt, including bad data, stayed in the leaderboard and statistics permanently.

**How it was fixed (simple):** Every attempt in the Analysis tab (in each facet view and in the "All recorded attempts" list of General statistics) has a red **Delete** button. It asks for confirmation, then permanently removes the attempt from the database. A deleted attempt disappears from the leaderboard, facet statistics, standings, and every other analysis view, and does not come back after a reload. If a driver's most recent attempt in a facet is deleted, that driver's previous attempt in the facet becomes their current score; if it was their only attempt, the driver disappears from the rankings.

**How it was fixed (technical detail):**

- `attemptsTable()` renders `data-delete-attempt` buttons; `openDeleteAttempt(id)` shows a confirmation dialog naming the driver, facet, date, and score. On confirm it calls `storage.removeRecord("submissions", id)`, and only after that succeeds does it remove the item from `state.data.submissions` and re-render, so a failed delete (for example a rules or network error) shows an error toast and the row stays. The function also returns immediately unless `state.session.isAdmin`. The server-side rule `allow read, update, delete: if admin()` in `firestore.rules` is what actually enforces who may delete.
- All views are computed from `state.data.submissions` on every render, so removing the item updates the leaderboard (`driverSummary()` recalculates from the remaining attempts), facet statistics, standings, and lists together.
- Document-id fix required for deletion to work: submissions used to be saved with `addDoc` (a random Firestore document id) but were loaded back as `{ id: doc.id, ...doc.data() }`, so the `id` field stored inside the document overwrote the real document id. Deleting by that value would have targeted a document that does not exist, which Firestore reports as success, so the row would vanish on screen and return on the next load. `loadAll()` now puts the real document id last (`{ ...doc.data(), id: doc.id }`) so deletion works for submissions already saved under random ids, and `addSubmission()` now uses `setDoc` with the submission's own id as the document id for new ones. The create rule is unaffected: a guest can still only create a document whose `userId` is their own.
- `@media print` hides the Delete column and buttons from the exported PDF.

**Files affected:** `js/app.js`, `js/storage.js`, `css/styles.css`

### Update 10: Dates appeared one day early (Analysis dates, event popup, calendar placement, default practice date)

**Problem with the previous version:** A practice entered for 10/9/2026 showed as Oct 8 in the Analysis tab, and a calendar event on 10/13/2026 appeared in the correct calendar cell but showed Oct 12 after being clicked. Two related problems were hiding behind these: after about 8 pm US Eastern time, a new practice form defaulted to tomorrow's date, and in time zones ahead of UTC (for example Japan or New Zealand) events were drawn one cell too late on the calendar.

**Why it happened:** A practice or event date is just a calendar day, saved as text such as `2026-10-09`. JavaScript treats the text `new Date("2026-10-09")` as midnight in UTC, but the screen shows it in the viewer's own time zone. In the US that moment is the evening of the day before (8:00 pm on Oct 8 in Eastern daylight time), so the date was displayed one day early. The calendar grid built its cell labels from local dates but converted them with `toISOString()`, which goes through UTC. That conversion happens to give the right answer in the US (which is why the event sat in the right cell) but the wrong answer in time zones ahead of UTC. The default for the practice date also used `toISOString()`, which is the UTC date, and the UTC date is already "tomorrow" on a US evening.

**How it was fixed (simple):** Dates are now always handled as plain calendar days built from the year, month, and day numbers, so no time zone conversion can shift them. Dates display correctly everywhere, the calendar places and labels events correctly, and a new practice form defaults to today's date where the person actually is.

**How it was fixed (technical detail):**

- New helpers in `app.js`: `dateKey(date)` builds `YYYY-MM-DD` from the local `getFullYear()`, `getMonth()`, and `getDate()`; `todayKey()` returns today's local date; `parseDay(key)` splits `YYYY-MM-DD` and constructs `new Date(year, month - 1, day)`, which is local midnight; and `dateText(key)` formats `parseDay(key)`.
- `dateText()` (used for Analysis dates and the calendar day popup) now uses `parseDay()` instead of `new Date(isoString)`. The calendar grid cell key now uses `dateKey(d)` instead of `d.toISOString().slice(0, 10)`. The default practice date (on first render and after a successful submit) now uses `todayKey()`.
- The stored value did not change (still `YYYY-MM-DD` text), so dates already saved in Firestore or in the browser are displayed correctly with no data migration. `createdAt` timestamps are real moments in time, are still stored with `toISOString()`, and are only used for ordering.
- Verified in four time zones (America/New_York, UTC, Asia/Tokyo, Pacific/Auckland): a practice dated 10/9/2026 shows as Oct 9, 2026 in Analysis; an event on 10/13/2026 sits in the Oct 13 cell and the popup shows Oct 13, 2026; and at 9:30 pm Eastern on Oct 9 the form defaults to 2026-10-09 (the previous version defaulted to 2026-10-10).

**Files affected:** `js/app.js`

### Update 11: Firebase configuration is now included in `js/config.js` in every version

**Problem with the previous version:** `js/config.js` shipped with empty Firebase values, so the Firebase web-app configuration had to be pasted in by hand every time a new version of the project was downloaded. Separately, signing in as a guest on the local development server (`http://localhost:5500`) failed with the Firebase error `auth/requests-from-referer-http://localhost:5500-are-blocked`.

**How it was fixed (simple):** `config.js` now already contains the project's Firebase web configuration, so Firebase is enabled as soon as a new version is opened and nothing needs to be re-entered. The sign-in error was not a code problem: it was caused by the website restrictions on the Firebase API key in Google Cloud Console, which did not accept the local address. It is fixed by adding the correct website entries to the key's restrictions there (`http://localhost:5500/*`, `http://localhost:*`, `http://127.0.0.1:5500/*`, the GitHub Pages address, and the project's `firebaseapp.com` and `web.app` addresses).

**How it was fixed (technical detail):** `firebaseConfig` in `js/config.js` holds `apiKey`, `authDomain`, `projectId`, and `appId` for the project, and `firebaseEnabled` evaluates to `true` because both `apiKey` and `projectId` are present (an empty configuration still starts the safe local-preview mode). The file's existing comments and the `firebaseEnabled` line are unchanged; the first comment, which mentions copying to `firebase-config.local.js`, is stale because the app reads `config.js` directly. The 403 came from the Identity Toolkit sign-in request (`accounts:signUp`, used for anonymous guest sign-in) being rejected because the request's HTTP referrer was not on the key's allow-list. An HTTP-referrer entry must include the scheme (`http://` or `https://`), and `http://localhost:*` covers every local port. A Firebase web API key is an identifier rather than a secret, so access to data is still controlled by `firestore.rules` and the administrator allow-list; the referrer restriction limits which websites can use the key. Any new site address (for example the GitHub Pages address) must be added both to the key's website restrictions and to Firebase Authentication's authorized domains.

**Files affected:** `js/config.js` (and a settings change in Google Cloud Console, not in the project files)

### Update 12: Practice forms reorganized into a stacked layout with Driver information and Driver performance sections

**Problem with the previous version:** Every practice form put all of its questions into one two-column grid, with driver names, grades, the date, performance counts, and the timer mixed together. The forms felt cluttered and cramped, and there was no clear separation between "who is driving" and "how they drove".

**How it was fixed (simple):** Each form now shows its description at the top, followed by three sections separated by divider lines. The first, **Driver information**, lists the questions about the driver or drivers (names, grades, the practice date, and, on the Speed form, the timer / observer name). The second, **Driver performance**, starts with the timer or stopwatch and then lists the performance questions. The third is the existing **Coach observations** section. All questions are stacked in a single column, one per row, with more space between them.

**How it was fixed (technical detail):**

- In `constants.js`, each facet now has two lists of fields: `driverFields` (the Driver information section) and `fields` (the Driver performance section). The driver name, grade, and practice date, which were hard-coded in `renderPractice()`, now live in `driverFields` so each form can word them differently (see Update 14). On the Speed form, `timerName` moved from `fields` to `driverFields`. The header comment at the top of `constants.js` documents the field format.
- `renderPractice()` now renders a `.form-header` (title and description), then a Driver information section built from `driverFields`, then a Driver performance section containing the timer panel followed by the fields built from `fields`, then the existing Coach observations section and form buttons. No input ids or names changed.
- The `.field-grid` inside `#practice-form` is now one column, with a maximum width of 680 px so lines stay readable, and a larger gap between questions. Sections have 28 px of padding and a 2 px divider line. Labels are slightly larger (14 px). All rules are scoped to `#practice-form`, so the course builder and form builder keep their existing layout.
- The timer panel moved from the bottom of the old single section to the top of Driver performance, so it sits directly above the fields it fills in.
- Saved data is unchanged: scoring (`scoring.js`), the Analysis tab, and previously saved attempts all use the same field names as before.

**Files affected:** `js/constants.js`, `js/app.js`, `css/styles.css`

### Update 13: Descriptions for questions that recorders could interpret differently

**Problem with the previous version:** Several questions (penalties, preventing scoring or fuel gathering, time wasted, and evasions) could be read differently by different recorders, so results were not recorded consistently. Their only guidance was a one-line hint, or none.

**How it was fixed (simple):** Those questions now show a short description box directly under the question and above the answer box, explaining exactly when to count something. Where the description has sub-points, they are shown as bullet points under the main sentence. The Speed and Shooting forms use the same penalty description, the Defensive form has descriptions for all three of its questions, and the Offensive form has one for evasions. Question titles on these forms now use the exact wording supplied (for example, "How many times did Driver 2 prevent Driver 1 from scoring?").

**How it was fixed (technical detail):**

- A field can now carry an optional `description` (sixth array item). It is written as a "text block": a plain string is a paragraph and an array of strings is a bulleted list, so an indented sub-point in the source wording becomes a bullet beneath the sentence above it. The new `blocksHtml()` helper in `app.js` converts a text block to paragraphs and `<ul>` lists (with HTML escaping), and `field()` places it in a `.q-desc` box between the label and the input.
- The input is linked to its description with `aria-describedby`, so screen readers announce the description with the question.
- The penalty text is defined once (`PENALTY_DESCRIPTION`) and shared by the Speed and Shooting forms. The "scoring" and "gathering fuel" versions of the prevention description differ only in the verb, as supplied.
- Renamed question titles: "Number of penalties received" (Speed and Shooting), "How many times did Driver 2 prevent Driver 1 from scoring?", "How many times did Driver 2 prevent Driver 1 from gathering fuel?", "How much time did Driver 2 waste for Driver 1?", and "How many times did Driver 1 evade Driver 2?". The save keys are unchanged (`penalties`, `scorePreventions`, `fuelPreventions`, `secondsWasted`, `evasions`), so scoring and previously saved attempts are not affected. The long titles would make the Analysis attempts tables hard to read, so fields can have an optional seventh item, `shortLabel`, which `attemptsTable()` uses as the column heading (for example "Times scoring was prevented"); the Analysis headings are therefore unchanged.
- Hints under the input: the Speed penalty hint was removed because the description covers it; the "Time wasted" question gained "Enter your estimate in seconds."; and the Shooting penalty hint "Includes driving after 90 seconds." was kept because the supplied penalty description does not include that rule.
- `.q-desc` is styled as a light panel with a colored left edge, with nested bullet lists.

**Files affected:** `js/constants.js`, `js/app.js`, `css/styles.css`

### Update 14: Driver 1 / Driver 2 naming on the Defensive and Offensive forms

**Problem with the previous version:** On the paired Defensive and Offensive forms, the question "Driver name" did not say which driver it meant, while the rest of the form and the instructions referred to Driver 1 and Driver 2.

**How it was fixed (simple):** The driver questions on both paired forms now say which driver they are, and they appear in the same order on both forms: Driver 1 (the offensive driver driving the REBUILT robot) first, then Driver 2 (the defensive driver driving the REEFSCAPE robot). The driver who is being assessed on that form has a short note saying so.

**How it was fixed (technical detail):**

- Defensive form: "Driver 1 name (Offensive driver; REBUILT)", "Driver 1 grade level (Offensive driver)", "Driver 2 name (Defensive driver; REEFSCAPE)", "Driver 2 grade level (Defensive driver)". Offensive form uses the same four titles. The grade questions follow the same scheme as the names (an extension of the supplied naming). The titles are defined once as constants in `constants.js` (`DRIVER_1_NAME`, `DRIVER_1_GRADE`, `DRIVER_2_NAME`, `DRIVER_2_GRADE`) so both forms always match.
- Driver 1 is listed first on both forms so that the two laptops show the drivers in the same order. The assessed driver (Driver 2 on the Defensive form, Driver 1 on the Offensive form) has the hint "This is the driver being assessed on this form..." (`ASSESSED_HINT`).
- Saved data is unchanged: the assessed driver is still saved as `driverName` and `grade` (which feeds the leaderboard and Analysis), and the other driver is still saved as `opponentName` / `opponentGrade` (Defensive form) or `defenderName` / `defenderGrade` (Offensive form). The Speed and Shooting forms keep "Driver name" and "Driver grade level".

**Files affected:** `js/constants.js`

### Update 15: Form descriptions on all four practice forms

**Problem with the previous version:** Each form had only a one-line summary, so recorders had to rely on being told how the session worked (how long it lasts, which drivers are involved, which robot each drives, and when to disable the robots).

**How it was fixed (simple):** Each of the four forms now shows the supplied description at the top, including the session rules and goals as bullet points. The wording was lightly adjusted for the website without removing any detail. One correction was made: the supplied Offensive form description said it is completed in tandem with the "offensive" driving form, but its partner is the Defensive form, so it now says "Defensive driving form".

**How it was fixed (technical detail):** Each facet in `constants.js` has an `intro` text block (paragraphs and bulleted lists) rendered by `renderPractice()` through `blocksHtml()` into a `.form-intro` block under the form title. The Defensive and Offensive forms share the two common session bullets (90-second practice, robots disabled when time is up) through `PAIRED_SESSION_BULLETS`. The old one-line `description` property of each facet was removed because nothing else used it. Intro text is displayed in the form header and does not affect saved data or scoring.

**Files affected:** `js/constants.js`, `js/app.js`, `css/styles.css`

### Update 16: Form builder rebuilt: sections, question types, descriptions, and tools

**Problem with the previous version:** The Form builder only collected a title and a description. It had no way to add sections, questions, question descriptions, or timers, so a form built with it could not collect any practice data.

**How it was fixed (simple):** The Form builder is now a full editor. An administrator gives the form a title and description, adds sections (like Driver information, Driver performance, and Coach observations), and adds questions to each section. Question types are number, short text, paragraph, multiple choice, checkboxes, dropdown list, and rating scale. Each question can have its own description (with bullet points) and can be required or optional. Each section can show a stopwatch or a countdown timer at its top. A Preview button shows the form exactly as students will see it before saving. Sections and questions can be reordered or deleted, and saved forms can be edited later. A new form starts with a Driver performance section and a Coach observations section already in place.

**How it was fixed (technical detail):**

- New module `js/formbuilder.js` renders two modes on the Form builder page: a list of saved forms (Edit, Open form, Analysis, Delete) and the editor. The form being edited is a plain object in `state.formDraft`. Every input carries a `data-path` such as `sections.0.questions.2.label`, and one delegated `input`/`change` listener writes values straight into the draft, so typing never re-draws the page or loses focus. Structural actions (add, move, delete) call `redraw()`, which re-renders and restores the scroll position, and the box that was just added receives focus. The ranking and "fill this question" lists refresh as question labels are typed.
- The form's data model (documented at the top of `js/customforms.js`): `{ id, title, description, sections: [{ id, title, description, tool: { type, seconds, fillQuestionId }, questions: [{ id, type, label, description, required, optionsText, min, max, scaleMax }] }], ranking: { questionId, direction }, nextId, createdAt, updatedAt }`. Question and section ids come from a per-form counter and are never reused, so editing a form never disturbs answers already recorded. Options are stored as text (one per line) and parsed when needed. Firestore cannot store an array inside an array, and this structure never does. Descriptions are plain text: a line starting with `- ` becomes a bullet point (`textToBlocks()` in `js/util.js`, reusing the same `blocksHtml()` renderer as the built-in forms).
- `validateDraft()` returns plain-language problems (missing title, a section or question with no text, fewer than two options, a minimum above the maximum, a countdown outside 5 to 7200 seconds, a ranking question that no longer exists). Saving is blocked and the problems are listed at the top of the editor. A form is saved with `store.saveRecord("customForms", form)`, with the form id as the document id.
- Preview renders the real form (`customFormHtml(form, { preview: true })`) in a wide dialog with the real tools; its submit button saves nothing.
- Deleting a form asks for confirmation and offers a checkbox to also delete its recorded attempts (off by default; if it is left off the attempts stay in the database but are not shown anywhere). Forms saved by the old builder (`{ name, description }`) are normalized on load, are listed as "Not published" until they have a question, and are given a starter section when edited.
- `js/util.js` is new: it holds the helpers that were previously inside `app.js` (HTML escaping, ids, the calendar-date helpers from Update 10, `blocksHtml`, `textToBlocks`) so the new modules can share them. `app.js` imports them.

**Files affected:** `js/formbuilder.js` (new), `js/customforms.js` (new), `js/util.js` (new), `js/app.js`, `css/styles.css`

### Update 17: Custom forms now appear on the Practice form tab for everyone

**Problem with the previous version:** The Form builder said a form was created, but it never appeared on the Practice form tab, so students could not complete it. Two causes: no code ever read the saved forms back (the Practice tab only knew the four built-in drills), and the Firestore rules allowed only administrators to read the `customForms` collection.

**How it was fixed (simple):** Every saved form that has at least one question now shows up as a card on the Practice form tab (tagged CUSTOM), next to the four built-in drills. Opening it shows the form in the same layout as the built-in forms: the title and description, a Driver information section (driver name, grade level, practice date), then the sections and questions the administrator built, with question descriptions, timers, and stopwatches working as designed. Submitting saves the attempt like any other. The Firestore rules were updated so everyone can read forms (see Update 22).

**How it was fixed (technical detail):**

- `renderPractice()` lists `publishedForms()` (normalized forms with at least one question) as cards using `data-facet="form:<id>"`. `state.facet` can now be a built-in drill key or `form:<id>`; if the selected form disappears, the page falls back to Speed. `customFormHtml()` renders the form with the same markup and styles as the built-in forms, including the `.q-desc` description boxes and `aria-describedby` links. Required radio and rating questions use native validation; required checkbox groups, which browsers cannot validate natively, are checked by `checkRequiredGroups()`.
- Tools: `bindTool()` gives each stopwatch or countdown panel its own state (several can exist in one form). A stopwatch can be linked to a number question; pressing Stop enters the exact reading (hundredths of a second) into it, and restarting withdraws that value (only if the field still holds what the stopwatch wrote). A countdown counts down from the configured seconds, shows "Time is up" at zero, and Pause and Reset work. Form Clear resets all tools. A tool stops itself if its panel is removed from the page.
- Submissions use the same top-level fields as the built-in drills (`id, facet, driverName, grade, date, data, score, createdAt, userId`), so the existing `submissions` security rule accepts them unchanged. `facet` is `form:<id>`; answers are stored under `data.answers` by question id (numbers as numbers, checkboxes as arrays); `score.metric` and `score.final` hold the value of the form's ranking question (or 0).
- Custom attempts are kept out of the four-facet leaderboard and facet statistics: `app.js` filters with `builtInSubmissions()` before computing General statistics, because `driverSummary()` would otherwise count a custom form as a completed facet.

**Files affected:** `js/app.js`, `js/customforms.js`, `css/styles.css`

### Update 18: Analysis pages for custom forms

**Problem with the previous version:** Custom forms had no analysis at all.

**How it was fixed (simple):** Every custom form is added to the Analysis tab's View dropdown (under "Custom forms") and gets the same kind of page as the built-in drills: summary tiles, driver standings, question summaries (averages and choice counts), and a spreadsheet of every attempt with each answer in its own column, with Delete buttons. Drivers are ranked using a "ranking question" that the administrator picks in the form's Analysis settings (any number or rating question), with a choice of whether higher or lower is better (for example, points scored versus time). A form with no ranking question lists drivers by number of attempts.

**How it was fixed (technical detail):** `customModel(form, submissions)` in `customforms.js` computes everything from the saved attempts: per-driver attempts, latest, best, and average of the ranking value; standings sorted by each driver's latest attempt (using the chosen direction, with drivers who have no value last); the best attempt overall; and one summary per question (count, average, lowest, highest for numbers; a count and share per option for choice questions, with an option counted once per checkbox selected). `customAnalysisHtml()` renders it with the same tile, table, and bar styles as the built-in views. `renderAnalysis()` adds an `<optgroup>` of published forms to the dropdown and falls back to General statistics if the selected form was deleted. The Delete dialog names the form instead of a drill. Renaming or editing a form keeps all earlier attempts, because they are linked to the form by its id and answers by question id.

**Files affected:** `js/customforms.js`, `js/app.js`

### Update 19: "Download PDF" produces a formatted report instead of printing the page

**Problem with the previous version:** The "Export / print PDF" button only opened the browser's print dialog for the web page as it appeared on screen, so the result was not a designed report.

**How it was fixed (simple):** The button, now labelled **Download PDF**, downloads a formatted PDF for the view currently selected (General statistics, one drill, or one custom form). Each report has a branded header with the date and time, a title, summary boxes, and numbered pages. The first page is portrait and holds the summary and standings; the wide tables (the leaderboard and the spreadsheet of attempts) are placed on landscape pages so every column fits, and long tables continue onto further pages with the heading repeated.

**How it was fixed (technical detail):**

- New module `js/pdf.js` exposes `downloadReport(report)`, which takes a plain description (`title`, `subtitle`, `metrics`, and `blocks` of tables or text, each with an `orientation`) and draws it with jsPDF and jsPDF-AutoTable. The two libraries (MIT licensed, with their licenses and a README) are bundled in `js/vendor/` so the export works with no internet or CDN, and they are loaded only when someone first clicks the button (about 450 KB).
- Layout rules: the first page is portrait; a block that needs a different orientation starts a new page in that orientation, and overflow pages keep their orientation and margins; table rows are never split across pages; columns can be marked no-wrap so dates, grades, and numbers stay on one line; type size reduces for wide tables (more than 7 columns, and again above 12) and for compact summary tables; summary values and labels shrink to fit inside their boxes; headers and "Page X of Y" footers are drawn last once the page count is known.
- `app.js` builds one report per view: `generalReport()` (facet statistics, the score-band explanation, the leaderboard, all attempts), `facetReport()` (standings and the attempts spreadsheet with the raw values and notes), and `customReport()` in `customforms.js` (standings, question summaries, and the spreadsheet with one column per question). Files are named like `DriveLab-speed-driving-2026-10-10.pdf`. The old print handlers were removed, and the button disables itself while the PDF is prepared.
- `pdfText()` swaps typographic quotes and dashes for plain ones and replaces characters outside the built-in PDF fonts' Western-European range (for example emoji or non-Latin scripts) with "?", so one unusual character in a note cannot break the whole PDF.

**Files affected:** `js/pdf.js` (new), `js/vendor/` (new: `jspdf.umd.min.js`, `jspdf.plugin.autotable.min.js`, licenses, README), `js/app.js`, `js/customforms.js`, `README.md`

### Update 20: Course builder: draw walls by clicking and dragging across a grid

**Problem with the previous version:** Courses were built by dragging premade wall pieces from a palette, which gave the course creator little control over exactly where walls go.

**How it was fixed (simple):** The Course builder now shows a grid (48 columns by 24 rows). Pressing the mouse on a cell and dragging fills in every cell the pointer passes over, live, as it moves. A Draw/Erase toggle (or holding Shift while dragging) removes walls, Undo reverses the last stroke, and Clear grid empties the layout. Each drill has three course slots, with a layout name, and Save layout stores it. Switching to another slot with unsaved changes asks first. Layouts saved with the old piece-based builder are converted automatically to grid cells and flagged for review.

**How it was fixed (technical detail):**

- New module `js/courses.js`. Painting uses pointer events with pointer capture on the grid, so it works with mouse, pen, and touch (`touch-action: none`). The cell under the pointer is computed from coordinates and clamped to the grid, so dragging past an edge still fills the edge cells. Between two pointer events a straight line of cells is drawn (Bresenham's algorithm), so a fast drag never leaves gaps. Cells are updated directly in the DOM (not re-rendered) for smooth drawing, and each stroke is pushed onto an undo stack.
- Courses are saved as `{ name, cols, rows, grid: [24 strings of 48 "0"/"1" characters], updatedAt }`, because Firestore cannot store an array inside an array. The record id is `<group>-<number>` (`speed-1`, `defense-3`, `shooting-2`; defense and offense share their courses), as before.
- Legacy layouts (`walls: [{ kind, x, y }]` placed on the old 28 px background grid) are converted in `legacyWallsToGrid()` to 4-cell runs (the old pieces were about four cells long) and are rewritten in the new format on the next Save. The converted layout keeps its shape but not its exact scale, which is why the builder asks for a review.
- The builder moved to the route `course-builder`; the route `courses` is now the public page in Update 21. The obsolete wall-piece CSS was removed.

**Files affected:** `js/courses.js` (new), `js/app.js`, `js/storage.js`, `index.html`, `css/styles.css`, `README.md`

### Update 21: Courses page that everyone can view

**Problem with the previous version:** Course layouts could only be seen inside the administrator's Course builder, so recorders and drivers could not look up the courses that had been created.

**How it was fixed (simple):** There is a new **Courses** page in the sidebar, visible to everyone. It shows the published layouts in three groups (Speed driving, Defensive + Offensive driving, and Shooting only), three courses each, with a picture of each layout and "Not published yet" for empty slots. Selecting a picture opens a larger view. Regular viewers can only look. Administrators see the same page with **Edit** (opens that course in the Course builder, loaded and ready), **Create** (for an empty slot), and **Delete** (after confirmation). The page is separate from the Course builder, which is now an administrator-only page for drawing.

**How it was fixed (technical detail):** `renderCourseGallery()` and `bindCourseGallery()` in `courses.js` draw each course as an inline SVG (`courseSvg()`, runs of wall cells merged into rectangles, so it is sharp at any size and light to load). Edit and Create set the selected drill and course number and open the `course-builder` route; Delete calls the new `store.removeCourse()`, which works for both Firebase and the local-preview store. Edit, Create, and Delete are only rendered for administrators, and the builder route remains administrator-only both in the interface and, for saving and deleting, in the Firestore rules. The sidebar has a public "Courses" link and an administrator-only "Course builder" link.

**Files affected:** `js/courses.js`, `js/app.js`, `js/storage.js`, `index.html`, `css/styles.css`

### Update 22: Firestore rules and loading changes for forms and courses

**Problem with the previous version:** The rules allowed only administrators to read the `customForms` and `courses` collections, so students could never see forms or courses even when the interface was fixed. Separately, the app loaded data in a way that would fail for the whole page if any collection was denied.

**How it was fixed (simple):** The rules now let everyone read published forms and course layouts (students need them) while only administrators can create, change, or delete them. Student attempts remain unreadable to everyone except administrators. The app also tolerates rules that have not been updated yet: it keeps working, simply without the forms and courses, and the sidebar shows "Firebase connected - update the Firestore rules (see README)".

**How it was fixed (technical detail):** `firestore.rules` replaced the catch-all `match /{collection}/{id}` rule with explicit rules: `events`, `courses`, and `customForms` are `allow read: if true; allow write: if admin();`, and `admins` is administrator-only. The `submissions` rule is unchanged (identical text), and it accepts custom-form attempts because they use the same top-level fields. In `storage.loadAll()`, each collection is read separately, and a `permission-denied` result for one is recorded (`getLoadWarnings()`) and treated as empty instead of failing the whole load; submissions are still requested only for administrators. `app.js` shows the sidebar message through `updateStatus()` and logs the details to the browser console. **The updated rules must be published in the Firebase console (Firestore Database, then Rules) before guests can see custom forms and courses.**

**Files affected:** `firestore.rules`, `js/storage.js`, `js/app.js`, `README.md`

### Update 23: Course builder: start and end markers, robot paths with laps, and a key on every course

**Problem with the previous version:** A course picture showed only walls. It could not tell drivers where to start or finish, which route to drive, or (on Speed driving courses with two laps) where each lap begins and ends. There was also nothing explaining what the drawn symbols meant.

**How it was fixed (simple):** The Course builder now has five tools: Draw walls, Erase, **Start position** (a green circle), **End position** (a red square), and **Robot path**. With the Robot path tool, you click to add path points or drag to trace the route freehand; a drag is straightened into a clean line with corners. Arrowheads along the path show which way to drive. On Speed driving courses, the path has a **Lap 1** and a **Lap 2** part: draw Lap 1, press **End Lap 1 / start Lap 2 path**, then draw Lap 2. Each lap's path begins with a numbered circle and finishes with a bar across the path; Lap 1 is a solid blue line and Lap 2 is a thinner dashed orange line, so they can be told apart even when printed in black and white. Other drills (defense/offense and shooting) have a single Robot path.

Every course now has a **key** that lists only the features that course actually uses, each with its symbol and color. For example, a course with only a Robot path lists only "Robot path (follow the arrows)". The key appears under the picture in the builder (updating live as you draw), under each course on the Courses page, and in the enlarged view.

**How it was fixed (technical detail):**

- Saved course format (additions to Update 20): `start: { col, row } | null`, `end: { col, row } | null`, and `paths: [{ lap, points: ["col,row", ...] }]`. Points are strings because Firestore cannot store an array inside an array; a path needs at least two points to be saved. Existing courses (walls only, or the legacy piece format) have none of these fields and display and edit as before. `courseModel()` reads any saved course into one in-memory shape (`grid`, `start`, `end`, `paths` for Lap 1 and Lap 2).
- One shared renderer, `overlayInner()`, draws markers and paths in cell units. The builder lays it as a transparent SVG over the grid (`pointer-events: none`, so painting is unaffected) and `courseSvg()` uses the same code for the Courses page and enlarged view, so what an administrator draws is exactly what viewers see. Arrowheads are placed near the start, every few cells, and at the end. The end square is drawn first and the start circle on top, so a loop that starts and finishes on the same cell shows a green circle inside the red square. The two lap badges sit up-left and up-right of their starts so they do not hide each other.
- Pointer handling in `bindCourseBuilder()` now depends on the selected tool. Start and End move the marker to the cell under the pointer (refused, with a message, on a wall cell). Robot path appends the cells the pointer crosses (using the same line-filling as wall drawing, so fast drags leave no gaps) and, when the pointer is released, reduces the stroke with the Ramer-Douglas-Peucker algorithm (tolerance 0.8 cell), so a straight drag becomes two points. A single click adds a waypoint. Painting a wall over, or erasing, a marker removes that marker. Undo now records the whole drawing (walls, markers, paths), up to 60 steps. "Clear grid" was renamed "Clear walls", and the path and markers have their own Clear / Remove buttons.
- The key is computed from the course (`courseFeatures()`): Wall (any wall cell), Starting position, Ending position, then either "Robot path" (non-speed drills) or "Robot path: Lap 1", "Robot path: Lap 2", "Lap start", and "Lap end" (Speed driving, when a lap path exists). Symbols and colors come from the same `COLORS` table used by the pictures. A course with nothing drawn has no key.
- Bug fixed along the way: a brand-new, untouched course counted as "unsaved" (its default name never matched a saved name), so switching drills in an empty builder asked to discard changes. Only real edits now count as unsaved.
- Lap paths are offered on Speed driving courses only, matching the Speed form's two laps; the data format itself stores a lap number, so other drills could be given laps later.

**Files affected:** `js/courses.js`, `css/styles.css`, `README.md`

### Update 24: Administrators stay signed in when the page is refreshed

**Problem with the previous version:** Refreshing the page always signed an administrator out, so they had to sign in with Google again. On every page load, `initializeStorage()` called `signInAnonymously()` unconditionally, which replaced the Google account that Firebase had restored with a new guest identity.

**How it was fixed (simple):** The site now remembers the administrator's sign-in for the current browser tab. Refreshing keeps them signed in (and on the same page). They are signed out only when they press **Log out** or close the tab.

**How it was fixed (technical detail):**

- `initializeStorage()` calls `setPersistence(firebaseAuth, browserSessionPersistence)`, so Firebase keeps the signed-in account in the tab's `sessionStorage`. That storage survives a refresh but is erased when the tab is closed, which gives exactly the required lifetime. (Firebase's default, `indexedDB`, would also survive closing the browser.) An account saved by an older version is moved to the new storage automatically.
- It then waits for `firebaseAuth.authStateReady()` and inspects `currentUser`: a restored **Google** account is checked against `admins/{uid}` and, if it is still on the allow-list, the administrator session is restored (`isAdmin: true`). If it was removed from the allow-list, it is signed out. A restored **anonymous** guest is reused. Only when there is no account does it create a new anonymous guest (`ensureGuest()`).
- The `admins/{uid}` check is shared by sign-in and restore through a new `checkAdmin(uid)` helper, which keeps Update 5's handling (a `permission-denied` result means "not an administrator"; other errors are re-thrown).
- A Google account that is not on the allow-list is now signed straight back out after the "not on the administrator allow-list" message, and the tab returns to a guest identity, so a refresh never restores a non-administrator Google account.
- `setRoute()` stores the current page in `sessionStorage` (`drivelab-route`), and `init()` reopens it after a refresh. An administrator-only page is reopened only if the administrator session was restored; otherwise the Practice form is shown.
- Access control is unchanged: data is still protected by `firestore.rules` on Firebase's servers. Logging out and closing the tab both remove the credential from the browser. Because guest identities now also last for one tab, closing the tab gives the next visit a new anonymous identity; this has no effect on saved data.

**Files affected:** `js/storage.js`, `js/app.js`

### Update 25: Dark mode for all users

**Problem with the previous version:** The site had only a light theme, which is bright in a dark practice space or in the evening.

**How it was fixed (simple):** Everyone (guests and administrators) has a **Dark mode / Light mode** button in the top bar. The choice is remembered in that browser. Before a choice is made, the site follows the device's light or dark setting. Every page is themed, including forms, timers, tables, the calendar, dialogs, the Form builder, and the course pictures (walls are drawn light on a dark field in dark mode).

**How it was fixed (technical detail):**

- Every hard-coded light colour in `styles.css` became a CSS variable in `:root` (for example `--input-bg`, `--soft`, `--timer-bg`, `--pill-bg`, `--course-wall`). `:root[data-theme="dark"]` redefines the same variables, so the dark theme lives in one block and every existing rule follows it. `color-scheme` is set per theme so native controls (date and time pickers, dropdowns, scrollbars) match.
- A small inline script in `<head>` of `index.html` sets `data-theme` from `localStorage` (`drivelab-theme`) or `prefers-color-scheme` before the stylesheet is applied, so the page never flashes the wrong theme. `bindThemeToggle()` in `app.js` handles the button (`aria-pressed`, label, icon), saves the choice, and follows a change in the device setting while no choice has been saved.
- Course pictures: the SVG background rectangle and wall group carry `course-bg-fill` / `course-wall-fill` classes. CSS `fill` overrides the SVG colour attributes, so the pictures, key icons, and tool icons re-colour with the theme while marker and path colours stay the same in both themes.
- The PDF report is unaffected and is always printed in the light style.

**Files affected:** `index.html`, `css/styles.css`, `js/app.js`, `js/courses.js`

### Update 26: Scoring equations on the Analysis page

**Problem with the previous version:** Administrators could see scores but not how they were calculated, apart from a one-line description of the overall formula.

**How it was fixed (simple):** The Analysis page now shows the scoring equations. **General statistics** has a **Scoring equations** section with the overall ranking formula and every component of all four facet scores. Each facet view (for example Speed driving) has a **How the Speed driving score is calculated** section with that facet's equations. Every equation has a short explanation of why that formula and its weights suit the drill.

**How it was fixed (technical detail):** New module `js/formulas.js` holds the equations as data (`SCORING_DOCS` per facet and `OVERALL_DOC`) and renders them (`allEquationsHtml()`, `facetEquationsHtml()`) with plain HTML (italic variables, subscripts, stacked fractions), so no math library or CDN is needed. `scoring.js` is unchanged and is still the only place scores are calculated; a comment at the top of `formulas.js` asks for it to be updated whenever a weight or benchmark in `scoring.js` changes. Custom forms are unaffected because they are ranked by an administrator-chosen question rather than a formula.

**Files affected:** `js/formulas.js` (new), `js/app.js`, `css/styles.css`

### Update 27: Calendar events have a start and end time, shown in 12-hour format

**Problem with the previous version:** An event had a single optional time, and the calendar showed it in 24-hour format (for example `16:00`).

**How it was fixed (simple):** **Add practice** now has **Start time** and **End time** boxes (both optional). The calendar and the day popup show times in 12-hour format, such as "4:00 PM – 6:30 PM". Events in a day are listed in time order. The site refuses an end time with no start time, or an end time that is not later than the start time. Events saved before this change still show their time, as the start time.

**How it was fixed (technical detail):** Events are saved with `startTime` and `endTime` as `HH:MM` text (what `<input type="time">` produces, so stored values do not depend on the viewer's locale) instead of `time`. `time12()` converts `HH:MM` to 12-hour text (`00:30` becomes 12:30 AM, `12:00` becomes 12:00 PM), `eventTimeText()` builds the range, and `eventsOn(day)` sorts a day's events by start time with untimed events last. A legacy `time` field is read as the start time, so no data migration is needed. Validation compares the `HH:MM` strings directly, which sort correctly as text. The event pill shows the time on its own line above the title so the time is not cut off in narrow cells, and a failed save now shows an error toast instead of failing silently. The `events` Firestore rule has no field allow-list, so `firestore.rules` does not need to change.

**Files affected:** `js/app.js`, `css/styles.css`

### Update 28: The DriveLab title opens the Practice form

**Problem with the previous version:** The DriveLab title in the top-left was a link to `#practice`, which only changed the address bar and did not change the page.

**How it was fixed (simple):** Clicking the DriveLab title now always opens the Practice form page, for guests and administrators.

**How it was fixed (technical detail):** `init()` binds a click handler on `.brand` that prevents the default link behaviour and calls `setRoute("practice")`, the same path the sidebar navigation uses (so the active navigation highlight updates too). The link keeps its `href` so it still works as a normal link and is announced as "DriveLab: go to the Practice form".

**Files affected:** `js/app.js`, `index.html`

### Update 29: Phone-width layout no longer scrolls sideways for administrators

**Problem with the previous version:** On screens narrower than about 800 px, the administrator's extra navigation buttons widened the whole page, so every page could be scrolled sideways.

**How it was fixed (technical detail):** In the `max-width: 980px` layout, `.app-shell` uses `grid-template-columns: minmax(0, 1fr)` instead of `1fr`, so the navigation row scrolls inside itself as intended instead of stretching the page.

**Files affected:** `css/styles.css`

### Update 30: Practice calendar fits phone screens (events become dots)

**Problem with the previous version:** On phone-width screens, a day with an event widened its whole column to fit the event's text, which pushed the calendar to the right and often off the screen. With one long event title on a 390 px wide phone, the page measured 916 px wide.

**How it was fixed (simple):** The seven day columns now always share the screen width equally, whatever is inside them. On phones (640 px wide or less), events are shown as small dots in the day (up to three, then "+N"), days with events are tinted, and the weekday names shorten to one letter. Tapping a day opens a pop-up with the full details of every event that day (title, time or "All day", and description; administrators also see Remove). A list of the month's practices appears under the calendar on phones; tapping one opens its details. Wide screens keep the existing pills. Today's date is highlighted, and days can be opened with the keyboard.

**How it was fixed (technical detail):**

- Root cause: `.calendar-grid` used `grid-template-columns: repeat(7, 1fr)`. A `1fr` track has an automatic minimum width equal to its content's minimum width, and the event pills use `white-space: nowrap`, so one long title set that minimum. The grid now uses `repeat(7, minmax(0, 1fr))`, and cells and day names have `min-width: 0`.
- `renderCalendar()` renders both the pills and an `.event-dots` group for every day; CSS shows one or the other by screen width, so nothing is re-rendered on resize. Cells have `role="button"`, `tabindex="0"`, an `aria-label` with the date and number of events, and Enter / Space open the pop-up.
- `showDay(day, onlyId)` lists a day's events (or one event, used by the month list through `showEvent(id)`); Remove now reports an error instead of failing silently.
- Verified at 360 px and 390 px (page width equals screen width, no sideways scrolling) and on desktop, in light and dark mode.

**Files affected:** `js/app.js`, `css/styles.css`

### Update 31: Scoring settings page for administrators

**Problem with the previous version:** Every weight and benchmark was fixed in `scoring.js`, so changing how drivers are scored meant editing code, and the Analysis page's explanations had to be rewritten by hand to match.

**How it was fixed (simple):** A new administrator-only **Scoring settings** page has a tab for General statistics and for each drill. Administrators use controls, not formulas:

- Every part of every drill has a **weight** (slider and box; the weights must add up to 100%, and a button rescales them).
- Measured counts and times have **Full marks (10) at** and **Zero points at** values (for a time, the faster time is full marks) and a **scoring curve**: straight line, diminishing returns, or accelerating.
- Penalties have **points lost per penalty**; lap pacing has a **strictness**; accuracy has the **accuracy needed for full marks**.
- General statistics has the **ranking method** (coverage first, average of completed facets, or missing facets count as zero), **which attempt counts** (most recent, best, or average of all), and the **facet weights**.

While editing, a **live preview** shows exactly what the Analysis page will say. **Example attempts** (for each drill) and **example drivers** (for General statistics) show the score with the saved settings, the score with the new settings, and the change. They can be edited, added, removed, reset, and are saved with the settings. An **Effect on recorded** section re-scores the real attempts and leaderboard with the draft. Problems (weights not adding to 100%, equal benchmarks) are listed and block saving. Leaving the page with unsaved changes asks first. **Restore all original scoring** returns to the original DriveLab rules.

**How it was fixed (technical detail):**

- `scoring.js` now holds a settings model (`DEFAULT_SCORING`, `COMPONENTS`, `normalizeScoring()`, `validateScoring()`). Each facet score is a weighted sum of components of four kinds: `range` (value mapped between `zero` and `full`, with a `curve`), `pace`, `penalty`, and `accuracy`. `scoreSubmission(submission, config)` and `driverSummary(submissions, config)` take the settings; the overall step is `overallFromFacets()` and the attempt rule is `facetValue()`.
- With the default settings, results are bit-for-bit identical to the previous code. This was checked on 200,000 random attempts and 50,000 random drivers. The linear formula keeps the original arithmetic order, and the facet average is summed in the original order, so not even a rounding edge changes.
- Settings are stored in Firestore as `settings/scoring` (everyone may read it, so a guest's on-the-spot score uses the current rules; only administrators write) and examples as `settings/scoringExamples` (administrators only). The new `settings` rule must be published. Missing or partial settings fall back to the defaults.
- `app.js` re-scores every built-in attempt from its raw answers with the current settings on every load and after saving (`applyScoring()`), so the leaderboard, statistics, PDFs, and equations always agree. The score saved with each attempt in the database is not changed. Custom-form attempts are unaffected.
- New module `js/scoringeditor.js`. Inputs write straight into the draft through `data-sc` / `data-ex` paths, and only the dependent parts (totals, problems, preview, result cells, impact) are redrawn, so typing never loses focus.

**Files affected:** `js/scoring.js`, `js/scoringeditor.js` (new), `js/app.js`, `js/storage.js`, `index.html`, `css/styles.css`, `firestore.rules`, `README.md`

### Update 32: The Analysis page explains the current scoring automatically

**Problem with the previous version:** The equations and explanations in `formulas.js` were typed by hand, so they would be wrong as soon as a weight or benchmark changed.

**How it was fixed (simple):** Every equation, number, and sentence on the Analysis page is now generated from the saved scoring settings. For example, "6 scoring preventions or more earns full marks (10); none earns 0. In between, the score rises in a straight line: each scoring prevention is worth 1.67 points", or "Time carries the most weight (60%), followed by Pace and Penalties (20% each)". Worked examples are calculated by the scoring code itself. When scoring has been customised, a box lists every difference from the original scoring and when it was changed. The original design notes still appear, but only for the parts that are unchanged. The leaderboard legend, the "How the overall score works" table (score bands are computed for the chosen method), the page subtitle, and the PDF report text are all generated the same way.

**How it was fixed (technical detail):** `formulas.js` exports `facetDoc()`, `facetCard()`, `overallDoc()`, `overallCard()`, `overallBands()` (minimum and maximum overall score for 1-4 facets, found by scoring every combination of facets at 0 and 10), `bandsTableHtml()`, `overallLegend()`, `overallPdfLines()`, and `changesFromDefault()`. `facetEquationsHtml()` and `allEquationsHtml()` take the settings as a parameter. The Scoring settings preview uses the same functions, so the preview and the Analysis page cannot disagree.

**Files affected:** `js/formulas.js`, `js/app.js`, `css/styles.css`

### Update 33: Export the Practice calendar to the team Google Calendar

**Problem with the previous version:** Practices scheduled in DriveLab had to be re-typed into the team's Google Calendar.

**How it was fixed (simple):** Administrators have an **Export to Team Google Calendar** button on the Practice calendar page. After a one-time setup, an export takes three clicks: the button, **Export now**, and **Allow** in Google's pop-up. The practices are added straight into the team calendar. Exporting again (for example, next month's practices) only adds practices that are not already there, so nothing is duplicated, even if a different administrator exports. The team calendar's other events are never changed or removed. An optional box removes Google copies of practices that were deleted from DriveLab, and it only touches events DriveLab created. A **Download .ics file** backup works with Google Calendar's Import with no setup. Step-by-step instructions (one-time setup, every export, and the backup method) are shown to administrators under the calendar.

**How it was fixed (technical detail):**

- New module `js/gcal.js`. Each DriveLab event's permanent UUID becomes a deterministic Google event id (`drivelab` + 32 hex digits, valid base32hex). `events.insert` with an id that already exists returns HTTP 409 "duplicate", which is counted as "already in Google Calendar". Events carry the private extended property `drivelab=1`, which the clean-up option uses (`privateExtendedProperty` filter) so it can only delete DriveLab-created events.
- Times: DriveLab's plain day and `HH:MM` times are sent as wall-clock times in the team calendar's own time zone (read from the events list response). Untimed practices become all-day events, a start without an end lasts one hour, and late events roll past midnight correctly.
- Access: `storage.getCalendarToken()` asks the signed-in administrator's Google account for the `calendar.events` scope with Firebase `reauthenticateWithPopup()` and reads the OAuth access token from the credential. No new OAuth client or secret is needed, and the token is kept only in memory and expires after about an hour. Calls go straight from the browser to the Google Calendar API, and rate-limit replies are retried with back-off. Setup errors (API not enabled, wrong Calendar ID, view-only access) produce plain-language messages pointing to the setup step.
- The Calendar ID and a summary of the last export are stored in `settings/calendarExport` (administrators only).
- The .ics file uses the same per-event UID every time and folds long lines (RFC 5545), so Google Calendar's Import skips practices that were already imported.
- Tested with a simulated Google Calendar: exporting November, exporting again, then exporting November plus December created each event exactly once, an existing non-DriveLab event was never touched, and the clean-up removed only the deleted practice's copy.

**Files affected:** `js/gcal.js` (new), `js/app.js`, `js/storage.js`, `css/styles.css`, `firestore.rules`, `README.md`

### Update 34: Detailed one-time setup steps for the Google Calendar export

**Problem with the previous version:** The one-time setup instructions on the Practice calendar page were short. They did not say where each button is in Google Cloud Console and Google Calendar.

**How it was fixed (simple):** The setup is now split into Parts A to E: turn on the API, allow the calendar permission, find the Calendar ID, share the calendar with administrators, and run the first export in DriveLab. Each step names the exact button or menu and where it is on the screen.

**How it was fixed (technical detail):** `exportInstructionsHtml()` in `js/gcal.js` renders the new step list. `.export-steps h4` and `.export-steps > .help` styles were added. No behavior changed.

**Files affected:** `js/gcal.js`, `css/styles.css`

### Update 35: Calendar export no longer needs Google Auth Platform or app verification (replaces the access method in Updates 33 and 34)

**Problem with the previous version:** The export asked each administrator's Google account for the `calendar.events` permission. That meant adding the scope in Google Cloud Console's Google Auth Platform. Google then asks for the app to be submitted for verification, which requires a public privacy policy that the site does not have.

**How it was fixed (simple):** The team calendar's owner now creates a small Google Apps Script once, from the file `google-apps-script/DriveLabCalendarSync.gs`. They paste the team Calendar ID into it and publish it as a web app. Its link (the "sync link") is pasted into DriveLab once. Exporting then sends the practices to that script, which adds them to the team calendar as the owner. Nothing is set up in Google Cloud Console or Google Auth Platform, no verification or privacy policy is needed, and administrators no longer see a Google pop-up or need edit access to the calendar. Every goal of the feature is unchanged: practices are added straight into the team calendar, re-exporting never duplicates them, other events are never touched, and the .ics backup still works.

**How it was fixed (technical detail):**

- **The script (`DriveLabCalendarSync.gs`).** It uses the Apps Script advanced Calendar service, so the Calendar API, authorization, and project are handled by Apps Script itself. The owner authorizes it once by running `setup()`; the unverified-app notice for one's own script can be passed with Advanced. `doPost()`:
  - verifies the caller;
  - takes a script lock, so two exports can't overlap;
  - reads the team calendar's name and time zone;
  - accepts at most 200 events per request;
  - whitelists and validates each event's fields, using the id pattern `drivelab[0-9a-v]+`;
  - inserts each event with its deterministic id, counting "already exists" as skipped;
  - optionally runs the clean-up, limited to events with the private marker `drivelab=1`.
- **Who may call it.** The web app link is public, so each request carries the administrator's Firebase ID token (`currentUser.getIdToken()`). The script checks the token's project (`aud`), rejects anonymous accounts, and then reads `admins/<uid>` through the Firestore REST API with that token. Firestore checks the token's signature and expiry and applies DriveLab's rules, which allow that read only for administrators. Anything other than HTTP 200 is refused with a plain message. The script can only write to the one Calendar ID written into it.
- **The website side (`gcal.js`).** `exportViaScript()` posts batches of 100 events as `text/plain` JSON with `redirect: "follow"`, which avoids a CORS preflight that Apps Script cannot answer, and adds up the results. `isSyncUrl()` accepts only `https://script.google.com/macros/s/.../exec` links. The settings document `settings/calendarExport` now stores `syncUrl`. `storage.getCalendarToken()` and the `reauthenticateWithPopup` scope request were removed in favour of `storage.getIdToken()`.
- **Undoing the old setup.** If the `calendar.events` scope or the Calendar API was turned on in Google Cloud Console under the previous instructions, it can be removed or left in place; DriveLab no longer uses either.
- **Testing.** Simulated end to end: exporting November, re-exporting, and exporting November plus December created each event exactly once. A non-DriveLab event was never touched, the clean-up removed only the deleted practice's copy, and 250 events were sent in 3 requests. Non-administrator, anonymous, forged, and missing tokens were all refused.

**Files affected:** `google-apps-script/DriveLabCalendarSync.gs` (new), `js/gcal.js`, `js/storage.js`, `js/app.js`, `README.md`

### Update 36: Warning about multiple Google accounts during the sync-script setup

**Problem with the previous version:** Being signed in to more than one Google account in the same browser makes Apps Script authorization and deployment fail with Google Drive's "Sorry, unable to open the file at this time". Google's Apps Script documentation says signing in to several accounts at once is not supported. The setup steps did not mention this.

**How it was fixed (simple):** The one-time setup on the Practice calendar page now opens with a notice. It says to do Parts A to C in a private (Incognito) window, signed in only as the team calendar's owner. No code behavior changed. The website's export is not affected, because DriveLab's requests to the sync link do not carry the browser's Google cookies.

**Files affected:** `js/gcal.js`

### Update 37: Saving and deleting stopped working ("store.saveRecord is not a function")

**Problem with the previous version:** In Update 35, an edit to `js/storage.js` cut off the end of the file. That deleted five storage functions: `addSubmission`, `saveRecord`, `removeRecord`, `saveCourse`, and `removeCourse`. Every action that saves or deletes data failed with a "... is not a function" error:

- adding or removing a calendar event;
- submitting a practice;
- deleting an attempt;
- saving or deleting a course;
- saving or deleting a custom form.

The site still loaded and displayed data, because loading and the new settings and export functions were intact. The tests run for Update 35 only covered the export, so the problem was missed.

**How it was fixed (simple):** The five functions were restored exactly as they were before. Nothing about how data is saved, and no saved data, was changed.

**How it was fixed (technical detail):**

- The five functions were copied back from the last correct version. A comparison confirms they are identical to the originals apart from one blank line.
- A check was run over every module: every `import { ... }` refers to a function its file exports, and every `store.<name>(...)` call matches a function `storage.js` exports. No problems remain.
- A browser test now exercises every save and delete path: add event, remove event, submit practice, delete attempt, save course, and save scoring settings. All of them succeed and are written to storage. The earlier calendar, scoring, and export tests still pass.

**Files affected:** `js/storage.js`

### Update 38: "Course driven" and "Robot driven" questions on every form

**Problem with the previous version:** No form recorded which course layout or which robot was used. A course that takes longer could not be told apart from a slower driver, and results on different robots were mixed together.

**How it was fixed (simple):** Every form now has two more required dropdowns in **Driver information**:

- **Course driven** lists the names of that drill's published courses: Speed driving courses on the Speed form, the shared paired-drill courses on the Defensive and Offensive forms, and Shooting only courses on the Shooting form.
- **Robot driven** offers REBUILT Robot, REEFSCAPE Robot, and Swerve Chassis. On the paired forms it asks about the assessed driver ("Robot driven by Driver 2 (the assessed driver)" on Defensive, Driver 1 on Offensive).

Custom forms get the same two questions automatically. The Form builder has a new **Courses listed in the "Course driven" question** setting: any course, or one course family. If no course has been published for a drill yet, the question shows "No courses published yet" and does not block submitting.

**How it was fixed (technical detail):**

- `constants.js` adds `ROBOTS`, `FACET_COURSE_GROUP` (`defense` and `offense` both map to the `defense` course family), and two new field types: `course` and `robot`. Each facet's `driverFields` gains the two questions after the practice date (after the timer name on Speed).
- The new module `js/fields.js` (`fieldHtml()`) draws every built-in question for both the Practice form and the new Edit pop-up, so they always match. It replaces `field()` for the drill forms; `field()` remains only for the calendar's event form.
- `courses.js` adds `publishedCourses(courses, group)` and `courseLabel(courses, key)`. A deleted course is shown as "Course N (deleted)", so old attempts stay readable.
- Answers are saved inside `data` as `data.course` (the course id, for example `speed-2`) and `data.robot`, for built-in and custom forms alike. The top-level fields of a submission are unchanged, so the `submissions` create rule in `firestore.rules` needs no change.
- `customforms.js` builds the Driver information section from `BASE_FIELDS` through `fieldHtml()`. `normalizeForm()` adds `courseGroup` (default `"all"`).
- The Analysis attempt tables and the PDF attempt spreadsheets (General statistics, each drill, and custom forms) gained **Course** and **Robot** columns. Attempts recorded before this update show "Not recorded" until an administrator edits them (Update 40).

**Files affected:** `js/constants.js`, `js/fields.js` (new), `js/courses.js`, `js/customforms.js`, `js/formbuilder.js`, `js/app.js`, `css/styles.css`

### Update 39: Each course has its own scoring settings

**Problem with the previous version:** One scoring function served every course in a drill. A longer Speed driving course was scored against the same 15-second excellent time as a short one, although both assess the same skills.

**How it was fixed (simple):** Each drill tab on **Scoring settings** now starts with a **Course** picker: **Default (no course recorded)** plus every published course for that drill. All courses show the same controls, but each course's values can be different.

- A course uses the drill's default settings until any of its values is changed. It then gets its **own settings**, marked with an "own settings" badge.
- **Copy values from** copies the default or another course's settings into the selected course.
- **Use the default settings for this course** removes a course's own settings.
- The example attempts and the live preview use the selected course. Saving re-scores every recorded attempt with its own course's settings.
- Attempts with no course recorded (for example older ones) use the default settings.

The Analysis page explains this automatically:

- The default settings card lists which courses use it.
- Each course with its own settings gets its own card.
- The "Changes from the original scoring" box lists each course's differences.
- On General statistics, the equations are grouped by drill in collapsible sections.

**How it was fixed (technical detail):**

- `scoring.js` adds `byCourse: { speed: {}, defense: {}, offense: {}, shooting: {} }` to the settings object, keyed by course id (`COURSE_KEY` = `speed|defense|shooting` + `-1..3`). `settingsFor(config, facet, courseKey)` returns the course's own settings or the drill's default. `scoreSubmission()` scores with `settingsFor(config, facet, data.course)`.
- `normalizeScoring()` was split into `normalizeFacet()`. Each saved course entry is normalized against its drill's default, and unknown keys are dropped. `validateScoring()` checks every course's settings too, reporting problems as, for example, "Speed driving, Course 2: the weights add up to 90%".
- With no course settings saved, scores are still bit-for-bit identical to the original formulas; the 250,000-case comparison was re-run with 0 differences.
- `scoringeditor.js`:
  - Inputs for a course write to `byCourse.<facet>.<course>.*`.
  - The first change copies the default into that course (`materialize()`). Only the course bar is then redrawn (`refreshCourseBar()`), so the box being typed in keeps its focus.
  - Example attempts are scored with the selected course injected as `data.course`.
- `formulas.js`:
  - `facetDoc()` and `facetCard()` take a course id.
  - The new `facetCourseCards()` renders the default card and one card per course with its own settings.
  - `changesFromDefault()` lists course differences using course names (`courseNameMap()`).
  - `facetEquationsHtml()` and `allEquationsHtml()` take `state.data.courses`.
- The settings document stays `settings/scoring`, now holding nested maps. No rules change is needed.

**Files affected:** `js/scoring.js`, `js/scoringeditor.js`, `js/formulas.js`, `js/app.js`, `css/styles.css`

### Update 40: Administrators can edit recorded attempts

**Problem with the previous version:** A recorded attempt could only be deleted, not corrected. Attempts recorded before Update 38 had no way to receive a course or robot answer, and attempts would have no way to answer any question added to a form later.

**How it was fixed (simple):** Every attempt in the Analysis tab has an **Edit** button: All recorded attempts, each drill's attempts, each custom form's spreadsheet, and the enlarged view (Update 42).

- Edit opens a medium-sized pop-up over the page with the form the driver completed, filled in with their answers. It uses the drill's **current** questions, so questions added later can be answered. Those are marked **No answer yet**.
- Every answer can be changed: driver information, course, robot, the performance values, coach observations, notes, and custom-form answers of every type.
- The bottom of the pop-up shows the final score (or the custom form's ranking value) for the answers on screen, next to the saved score.
- **Save changes** stores the edit. Scores, leaderboards, and statistics update straight away, and the attempt is tagged **Edited**.
- **Revert to original** loads the values exactly as they were first submitted; **Save changes** then restores them and removes the Edited tag. **Cancel** closes without saving.
- Only the driver name and practice date must be filled in, so old attempts can be completed a little at a time.

**How it was fixed (technical detail):**

- The new module `js/attempts.js` handles editing.
  - **Built-in drills:** `builtInFormHtml()` renders the drill's current `driverFields` and `fields` through `fieldHtml()` in edit mode (`edit-` id prefix, values filled in, unanswered fields marked), plus the observations and notes.
  - **Custom forms:** `customFormHtml(form, { edit: true, values })` renders the form with no timers or submit buttons and nothing required except the driver name and date. `fillCustom()` then fills in text, number, dropdown, radio, rating-scale, and checkbox answers.
- `readEdit()` builds the updated attempt.
  - **Built-in drills:** the saved `data`, overlaid with the form's values (strings, exactly as the Practice form saves them), and a fresh `score` from `scoreSubmission()`.
  - **Custom forms:** the saved `answers` overlaid with `collectAnswers()`, so answers to questions since removed from the form are kept, plus `metricOf()`.
- The first edit stores `original` (driver name, grade, date, and data as first submitted) and `editedAt` on the attempt. When the saved values match `original` again, compared with sorted keys and with blank answers ignored, both fields are removed.
- Saving uses `store.saveRecord("submissions", item)`. The existing rule `allow read, update, delete: if admin()` already allows administrators to update attempts, so `firestore.rules` is unchanged. Afterwards `applyScoring()` and `render()` refresh every view.
- The pop-up is the site's own `<dialog>` with the `edit-modal` class: up to 860 px wide and 86% of the window height, with the form scrolling inside. It opens on top of the enlarged view when started from there.

**Files affected:** `js/attempts.js` (new), `js/customforms.js`, `js/fields.js`, `js/app.js`, `css/styles.css`

### Update 41: Search and filters for recorded attempts

**Problem with the previous version:** With many attempts, finding one driver's attempts, a grade, or the attempts missing information meant scrolling the whole list.

**How it was fixed (simple):** **All recorded attempts** and each drill's attempts list now have:

- **Search:** matches the driver, grade, drill, date, course, robot, the other driver in a paired drill, timer name, observations, notes, answers, and score. Every word typed must match, for example `alex long loop`.
- **Filters menu:** tick boxes for drill (General statistics), grade level, robot, course, coach observations, and record status (edited by an administrator, or missing course or robot). Boxes in the same group widen the results; different groups narrow them.
- **Filter chips:** each active filter appears as a chip that removes it when clicked, with **Clear all** beside them.
- **Result count:** "Showing 4 of 15".
- **Missing-information note:** when attempts have no course or robot recorded, a note says how many and how to find them.

Search and filters are remembered while moving around the Analysis tab, and are shared with the enlarged view.

**How it was fixed (technical detail):**

- `attemptsSectionHtml()` and `bindAttemptsSections()` in `attempts.js` render and wire each panel. Filters are kept in `state.attemptFilters[scope]`, where the scope is `general` or a drill key.
- Typing or ticking redraws only the table, count, and chips, never the search box, so focus is never lost.
- Edit, Delete, chips, and Enlarge use event delegation on the panel, so redrawn rows need no re-binding. A single page-wide listener closes an open Filters menu when the administrator clicks anywhere else.

**Files affected:** `js/attempts.js`, `js/app.js`, `css/styles.css`

### Update 42: Enlarged view for recorded attempts

**Problem with the previous version:** The attempts tables gained Course, Robot, and editing columns, and on a laptop screen they only fit by scrolling inside a narrow panel.

**How it was fixed (simple):** An **Enlarge** button at the top right of each attempts list opens it as a layer over the page, about 94% of the window wide and 88% high, so the page stays visible around it. The enlarged list keeps the same search and filters and adds:

- every response for each attempt;
- the notes in full;
- when the attempt was recorded;
- the other driver (paired drills) or the timer name (Speed driving).

Its headings stay in view while scrolling. Edit and Delete work there too, and the list updates straight away. Esc or × returns to the page.

**How it was fixed (technical detail):** `openSheet()` creates one `<dialog id="attempt-sheet" class="sheet">` (in-page, not a browser window) and fills it with `attemptsSectionHtml(..., { expanded: true })`. `render()` calls `refreshSheet()`, so an edit or delete redraws the open sheet, and closing the sheet redraws the page so it shows the same filters. The sheet is a flex column whose table scrolls inside it with sticky headings.

**Files affected:** `js/attempts.js`, `js/app.js`, `css/styles.css`

### Update 43: Attempts column in the Driver leaderboard

**Problem with the previous version:** The leaderboard did not show how many attempts each driver had recorded.

**How it was fixed (simple):** The Driver leaderboard has an **Attempts** column after **Facets**: the number of attempts the driver has recorded across the four drills. The PDF leaderboard has the same column.

**How it was fixed (technical detail):** `driverRows()` adds `attempts: entries.length`. The leaderboard header, rows, empty-state `colspan` (now 10), and `generalReport()` (head, alignment, no-wrap columns, body) were updated.

**Files affected:** `js/app.js`

### Update 44: A wide table no longer widens the whole page on desktop

**Problem with the previous version:** On desktop, an Analysis view with a wide attempts table (Speed driving or Defensive driving, now with Course and Robot columns) made the whole page wider than the window. The page header, tiles, and Download PDF button then needed sideways scrolling.

**How it was fixed (simple):** Wide tables now scroll inside their own panel, and the page always fits the window.

**How it was fixed (technical detail):** The desktop `.app-shell` grid used `grid-template-columns: 244px 1fr`. A `1fr` track has an automatic minimum equal to its content's minimum width, so a no-wrap table set the column's width. It is now `244px minmax(0, 1fr)`, the same fix Update 29 made for the phone layout. Every Analysis view was checked at 1440 px and 390 px wide: the page width equals the window width.

**Files affected:** `css/styles.css`

### Update 45: Larger enlarged view and Edit pop-up; Enlarge button on the Driver leaderboard

**Problem with the previous version:** The enlarged view of the recorded attempts (about 94% by 88% of the window) and the Edit attempt pop-up (up to 860 px wide) were a little small for the amount of detail they show. The Driver leaderboard could not be enlarged at all.

**How it was fixed (simple):**

- The enlarged view now fills about **97%** of the window's width and height. A thin edge of the page stays visible, so it still reads as a layer over the page.
- The **Edit attempt** pop-up is larger: up to 1,080 px wide (about 88% of narrower windows) and 92% of the window height. That is still smaller than the enlarged view, which it can open on top of.
- The **Driver leaderboard** has an **Enlarge** button at its top right that opens the leaderboard in the same layer. The enlarged leaderboard adds the number of attempts in each facet under that facet's score, each driver's facet average, and their most recent practice date. Esc or × returns to the page.

**How it was fixed (technical detail):**

- **Sizes (CSS):**
  - `dialog.sheet` uses `width` / `height` / `max-width` / `max-height` of `97vw` / `97vh` with `margin: auto`. The explicit maximums override the browser's default `<dialog>` limit, which would otherwise cap the size at the window minus about 38 px.
  - `dialog.edit-modal` is `min(1080px, 88vw)` wide with a `92vh` maximum height, and its content scrolls inside.
  - On phones the pop-up is the window width minus 20 px.
- **Other sections in the enlarged layer:** `openContentSheet(api, { key, title, html })` in `attempts.js` shows any section there. `html()` is called again by `refreshSheet()` whenever the page re-renders, so the enlarged copy always shows current data.
- **Leaderboard table:** in `app.js`, the leaderboard table moved into `leaderboardTable(rows, expanded)`, and `leaderboardSheetHtml()` builds the enlarged version. `driverRows()` now also returns `perFacet` (attempts in each facet) and `lastDate` (most recent practice date).
- **Checks:** the enlarged attempts view and the enlarged leaderboard measured 97% of the window's width and height at 1440 x 900 and at 390 x 844, and the page still never scrolls sideways.

**Files affected:** `js/attempts.js`, `js/app.js`, `css/styles.css`

### Update 46: The enlarged views now fill their whole area

**Problem with the previous version:** In the enlarged view of All recorded attempts, and in the enlarged Driver leaderboard, the table stopped about two-thirds of the way down and left a large empty area at the bottom. With many attempts, the administrator had to scroll a short box inside a mostly empty layer.

**How it was fixed (simple):** The table now uses all the height of the enlarged layer and scrolls only when the rows do not fit. The page's normal (not enlarged) tables are unchanged.

**How it was fixed (technical detail):**

- Every `.table-wrap` on the page has `max-height: 570px`, so long tables scroll inside the page. The enlarged layer's table (`dialog.sheet .sheet-table`) also has that class, so it inherited the 570 px limit even though the layer is about 97% of the window tall.
- That table now sets `max-height: none` and `min-height: 0`. It is a flex item that fills the layer (`flex: 1` for the attempts list), or grows with its rows up to the layer's height (`flex: 0 1 auto` for the leaderboard, so the box ends at its last row when there are only a few drivers).
- Checked with 74 attempts at 1462 x 787, 1440 x 900, and 390 x 844. The attempts table now ends 18 px (the layer's padding) above the layer's bottom edge on all three. The leaderboard table fills the layer down to the formula note beneath it.

**Files affected:** `css/styles.css`

### Update 47: Shooting only removed, name autofill removed, and a new coach observation

**Problem with the previous version:**

- The team no longer runs the Shooting only drill, but its form, Analysis section, course family, and scoring settings were still on the site.
- Every form filled in the driver name with the last name typed in that browser, and the browser's own autofill also offered names. In practice this caused more retyping and wrong names than it saved.
- Coaches had no way to record sporadic or jittery driving.

**How it was fixed (simple):**

- The **Shooting only** form, its Analysis view and PDF, its column in the Driver leaderboard, its Scoring settings tab, its course family on the Courses page and Course builder, and its option in the Form builder's "Courses listed" setting are gone.
- Shooting only attempts already saved are **kept in the database** (nothing was deleted) but are no longer shown or counted anywhere. They can be deleted later if the team wants.
- Driver names are no longer pre-filled on any form (built-in or custom), and the browser's own name suggestions are turned off on the name boxes. The name remembered by older versions is removed from each browser the first time the new version loads.
- The **Coach observations** tick boxes now include **Sporadic / Jittery Movement** (after Speed, Agility, and Smooth driving). It also appears in the Analysis Filters menu.

**How it was fixed (technical detail):**

- **Shooting only removed:**
  - `constants.js`: the `shooting` entry of `FACETS` was removed; `FACET_COURSE_GROUP` no longer has it.
  - `scoring.js`: `FACET_ORDER` is now `["speed", "defense", "offense"]` (exported `FACET_COUNT` = 3); the `shooting` components, defaults, and `byCourse` entry were removed. `COURSE_KEY` accepts only `speed-N` and `defense-N`. `scoreSubmission()` returns `{ final: 0 }` for a facet that is no longer scored, instead of scoring it as Shooting.
  - `courses.js`: the shooting entry of `COURSE_GROUPS` was removed. Saved shooting course documents stay in Firestore but are not shown.
  - `customforms.js`: the shooting choice of `COURSE_GROUP_CHOICES` was removed; a form saved with it falls back to "Any course".
  - `app.js`, `attempts.js`, `scoringeditor.js`, `formulas.js`: every hard-coded list of four facets now uses `FACET_ORDER`, and every "all four" / "/4" text uses the facet count ("Completed all three facets", "2/3").
  - `builtInSubmissions()` (and with it the leaderboard, statistics, attempts lists, and PDFs) only includes the three remaining facets.
  - The example drivers on the Scoring settings page no longer have a Shooting column.
- **Name autofill removed:**
  - `app.js` and `customforms.js` no longer read or write `localStorage["drivelab-last-name"]`, and no longer put the name back into the form after submitting. `init()` removes the old key.
  - `fields.js` adds `autocomplete="off"` to text inputs.
  - The help texts "Your recent local name is suggested." and the Practice page and Admin page notes about name suggestions were updated.
- **New observation:** `OBSERVATIONS` in `constants.js` gains "Sporadic / Jittery Movement". The Analysis Filters menu now lists every drill form's observation choices plus any value found in recorded attempts (see Update 50, where the choices become editable).

**Files affected:** `js/constants.js`, `js/scoring.js`, `js/courses.js`, `js/customforms.js`, `js/fields.js`, `js/app.js`, `js/attempts.js`, `js/scoringeditor.js`, `js/formulas.js`

### Update 48: Overall score formula for three facets

**Problem with the previous version:** The coverage-first overall score was built for four facets: 2.5 points per completed facet, plus 0.249 × the facet average, plus 0.01 when all four were complete. With Shooting only removed, no driver could complete all four facets. The best possible score would have been 7.49, and the bands no longer described the drills that exist.

**How it was fixed (simple):** The overall score is now calculated for three facets. Each completed facet is worth one third of the 10-point scale, so the bands are:

- 1 facet: 0.00–3.32
- 2 facets: 3.33–6.66
- all 3 facets: 6.68–10.00

A driver with more facets completed still always ranks above one with fewer, and a perfect driver scores exactly 10.00.

All existing attempts were updated automatically: every overall score, leaderboard rank, and statistic is recalculated from the attempts when the page loads, and drill scores (Speed, Defensive, Offensive) are unchanged.

The other two ranking methods also work with three facets. The default facet weights are an equal split (33.34 / 33.33 / 33.33%). Saved weights from the four-facet version are converted automatically, keeping the three drills' relative weights.

**How it was fixed (technical detail):**

- `scoring.js` adds `coverageNumbers(n = FACET_COUNT)`: band = 10 / n, scale = (band − 0.01) / 10, bonus = 0.01. With 4 facets this gives the old 2.5 / 0.249 / 0.01; with 3 it gives 3.333… / 0.32333… / 0.01.
  - `overallFromFacets()` uses band × (K − 1) + scale × average + bonus when K = n.
  - The "missing counts as 0" method now divides by the weight total, so it is always out of 10.
- Default `overall.weights` are `{ speed: 33.34, defense: 33.33, offense: 33.33 }`. `weightsEqual()` treats weights within 0.011 of each other as equal, so the facet average stays a plain average.
  - The Scoring settings "Make weights add up to 100%" button now rounds to 2 decimals (33.33 / 33.33 / 33.34) instead of 1.
- Migration: `normalizeScoring()` handles a saved `overall.weights` that still contains `shooting`. Equal weights become the new equal split; unequal weights are rescaled to add up to 100% (for example 40 / 20 / 20 / 20 becomes 50 / 25 / 25). The settings document is rewritten in the new form the next time an administrator saves scoring settings.
- `formulas.js` generates the Analysis explanation, PDF lines, and score-band table from `coverageNumbers()` and `FACET_COUNT`. It shows "10/3 × (K − 1) + 0.3233 × Ā + 0.01 × [K = 3]", the bands come from all 2³ − 1 facet combinations, and the example driver completes all three facets.
- Checks:
  - 150,000 random Speed, Defensive, and Offensive attempts score bit-for-bit the same as in release 1.3.2.
  - 100,000 random drivers match the three-facet formula exactly.
  - The bands do not overlap (0–3.32, 3.33–6.66, 6.68–10.00).

**Files affected:** `js/scoring.js`, `js/formulas.js`, `js/scoringeditor.js`

### Update 49: Sort the recorded attempts by any column

**Problem with the previous version:** The attempts lists were always ordered by when each attempt was recorded, newest first. Finding the best scores, the earliest practices, or all attempts on one course meant searching or scrolling.

**How it was fixed (simple):** In **All recorded attempts**, each drill's attempts list, and their enlarged views, a column heading with a ↕ arrow can be clicked to sort by it. Clicking it again reverses the order, and the column shows ▲ or ▼.

| Column | First click | Second click |
| --- | --- | --- |
| Date, Recorded | Earliest first | Latest first |
| Final score, and every number column (times, splits, penalties, preventions, fuel, evasions, and added number or rating questions) | Highest first | Lowest first |
| Grade | 9th to 12th | 12th to 9th |
| Drill, Course, Robot | A to Z | Z to A |

- Attempts with no value (for example no course recorded) always go to the bottom.
- Driver, Responses, Observations, Notes, partner, timer, and Actions cannot be sorted.
- While a list is sorted, "Sorted by …" and a **Reset sorting** button appear next to the Filters menu. Reset sorting returns to the default order (most recently recorded first) and hides itself again. It is hidden whenever the list is in its default order.
- The sort works together with search and filters, and the enlarged view uses the same sort.

**How it was fixed (technical detail):**

- `attempts.js`:
  - `sorters(state, facet)` defines each sortable column's value and first direction. `sortList()` sorts with empty values last and ties in the default order. The sort is kept in `state.attemptSort[scope]`, where `null` means the default.
  - `tableHtml()` columns carry a sort key. Sortable headings are `<button class="th-sort" data-sort="…">` with `aria-sort` on the `<th>`, so they work from the keyboard.
  - Clicking a heading (event delegation on the panel) redraws only the table and moves focus back to that heading. `sortResetHtml()` / `sortDescription()` draw the status and Reset button, which `redrawTable()` shows or hides.
- `css/styles.css`: `.th-sort`, `.sort-arrow`, and `.sort-status`.

**Files affected:** `js/attempts.js`, `css/styles.css`

### Update 50: Administrators can edit the built-in drill forms

**Problem with the previous version:** The Speed, Defensive, and Offensive forms were fixed in the code. Changing a description or question wording, or adding a question, needed a programmer, while custom forms could be changed by anyone with administrator access.

**How it was fixed (simple):**

- **Edit form button:** administrators now see an **Edit form** button above every form on the Practice form tab: the three drills and custom forms. Students and other visitors don't see it, and administrators can still fill in and submit the forms normally. The **Form builder** tab also lists the three drill forms under **Built-in drill forms**, with Open form, Edit, and (once changed) **Restore original**.
- **What can be changed:** the drill form opens in the same editor as a custom form. Administrators can change:
  - the form description;
  - section titles and descriptions;
  - every question's wording, description, and hint;
  - the order of questions and sections;
  - the coach-observation choices.

  They can also add new sections and questions of any type (number, short text, paragraph, multiple choice, tick boxes, dropdown, rating scale).
- **Built-in questions:** the drill's original questions are marked **Built-in**. They can be reworded, described, and moved, but not deleted or changed to another type, because the drill's score, timer, and Analysis use them. A section holding built-in questions cannot be deleted.
- **What stays fixed:** the drill name, the timer (still at the top of the Driver performance section), and the scoring (still set on the Scoring settings page).
- **Preview, save, restore:** **Preview** shows the form as recorders will see it. **Save form** returns to the Practice form tab with the new version. **Restore original form** removes the changes.
- **Answers to added questions:** these are saved with the attempt. They appear as extra columns in the drill's attempts list, in the enlarged view's responses, in search, and in the Edit attempt pop-up, where older attempts show them as **No answer yet** so they can be filled in later. Number and rating questions can be sorted.

**How it was fixed (technical detail):**

- **Data model:**
  - The new module `js/drillforms.js` turns each drill into a form in the custom-form shape. `defaultDrillForm(facet)` builds it from `FACETS`: Driver information, Driver performance (`role: "performance"`, which holds the timer), and Coach observations (the `observation` tick boxes and `notes`). Each original question is `{ field: "<data key>", locked: true, help, shortLabel }`.
  - `drillForm(state, facet)` returns the saved version or the original. A saved version is repaired against the original: a missing original question is put back in its section, unknown or duplicate ones are dropped, and the title, type, id, and required flag always come from the original. A reworded question loses its short column heading so tables show the new wording.
- **Storage:** an edited drill form is saved with `store.saveRecord("customForms", …)` under the id `builtin-<drill>` with `builtin: "<drill>"`. The existing `customForms` rule (everyone can read; only administrators can write) applies, so `firestore.rules` is unchanged and nothing needs publishing. `isDrillForm()` keeps these documents out of the custom-form lists, the Practice form's custom cards, and the Analysis view list. `normalizeForm()` now keeps `builtin`, `role`, `field`, `locked`, `help`, and `shortLabel`.
- **Rendering:** `drillFormHtml(form, facet, …)` draws the Practice form, the Form builder preview (timer shown as a placeholder), and the Edit attempt pop-up (`edit: true`). Built-in questions use `fieldHtml()` and keep their element ids and names, so the timer, Lap Split, and scoring code are unchanged. Added questions use `questionHtml()` from `customforms.js` (now exported, with `checkRequiredGroups()` and `answerText()`).
- **Saving answers:** built-in answers are saved exactly as before (`data.totalTime`, `data.observations`, …). Added questions' answers go to `data.answers[<question id>]` (`collectAnswers(addedPart(form))`), and their raw form keys are removed from `data`. Editing an attempt merges the answers and keeps answers to questions since removed.
- **Form builder:** `formbuilder.js` adds:
  - `lockedQuestionEditor()`: a fixed type badge, no delete, required state shown as text, and a hint box; for observations, the choices box.
  - `drillEditor()`: fixed title; no course, ranking, or tool settings; a **Restore original form** button.
  - The **Built-in drill forms** list, `restoreDrill()` (removes `builtin-<drill>`), and `closeEditor()`, which returns to the Practice form tab when the editor was opened from there (`state.formReturn`). `q-del` and `s-del` ignore built-in questions and their sections.
- **Fix found while testing:** the Form builder preview's form stayed inside the closed pop-up, so the page held two elements with the same ids (for example `#totalTime`). The preview pop-up is now emptied when it closes (this affected custom-form previews too).
- **Analysis:** `attempts.js` uses the current wording for column headings and responses, adds a column per added question to each drill's attempts list, includes added answers in the enlarged view's Responses and in search, and fills them in the Edit pop-up (`fillCustom()`).
- `util.js` adds `blocksToText()`, the reverse of `textToBlocks()`, to turn the original descriptions into editable text.

**Files affected:** `js/drillforms.js` (new), `js/formbuilder.js`, `js/customforms.js`, `js/attempts.js`, `js/app.js`, `js/fields.js`, `js/util.js`, `css/styles.css`

### Update 51: Testing for this release

**Problem with the previous version:** Not a problem with the site: this release changes the scoring, the forms, and every Analysis list together, so it needed checks across all of them.

**How it was fixed (simple):** Every change in Updates 47–50 was tested in the browser as an administrator and as a visitor, on desktop and phone sizes, in light and dark mode. The earlier tests for saving, the calendar, courses, per-course scoring, editing attempts, filters, and the enlarged views were run again and still pass.

**How it was fixed (technical detail):** The browser tests check:

- three drill cards; empty name boxes with `autocomplete="off"`; the old remembered name is deleted; and the new observation is saved;
- editing the Speed form: description, a reworded question, a hint, and a new number question. Then submitting an attempt that saves `data.answers` with no stray keys, filling the new question in for an older attempt, and restoring the original form;
- no Edit form button for visitors;
- the Analysis views and tiles without Shooting; sorting by Date, Final score, and Recorded in both directions; Reset sorting hidden or shown correctly; and the sort shared with the enlarged view;
- old four-facet weights becoming 33.34 / 33.33 / 33.33;
- PDFs, and every page at 390 px with no sideways scrolling.

All module imports and `store.*` calls resolve, and there are no page errors.

**Files affected:** none (testing only)
