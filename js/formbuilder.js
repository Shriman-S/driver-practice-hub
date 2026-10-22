// The administrator's Form builder page. It has two modes:
//   list   - every custom form, with Edit / Open / Analysis / Delete
//   editor - build or change one form: title and description, sections, questions (with descriptions), tools, and analysis settings
// The form being edited is a plain object kept in state.formDraft (its shape is described at the top of customforms.js). Typing into
// a box updates that object directly (no re-draw, so focus is never lost); structural changes such as adding a question re-draw the page.
import { esc, now, uid } from "./util.js";
import {
	QUESTION_TYPES,
	TOOL_TYPES,
	hasOptions,
	isNumeric,
	parseOptions,
	normalizeForm,
	allQuestions,
	customFormHtml,
	bindCustomForm,
	formFacet,
	COURSE_GROUP_CHOICES,
} from "./customforms.js";
import { FACETS } from "./constants.js";
import { drillForm, drillFormHtml, drillFormId, isDrillForm } from "./drillforms.js";

// Built-in drill forms (drillforms.js) are edited here too. Their original questions are `locked`: they can be reworded, described,
// given a hint, and moved, but not deleted or given another type, because the score, the timer, and Analysis read them.
const DRILLS = Object.keys(FACETS);
const LOCKED_TYPE_NAMES = { text: "Short answer", number: "Number", date: "Date", select: "Grade dropdown", robot: "Robot dropdown", course: "Course dropdown", checkbox: "Tick boxes", paragraph: "Long answer" };
const hasLocked = (section) => section.questions.some((q) => q.field);

const typeLabel = (value) =>
	QUESTION_TYPES.find((t) => t.value === value)?.label || value;

// ---------------------------------------------------------------- drafts
function newQuestion(draft, type = "number") {
	return {
		id: `q${draft.nextId++}`,
		type,
		label: "",
		description: "",
		required: true,
		optionsText: "",
		min: "",
		max: "",
		scaleMax: 5,
	};
}
function newSection(draft, title = "") {
	return {
		id: `s${draft.nextId++}`,
		title,
		description: "",
		tool: { type: "none", seconds: 90, fillQuestionId: "" },
		questions: [],
	};
}
// A new form starts like the built-in ones: a Driver performance section (with one blank question to fill in) and a Coach observations section.
function createDraft() {
	const draft = {
		id: uid(),
		title: "",
		description: "",
		sections: [],
		ranking: { questionId: "", direction: "higher" },
		courseGroup: "all",
		nextId: 1,
		createdAt: now(),
		updatedAt: null,
	};
	const performance = newSection(draft, "Driver performance");
	performance.questions.push(newQuestion(draft, "number"));
	const coach = newSection(draft, "Coach observations");
	coach.description =
		"These notes support coaching and are not part of any ranking.";
	const observations = newQuestion(draft, "checkbox");
	observations.label = "Observations";
	observations.optionsText = "Speed\nAgility\nSmooth driving";
	observations.required = false;
	const note = newQuestion(draft, "paragraph");
	note.label = "Notable driving / coaching note";
	note.required = false;
	coach.questions.push(observations, note);
	draft.sections.push(performance, coach);
	return draft;
}
const clone = (value) => JSON.parse(JSON.stringify(value)); // also strips `undefined`, which Firestore refuses to store

function getByPath(object, path) {
	return path.split(".").reduce((o, k) => o?.[k], object);
}
function setByPath(object, path, value) {
	const keys = path.split("."),
		last = keys.pop();
	keys.reduce((o, k) => o[k], object)[last] = value;
}

