/**
 * DriveLab -> team Google Calendar sync (Google Apps Script web app).
 *
 * WHY THIS EXISTS
 * DriveLab is a static website. Writing to a Google Calendar from the website itself would need a Google OAuth app with the
 * "calendar.events" permission, which Google only allows without warnings after an app verification (privacy policy, review).
 * Instead, this small script is owned by the team calendar's owner and runs AS THAT PERSON. DriveLab sends it the practices, and
 * the script adds them to the team calendar. Nothing has to be configured in Google Cloud Console or Google Auth Platform.
 *
 * WHO CAN USE IT
 * The web app link is reachable by anyone, so every request must include the DriveLab administrator's Firebase sign-in token.
 * The script asks Firestore to read admins/<uid> WITH THAT TOKEN. DriveLab's security rules only let an administrator read that
 * document, so the read succeeds only for a real, signed-in DriveLab administrator. Anyone else is refused. The script can only
 * ever write to the one calendar in CALENDAR_ID below.
 *
 * NO DUPLICATES, OTHER EVENTS UNTOUCHED
 * Each practice gets a permanent Google event id ("drivelab" + its DriveLab id). Google refuses a second event with the same id, so a
 * practice that is already in the calendar is skipped. The optional clean-up only deletes events that DriveLab created (they carry
 * the private marker drivelab=1). No other event on the team calendar is ever read, changed, or deleted.
 *
 * SETUP: see "How to export to the team Google Calendar" on DriveLab's Practice calendar page (administrators).
 * Requires the advanced service "Google Calendar API" (Services +, identifier "Calendar").
 */

// 1) Paste the team calendar's Calendar ID between the quotes (Google Calendar > Settings and sharing > Integrate calendar).
const CALENDAR_ID = "PASTE_TEAM_CALENDAR_ID_HERE";
// 2) DriveLab's Firebase project ID (from js/config.js). Leave as is unless the project changes.
const FIREBASE_PROJECT_ID = "driver-practice-database";

const MAX_EVENTS_PER_REQUEST = 200;

/** Run this once from the editor (select "setup", press Run) to grant permissions and check the Calendar ID. */
function setup() {
  if (CALENDAR_ID.indexOf("PASTE_") === 0) throw new Error("Paste the team calendar's Calendar ID into CALENDAR_ID (line 26) first, then save and run setup again.");
  const cal = Calendar.Calendars.get(CALENDAR_ID);
  // Touch UrlFetchApp so its permission is granted now too (it is used to check that a request comes from a DriveLab administrator).
  UrlFetchApp.fetch("https://firestore.googleapis.com/", { muteHttpExceptions: true });
  console.log("Connected to the team calendar: \"" + cal.summary + "\" (time zone " + cal.timeZone + "). Setup is complete; now deploy it as a web app.");
}

/** Opening the web app link in a browser shows this, which is a quick way to check the link works. */
function doGet() {
  return json_({ ok: true, service: "DriveLab calendar sync", configured: CALENDAR_ID.indexOf("PASTE_") !== 0 });
}

function doPost(e) {
  let body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return json_({ ok: false, error: "The request could not be read." });
  }
  if (CALENDAR_ID.indexOf("PASTE_") === 0) return json_({ ok: false, error: "The sync script has no Calendar ID yet. Paste it into CALENDAR_ID in the script, save, and deploy a new version." });
  const check = verifyAdmin_(body.idToken);
  if (!check.ok) return json_({ ok: false, error: check.error });

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return json_({ ok: false, error: "Another export is running. Try again in a minute." });
  try {
    let cal;
    try {
      cal = Calendar.Calendars.get(CALENDAR_ID);
    } catch (err) {
      return json_({ ok: false, error: "The script cannot open the team calendar. Check CALENDAR_ID, and that the script's owner owns the calendar or has \"Make changes to events\" permission. (" + err.message + ")" });
    }
    const timeZone = cal.timeZone;
    const events = Array.isArray(body.events) ? body.events.slice(0, MAX_EVENTS_PER_REQUEST) : [];
    const result = { ok: true, calendarName: cal.summary, timeZone: timeZone, added: 0, skipped: 0, failed: [], removed: 0 };

    events.forEach(function (raw) {
      const resource = cleanEvent_(raw, timeZone);
      if (!resource) {
        result.failed.push({ id: String(raw && raw.id), message: "Invalid practice data." });
        return;
      }
      try {
        Calendar.Events.insert(resource, CALENDAR_ID);
        result.added++;
      } catch (err) {
        // Google refuses an id that is already used in this calendar: the practice was exported before, so leave it alone.
        if (/already exists|duplicate|identifier/i.test(String(err.message))) result.skipped++;
        else result.failed.push({ id: resource.id, message: String(err.message) });
      }
    });

    if (body.removeDeleted === true && Array.isArray(body.keep)) result.removed = removeDeleted_(body.keep);
    return json_(result);
  } finally {
    lock.releaseLock();
  }
}

