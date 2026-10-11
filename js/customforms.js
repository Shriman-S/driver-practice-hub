// Custom practice forms created in the Form builder: the data model, the form students fill in, the timer tools, and the analytics.
//
// A saved form (collection "customForms", document id = form.id):
// {
//   id, title, description,                       description is plain text; lines starting with "- " become bullet points
//   sections: [ { id, title, description,
//                 tool: { type: "none" | "stopwatch" | "countdown", seconds: 90, fillQuestionId: "" },
//                 questions: [ { id, type, label, description, required, optionsText, min, max, scaleMax } ] } ],
//   ranking: { questionId: "" | "q3", direction: "higher" | "lower" },     which number/scale question ranks the drivers
//   nextId, createdAt, updatedAt
// }
// Question types: number, text (short), paragraph (long), choice (radio buttons), checkbox, dropdown, scale (1 to scaleMax).
// Every custom form automatically starts with a locked "Driver information" section (name, grade, practice date), so each attempt can
// be tied to a driver. A submission is saved like the built-in ones: facet "form:<id>", with the answers stored under data.answers.
import {
	esc,
	uid,
	now,
	todayKey,
	dateText,
	blocksHtml,
	textToBlocks,
} from "./util.js";
import { GRADES } from "./constants.js";

export const QUESTION_TYPES = [
	{ value: "number", label: "Number" },
	{ value: "text", label: "Short text" },
	{ value: "paragraph", label: "Paragraph (long text)" },
	{ value: "choice", label: "Multiple choice (pick one)" },
	{ value: "checkbox", label: "Checkboxes (pick any)" },
	{ value: "dropdown", label: "Dropdown list" },
	{ value: "scale", label: "Rating scale" },
];
export const TOOL_TYPES = [
	{ value: "none", label: "No tool" },
	{ value: "stopwatch", label: "Stopwatch" },
	{ value: "countdown", label: "Countdown timer" },
];
export const hasOptions = (type) =>
	["choice", "checkbox", "dropdown"].includes(type);
export const isNumeric = (type) => type === "number" || type === "scale";
export const parseOptions = (text) => [
	...new Set(
		String(text || "")
			.split(/\r?\n/)
			.map((s) => s.trim())
			.filter(Boolean),
	),
]; // one option per line, no duplicates
export const formFacet = (id) => `form:${id}`; // the `facet` value saved on a submission
export const isCustomFacet = (facet) => String(facet).startsWith("form:");
export const formIdOf = (facet) => String(facet).slice(5);

// Older saved forms only had { name, description }. Fill in anything missing so the rest of the code can rely on the full shape.
export function normalizeForm(raw) {
	const tool = (t) => ({
		type: t?.type || "none",
		seconds: Number(t?.seconds) > 0 ? Number(t.seconds) : 90,
		fillQuestionId: t?.fillQuestionId || "",
	});
	return {
		id: raw.id,
		title: raw.title ?? raw.name ?? "",
		description: raw.description || "",
		sections: (raw.sections || []).map((s) => ({
			id: s.id,
			title: s.title || "",
			description: s.description || "",
			tool: tool(s.tool),
			questions: (s.questions || []).map((q) => ({
				id: q.id,
				type: q.type || "text",
				label: q.label || "",
				description: q.description || "",
				required: Boolean(q.required),
				optionsText: q.optionsText || "",
				min: q.min ?? "",
				max: q.max ?? "",
				scaleMax: Number(q.scaleMax) || 5,
			})),
		})),
		ranking: {
			questionId: raw.ranking?.questionId || "",
			direction: raw.ranking?.direction === "lower" ? "lower" : "higher",
		},
		nextId: raw.nextId || 1,
		createdAt: raw.createdAt || now(),
		updatedAt: raw.updatedAt || null,
	};
}
export const allQuestions = (form) => form.sections.flatMap((s) => s.questions);
// A form is offered on the Practice tab once it has at least one question.
export const isPublished = (form) => allQuestions(form).length > 0;
export const rankingQuestion = (form) =>
	allQuestions(form).find(
		(q) => q.id === form.ranking?.questionId && isNumeric(q.type),
	) || null;