// Everything wrong with a form, in plain language. An empty list means it can be saved.
export function validateDraft(draft) {
	const problems = [];
	if (!draft.title.trim()) problems.push("Give the form a title.");
	if (!draft.sections.length) problems.push("Add at least one section.");
	draft.sections.forEach((s, si) => {
		const where = `Section ${si + 1}${s.title.trim() ? ` ("${s.title.trim()}")` : ""}`;
		if (!s.title.trim()) problems.push(`${where} needs a title.`);
		if (!s.questions.length)
			problems.push(
				`${where} needs at least one question (or delete the section).`,
			);
		if (
			s.tool.type === "countdown" &&
			!(
				Number.isInteger(Number(s.tool.seconds)) &&
				Number(s.tool.seconds) >= 5 &&
				Number(s.tool.seconds) <= 7200
			)
		)
			problems.push(
				`${where}: the countdown must be a whole number of seconds between 5 and 7200.`,
			);
		s.questions.forEach((q, qi) => {
			const at = `${where}, question ${qi + 1}`;
			if (!q.label.trim()) problems.push(`${at} needs a question.`);
			if (hasOptions(q.type) && parseOptions(q.optionsText).length < 2)
				problems.push(`${at} needs at least two options (one per line).`);
			if (
				q.type === "number" &&
				q.min !== "" &&
				q.max !== "" &&
				Number(q.min) > Number(q.max)
			)
				problems.push(`${at}: the minimum is larger than the maximum.`);
		});
	});
	if (
		draft.ranking.questionId &&
		!allQuestions(draft).some(
			(q) => q.id === draft.ranking.questionId && isNumeric(q.type),
		)
	)
		problems.push(
			"The ranking question must be a number or rating-scale question that still exists.",
		);
	return problems;
}
// The form exactly as it will be saved and shown to students.
const finalize = (draft) =>
	normalizeForm(
		clone({ ...draft, title: draft.title.trim(), updatedAt: now() }),
	);

// ---------------------------------------------------------------- page
export function renderFormBuilder(ctx) {
	return ctx.state.formDraft ? renderEditor(ctx) : renderList(ctx);
}

function renderList(ctx) {
	const { state } = ctx,
		forms = state.data.customForms.filter((f) => !isDrillForm(f)).map(normalizeForm);
	const items = forms.length
		? forms
				.map((f) => {
					const questions = allQuestions(f).length,
						attempts = state.data.submissions.filter(
							(x) => x.facet === formFacet(f.id),
						).length;
					return `<div class="custom-item"><span><strong>${esc(f.title || "(untitled form)")}</strong><br><small>${questions ? `${f.sections.length} section${f.sections.length === 1 ? "" : "s"} | ${questions} question${questions === 1 ? "" : "s"} | ${attempts} attempt${attempts === 1 ? "" : "s"} recorded` : "Not published: this form has no questions yet. Edit it to add some."}</small></span>
      <span class="item-actions">${questions ? `<button class="button button-secondary button-small" data-form-open="${esc(f.id)}">Open form</button><button class="button button-secondary button-small" data-form-analysis="${esc(f.id)}">Analysis</button>` : ""}<button class="button button-secondary button-small" data-form-edit="${esc(f.id)}">Edit</button><button class="button button-danger button-small" data-form-delete="${esc(f.id)}">Delete</button></span></div>`;
				})
				.join("")
		: '<p class="help">No custom forms yet. Create one and it will appear on the Practice form tab for everyone.</p>';
	const drills = DRILLS.map((k) => {
		const saved = state.data.customForms.find((f) => f.id === drillFormId(k));
		const form = drillForm(state, k);
		const questions = allQuestions(form).length;
		const status = saved ? `Edited${saved.updatedAt ? ` ${new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(saved.updatedAt))}` : ""}` : "Original form";
		return `<div class="custom-item"><span><strong>${esc(FACETS[k].label)}</strong> <span class="drill-status${saved ? " edited" : ""}">${esc(status)}</span><br><small>${form.sections.length} sections | ${questions} questions | scored by the drill's scoring settings</small></span>
      <span class="item-actions"><button class="button button-secondary button-small" data-drill-open="${k}">Open form</button><button class="button button-secondary button-small" data-drill-edit="${k}">Edit</button>${saved ? `<button class="button button-secondary button-small" data-drill-restore="${k}">Restore original</button>` : ""}</span></div>`;
	}).join("");
	return `${ctx.pageHeader("Form builder", "Build your own practice forms with sections, questions, descriptions, and timers, or change the built-in drill forms. Every saved form appears on the Practice form tab.", '<button class="button" id="new-form">Create new form</button>')}<section class="panel form-panel"><div class="panel-heading"><div><h3>Built-in drill forms</h3><p>Change a drill's description, questions, and sections. The questions its score uses can be reworded but not removed.</p></div></div><div class="custom-list">${drills}</div></section><section class="panel form-panel" style="margin-top:18px"><div class="panel-heading"><div><h3>Custom forms</h3></div></div><div class="custom-list">${items}</div></section>`;
}

