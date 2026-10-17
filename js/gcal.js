// Practice calendar -> team Google Calendar export (administrators only).
//
// HOW THE EXPORT REACHES GOOGLE CALENDAR (no Google Cloud / Google Auth Platform setup, no app verification)
// The calendar owner deploys the small Google Apps Script in google-apps-script/DriveLabCalendarSync.gs as a web app that runs as
// them and can write only to the team calendar. DriveLab stores that web app's link ("sync link") and POSTs the practices to it
// together with the administrator's Firebase sign-in token. The script confirms the token belongs to a DriveLab administrator (by
// reading admins/<uid> in Firestore with it, which DriveLab's rules allow only for administrators) and then adds the events.
//
// HOW DUPLICATES ARE PREVENTED
// Every DriveLab event already has a permanent id (a UUID). The Google copy gets an event id derived from it:
//     "drivelab" + the UUID's 32 hex digits      e.g. drivelab3f2a9c...   (Google allows the characters a-v and 0-9)
// Google Calendar refuses to create a second event with an id that already exists in that calendar, so exporting again (next week,
// next month, or by a different administrator) only ADDS practices that are not there yet; the others are reported as skipped.
//
// OTHER EVENTS ARE NEVER TOUCHED
// Only events with DriveLab ids are created. The optional clean-up (off by default) deletes only events that DriveLab itself created
// (private extended property drivelab=1) whose practice no longer exists in DriveLab.
//
// BACKUP METHOD (.ics FILE)
// downloadIcs() builds a standard iCalendar file with the same permanent per-event UIDs. Google Calendar's Import skips events
// whose UID is already in that calendar, so importing a newer file also adds only the new events. Use ONE method per calendar.
import { esc, pad2, parseDay, dateKey, dateText, todayKey } from "./util.js";

const API = "https://www.googleapis.com/calendar/v3";
export const SETTINGS_ID = "calendarExport";

// Google event id for a DriveLab event (deterministic, so the same practice always maps to the same Google event).
export function googleEventId(event) {
	const hex = String(event.id).toLowerCase().replace(/[^0-9a-f]/g, "");
	// UUIDs give 32 hex digits. Anything unusual (an id without hex) falls back to a stable base-32 encoding of the id text.
	if (hex.length >= 16) return `drivelab${hex}`;
	return `drivelab${[...new TextEncoder().encode(String(event.id))].map((b) => b.toString(32).padStart(2, "0")).join("")}`;
}

// ---------------------------------------------------------------- event times
// DriveLab stores a plain day ("YYYY-MM-DD") and optional "HH:MM" start / end times with no time zone. Google receives them as
// wall-clock times in the TEAM CALENDAR's own time zone, so 4:00 PM in DriveLab is 4:00 PM on the team calendar.
const startOf = (e) => e.startTime || e.time || "";
const minutes = (hhmm) => {
	const [h, m] = hhmm.split(":").map(Number);
	return h * 60 + m;
};
const addDays = (key, n) => {
	const d = parseDay(key);
	d.setDate(d.getDate() + n);
	return dateKey(d);
};
// Wall-clock moment `mins` minutes after midnight on `day` (rolls into the next day if needed).
const wall = (day, mins) => {
	const date = addDays(day, Math.floor(mins / 1440));
	const m = ((mins % 1440) + 1440) % 1440;
	return { date, time: `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}` };
};
// { allDay, start: {date, time}, end: {date, time} }. An event with a start but no end is shown as one hour long.
export function eventSpan(e) {
	const start = startOf(e);
	if (!start) return { allDay: true, start: { date: e.date }, end: { date: addDays(e.date, 1) } };
	const s = minutes(start);
	const end = e.endTime && minutes(e.endTime) > s ? minutes(e.endTime) : s + 60;
	return { allDay: false, start: wall(e.date, s), end: wall(e.date, end) };
}
function eventDescription(e) {
	return [e.description || "", "Added from the DriveLab practice calendar."].filter(Boolean).join("\n\n");
}