// ================================================================ the form students fill in
const star = '<span class="required">*</span>';
const descBox = (id, text) =>
	text?.trim()
		? `<div class="q-desc" id="${id}-desc">${blocksHtml(textToBlocks(text))}</div>`
		: "";

// The three built-in Driver information questions, written with the same markup as the built-in forms.
function baseField(id, label, type, help = "") {
	const input =
		type === "select"
			? `<select id="${id}" name="${id}" required><option value="">Select grade</option>${GRADES.map((g) => `<option>${g}</option>`).join("")}</select>`
			: `<input id="${id}" name="${id}" type="${type}" required ${type === "text" ? 'maxlength="80"' : ""}/>`;
	return `<div class="field"><label for="${id}">${esc(label)} ${star}</label>${input}${help ? `<span class="help">${esc(help)}</span>` : ""}</div>`;
}

function questionHtml(q, form) {
	const id = q.id,
		req = q.required,
		desc = descBox(id, q.description),
		described = desc ? ` aria-describedby="${id}-desc"` : "";
	const label = `${esc(q.label)} ${req ? star : ""}`,
		requiredAttr = req ? "required" : "";
	const options = parseOptions(q.optionsText);
	let control;
	switch (q.type) {
		case "number":
			control = `<input id="${id}" name="${id}" type="number" step="any" ${q.min !== "" && q.min != null ? `min="${esc(q.min)}"` : ""} ${q.max !== "" && q.max != null ? `max="${esc(q.max)}"` : ""} ${requiredAttr}${described}/>`;
			break;
		case "text":
			control = `<input id="${id}" name="${id}" type="text" maxlength="200" ${requiredAttr}${described}/>`;
			break;
		case "paragraph":
			control = `<textarea id="${id}" name="${id}" maxlength="600" ${requiredAttr}${described}></textarea>`;
			break;
		case "dropdown":
			control = `<select id="${id}" name="${id}" ${requiredAttr}${described}><option value="">Select an option</option>${options.map((o) => `<option>${esc(o)}</option>`).join("")}</select>`;
			break;
		case "choice":
			control = `<div class="checkboxes options-col" role="radiogroup" aria-labelledby="${id}-label"${described}>${options.map((o) => `<label><input type="radio" name="${id}" value="${esc(o)}" ${requiredAttr}> ${esc(o)}</label>`).join("")}</div>`;
			break;
		case "checkbox":
			control = `<div class="checkboxes options-col" role="group" aria-labelledby="${id}-label"${described} data-checkgroup="${id}" data-required="${req}">${options.map((o) => `<label><input type="checkbox" name="${id}" value="${esc(o)}"> ${esc(o)}</label>`).join("")}</div>`;
			break;
		case "scale":
			control = `<div class="checkboxes scale" role="radiogroup" aria-labelledby="${id}-label"${described}>${Array.from(
				{ length: q.scaleMax },
				(_, i) => i + 1,
			)
				.map(
					(n) =>
						`<label><input type="radio" name="${id}" value="${n}" ${requiredAttr}> ${n}</label>`,
				)
				.join("")}</div>`;
			break;
	}
	// Groups (radio buttons / checkboxes) have no single input for a <label for>, so they use a labelled group instead.
	const group = ["choice", "checkbox", "scale"].includes(q.type);
	const head = group
		? `<span class="q-label" id="${id}-label">${label}</span>`
		: `<label for="${id}">${label}</label>`;
	return `<div class="field">${head}${desc}${control}</div>`;
}

function toolHtml(section, form) {
	const t = section.tool;
	if (t.type === "none") return "";
	const fill =
		t.type === "stopwatch" && t.fillQuestionId
			? allQuestions(form).find((q) => q.id === t.fillQuestionId)
			: null;
	const minutes = Math.floor(t.seconds / 60),
		secs = t.seconds % 60;
	const start =
		t.type === "countdown"
			? `${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}.0`
			: "00:00.0";
	return `<div class="timer" data-tool="${t.type}" data-seconds="${t.seconds}" data-fill="${fill ? esc(fill.id) : ""}" data-fill-label="${fill ? esc(fill.label) : ""}"><div><span class="tag">${t.type === "stopwatch" ? "STOPWATCH" : `${t.seconds}-SECOND TIMER`}</span><div class="timer-output">${start}</div></div><button type="button" class="button button-secondary" data-act="toggle">Start</button><button type="button" class="button button-secondary button-small" data-act="reset">Reset</button><span class="help" data-role="help"></span></div>`;
}