function lockedQuestionEditor(draft, section, si, question, qi) {
	const p = `sections.${si}.questions.${qi}`,
		count = section.questions.length;
	const scored = FACETS[draft.builtin]?.fields.some((f) => f[0] === question.field);
	const note = scored
		? "Used by this drill's score, so it cannot be removed or given another type. Its answer must be a number."
		: question.field === "observations" || question.field === "notes"
			? "One of the drill's original questions. It cannot be removed, but its wording and choices can change."
			: "One of the drill's original questions. It cannot be removed or given another type.";
	const options =
		question.field === "observations"
			? `<label class="b-field"><span>Choices (one per line)</span><textarea rows="4" data-path="${p}.optionsText">${esc(question.optionsText)}</textarea></label><p class="help">Renaming a choice does not change attempts already recorded with the old name.</p>`
			: "";
	return `<div class="b-question b-locked"><div class="b-qhead"><span class="b-num">Q${qi + 1}</span><span class="b-fixed-type" title="${esc(note)}">Built-in · ${esc(LOCKED_TYPE_NAMES[question.type] || question.type)}</span><input type="text" class="b-label" data-path="${p}.label" data-label value="${esc(question.label)}" aria-label="Question text"><span class="b-ctl"><button type="button" class="icon-btn" data-act="q-up" data-s="${si}" data-q="${qi}" ${qi === 0 ? "disabled" : ""} aria-label="Move question up">\u2191</button><button type="button" class="icon-btn" data-act="q-down" data-s="${si}" data-q="${qi}" ${qi === count - 1 ? "disabled" : ""} aria-label="Move question down">\u2193</button></span></div>
    <p class="help b-lock-note">${esc(note)} ${question.required ? "Always required." : "Optional."}</p>
    <label class="b-field"><span>Description (optional): explain how to answer. Start a line with "- " for a bullet point.</span><textarea rows="${question.description ? 4 : 2}" data-path="${p}.description">${esc(question.description)}</textarea></label>
    <label class="b-field"><span>Hint shown under the answer box (optional)</span><input type="text" data-path="${p}.help" value="${esc(question.help || "")}"></label>${options}</div>`;
}

function questionEditor(draft, section, si, question, qi) {
	if (question.field) return lockedQuestionEditor(draft, section, si, question, qi);
	const p = `sections.${si}.questions.${qi}`,
		count = section.questions.length;
	const typeSelect = `<select data-path="${p}.type" data-rerender aria-label="Question type">${QUESTION_TYPES.map((t) => `<option value="${t.value}" ${t.value === question.type ? "selected" : ""}>${t.label}</option>`).join("")}</select>`;
	let extra = "";
	if (hasOptions(question.type))
		extra = `<label class="b-field"><span>Options (one per line)</span><textarea rows="4" data-path="${p}.optionsText" placeholder="First option&#10;Second option">${esc(question.optionsText)}</textarea></label>`;
	if (question.type === "number")
		extra = `<div class="b-row"><label class="b-field"><span>Minimum (optional)</span><input type="number" step="any" data-path="${p}.min" value="${esc(question.min)}"></label><label class="b-field"><span>Maximum (optional)</span><input type="number" step="any" data-path="${p}.max" value="${esc(question.max)}"></label></div>`;
	if (question.type === "scale")
		extra = `<label class="b-field"><span>Scale goes from 1 to</span><select data-path="${p}.scaleMax">${[3, 4, 5, 6, 7, 8, 9, 10].map((n) => `<option ${Number(question.scaleMax) === n ? "selected" : ""}>${n}</option>`).join("")}</select></label>`;
	return `<div class="b-question"><div class="b-qhead"><span class="b-num">Q${qi + 1}</span>${typeSelect}<input type="text" class="b-label" data-path="${p}.label" data-label placeholder="Question, e.g. How many cones were knocked over?" value="${esc(question.label)}" aria-label="Question text"><span class="b-ctl"><button type="button" class="icon-btn" data-act="q-up" data-s="${si}" data-q="${qi}" ${qi === 0 ? "disabled" : ""} aria-label="Move question up">\u2191</button><button type="button" class="icon-btn" data-act="q-down" data-s="${si}" data-q="${qi}" ${qi === count - 1 ? "disabled" : ""} aria-label="Move question down">\u2193</button><button type="button" class="icon-btn danger" data-act="q-del" data-s="${si}" data-q="${qi}" aria-label="Delete question">\u2715</button></span></div>
    <label class="b-field"><span>Description (optional): explain how to answer. Start a line with "- " for a bullet point.</span><textarea rows="2" data-path="${p}.description" placeholder="Shown under the question to help recorders answer consistently.">${esc(question.description)}</textarea></label>
    ${extra}<label class="b-check"><input type="checkbox" data-path="${p}.required" ${question.required ? "checked" : ""}> Required</label></div>`;
}

