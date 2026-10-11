# DriveLab - FRC Driver Practice Hub

DriveLab is a no-cost, GitHub Pages-ready FRC driver-practice tracker. It is designed around the supplied REBUILT / REEFSCAPE form and scoring explanation, but it has an original interface and separated, commented source files.

## Features and no-cost tools

- **Four ready-to-use assessment forms**
  - Speed, defense, offense, and shooting-only forms include the supplied questions, native stopwatch/countdown controls, coaching observations, and their documented scoring weights.
- **Paired defensive/offensive workflow**
  - Defense and offense are recorded as separate assessments for the two drivers in one 90-second paired session, preserving individual data.
- **Private name convenience**
  - The most recent name is remembered only in the current browser, reducing repetitive typing without publishing a list of students.
- **Administrator-only analysis**
  - A spreadsheet-style facet table, score bars, and coverage-first leaderboard compare drivers while keeping raw submissions unreadable to regular users.
- **Courses and Course builder**
  - Everyone can view the published course layouts on the **Courses** page (three layouts each for speed, shared defense/offense, and shooting). Administrators also get Edit, Create, and Delete there.
  - Administrators draw a course on the **Course builder** page by clicking and dragging across a 48 x 24 grid; cells fill as the pointer moves. There is an Erase tool (or hold Shift), Undo, and Clear walls.
  - They can also place a green **start** circle and a red **end** square, and trace a **robot path** (arrows show the direction to drive). Speed driving courses can have a separate Lap 1 and Lap 2 path, with a numbered circle where each lap begins and a bar where it ends.
  - Every course shows a **key** listing only the features that course uses, with the matching symbols and colors.
- **Practice calendar**
  - Anyone can browse month-by-month events; administrators can schedule or remove events and descriptions.
- **Download PDF**
  - The Analysis page's **Download PDF** button downloads a formatted, dated report of the selected view (general statistics, one drill, or one custom form): a portrait summary page followed by landscape pages for the leaderboard and attempts spreadsheet. It uses the free, MIT-licensed jsPDF libraries bundled in `js/vendor/`, so no paid service or internet connection is needed.
- **Form builder (custom forms)**
  - Administrators build forms with a title and description, sections, and questions (number, short text, paragraph, multiple choice, checkboxes, dropdown, rating scale), each with an optional description, plus stopwatch and countdown tools. Saved forms appear on the **Practice form** tab for everyone.
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
5. Create a Cloud Firestore database in production mode. In **Rules**, replace the default rules with the exact contents of `firestore.rules` and publish. **Publish the rules again whenever `firestore.rules` changes**: custom forms and courses are only visible to students after the rules that allow everyone to read them (`customForms` and `courses`) are published. If the rules are out of date the sidebar says so.
6. Visit your hosted site, choose **Administrator sign in**, and sign in with your Google account. Copy the UID shown in **Admin**.
7. In Firestore's **Data** panel, create collection `admins`; create one document whose ID is that UID. Its fields may be empty. Sign out/in or refresh. That account can now open Analysis and the administrative areas.
8. Test with a non-admin browser profile: it should submit a form but cannot see or query analysis. Test this before placing real student names in the system.

## Repository map

| Path | Purpose |
| --- | --- |
| `index.html` | Accessible static page shell. |
| `css/styles.css` | Responsive visual design. |
| `js/constants.js` | Form questions and facet definitions. |
| `js/scoring.js` | Auditable scoring and coverage-first ranking functions. |
| `js/storage.js` | Local-preview and protected Firebase storage adapter. |
| `js/app.js` | Routed UI, built-in forms and timers, calendar, and analysis. |
| `js/util.js` | Small shared helpers (escaping, dates, text blocks). |
| `js/customforms.js` | Custom form data model, the form students fill in, timer tools, and custom analytics. |
| `js/formbuilder.js` | The administrator's Form builder editor. |
| `js/courses.js` | Course grid painter, Courses page, and course pictures. |
| `js/pdf.js` | Formatted PDF report builder. |
| `js/vendor/` | Bundled jsPDF and jsPDF-AutoTable (MIT licensed) used only by the PDF export. |
| `firestore.rules` | Server-enforced access rules for student information. |

## Free-service guardrails

Firebase's Spark plan offers no-cost Authentication options and Cloud Firestore quotas, but it has limits. At the time this repository was prepared, Cloud Firestore's free quota is 50,000 reads/day, 20,000 writes/day, 20,000 deletes/day, 1 GiB stored data, and 10 GiB/month egress. If the project exceeds a Spark limit, that service stops until the next period rather than automatically charging you. Monitor the Firebase console and do not enable paid products, Cloud Functions, phone authentication, backups, TTL, or a billing account.

Sources: [Firebase pricing plans](https://firebase.google.com/docs/projects/billing/firebase-pricing-plans), [Cloud Firestore pricing](https://firebase.google.com/docs/firestore/pricing), and [Authentication limits](https://firebase.google.com/docs/auth/limits).