export function customFormHtml(form, { preview = false } = {}) {
	const sections = form.sections
		.map(
			(s) =>
				`<div class="form-section"><h3>${esc(s.title)}</h3>${s.description?.trim() ? `<div class="section-desc">${blocksHtml(textToBlocks(s.description))}</div>` : ""}${toolHtml(s, form)}<div class="field-grid">${s.questions.map((q) => questionHtml(q, form)).join("")}</div></div>`,
		)
		.join("");
	return `<form id="practice-form" class="panel form-panel" data-custom-form="${esc(form.id)}"><div class="form-header"><h3>${esc(form.title)}</h3><div class="form-intro">${blocksHtml(textToBlocks(form.description))}</div></div>
    <div class="form-section"><h3>Driver information</h3><p>Who is driving, and when the practice took place.</p><div class="field-grid">${baseField("driverName", "Driver name", "text", "First name with last initial. Your recent local name is suggested.")}${baseField("grade", "Driver grade level", "select")}${baseField("practiceDate", "Practice date", "date")}</div></div>
    ${sections}
    <div class="form-actions"><button type="reset" class="button button-secondary">Clear</button><button class="button" type="submit">${preview ? "Submit (preview only)" : "Submit practice"}</button></div></form>`;
}

// ---------------------------------------------------------------- tools (stopwatch / countdown) inside a custom form
function bindTool(panel, formEl, ctx) {
	const countdown = panel.dataset.tool === "countdown",
		START_MS = countdown ? Number(panel.dataset.seconds) * 1000 : 0;
	const output = panel.querySelector(".timer-output"),
		toggle = panel.querySelector('[data-act="toggle"]'),
		reset = panel.querySelector('[data-act="reset"]'),
		help = panel.querySelector('[data-role="help"]');
	const fillInput = panel.dataset.fill
		? formEl.querySelector(`[name="${panel.dataset.fill}"]`)
		: null;
	let value = START_MS,
		running = false,
		last = 0,
		raf = null,
		written = null;

	const display = () => {
		const x = Math.max(0, value),
			m = Math.floor(x / 60000),
			s = Math.floor((x % 60000) / 1000),
			t = Math.floor((x % 1000) / 100);
		output.textContent = `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${t}`;
	};
	const advance = () => {
		const t = performance.now();
		value += (countdown ? -1 : 1) * (t - last);
		last = t;
	}; // exact time since the last update
	const say = (text) => {
		if (help) help.textContent = text;
	};
	const idleHelp = () =>
		say(
			countdown
				? "Counts down to zero. A message appears when time is up."
				: fillInput
					? `When you press Stop, the reading is entered into "${panel.dataset.fillLabel}".`
					: "Use the stopwatch to time the drill.",
		);
	const clearFill = () => {
		if (fillInput && fillInput.value === written) fillInput.value = "";
		written = null;
	};

	const tick = () => {
		if (!running) return;
		if (!panel.isConnected) {
			running = false;
			return;
		} // the page was re-drawn; stop this old timer
		advance();
		display();
		if (countdown && value <= 0) {
			running = false;
			value = 0;
			display();
			toggle.textContent = "Start";
			say("Time is up.");
			ctx.toast("Time is up.");
			return;
		}
		raf = requestAnimationFrame(tick);
	};
	toggle.onclick = () => {
		if (!running) {
			// start / resume
			if (!countdown) clearFill(); // a resumed stopwatch is not finished, so its old reading is withdrawn
			if (countdown && value <= 0) value = START_MS;
			running = true;
			last = performance.now();
			raf = requestAnimationFrame(tick);
			toggle.textContent = countdown ? "Pause" : "Stop";
			say(
				countdown ? "Running." : "Running. Press Stop at the end of the drill.",
			);
		} else {
			// pause / stop
			cancelAnimationFrame(raf);
			advance();
			display();
			running = false;
			toggle.textContent = "Start";
			if (!countdown) {
				const seconds = (Math.round(value / 10) / 100).toFixed(2);
				say(
					`Stopped at ${seconds} seconds.${fillInput ? ` Entered into "${panel.dataset.fillLabel}".` : ""}`,
				);
				if (fillInput) {
					fillInput.value = seconds;
					written = seconds;
				}
			} else say("Paused.");
		}
	};
	const resetAll = () => {
		cancelAnimationFrame(raf);
		running = false;
		value = START_MS;
		display();
		toggle.textContent = "Start";
		clearFill();
		idleHelp();
	};
	reset.onclick = resetAll;
	formEl.addEventListener("reset", resetAll);
	display();
	idleHelp();
}

