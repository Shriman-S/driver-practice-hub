// The three built-in drill forms (Speed, Defensive, Offensive driving) as EDITABLE forms.
//
// constants.js still holds each drill's ORIGINAL questions (FACETS). An administrator can now change a drill's form in the Form
// builder ("Edit form" on the Practice form tab) with the same controls as a custom form: the form description, section titles and
// descriptions, every question's wording, description and hint, the order of questions and sections, the coach-observation choices,
// and new sections and questions of any type. The edited form is saved in the `customForms` collection with the id
// "builtin-<drill>" (for example "builtin-speed") and the marker `builtin: "<drill>"`, so the existing Firestore rules apply (everyone
// may read forms, only administrators may change them) and nothing new needs publishing.
//
// A drill form uses the custom-form shape (see customforms.js) with two additions:
//   section.role    - "driver" | "performance" | "coach" for the three original sections; the drill's built-in timer is shown at the
//                     top of the "performance" section
//   question.field  - for an ORIGINAL question: the key its answer is saved under (driverName, totalTime, observations, notes, ...).
//                     These questions are `locked`: they can be reworded, described, and moved, but not deleted and not given another
//                     type, because the score (scoring.js), the timer, and the Analysis tab read them. Their answers are saved exactly
//                     as before (data.totalTime, data.observations, ...).
// Questions an administrator ADDS behave exactly like custom-form questions; their answers are saved under data.answers[<question id>].
import { FACETS, OBSERVATIONS, FACET_COURSE_GROUP } from "./constants.js";
import { fieldHtml } from "./fields.js";
import { questionHtml, normalizeForm, allQuestions, parseOptions } from "./customforms.js";
import { esc, blocksHtml, textToBlocks, blocksToText } from "./util.js";

export const drillFormId = (facet) => `builtin-${facet}`;
export const isDrillForm = (form) => Boolean(form?.builtin) || String(form?.id || "").startsWith("builtin-");
const NOTES_PLACEHOLDER = "Describe what was notable about the driver's driving.";

// The original form for a drill, built from constants.js.
export function defaultDrillForm(facet) {
	const f = FACETS[facet];
	const q = (def) => ({
		id: `b-${def[0]}`,
		field: def[0],
		locked: true,
		type: def[2],
		label: def[1],
		required: Boolean(def[3]),
		help: def[4] || "",
		description: def[5] ? blocksToText(def[5]) : "",
		shortLabel: def[6] || "",
		optionsText: "",
		min: "",
		max: "",
		scaleMax: 5,
	});
	const tool = { type: "none", seconds: 90, fillQuestionId: "" };
	return {
		builtin: facet,
		id: drillFormId(facet),
		title: f.label,
		description: blocksToText(f.intro),
		sections: [
			{ id: "s-driver", role: "driver", title: "Driver information", description: "Who is driving, and when the practice took place.", tool, questions: f.driverFields.map(q) },
			{ id: "s-performance", role: "performance", title: "Driver performance", description: "Start the timer below, then answer each question about the driver's performance.", tool, questions: f.fields.map(q) },
			{
				id: "s-coach",
				role: "coach",
				title: "Coach observations",
				description: "These notes support coaching and are deliberately excluded from the numerical score.",
				tool,
				questions: [
					{ id: "b-observations", field: "observations", locked: true, type: "checkbox", label: "Observations", required: false, help: "", description: "", shortLabel: "", optionsText: OBSERVATIONS.join("\n"), min: "", max: "", scaleMax: 5 },
					{ id: "b-notes", field: "notes", locked: true, type: "paragraph", label: "Notable driving / coaching note", required: false, help: "", description: "", shortLabel: "", optionsText: "", min: "", max: "", scaleMax: 5 },
				],
			},
		],
		ranking: { questionId: "", direction: "higher" },
		courseGroup: FACET_COURSE_GROUP[facet],
		nextId: 1,
		createdAt: null,
		updatedAt: null,
	};
}

