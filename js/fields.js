// One question on a built-in drill form (and the shared Driver information questions on custom forms), as HTML.
// Used by the Practice form AND by the administrator's "Edit attempt" pop-up, so a question always looks the same in both.
//
// def is a FACETS field array (see constants.js): [ name, label, type, required, help, description, shortLabel ]
// options:
//   facet     - the drill, for the Course dropdown (its course family's published courses); a custom form passes `courseGroup`
//   courses   - state.data.courses (course names)
//   value     - the current answer (edit mode)
//   edit      - edit mode: only the driver name and practice date stay required, so an administrator can fill in old attempts
//               a little at a time; unanswered questions are marked
//   idPrefix  - prefix for element ids (the edit pop-up uses "edit-" so its ids never clash with the page)
// NOTE: each control needs a `name` as well as an `id`; FormData (used when submitting) only reads controls that have a name.
import { GRADES, ROBOTS, FACET_COURSE_GROUP } from "./constants.js";
import { COURSE_GROUPS, publishedCourses, courseLabel } from "./courses.js";
import { esc, blocksHtml } from "./util.js";

const ALWAYS_REQUIRED = ["driverName", "practiceDate"];

// The Course dropdown's choices for a course family ("speed", "defense", "shooting") or "all" (custom forms can use any course).
export function courseOptions(courses = {}, group = "all") {
	if (group !== "all") return publishedCourses(courses, group).map((c) => ({ value: c.key, label: `Course ${c.number}: ${c.name}` }));
	return COURSE_GROUPS.flatMap((g) =>
		publishedCourses(courses, g.key).map((c) => ({ value: c.key, label: `${g.label}, Course ${c.number}: ${c.name}` })),
	);
}

function selectHtml(id, name, choices, placeholder, value, attrs) {
	const list = [...choices];
	// An answer that is no longer offered (for example a deleted course) is still shown, so editing never loses it.
	if (value && !list.some((c) => c.value === value)) list.push({ value, label: value });
	return `<select id="${id}" name="${name}" ${attrs}><option value="">${esc(placeholder)}</option>${list
		.map((c) => `<option value="${esc(c.value)}" ${c.value === value ? "selected" : ""}>${esc(c.label)}</option>`)
		.join("")}</select>`;
}

export function fieldHtml(def, { facet = "", courseGroup = "", courses = {}, value, edit = false, idPrefix = "" } = {}) {
	const [name, label, type, requiredDef, help = "", description = null] = def;
	const id = `${idPrefix}${name}`;
	let required = edit ? ALWAYS_REQUIRED.includes(name) && requiredDef : requiredDef;
	let note = help;
	const described = description ? `aria-describedby="${id}-desc"` : "";
	const v = value === undefined || value === null ? "" : String(value);
	let control;
	if (type === "select" || type === "robot") {
		const choices = (type === "select" ? GRADES : ROBOTS).map((x) => ({ value: x, label: x }));
		control = selectHtml(id, name, choices, type === "select" ? "Select grade" : "Select robot", v, `${described} ${required ? "required" : ""}`);
	} else if (type === "course") {
		const group = courseGroup || FACET_COURSE_GROUP[facet] || "all";
		const choices = courseOptions(courses, group);
		if (!choices.length) {
			// Nothing to choose from yet: the question is shown but cannot block a submission.
			required = false;
			note = "No courses have been published for this drill yet. An administrator can add them in the Course builder.";
		}
		const shown = v && !choices.some((c) => c.value === v) ? [...choices, { value: v, label: courseLabel(courses, v) }] : choices;
		control = selectHtml(id, name, shown, choices.length ? "Select course" : "No courses published yet", v, `${described} ${required ? "required" : ""}`);
	} else
		control = `<input id="${id}" name="${name}" ${described} type="${type}" ${type === "number" ? "min=0 step=any" : ""} ${type === "text" ? 'maxlength="80"' : ""} value="${esc(v)}" ${required ? "required" : ""}/>`;
	const unanswered = edit && v === "";
	return `<div class="field${unanswered ? " unanswered" : ""}"><label for="${id}">${esc(label)} ${required ? '<span class="required">*</span>' : ""}${unanswered ? ' <span class="no-answer">No answer yet</span>' : ""}</label>${description ? `<div class="q-desc" id="${id}-desc">${blocksHtml(description)}</div>` : ""}${control}${note ? `<span class="help">${esc(note)}</span>` : ""}</div>`;
}