// ---------------------------------------------------------------- answers
// Read every answer out of the form, keyed by question id. Numbers become numbers; unanswered optional questions become null / "" / [].
export function collectAnswers(form, formEl) {
	const answers = {};
	for (const q of allQuestions(form)) {
		const els = [...formEl.querySelectorAll(`[name="${q.id}"]`)];
		if (q.type === "checkbox")
			answers[q.id] = els.filter((e) => e.checked).map((e) => e.value);
		else if (q.type === "choice" || q.type === "scale") {
			const on = els.find((e) => e.checked);
			answers[q.id] = on
				? q.type === "scale"
					? Number(on.value)
					: on.value
				: q.type === "scale"
					? null
					: "";
		} else if (q.type === "number")
			answers[q.id] = els[0].value === "" ? null : Number(els[0].value);
		else answers[q.id] = (els[0]?.value || "").trim();
	}
	return answers;
}
// The number that ranks drivers on this form (from the form's ranking question), or null when it was left blank.
export const metricOf = (form, answers) => {
	const q = rankingQuestion(form);
	if (!q) return null;
	const v = answers[q.id];
	return typeof v === "number" && Number.isFinite(v) ? v : null;
};

// A required checkbox group needs at least one box ticked, which the browser cannot check natively, so it is done here.
function checkRequiredGroups(formEl) {
	let ok = true;
	formEl
		.querySelectorAll('[data-checkgroup][data-required="true"]')
		.forEach((group) => {
			const boxes = [...group.querySelectorAll("input")],
				anyChecked = boxes.some((b) => b.checked);
			boxes[0]?.setCustomValidity(
				anyChecked ? "" : "Choose at least one option.",
			);
			if (!anyChecked) ok = false;
		});
	return ok;
}

export function bindCustomForm(form, ctx, { preview = false } = {}) {
	const formEl = document.querySelector("#practice-form");
	formEl
		.querySelectorAll(".timer[data-tool]")
		.forEach((panel) => bindTool(panel, formEl, ctx));
	formEl
		.querySelectorAll("[data-checkgroup] input")
		.forEach((box) =>
			box.addEventListener("change", () => checkRequiredGroups(formEl)),
		);
	const cached = localStorage.getItem("drivelab-last-name");
	if (cached && !preview) formEl.querySelector("#driverName").value = cached;
	formEl.querySelector("#practiceDate").value = todayKey();
	formEl.onsubmit = async (e) => {
		e.preventDefault();
		if (preview) return ctx.toast("This is only a preview. Nothing was saved.");
		checkRequiredGroups(formEl);
		if (!formEl.reportValidity()) return;
		const answers = collectAnswers(form, formEl),
			metric = metricOf(form, answers);
		const item = {
			id: uid(),
			facet: formFacet(form.id),
			driverName: formEl.driverName.value.trim(),
			grade: formEl.grade.value,
			date: formEl.practiceDate.value,
			data: { formTitle: form.title, answers },
			score: { final: metric ?? 0, metric },
			createdAt: now(),
		};
		try {
			await ctx.store.addSubmission(item);
			ctx.state.data.submissions.push(item);
			localStorage.setItem("drivelab-last-name", item.driverName);
			ctx.toast(`${form.title}: practice recorded.`);
			formEl.reset();
			formEl.querySelector("#practiceDate").value = todayKey();
			formEl.querySelector("#driverName").value = item.driverName;
		} catch (err) {
			ctx.toast(`Could not save: ${err.message}`);
		}
	};
}

// ================================================================ analytics
const mean = (list) =>
	list.length ? list.reduce((a, b) => a + b, 0) / list.length : 0;
const fmt = (n) => Number(n).toFixed(2);
const newestFirst = (a, b) => b.createdAt.localeCompare(a.createdAt);
const finite = (v) => typeof v === "number" && Number.isFinite(v);
const answerText = (q, value) =>
	Array.isArray(value)
		? value.join(", ") || "--"
		: value === null || value === undefined || value === ""
			? "--"
			: String(value);