// ---------------------------------------------------------------- export through the team's sync script
// The event as Google Calendar expects it. Timed events are wall-clock times; the sync script adds the team calendar's time zone.
export function googleEvent(e, timeZone = "") {
	const span = eventSpan(e);
	const when = (p) =>
		span.allDay ? { date: p.date } : { dateTime: `${p.date}T${p.time}:00`, ...(timeZone ? { timeZone } : {}) };
	return {
		id: googleEventId(e),
		summary: e.title || "Practice",
		description: eventDescription(e),
		start: when(span.start),
		end: when(span.end),
		extendedProperties: { private: { drivelab: "1", drivelabId: String(e.id) } },
	};
}

// A sync link is the web app URL Apps Script shows after "Deploy" (it ends in /exec).
export const isSyncUrl = (url) =>
	/^https:\/\/script\.google\.com\/(a\/[^/]+\/)?macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(String(url).trim());

async function post(url, body) {
	let response;
	try {
		// text/plain keeps this a "simple" request (no CORS preflight, which Apps Script cannot answer); the body is still JSON.
		response = await fetch(url, {
			method: "POST",
			redirect: "follow",
			headers: { "Content-Type": "text/plain;charset=utf-8" },
			body: JSON.stringify(body),
		});
	} catch {
		throw new Error(
			"Could not reach the sync script. Check the sync link, and that the web app was deployed with Who has access set to Anyone.",
		);
	}
	let data;
	try {
		data = await response.json();
	} catch {
		throw new Error(
			"The sync link did not answer like the DriveLab sync script. Check that you copied the Web app URL (ending in /exec) and that Who has access is Anyone.",
		);
	}
	if (!data.ok) throw new Error(data.error || "The sync script reported an error.");
	return data;
}

// The export. Sends the practices in batches (Apps Script runs are time-limited) and adds up the results.
// `events` are the practices to add; `allEvents` is every practice still in DriveLab (the optional clean-up keeps all of these).
export async function exportViaScript({ url, idToken, events, allEvents = events, removeDeleted = false, onProgress }) {
	const BATCH = 100;
	const result = { calendar: { name: "" }, added: 0, skipped: 0, failed: [], removed: 0 };
	const batches = [];
	for (let i = 0; i < events.length; i += BATCH) batches.push(events.slice(i, i + BATCH));
	if (!batches.length) batches.push([]); // clean-up only
	let done = 0;
	for (let i = 0; i < batches.length; i++) {
		const last = i === batches.length - 1;
		const data = await post(url, {
			action: "export",
			idToken,
			events: batches[i].map((e) => googleEvent(e)),
			removeDeleted: last && removeDeleted,
			keep: last && removeDeleted ? allEvents.map(googleEventId) : [],
		});
		result.calendar.name = data.calendarName || result.calendar.name;
		result.added += data.added || 0;
		result.skipped += data.skipped || 0;
		result.removed += data.removed || 0;
		(data.failed || []).forEach((f) =>
			result.failed.push({ event: batches[i].find((e) => googleEventId(e) === f.id) || { title: f.id, date: "" }, message: f.message }),
		);
		done += batches[i].length;
		onProgress?.(done, events.length);
	}
	return result;
}

// ---------------------------------------------------------------- .ics file (backup method)
const icsText = (value) =>
	String(value || "")
		.replace(/\\/g, "\\\\")
		.replace(/;/g, "\\;")
		.replace(/,/g, "\\,")
		.replace(/\r?\n/g, "\\n");
