# DriveLab - FRC Driver Practice Hub

DriveLab is a no-cost, GitHub Pages-ready FRC driver-practice tracker. It is designed around the supplied REBUILT / REEFSCAPE form and scoring explanation, but it has an original interface and separated, commented source files.

## Features and no-cost tools

- **Four ready-to-use assessment forms**
  - Speed, defense, offense, and shooting-only forms include the supplied questions, native stopwatch/countdown controls, coaching observations, and their documented scoring weights.
  - Every form (including custom forms) asks which **course** was driven (a dropdown of that drill's published courses) and which **robot** was driven (REBUILT Robot, REEFSCAPE Robot, or Swerve Chassis).
- **Paired defensive/offensive workflow**
  - Defense and offense are recorded as separate assessments for the two drivers in one 90-second paired session, preserving individual data.
- **Private name convenience**
  - The most recent name is remembered only in the current browser, reducing repetitive typing without publishing a list of students.
- **Administrator-only analysis**
  - A spreadsheet-style facet table, score bars, and coverage-first leaderboard (with each driver's number of attempts) compare drivers while keeping raw submissions unreadable to regular users.
  - Every list of recorded attempts can be searched (driver, course, robot, notes, date, answers, and more) and filtered (drill, grade, robot, course, observations, edited, or missing course/robot). An **Enlarge** button shows the list over the page with every response and detail.
  - Administrators can **Edit** any recorded attempt in a pop-up that shows the form the driver completed with their answers, including questions added to the form later (for example, adding the course to older attempts). **Revert to original** restores the values first submitted.
  - The Analysis page shows the scoring equations for the overall ranking and every facet. The equations and their explanations are generated automatically from the current scoring settings, so they always describe the formula in use.
- **Scoring settings (administrators)**
  - Each course can have its own scoring values (for example, a longer Speed driving course can have a slower "excellent" time); attempts are scored with the settings of the course they were driven on, and attempts with no course recorded use the drill's default settings.
  - Change every drill's scoring without typing formulas: a weight for each part, the "full marks" and "zero points" benchmarks, a scoring curve, points lost per penalty, pace strictness, and the accuracy needed for full marks. For General statistics, choose the overall ranking method (coverage first, average of completed facets, or missing facets count as zero), which attempt counts (most recent, best, or average), and the facet weights.
  - A live preview shows exactly what the Analysis page will say. Editable example attempts and example drivers show each score with the saved settings and with the new ones side by side, and the page shows how the change would affect the drivers already recorded. Saving re-scores every recorded attempt from its raw answers.
  - An administrator stays signed in when the page is refreshed, and is signed out by **Log out** or by closing the tab.
- **Courses and Course builder**
  - Everyone can view the published course layouts on the **Courses** page (three layouts each for speed, shared defense/offense, and shooting). Administrators also get Edit, Create, and Delete there.
  - Administrators draw a course on the **Course builder** page by clicking and dragging across a 48 x 24 grid; cells fill as the pointer moves. There is an Erase tool (or hold Shift), Undo, and Clear walls.
  - They can also place a green **start** circle and a red **end** square, and trace a **robot path** (arrows show the direction to drive). Speed driving courses can have a separate Lap 1 and Lap 2 path, with a numbered circle where each lap begins and a bar where it ends.
  - Every course shows a **key** listing only the features that course uses, with the matching symbols and colors.
- **Practice calendar**
  - Anyone can browse month-by-month events; administrators can schedule or remove events with a description and an optional start and end time. Times are shown in 12-hour format (for example 4:00 PM - 6:30 PM).
  - On phones, events appear as dots so the calendar always fits the screen; tapping a day opens a pop-up with every event's details, and a list of the month's practices appears under the calendar.
  - **Export to Team Google Calendar** (administrators) adds the practices to the team's Google Calendar in one click. Exporting again only adds practices that are not there yet, and the calendar's other events are never changed. An .ics file download is available as a backup method. Step-by-step instructions are on the Practice calendar page for administrators.
- **Dark mode**
  - Everyone can switch between light and dark mode with the button in the top bar. The choice is remembered in that browser; before a choice is made, the site follows the device setting.
- **Download PDF**
  - The Analysis page's **Download PDF** button downloads a formatted, dated report of the selected view (general statistics, one drill, or one custom form): a portrait summary page followed by landscape pages for the leaderboard and attempts spreadsheet. It uses the free, MIT-licensed jsPDF libraries bundled in `js/vendor/`, so no paid service or internet connection is needed.
- **Form builder (custom forms)**
  - Administrators build forms with a title and description, a choice of which courses the Course driven question lists, sections, and questions (number, short text, paragraph, multiple choice, checkboxes, dropdown, rating scale), each with an optional description, plus stopwatch and countdown tools. Saved forms appear on the **Practice form** tab for everyone.
  - Every custom form gets its own Analysis page (driver standings ranked by a number or scale question the administrator picks, question summaries, and a spreadsheet of all attempts) and its own PDF. Custom forms never count toward the four-facet leaderboard.
- **GitHub Pages**
  - Static hosting is free and the repository has no build step, package manager, paid library, or API key requirement for the preview.
- **Firebase Authentication + Cloud Firestore (optional production layer)**
  - Google sign-in, anonymous submission identity, Firestore rules, and the Spark plan can provide a shared data store and real access controls at no cost within its published quotas; this is the only external service used.

## Important security architecture

GitHub Pages is static: it cannot safely hold a password, secure a database, or restrict data merely by hiding a tab. A JavaScript-only "admin password" would be publicly recoverable. Therefore, this project deliberately has two modes:

1. **Local preview mode** (the default): data is kept in that browser's `localStorage`; it is useful for inspecting and demonstrating the site, but it is not shared or secure for a team.
2. **Protected shared mode** (required before publishing student data): the free Firebase configuration enables anonymous sign-in for submitters, Google sign-in for administrators, and server-enforced Firestore rules. Submitters can create their own entry but cannot read any entries; only allowed administrator UIDs can read analysis, names, grades, or notes.

Do not treat the local preview, a GitHub repository, or a hidden front-end tab as a security boundary.

## Configure secure, shared no-cost storage

1. Create a Firebase project at the Firebase Console and keep it on the no-cost **Spark** plan; do not attach a Cloud Billing account.
2. Add a Web app, copy its configuration values, and copy `js/config.js` to `js/firebase-config.local.js`.
3. Put the Firebase values in `firebase-config.local.js`. Before deploying, copy those values into `js/config.js`; Firebase web config is public by design, while the rules are the protection.
4. In **Authentication > Sign-in method**, enable **Anonymous** and **Google** providers. In **Authentication > Settings > Authorized domains**, add `<your-github-username>.github.io`.
5. Create a Cloud Firestore database in production mode. In **Rules**, replace the default rules with the exact contents of `firestore.rules` and publish. **Publish the rules again whenever `firestore.rules` changes**: custom forms and courses are only visible to students after the rules that allow everyone to read them (`customForms` and `courses`) are published, and saved scoring settings and the calendar export need the `settings` rule. If the rules are out of date the sidebar says so.
6. Visit your hosted site, choose **Administrator sign in**, and sign in with your Google account. Copy the UID shown in **Admin**.
7. In Firestore's **Data** panel, create collection `admins`; create one document whose ID is that UID. Its fields may be empty. Sign out/in or refresh. That account can now open Analysis and the administrative areas.
8. Test with a non-admin browser profile: it should submit a form but cannot see or query analysis. Test this before placing real student names in the system.
9. Optional, for **Export to Team Google Calendar**: the team calendar's owner creates a Google Apps Script project from `google-apps-script/DriveLabCalendarSync.gs`, pastes the team Calendar ID into it, adds the Google Calendar API service, runs `setup` once, and deploys it as a web app (Execute as: Me, Who has access: Anyone). An administrator then pastes the web app URL (the "sync link") into DriveLab's export window. No Google Cloud Console, Google Auth Platform, OAuth verification, or privacy policy is needed. The full click-by-click steps are shown on the Practice calendar page when signed in as an administrator.

## Repository map

| Path | Purpose |
| --- | --- |
| `index.html` | Accessible static page shell. |
| `css/styles.css` | Responsive visual design. |
| `js/constants.js` | Form questions and facet definitions. |
| `js/scoring.js` | Auditable scoring and ranking functions, the scoring settings model, its defaults (the original scoring), and validation. |
| `js/scoringeditor.js` | The administrator's Scoring settings page: controls, live preview, editable examples, and effect on recorded drivers. |
| `js/gcal.js` | Practice calendar export to the team Google Calendar (through the sync script, no duplicates), the .ics backup file, and the on-page setup steps. |
| `google-apps-script/DriveLabCalendarSync.gs` | The Google Apps Script the team calendar's owner deploys as the "sync link". It accepts requests only from signed-in DriveLab administrators and writes only to the team calendar. |
| `js/storage.js` | Local-preview and protected Firebase storage adapter. |
| `js/app.js` | Routed UI, built-in forms and timers, calendar, and analysis. |
| `js/fields.js` | Draws the questions of the built-in forms (shared by the Practice form and the Edit attempt pop-up), including the Course and Robot dropdowns. |
| `js/attempts.js` | Analysis attempt lists: search, filters, the enlarged view, and the Edit attempt pop-up. |
| `js/util.js` | Small shared helpers (escaping, dates, text blocks). |
| `js/customforms.js` | Custom form data model, the form students fill in, timer tools, and custom analytics. |
| `js/formbuilder.js` | The administrator's Form builder editor. |
| `js/courses.js` | Course grid painter, Courses page, and course pictures. |
| `js/pdf.js` | Formatted PDF report builder. |
| `js/formulas.js` | Generates the scoring equations and explanations shown on the Analysis page from the current scoring settings (the calculations themselves are in `scoring.js`). |
| `js/vendor/` | Bundled jsPDF and jsPDF-AutoTable (MIT licensed) used only by the PDF export. |
| `firestore.rules` | Server-enforced access rules for student information. |

## Free-service guardrails

Firebase's Spark plan offers no-cost Authentication options and Cloud Firestore quotas, but it has limits. At the time this repository was prepared, Cloud Firestore's free quota is 50,000 reads/day, 20,000 writes/day, 20,000 deletes/day, 1 GiB stored data, and 10 GiB/month egress. If the project exceeds a Spark limit, that service stops until the next period rather than automatically charging you. Monitor the Firebase console and do not enable paid products, Cloud Functions, phone authentication, backups, TTL, or a billing account.

Sources: [Firebase pricing plans](https://firebase.google.com/docs/projects/billing/firebase-pricing-plans), [Cloud Firestore pricing](https://firebase.google.com/docs/firestore/pricing), and [Authentication limits](https://firebase.google.com/docs/auth/limits).