function sectionEditor(draft, section, si) {
	const p = `sections.${si}`,
		last = draft.sections.length - 1,
		numberQs = allQuestions(draft).filter((q) => q.type === "number");
	const fillOptions = `<option value="">Do not fill any question</option>${numberQs.map((q) => `<option value="${q.id}" ${q.id === section.tool.fillQuestionId ? "selected" : ""}>${esc(q.label || "(untitled question)")}</option>`).join("")}`;
	const toolExtra =
		section.tool.type === "countdown"
			? `<label class="b-field"><span>Countdown length (seconds)</span><input type="number" min="5" max="7200" step="1" data-path="${p}.tool.seconds" value="${esc(section.tool.seconds)}"></label>`
			: section.tool.type === "stopwatch"
				? `<label class="b-field"><span>When stopped, enter the time into this number question</span><select data-path="${p}.tool.fillQuestionId" data-fill-select>${fillOptions}</select></label>`
				: "";
	return `<div class="b-section"><div class="b-shead"><strong>Section ${si + 1}</strong><span class="b-ctl"><button type="button" class="icon-btn" data-act="s-up" data-s="${si}" ${si === 0 ? "disabled" : ""} aria-label="Move section up">\u2191</button><button type="button" class="icon-btn" data-act="s-down" data-s="${si}" ${si === last ? "disabled" : ""} aria-label="Move section down">\u2193</button>${hasLocked(section) ? "" : `<button type="button" class="icon-btn danger" data-act="s-del" data-s="${si}" aria-label="Delete section">\u2715</button>`}</span></div>
    <label class="b-field"><span>Section title</span><input type="text" data-path="${p}.title" placeholder="e.g. Driver performance" value="${esc(section.title)}"></label>
    <label class="b-field"><span>Section description (optional)</span><textarea rows="2" data-path="${p}.description">${esc(section.description)}</textarea></label>
    ${
		draft.builtin
			? section.role === "performance"
				? `<p class="help">The drill's built-in ${FACETS[draft.builtin].timer === "stopwatch" ? "stopwatch (with Lap Split)" : "90-second countdown"} is shown at the top of this section.</p>`
				: ""
			: `<div class="b-row"><label class="b-field"><span>Tool shown at the top of this section</span><select data-path="${p}.tool.type" data-rerender>${TOOL_TYPES.map((t) => `<option value="${t.value}" ${t.value === section.tool.type ? "selected" : ""}>${t.label}</option>`).join("")}</select></label>${toolExtra}</div>`
	}
    <div class="b-questions">${section.questions.map((q, qi) => questionEditor(draft, section, si, q, qi)).join("")}</div>
    <button type="button" class="button button-secondary button-small" data-act="q-add" data-s="${si}">+ Add question</button></div>`;
}

function renderEditor(ctx) {
	const { state } = ctx,
		d = state.formDraft,
		numberish = allQuestions(d).filter((q) => isNumeric(q.type));
	const errors = state.formErrors?.length
		? `<div class="notice error" role="alert"><strong>This form is not ready to save:</strong><ul>${state.formErrors.map((e) => `<li>${esc(e)}</li>`).join("")}</ul></div>`
		: "";
	const published = state.data.customForms.some((f) => f.id === d.id);
	if (d.builtin) return drillEditor(ctx, d, errors, published);
	return `${ctx.pageHeader(published ? "Edit form" : "Create form", "Build the form the way students will see it. Use Preview to try it out before saving.", `<span class="hero-actions"><button class="button button-secondary" id="form-cancel">Cancel</button><button class="button button-secondary" id="form-preview">Preview</button><button class="button" id="form-save">Save form</button></span>`)}${errors}
  <section class="panel form-panel" id="form-editor">
    <div class="b-intro"><label class="b-field"><span>Form title <span class="required">*</span></span><input type="text" data-path="title" placeholder="e.g. Cone slalom drill" value="${esc(d.title)}"></label>
      <label class="b-field"><span>Form description (optional). Start a line with "- " for a bullet point.</span><textarea rows="4" data-path="description" placeholder="What does this form assess, and how is the practice run?">${esc(d.description)}</textarea></label>
      <label class="b-field"><span>Courses listed in the "Course driven" question</span><select data-path="courseGroup">${COURSE_GROUP_CHOICES.map(([k, label]) => `<option value="${k}" ${(d.courseGroup || "all") === k ? "selected" : ""}>${esc(label)}</option>`).join("")}</select></label>
      <p class="help">Every form automatically begins with a <strong>Driver information</strong> section (driver name, grade level, practice date, course driven, and robot driven) so each attempt belongs to a driver. The sections you add below follow it.</p></div>
    ${d.sections.map((s, si) => sectionEditor(d, s, si)).join("")}
    <button type="button" class="button button-secondary" data-act="s-add">+ Add section</button>
    <div class="b-section b-analysis"><div class="b-shead"><strong>Analysis settings</strong></div><p class="help">Every form gets an Analysis page with driver standings, question summaries, and a spreadsheet of all attempts. To rank drivers, choose the number or rating question that measures performance.</p>
      <div class="b-row"><label class="b-field"><span>Ranking question</span><select data-path="ranking.questionId" data-ranking-select><option value="">None (list drivers by number of attempts)</option>${numberish.map((q) => `<option value="${q.id}" ${q.id === d.ranking.questionId ? "selected" : ""}>${esc(q.label || "(untitled question)")}</option>`).join("")}</select></label>
        <label class="b-field"><span>Better results are</span><select data-path="ranking.direction"><option value="higher" ${d.ranking.direction === "higher" ? "selected" : ""}>Higher numbers (for example, points scored)</option><option value="lower" ${d.ranking.direction === "lower" ? "selected" : ""}>Lower numbers (for example, time or penalties)</option></select></label></div></div>
  </section>`;
}

function drillEditor(ctx, d, errors, saved) {
	return `${ctx.pageHeader(`Edit the ${FACETS[d.builtin].label} form`, "Change the form the way recorders will see it. Use Preview to try it out before saving.", `<span class="hero-actions"><button class="button button-secondary" id="form-cancel">Cancel</button><button class="button button-secondary" id="form-preview">Preview</button>${saved ? '<button class="button button-secondary" id="form-restore">Restore original form</button>' : ""}<button class="button" id="form-save">Save form</button></span>`)}${errors}
  <section class="panel form-panel" id="form-editor">
    <div class="b-intro"><div class="b-field"><span>Form title</span><div class="b-fixed">${esc(d.title)}</div><small class="help">The drill's name is used across the Practice form, Analysis, and Scoring settings, so it stays the same.</small></div>
      <label class="b-field"><span>Form description (optional). Start a line with "- " for a bullet point.</span><textarea rows="5" data-path="description">${esc(d.description)}</textarea></label>
      <p class="help">Questions marked <strong>Built-in</strong> are the drill's original questions: reword them, describe them, or move them within their section, but they cannot be removed. Add any other questions or sections you need; their answers appear in Analysis and can be filled in later for older attempts with <strong>Edit</strong>. The score is still calculated from the built-in questions, using the Scoring settings page.</p></div>
    ${d.sections.map((s, si) => sectionEditor(d, s, si)).join("")}
    <button type="button" class="button button-secondary" data-act="s-add">+ Add section</button>
  </section>`;
}

// Leave the editor: back to the page that opened it (the Practice form tab's Edit form button), or to the form list.
function closeEditor(ctx) {
	const { state } = ctx;
	state.formDraft = null;
	state.formErrors = [];
	state.formDirty = false;
	const back = state.formReturn;
	state.formReturn = null;
	if (back) ctx.setRoute(back);
	else ctx.render();
}

// ---------------------------------------------------------------- behaviour
export function bindFormBuilder(ctx) {
	const { state } = ctx;
	if (!state.formDraft) return bindList(ctx);
	const d = state.formDraft,
		editor = document.querySelector("#form-editor");

	// Put the cursor in the box that was just added, and keep the page where it was after a structural change.
	if (state.formFocus) {
		editor
			.querySelector(`[data-path="${state.formFocus}"]`)
			?.focus({ preventScroll: false });
		state.formFocus = null;
	}

	// The ranking and "fill this question" lists show question labels, so refresh them as labels are typed.
	const refreshQuestionLists = () => {
		const numberish = allQuestions(d).filter((q) => isNumeric(q.type)),
			numeric = allQuestions(d).filter((q) => q.type === "number");
		const rebuild = (select, items, first, selected) => {
			if (!select) return;
			select.innerHTML = `<option value="">${first}</option>${items.map((q) => `<option value="${q.id}" ${q.id === selected ? "selected" : ""}>${esc(q.label || "(untitled question)")}</option>`).join("")}`;
		};
		rebuild(
			editor.querySelector("[data-ranking-select]"),
			numberish,
			"None (list drivers by number of attempts)",
			d.ranking.questionId,
		);
		editor
			.querySelectorAll("[data-fill-select]")
			.forEach((sel) =>
				rebuild(
					sel,
					numeric,
					"Do not fill any question",
					getByPath(d, sel.dataset.path),
				),
			);
	};
	const update = (event, finished) => {
		const el = event.target.closest("[data-path]");
		if (!el) return;
		const value = el.type === "checkbox" ? el.checked : el.value;
		setByPath(d, el.dataset.path, value);
		state.formDirty = true;
		if (el.hasAttribute("data-label")) refreshQuestionLists();
		if (finished && el.hasAttribute("data-rerender")) redraw(ctx);
	};
	editor.addEventListener("input", (e) => update(e, false));
	editor.addEventListener("change", (e) => update(e, true));

	editor.addEventListener("click", (event) => {
		const button = event.target.closest("[data-act]");
		if (!button) return;
		const si = Number(button.dataset.s),
			qi = Number(button.dataset.q),
			act = button.dataset.act;
		const swap = (list, i, j) => {
			[list[i], list[j]] = [list[j], list[i]];
		};
		state.formDirty = true;
		if (act === "s-add") {
			const s = newSection(d);
			s.questions.push(newQuestion(d));
			d.sections.push(s);
			state.formFocus = `sections.${d.sections.length - 1}.title`;
		} else if (act === "s-up") swap(d.sections, si, si - 1);
		else if (act === "s-down") swap(d.sections, si, si + 1);
		else if (act === "s-del") {
			const s = d.sections[si];
			if (hasLocked(s)) return; // a section holding built-in questions cannot be deleted
			if (
				s.questions.length &&
				!confirm(
					`Delete this section and its ${s.questions.length} question${s.questions.length === 1 ? "" : "s"}?`,
				)
			)
				return;
			d.sections.splice(si, 1);
			if (
				d.ranking.questionId &&
				!allQuestions(d).some((q) => q.id === d.ranking.questionId)
			)
				d.ranking.questionId = "";
		} else if (act === "q-add") {
			d.sections[si].questions.push(newQuestion(d));
			state.formFocus = `sections.${si}.questions.${d.sections[si].questions.length - 1}.label`;
		} else if (act === "q-up") swap(d.sections[si].questions, qi, qi - 1);
		else if (act === "q-down") swap(d.sections[si].questions, qi, qi + 1);
		else if (act === "q-del") {
			if (d.sections[si].questions[qi].field) return; // built-in questions cannot be deleted
			const id = d.sections[si].questions[qi].id;
			d.sections[si].questions.splice(qi, 1);
			if (d.ranking.questionId === id) d.ranking.questionId = "";
			d.sections.forEach((s) => {
				if (s.tool.fillQuestionId === id) s.tool.fillQuestionId = "";
			});
		}
		redraw(ctx);
	});

	document.querySelector("#form-cancel").onclick = () => {
		if (state.formDirty && !confirm("Discard your changes to this form?"))
			return;
		closeEditor(ctx);
	};
	document.querySelector("#form-restore")?.addEventListener("click", () => restoreDrill(ctx, d.builtin));
	document.querySelector("#form-preview").onclick = () => openPreview(ctx);
	document.querySelector("#form-save").onclick = () => saveDraft(ctx);
}

// Re-draw the editor while keeping the scroll position (the page would otherwise jump to the top).
function redraw(ctx) {
	const y = window.scrollY;
	ctx.render();
	window.scrollTo(0, y);
}

async function saveDraft(ctx) {
	const { state } = ctx,
		problems = validateDraft(state.formDraft);
	state.formErrors = problems;
	if (problems.length) {
		redraw(ctx);
		window.scrollTo(0, 0);
		return ctx.toast("Fix the items listed at the top, then save again.");
	}
	const form = finalize(state.formDraft);
	try {
		await ctx.store.saveRecord("customForms", form);
		const forms = state.data.customForms,
			i = forms.findIndex((f) => f.id === form.id);
		i < 0 ? forms.push(form) : (forms[i] = form);
		closeEditor(ctx);
		ctx.toast(
			form.builtin
				? `The ${form.title} form was saved. The Practice form tab now shows the new version.`
				: `"${form.title}" saved. It now appears on the Practice form tab.`,
		);
	} catch (err) {
		ctx.toast(`Could not save: ${err.message}`);
	}
}

// Back to the drill's original form: the saved version is removed. Attempts keep every answer they already have.
async function restoreDrill(ctx, facet) {
	const { state } = ctx;
	const id = drillFormId(facet);
	if (!confirm(`Restore the original ${FACETS[facet].label} form? Your changes to this form are removed (recorded attempts keep all their answers).`)) return;
	try {
		if (state.data.customForms.some((f) => f.id === id)) await ctx.store.removeRecord("customForms", id);
		state.data.customForms = state.data.customForms.filter((f) => f.id !== id);
		if (state.formDraft?.builtin === facet) closeEditor(ctx);
		else ctx.render();
		ctx.toast(`The original ${FACETS[facet].label} form is back.`);
	} catch (err) {
		ctx.toast(`Could not restore: ${err.message}`);
	}
}

function openPreview(ctx) {
	const form = finalize(ctx.state.formDraft);
	// Empty the pop-up when it closes, so the preview's form (with the same element ids as the real form) never stays in the page.
	ctx.modal.addEventListener("close", () => (ctx.content.innerHTML = ""), { once: true });
	if (form.builtin) {
		ctx.content.innerHTML = `<div class="modal-head"><div><p class="eyebrow">PREVIEW</p><h2>${esc(form.title)}</h2></div><button class="close" id="close-modal">\u00d7</button></div><p class="help">This is how recorders will see the form. Nothing you enter here is saved.</p>${drillFormHtml(form, form.builtin, { preview: true, courses: ctx.state.data.courses })}`;
		ctx.openModal({ wide: true });
		document.querySelector("#close-modal").onclick = () => ctx.modal.close();
		const f = ctx.content.querySelector("#practice-form");
		f.onsubmit = (e) => {
			e.preventDefault();
			if (f.reportValidity()) ctx.toast("Preview only: nothing was saved.");
		};
		return;
	}
	ctx.content.innerHTML = `<div class="modal-head"><div><p class="eyebrow">PREVIEW</p><h2>${esc(form.title || "Untitled form")}</h2></div><button class="close" id="close-modal">\u00d7</button></div><p class="help">This is how students will see the form. Nothing you enter here is saved.</p>${customFormHtml(form, { preview: true, courses: ctx.state.data.courses })}`;
	ctx.openModal({ wide: true });
	document.querySelector("#close-modal").onclick = () => ctx.modal.close();
	bindCustomForm(form, ctx, { preview: true });
}

// ---------------------------------------------------------------- list mode
function bindList(ctx) {
	const { state } = ctx;
	const find = (id) => state.data.customForms.find((f) => f.id === id);
	document.querySelectorAll("[data-drill-edit]").forEach(
		(b) =>
			(b.onclick = () => {
				state.formDraft = clone(drillForm(state, b.dataset.drillEdit));
				state.formErrors = [];
				state.formDirty = false;
				state.formReturn = null;
				ctx.render();
			}),
	);
	document.querySelectorAll("[data-drill-open]").forEach(
		(b) =>
			(b.onclick = () => {
				state.facet = b.dataset.drillOpen;
				ctx.setRoute("practice");
			}),
	);
	document.querySelectorAll("[data-drill-restore]").forEach((b) => (b.onclick = () => restoreDrill(ctx, b.dataset.drillRestore)));
	document.querySelector("#new-form").onclick = () => {
		state.formDraft = createDraft();
		state.formErrors = [];
		state.formDirty = false;
		state.formFocus = "title";
		ctx.render();
	};
	document.querySelectorAll("[data-form-edit]").forEach(
		(b) =>
			(b.onclick = () => {
				const form = normalizeForm(find(b.dataset.formEdit));
				// Forms from the earliest version had no sections. Give them one so there is somewhere to add questions.
				if (!form.sections.length) {
					const s = newSection(form, "Driver performance");
					s.questions.push(newQuestion(form));
					form.sections.push(s);
				}
				state.formDraft = clone(form);
				state.formErrors = [];
				state.formDirty = false;
				ctx.render();
			}),
	);
	document.querySelectorAll("[data-form-open]").forEach(
		(b) =>
			(b.onclick = () => {
				state.facet = formFacet(b.dataset.formOpen);
				ctx.setRoute("practice");
			}),
	);
	document.querySelectorAll("[data-form-analysis]").forEach(
		(b) =>
			(b.onclick = () => {
				state.analysisView = formFacet(b.dataset.formAnalysis);
				ctx.setRoute("analysis");
			}),
	);
	document
		.querySelectorAll("[data-form-delete]")
		.forEach(
			(b) => (b.onclick = () => confirmDeleteForm(ctx, b.dataset.formDelete)),
		);
}

function confirmDeleteForm(ctx, id) {
	const { state } = ctx,
		form = state.data.customForms.find((f) => f.id === id);
	if (!form) return;
	const attempts = state.data.submissions.filter(
		(x) => x.facet === formFacet(id),
	);
	ctx.content.innerHTML = `<div class="modal-head"><div><p class="eyebrow">CONFIRM DELETE</p><h2>Delete this form?</h2></div><button class="close" id="close-modal">\u00d7</button></div><p><strong>${esc(form.title || form.name || "(untitled form)")}</strong></p><p class="help">The form disappears from the Practice form tab and its Analysis page. This cannot be undone.</p>${attempts.length ? `<label class="b-check"><input type="checkbox" id="delete-attempts"> Also permanently delete its ${attempts.length} recorded attempt${attempts.length === 1 ? "" : "s"}</label><p class="help">If you leave this unchecked, the attempts stay in the database but are not shown anywhere.</p>` : ""}<div class="form-actions"><button class="button button-secondary" id="cancel-delete">Cancel</button><button class="button button-danger" id="confirm-delete">Delete form</button></div>`;
	ctx.openModal();
	document.querySelector("#close-modal").onclick = document.querySelector(
		"#cancel-delete",
	).onclick = () => ctx.modal.close();
	document.querySelector("#confirm-delete").onclick = async (e) => {
		e.target.disabled = true;
		try {
			await ctx.store.removeRecord("customForms", id);
			state.data.customForms = state.data.customForms.filter(
				(f) => f.id !== id,
			);
			if (document.querySelector("#delete-attempts")?.checked) {
				for (const x of attempts)
					await ctx.store.removeRecord("submissions", x.id);
				state.data.submissions = state.data.submissions.filter(
					(x) => x.facet !== formFacet(id),
				);
			}
			if (state.facet === formFacet(id)) state.facet = "speed";
			if (state.analysisView === formFacet(id)) state.analysisView = "general";
			ctx.modal.close();
			ctx.render();
			ctx.toast("Form deleted.");
		} catch (err) {
			e.target.disabled = false;
			ctx.toast(`Could not delete: ${err.message}`);
		}
	};
}