// The form a drill currently uses: the administrator's saved version, or the original. A saved version is checked against the original
// so the drill can never lose a question the score needs: a missing original question is put back in its usual section, and the
// fixed parts (title, type, key, and "always required") always come from the original.
export function drillForm(state, facet) {
	const original = defaultDrillForm(facet);
	const saved = (state?.data?.customForms || []).find((f) => f.id === drillFormId(facet));
	if (!saved) return original;
	const form = normalizeForm({ ...saved, builtin: facet });
	form.title = original.title;
	form.courseGroup = original.courseGroup;
	form.ranking = { questionId: "", direction: "higher" };
	const originals = Object.fromEntries(original.sections.flatMap((s) => s.questions.map((q) => [q.field, { q, section: s }])));
	const seen = new Set();
	for (const s of form.sections)
		s.questions = s.questions.filter((q) => {
			if (!q.field) return true;
			const o = originals[q.field];
			if (!o || seen.has(q.field)) return false; // an original question that no longer exists (or a duplicate)
			seen.add(q.field);
			Object.assign(q, { locked: true, type: o.q.type, required: o.q.required, id: o.q.id });
			q.shortLabel = q.label === o.q.label ? o.q.shortLabel : ""; // a reworded question uses its new wording in table headings
			if (q.field !== "observations") q.optionsText = "";
			return true;
		});
	for (const [field, o] of Object.entries(originals)) {
		if (seen.has(field)) continue;
		let home = form.sections.find((s) => s.role === o.section.role);
		if (!home) form.sections.push((home = { ...o.section, questions: [] }));
		home.questions.push({ ...o.q });
	}
	return form;
}
// The questions an administrator added (not the original ones), as a mini form for collectAnswers() / fillCustom().
export const addedQuestions = (form) => allQuestions(form).filter((q) => !q.field);
export const addedPart = (form) => ({ ...form, sections: [{ id: "added", title: "", description: "", tool: { type: "none" }, questions: addedQuestions(form) }] });
// The current wording of an original question (for column headings and response lists).
export function drillLabel(form, field, short = true) {
	const q = allQuestions(form).find((x) => x.field === field);
	return q ? (short && q.shortLabel ? q.shortLabel : q.label) : field;
}
// The coach-observation choices of a drill form.
export const observationChoices = (form) => parseOptions(allQuestions(form).find((q) => q.field === "observations")?.optionsText || "");

// ---------------------------------------------------------------- drawing a drill form
// options:
//   courses   - state.data.courses (Course dropdown)
//   edit      - the administrator's Edit attempt pop-up (no timer or buttons; only name and date required)
//   preview   - the Form builder preview (the timer is shown as a placeholder; submitting saves nothing)
//   values    - answers to show (edit): { driverName, grade, practiceDate, ...data }
//   timer     - the timer panel's HTML (Practice form only; drawn by app.js)
//   adminBar  - HTML shown above the form for administrators (the Edit form button)
function lockedQuestionHtml(q, facet, opts) {
	const { courses, edit, values = {} } = opts;
	const prefix = edit ? "edit-" : "";
	if (q.field === "observations") {
		const picked = values.observations || [];
		const desc = q.description?.trim() ? `<div class="q-desc">${blocksHtml(textToBlocks(q.description))}</div>` : "";
		return `<div class="field full"><span class="q-label">${esc(q.label)}</span>${desc}<div class="checkboxes">${parseOptions(q.optionsText)
			.map((o) => `<label><input type="checkbox" name="observation" value="${esc(o)}" ${picked.includes(o) ? "checked" : ""}> ${esc(o)}</label>`)
			.join("")}</div>${q.help ? `<span class="help">${esc(q.help)}</span>` : ""}</div>`;
	}
	if (q.field === "notes") {
		const desc = q.description?.trim() ? `<div class="q-desc" id="${prefix}notes-desc">${blocksHtml(textToBlocks(q.description))}</div>` : "";
		return `<div class="field full"><label for="${prefix}notes">${esc(q.label)}</label>${desc}<textarea id="${prefix}notes" name="notes" maxlength="600" placeholder="${esc(NOTES_PLACEHOLDER)}" ${desc ? `aria-describedby="${prefix}notes-desc"` : ""}>${esc(values.notes || "")}</textarea>${q.help ? `<span class="help">${esc(q.help)}</span>` : ""}</div>`;
	}
	const blocks = q.description?.trim() ? textToBlocks(q.description) : null;
	return fieldHtml([q.field, q.label, q.type, q.required, q.help, blocks], { facet, courses, edit, value: edit ? values[q.field] : undefined, idPrefix: prefix });
}
export function drillFormHtml(form, facet, opts = {}) {
	const { edit = false, preview = false, timer = "", adminBar = "" } = opts;
	const sections = form.sections
		.map((s) => {
			const tool = s.role === "performance" && !edit ? (preview ? '<div class="timer timer-placeholder"><span class="tag">TIMER</span><span class="help">The drill\'s timer appears here.</span></div>' : timer) : "";
			const desc = s.description?.trim() ? (edit ? "" : `<div class="section-desc">${blocksHtml(textToBlocks(s.description))}</div>`) : "";
			return `<div class="form-section"><h3>${esc(s.title)}</h3>${desc}${tool}<div class="field-grid">${s.questions
				.map((q) => (q.field ? lockedQuestionHtml(q, facet, opts) : questionHtml(q, form, edit)))
				.join("")}</div></div>`;
		})
		.join("");
	if (edit) return `<form id="edit-attempt-form" class="form-panel edit-form" novalidate>${sections}</form>`;
	return `${adminBar}<form id="practice-form" class="panel form-panel"><div class="form-header"><h3>${esc(form.title)}</h3><div class="form-intro">${blocksHtml(textToBlocks(form.description))}</div></div>${sections}<div class="form-actions"><button type="reset" class="button button-secondary">Clear</button><button class="button" type="submit">${preview ? "Submit (preview only)" : "Submit practice"}</button></div></form>`;
}