// Everything the Analysis page and the PDF need for one custom form.
export function customModel(form, submissions) {
	const list = submissions.filter((x) => x.facet === formFacet(form.id)),
		rankQ = rankingQuestion(form),
		lowerBetter = form.ranking.direction === "lower";
	const better = (a, b) => (lowerBetter ? a < b : a > b); // is metric a better than metric b?
	const metricOfAttempt = (x) =>
		finite(x.score?.metric) ? x.score.metric : null;
	const byDriver = {};
	list.forEach((x) => (byDriver[x.driverName] ??= []).push(x));
	const standings = Object.entries(byDriver)
		.map(([name, entries]) => {
			const sorted = [...entries].sort(newestFirst),
				metrics = entries.map(metricOfAttempt).filter(finite);
			return {
				name,
				grade: sorted[0].grade,
				attempts: entries.length,
				latest: metricOfAttempt(sorted[0]),
				best: metrics.length
					? lowerBetter
						? Math.min(...metrics)
						: Math.max(...metrics)
					: null,
				average: metrics.length ? mean(metrics) : null,
			};
		})
		.sort((a, b) => {
			if (!rankQ)
				return b.attempts - a.attempts || a.name.localeCompare(b.name); // no ranking question: most attempts first
			if (a.latest === null || b.latest === null)
				return (a.latest === null) - (b.latest === null);
			return a.latest === b.latest
				? a.name.localeCompare(b.name)
				: better(a.latest, b.latest)
					? -1
					: 1;
		});
	const metrics = list.map(metricOfAttempt).filter(finite);
	const bestAttempt = metrics.length
		? list
				.filter((x) => finite(metricOfAttempt(x)))
				.reduce((t, x) =>
					better(metricOfAttempt(x), metricOfAttempt(t)) ? x : t,
				)
		: null;
	// One summary per question: numbers get count / average / min / max, choice-style questions get a count per option.
	const summaries = allQuestions(form).map((q) => {
		const values = list.map((x) => x.data?.answers?.[q.id]);
		if (isNumeric(q.type)) {
			const nums = values.filter(finite);
			return {
				q,
				kind: "numeric",
				count: nums.length,
				average: nums.length ? mean(nums) : null,
				min: nums.length ? Math.min(...nums) : null,
				max: nums.length ? Math.max(...nums) : null,
			};
		}
		if (hasOptions(q.type)) {
			const options = parseOptions(q.optionsText).map((o) => ({
				option: o,
				count: values.filter((v) =>
					Array.isArray(v) ? v.includes(o) : v === o,
				).length,
			}));
			const answered = values.filter((v) =>
				Array.isArray(v) ? v.length : v,
			).length;
			return { q, kind: "choice", answered, options };
		}
		return { q, kind: "text", answered: values.filter((v) => v).length };
	});
	return {
		list,
		rankQ,
		lowerBetter,
		standings,
		metrics,
		bestAttempt,
		average: metrics.length ? mean(metrics) : null,
		drivers: Object.keys(byDriver).length,
		summaries,
	};
}

const tile = (label, value, accent = false) =>
	`<div class="metric panel ${accent ? "accent" : ""}"><p>${esc(label)}</p><strong>${value}</strong></div>`;
const metricName = (m) => (m.rankQ ? m.rankQ.label : "Ranking value");