// ---------------------------------------------------------------- helpers

// Only a signed-in DriveLab administrator may export. Firestore checks the token's signature and expiry and applies DriveLab's rules.
function verifyAdmin_(token) {
  const deny = { ok: false, error: "Only a signed-in DriveLab administrator can export. Sign in again and retry." };
  if (typeof token !== "string" || token.split(".").length !== 3) return deny;
  let payload;
  try {
    let part = token.split(".")[1];
    while (part.length % 4) part += "=";
    payload = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(part)).getDataAsString());
  } catch (err) {
    return deny;
  }
  if (payload.aud !== FIREBASE_PROJECT_ID || !payload.sub) return deny;
  if (payload.firebase && payload.firebase.sign_in_provider === "anonymous") return deny;
  const url = "https://firestore.googleapis.com/v1/projects/" + FIREBASE_PROJECT_ID + "/databases/(default)/documents/admins/" + encodeURIComponent(payload.sub);
  const res = UrlFetchApp.fetch(url, { headers: { Authorization: "Bearer " + token }, muteHttpExceptions: true });
  const code = res.getResponseCode();
  if (code === 200) return { ok: true, uid: payload.sub };
  if (code === 401) return { ok: false, error: "Your DriveLab sign-in has expired. Log out, sign in again, and retry." };
  if (code === 404) return { ok: false, error: "This Google account is not on DriveLab's administrator list." };
  return { ok: false, error: "This account is not a DriveLab administrator (or the Firestore rules have not been published)." };
}

// Accept only the fields DriveLab sends, in the expected shape, so the endpoint cannot be used to create anything else.
function cleanEvent_(raw, timeZone) {
  if (!raw || typeof raw !== "object") return null;
  const id = String(raw.id || "");
  if (!/^drivelab[0-9a-v]{5,1000}$/.test(id)) return null;
  const day = /^\d{4}-\d{2}-\d{2}$/;
  const time = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/;
  const when = function (w) {
    if (!w) return null;
    if (w.date && day.test(w.date)) return { date: w.date };
    if (w.dateTime && time.test(w.dateTime)) return { dateTime: w.dateTime, timeZone: timeZone };
    return null;
  };
  const start = when(raw.start), end = when(raw.end);
  if (!start || !end) return null;
  return {
    id: id,
    summary: String(raw.summary || "Practice").slice(0, 300),
    description: String(raw.description || "").slice(0, 3000),
    start: start,
    end: end,
    extendedProperties: { private: { drivelab: "1", drivelabId: String((raw.extendedProperties && raw.extendedProperties.private && raw.extendedProperties.private.drivelabId) || "").slice(0, 100) } },
  };
}

// Deletes DriveLab-created events (private marker drivelab=1) whose practice no longer exists in DriveLab. Nothing else is touched.
function removeDeleted_(keepIds) {
  const keep = {};
  keepIds.forEach(function (id) { keep[String(id)] = true; });
  let removed = 0, pageToken = null;
  do {
    const page = Calendar.Events.list(CALENDAR_ID, { privateExtendedProperty: "drivelab=1", showDeleted: false, maxResults: 2500, pageToken: pageToken || undefined });
    (page.items || []).forEach(function (ev) {
      const ours = ev.extendedProperties && ev.extendedProperties.private && ev.extendedProperties.private.drivelab === "1";
      if (ours && String(ev.id).indexOf("drivelab") === 0 && !keep[ev.id]) {
        try {
          Calendar.Events.remove(CALENDAR_ID, ev.id);
          removed++;
        } catch (err) {
          console.warn("Could not remove " + ev.id + ": " + err.message);
        }
      }
    });
    pageToken = page.nextPageToken;
  } while (pageToken);
  return removed;
}

function json_(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}