// RFC 5545 lines are at most 75 octets; longer lines continue on the next line after a single space.
function fold(line) {
	const bytes = new TextEncoder();
	if (bytes.encode(line).length <= 75) return line;
	const out = [];
	let current = "";
	for (const ch of line) {
		if (bytes.encode(current + ch).length > (out.length ? 74 : 75)) {
			out.push(current);
			current = ch;
		} else current += ch;
	}
	out.push(current);
	return out.join("\r\n ");
}
const icsStamp = (d) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
export function buildIcs(events) {
	const stamp = icsStamp(new Date());
	const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//DriveLab//Practice calendar//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH"];
	for (const e of events) {
		const span = eventSpan(e);
		const day = (p) => p.date.replace(/-/g, "");
		lines.push(
			"BEGIN:VEVENT",
			// The same UID every time this practice is exported, so Google's Import skips it once it is in the calendar.
			// (It matches the iCalUID Google gives an event created by the direct export, "<event id>@google.com".)
			`UID:${googleEventId(e)}@google.com`,
			`DTSTAMP:${stamp}`,
			span.allDay ? `DTSTART;VALUE=DATE:${day(span.start)}` : `DTSTART:${day(span.start)}T${span.start.time.replace(":", "")}00`,
			span.allDay ? `DTEND;VALUE=DATE:${day(span.end)}` : `DTEND:${day(span.end)}T${span.end.time.replace(":", "")}00`,
			`SUMMARY:${icsText(e.title || "Practice")}`,
			`DESCRIPTION:${icsText(eventDescription(e))}`,
			"END:VEVENT",
		);
	}
	lines.push("END:VCALENDAR");
	return lines.map(fold).join("\r\n") + "\r\n";
}
export function downloadIcs(events) {
	const blob = new Blob([buildIcs(events)], { type: "text/calendar;charset=utf-8" });
	const url = URL.createObjectURL(blob);
	const a = Object.assign(document.createElement("a"), { href: url, download: `DriveLab-practice-calendar-${todayKey()}.ics` });
	document.body.append(a);
	a.click();
	a.remove();
	setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// ---------------------------------------------------------------- instructions shown on the Practice calendar page (administrators)
export const SCRIPT_FILE = "google-apps-script/DriveLabCalendarSync.gs";
export function exportInstructionsHtml({ syncUrl = "", lastExport = null, firebase = true } = {}) {
	const last = lastExport?.at
		? `<p class="help">Last export: ${esc(new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(lastExport.at)))} to <strong>${esc(lastExport.calendarName || "the team calendar")}</strong> (${lastExport.added} added, ${lastExport.skipped} already there${lastExport.removed ? `, ${lastExport.removed} removed` : ""}${lastExport.failed ? `, ${lastExport.failed} failed` : ""}).</p>`
		: "";
	return `<section class="panel export-help" id="export-help">
  <div class="panel-heading"><div><h3>How to export to the team Google Calendar</h3><p>Administrators only. The export adds DriveLab practices to the team calendar. It never removes or changes the calendar's other events, and exporting again only adds practices that are not there yet. No Google Cloud Console, Google Auth Platform, app verification, or privacy policy is needed.</p></div></div>
  <div class="export-body">
    ${syncUrl ? `<p class="notice">The team calendar's sync link is set up. Press <strong>Export to Team Google Calendar</strong> to export.</p>` : `<p class="notice">The sync link is not set up yet. Do the one-time setup below first.</p>`}
    ${last}
    <details class="export-steps" ${syncUrl ? "" : "open"}>
      <summary>One-time setup (about 10 minutes, on a computer)</summary>
      <p class="help">Do Parts A to C signed in with the Google account that <strong>owns the team Google Calendar</strong>. Exported practices are added by that account. Part D can be done by any DriveLab administrator.</p>
      <h4>Part A: Copy the team calendar's Calendar ID</h4>
      <ol>
        <li>Open <a href="https://calendar.google.com/" target="_blank" rel="noopener">Google Calendar</a> on a computer (the phone app does not show Calendar IDs).</li>
        <li>In the left-hand column, under <strong>My calendars</strong>, find the team calendar (click the arrow beside the heading if the list is collapsed).</li>
        <li>Point at the team calendar's name, click the <strong>⋮</strong> (three dots) that appears to its right, then click <strong>Settings and sharing</strong>.</li>
        <li>In the list down the left side of the settings page, click <strong>Integrate calendar</strong>. Under <strong>Calendar ID</strong> is a long address, usually ending in <code>@group.calendar.google.com</code>. Highlight it and copy it (Ctrl+C, or ⌘+C on a Mac). Check that the name at the top of the page is the team calendar, not your personal one.</li>
      </ol>
      <h4>Part B: Create the sync script</h4>
      <ol>
        <li>Open <a href="https://script.google.com/home" target="_blank" rel="noopener">Google Apps Script</a> (script.google.com), still signed in as the calendar's owner. If it asks, accept the terms.</li>
        <li>Click <strong>+ New project</strong> at the top left. A code editor opens with a file named <strong>Code.gs</strong>.</li>
        <li>Click <strong>Untitled project</strong> at the top left, type <code>DriveLab Calendar Sync</code>, and click <strong>Rename</strong>.</li>
        <li>In the DriveLab project folder, open <code>${SCRIPT_FILE}</code> in a text editor (for example VS Code), select everything, and copy it. In the Apps Script editor, click inside the code, select all of the starter code (Ctrl+A / ⌘+A), and paste over it.</li>
        <li>Find the line <code>const CALENDAR_ID = "PASTE_TEAM_CALENDAR_ID_HERE";</code> near the top. Replace <code>PASTE_TEAM_CALENDAR_ID_HERE</code> with the Calendar ID from Part A. Keep the quotation marks.</li>
        <li>Click the <strong>Save project</strong> icon (a floppy disk) in the toolbar above the code, or press Ctrl+S / ⌘+S.</li>
        <li>In the left-hand column of the editor, next to <strong>Services</strong>, click the <strong>+</strong>. In the list, click <strong>Google Calendar API</strong>, leave the identifier as <code>Calendar</code>, and click <strong>Add</strong>. "Calendar" now appears under Services.</li>
        <li>In the toolbar above the code is a drop-down of function names. Choose <strong>setup</strong>, then click <strong>▷ Run</strong>.</li>
        <li>An <strong>Authorization required</strong> box appears. Click <strong>Review permissions</strong> and choose the calendar owner's account. Google shows "Google hasn't verified this app" because the script is your own; click <strong>Advanced</strong> (bottom left), then <strong>Go to DriveLab Calendar Sync (unsafe)</strong>. On the next screen, tick <strong>Select all</strong> if it is shown, then click <strong>Allow</strong> (or <strong>Continue</strong>).</li>
        <li>The <strong>Execution log</strong> opens under the code. It should say <em>Connected to the team calendar: "…"</em> with the team calendar's name. If it shows an error instead, check the Calendar ID line and run <strong>setup</strong> again.</li>
      </ol>
      <h4>Part C: Publish the script as a web app and copy its link</h4>
      <ol>
        <li>At the top right of the editor, click the blue <strong>Deploy</strong> button, then <strong>New deployment</strong>.</li>
        <li>In the window, click the <strong>gear icon</strong> next to <strong>Select type</strong> and choose <strong>Web app</strong>.</li>
        <li>Fill in the settings: <strong>Description</strong> <code>DriveLab sync</code>; <strong>Execute as</strong> <strong>Me (your email)</strong>; <strong>Who has access</strong> <strong>Anyone</strong> (not "Anyone with Google account"). The script refuses every request that does not come from a signed-in DriveLab administrator, so this is safe.</li>
        <li>Click <strong>Deploy</strong>. If Google asks you to authorize again, repeat the permission steps from Part B step 9.</li>
        <li>Under <strong>Web app</strong>, copy the <strong>URL</strong> (it starts with <code>https://script.google.com/macros/s/</code> and ends in <code>/exec</code>) with the <strong>Copy</strong> button, then click <strong>Done</strong>. This is the <strong>sync link</strong>.</li>
      </ol>
      <h4>Part D: Save the sync link in DriveLab and run the first export</h4>
      <ol>
        <li>Make sure the latest <code>firestore.rules</code> has been published (Firebase console → <strong>Firestore Database</strong> → <strong>Rules</strong> tab → paste → <strong>Publish</strong>).</li>
        <li>In DriveLab, sign in with <strong>Administrator sign in</strong> (top right), then open <strong>Practice calendar</strong> from the menu (left side on a computer, top row on a phone).</li>
        <li>At the top right of the page, next to the orange <strong>Add practice</strong> button, click <strong>Export to Team Google Calendar</strong>.</li>
        <li>Paste the sync link into <strong>Team calendar sync link</strong> and click <strong>Export now</strong>. DriveLab remembers the link for every administrator, so it is only pasted once.</li>
      </ol>
    </details>
    <details class="export-steps" open>
      <summary>Every time you export (under a minute)</summary>
      <ol>
        <li>Add the practices for the coming period (for example, next month) with <strong>Add practice</strong>.</li>
        <li>Click <strong>Export to Team Google Calendar</strong> (top right of this page), then <strong>Export now</strong>. No Google pop-up appears.</li>
        <li>Wait for the summary: it lists how many practices were <strong>added</strong> and how many were <strong>already in Google Calendar</strong> (skipped, so nothing is duplicated). Click <strong>Open Google Calendar</strong> to see them.</li>
      </ol>
      <p class="help">Removed a practice from DriveLab after exporting it? Tick <strong>Also remove practices deleted from DriveLab</strong> in the export window, which deletes only those DriveLab-created copies. Otherwise delete it in Google Calendar yourself. DriveLab events cannot be edited, so to change a practice, remove it, add the corrected one, and export with that box ticked.</p>
    </details>
    <details class="export-steps">
      <summary>Backup method: import an .ics file (no setup needed)</summary>
      <ol>
        <li>Click <strong>Export to Team Google Calendar</strong>, then <strong>Download .ics file</strong>.</li>
        <li>On a computer, open <a href="https://calendar.google.com/calendar/r/settings/export" target="_blank" rel="noopener">Google Calendar → Settings → Import &amp; export</a>.</li>
        <li>Click <strong>Select file from your computer</strong>, pick the downloaded file, set <strong>Add to calendar</strong> to the <strong>team calendar</strong> (not your personal one), and click <strong>Import</strong>.</li>
      </ol>
      <p class="help">Each practice keeps the same ID in every file, so Google skips the ones already imported and adds only the new ones. Use one method (sync link or file import) for the team calendar, not both.</p>
    </details>
    <details class="export-steps">
      <summary>Changing the script later</summary>
      <ol>
        <li>Edit and save the code in Apps Script, then click <strong>Deploy → Manage deployments</strong>.</li>
        <li>Select the <strong>DriveLab sync</strong> deployment, click the <strong>pencil</strong> (Edit) icon, set <strong>Version</strong> to <strong>New version</strong>, and click <strong>Deploy</strong>. The sync link stays the same, so nothing changes in DriveLab.</li>
      </ol>
    </details>
    ${firebase ? "" : `<p class="notice">This is the local preview, which has no administrator sign-in, so only the .ics file method is available here.</p>`}
  </div>
</section>`;
}

// The export dialog (sync link, options, and the two methods).
export function exportDialogHtml({ syncUrl = "", count, upcoming, firebase }) {
	return `<div class="modal-head"><div><p class="eyebrow">PRACTICE CALENDAR</p><h2>Export to Team Google Calendar</h2></div><button class="close" id="close-modal" aria-label="Close">×</button></div>
<form id="gcal-form" class="event-form">
  <p class="help" style="margin:0">DriveLab has <strong>${count}</strong> practice${count === 1 ? "" : "s"} (${upcoming} from today onward). Practices already in the team calendar are skipped, so nothing is added twice. Other events on the team calendar are never changed or removed.</p>
  <div class="field"><label for="gcal-url">Team calendar sync link <span class="required">*</span></label><input id="gcal-url" name="gcal-url" required value="${esc(syncUrl)}" placeholder="https://script.google.com/macros/s/…/exec" ${firebase ? "" : "disabled"} autocomplete="off" spellcheck="false" /><span class="help">The Web app URL from the one-time setup (Part C). It is saved for every administrator.</span></div>
  <label class="b-check"><input type="checkbox" id="gcal-upcoming" checked /> Only export practices from today onward</label>
  <label class="b-check"><input type="checkbox" id="gcal-remove" ${firebase ? "" : "disabled"} /> Also remove practices deleted from DriveLab (only DriveLab-created copies)</label>
  <div id="gcal-status" class="gcal-status" role="status" hidden></div>
  <div class="form-actions gcal-actions"><button type="button" class="button button-secondary" id="gcal-ics">Download .ics file</button><button class="button" type="submit" id="gcal-go" ${firebase ? "" : "disabled"}>Export now</button></div>
  ${firebase ? "" : `<p class="notice">Exporting with the sync link needs the Firebase (administrator sign-in) version of the site. In this local preview, use Download .ics file.</p>`}
</form>`;
}
export const upcomingOnly = (events) => events.filter((e) => e.date >= todayKey());
export { dateText };