export function customAnalysisHtml(form, submissions) {
	const m = customModel(form, submissions),
		rank = m.rankQ;
	const standingsRows = m.standings.length
		? m.standings
				.map(
					(r, i) =>
						`<tr><td class="rank">#${i + 1}</td><td><strong>${esc(r.name)}</strong></td><td>${esc(r.grade)}</td><td>${r.attempts}</td>${rank ? `<td><strong>${r.latest === null ? "--" : fmt(r.latest)}</strong></td><td>${r.best === null ? "--" : fmt(r.best)}</td><td>${r.average === null ? "--" : fmt(r.average)}</td>` : ""}</tr>`,
				)
				.join("")
		: `<tr><td colspan="${rank ? 7 : 4}" class="empty">No attempts recorded for this form.</td></tr>`;
	const summaryNumeric = m.summaries.filter((s) => s.kind === "numeric");
	const summaryChoice = m.summaries.filter((s) => s.kind === "choice");
	const numericTable = summaryNumeric.length
		? `<div class="table-wrap"><table><thead><tr><th>Question</th><th>Responses</th><th>Average</th><th>Lowest</th><th>Highest</th></tr></thead><tbody>${summaryNumeric.map((s) => `<tr><td>${esc(s.q.label)}</td><td>${s.count}</td><td>${s.average === null ? "--" : fmt(s.average)}</td><td>${s.min === null ? "--" : fmt(s.min)}</td><td>${s.max === null ? "--" : fmt(s.max)}</td></tr>`).join("")}</tbody></table></div>`
		: "";
	const choiceTables = summaryChoice
		.map(
			(s) =>
				`<div class="table-wrap" style="margin-top:14px"><table><thead><tr><th>${esc(s.q.label)}</th><th>Responses</th><th>Share</th></tr></thead><tbody>${s.options.map((o) => `<tr><td>${esc(o.option)}</td><td>${o.count}</td><td><div class="bar"><i style="width:${s.answered ? Math.round((100 * o.count) / s.answered) : 0}%"></i></div>${s.answered ? Math.round((100 * o.count) / s.answered) : 0}%</td></tr>`).join("")}</tbody></table></div>`,
		)
		.join("");
	const columns = allQuestions(form);
	const sheetHead = `<th>Date</th><th>Driver</th><th>Grade</th>${columns.map((q) => `<th>${esc(q.label)}</th>`).join("")}<th class="no-print">Delete</th>`;
	const sheetRows = [...m.list]
		.sort(newestFirst)
		.map(
			(x) =>
				`<tr><td class="nowrap">${dateText(x.date)}</td><td>${esc(x.driverName)}</td><td>${esc(x.grade)}</td>${columns
					.map((q) => {
						const text = answerText(q, x.data?.answers?.[q.id]);
						return q.type === "paragraph" || q.type === "text"
							? `<td class="note-cell" title="${esc(text)}">${esc(text)}</td>`
							: `<td>${esc(text)}</td>`;
					})
					.join(
						"",
					)}<td class="no-print"><button class="button button-danger button-small" data-delete-attempt="${esc(x.id)}">Delete</button></td></tr>`,
		)
		.join("");
	return `<div class="metrics">${tile("Attempts", m.list.length)}${tile("Drivers", m.drivers)}${tile(rank ? `Average: ${esc(rank.label)}` : "Ranking", rank ? (m.average === null ? "--" : fmt(m.average)) : "None set")}${tile(rank ? `Best (${m.lowerBetter ? "lowest" : "highest"})` : "Most attempts", rank ? (m.bestAttempt ? `${fmt(m.bestAttempt.score.metric)}<small style="font-size:12px;color:var(--muted);font-weight:500"> ${esc(m.bestAttempt.driverName)}</small>` : "--") : m.standings[0] ? `${m.standings[0].attempts}<small style="font-size:12px;color:var(--muted);font-weight:500"> ${esc(m.standings[0].name)}</small>` : "--", true)}</div>
  <section class="panel analysis-panel" style="margin-bottom:18px"><div class="panel-heading"><div><h3>${esc(form.title)} standings</h3><p>${rank ? `Ranked by each driver's latest attempt at "${esc(rank.label)}" (${m.lowerBetter ? "lower" : "higher"} is better).` : "No ranking question was chosen for this form, so drivers are listed by number of attempts. Edit the form to choose one."}</p></div></div><div class="table-wrap"><table><thead><tr><th>Rank</th><th>Driver</th><th>Grade</th><th>Attempts</th>${rank ? "<th>Latest</th><th>Best</th><th>Average</th>" : ""}</tr></thead><tbody>${standingsRows}</tbody></table></div></section>
  ${numericTable || choiceTables ? `<section class="panel analysis-panel" style="margin-bottom:18px"><div class="panel-heading"><div><h3>Question summaries</h3><p>Totals across every recorded attempt.</p></div></div>${numericTable}${choiceTables}</section>` : ""}
  <section class="panel"><div class="panel-heading"><div><h3>${esc(form.title)} attempts</h3><p>Most recent first, with every answer. Deleting an attempt removes it from every analysis view.</p></div></div><div class="table-wrap"><table><thead><tr>${sheetHead}</tr></thead><tbody>${sheetRows || `<tr><td colspan="${columns.length + 4}" class="empty">No attempts recorded.</td></tr>`}</tbody></table></div></section>`;
}

// The same analysis as a PDF report description (see pdf.js).
export function customReport(form, submissions) {
	const m = customModel(form, submissions),
		rank = m.rankQ,
		columns = allQuestions(form);
	const blocks = [];
	blocks.push({
		title: `${form.title} standings`,
		orientation: "portrait",
		nowrap: [0, 3, 4, 5, 6],
		note: rank
			? `Ranked by each driver's latest attempt at "${rank.label}" (${m.lowerBetter ? "lower" : "higher"} is better).`
			: "No ranking question chosen: drivers are listed by number of attempts.",
		head: rank
			? ["Rank", "Driver", "Grade", "Attempts", "Latest", "Best", "Average"]
			: ["Rank", "Driver", "Grade", "Attempts"],
		align: rank
			? ["center", "left", "left", "center", "right", "right", "right"]
			: ["center", "left", "left", "center"],
		body: m.standings.map((r, i) =>
			rank
				? [
						`#${i + 1}`,
						r.name,
						r.grade,
						String(r.attempts),
						r.latest === null ? "--" : fmt(r.latest),
						r.best === null ? "--" : fmt(r.best),
						r.average === null ? "--" : fmt(r.average),
					]
				: [`#${i + 1}`, r.name, r.grade, String(r.attempts)],
		),
	});
	const numeric = m.summaries.filter((s) => s.kind === "numeric");
	if (numeric.length)
		blocks.push({
			title: "Question summaries: numbers",
			orientation: "portrait",
			compact: true,
			head: ["Question", "Responses", "Average", "Lowest", "Highest"],
			align: ["left", "center", "right", "right", "right"],
			body: numeric.map((s) => [
				s.q.label,
				String(s.count),
				s.average === null ? "--" : fmt(s.average),
				s.min === null ? "--" : fmt(s.min),
				s.max === null ? "--" : fmt(s.max),
			]),
		});
	const choice = m.summaries.filter((s) => s.kind === "choice");
	if (choice.length)
		blocks.push({
			title: "Question summaries: choices",
			orientation: "portrait",
			compact: true,
			head: ["Question", "Option", "Responses", "Share"],
			align: ["left", "left", "center", "right"],
			body: choice.flatMap((s) =>
				s.options.map((o) => [
					s.q.label,
					o.option,
					String(o.count),
					`${s.answered ? Math.round((100 * o.count) / s.answered) : 0}%`,
				]),
			),
		});
	blocks.push({
		title: `${form.title} attempts`,
		orientation: "landscape",
		head: ["Date", "Driver", "Grade", ...columns.map((q) => q.label)],
		nowrap: [
			0,
			1,
			2,
			...columns
				.map((q, i) => (isNumeric(q.type) ? i + 3 : -1))
				.filter((i) => i >= 0),
		],
		body: [...m.list]
			.sort(newestFirst)
			.map((x) => [
				dateText(x.date),
				x.driverName,
				x.grade,
				...columns.map((q) => answerText(q, x.data?.answers?.[q.id])),
			]),
	});
	return {
		title: form.title,
		subtitle: `Custom form analysis | ${m.list.length} attempt${m.list.length === 1 ? "" : "s"}`,
		metrics: [
			{ label: "Attempts", value: String(m.list.length) },
			{ label: "Drivers", value: String(m.drivers) },
			{
				label: rank ? `Average: ${rank.label}` : "Ranking",
				value: rank ? (m.average === null ? "--" : fmt(m.average)) : "None set",
			},
			{
				label: rank
					? `Best (${m.lowerBetter ? "lowest" : "highest"})`
					: "Most attempts",
				accent: true,
				value: rank
					? m.bestAttempt
						? `${fmt(m.bestAttempt.score.metric)} (${m.bestAttempt.driverName})`
						: "--"
					: m.standings[0]
						? `${m.standings[0].attempts} (${m.standings[0].name})`
						: "--",
			},
		],
		blocks,
	};
}
