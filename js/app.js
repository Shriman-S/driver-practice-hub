import { FACETS, GRADES, OBSERVATIONS } from "./constants.js";
import {
	scoreSubmission,
	driverSummary,
	normalizeScoring,
	OVERALL_METHODS,
	ATTEMPT_RULES,
} from "./scoring.js";
import * as store from "./storage.js";
import {
	esc,
	uid,
	now,
	pad2,
	dateKey,
	todayKey,
	parseDay,
	dateText,
	blocksHtml,
	textToBlocks,
} from "./util.js";
import {
	renderCourseGallery,
	bindCourseGallery,
	renderCourseBuilder,
	bindCourseBuilder,
} from "./courses.js";
import { renderFormBuilder, bindFormBuilder } from "./formbuilder.js";
import {
	customFormHtml,
	bindCustomForm,
	normalizeForm,
	isPublished,
	isCustomFacet,
	formFacet,
	customAnalysisHtml,
	customReport,
} from "./customforms.js";
import { downloadReport } from "./pdf.js";
import { fieldHtml } from "./fields.js";
import { courseLabel } from "./courses.js";
import {
	attemptsSectionHtml,
	bindAttemptsSections,
	refreshSheet,
	openEditAttempt,
	attemptLabelOf,
	openContentSheet,
} from "./attempts.js";
import {
	facetEquationsHtml,
	allEquationsHtml,
	bandsTableHtml,
	overallLegend,
	overallPdfLines,
} from "./formulas.js";
import {
	renderScoringEditor,
	bindScoringEditor,
	scoringIsDirty,
	resetScoringDraft,
} from "./scoringeditor.js";
import {
	exportDialogHtml,
	exportInstructionsHtml,
	exportViaScript,
	isSyncUrl,
	downloadIcs,
	upcomingOnly,
	SETTINGS_ID as CALENDAR_SETTINGS_ID,
} from "./gcal.js";

// Application state stays in one small object; all HTML below is generated from trusted app data, never raw user HTML.
const state = {
	route: "practice",
	facet: "speed",
	analysisView: "general",
	courseGroup: "speed",
	courseNumber: 1,
	courseTool: "draw",
	courseDraft: null,
	formDraft: null,
	formErrors: [],
	formDirty: false,
	formFocus: null,
	// Scoring settings in use (scoring.js). The Scoring settings page edits a copy in scoringDraft until it is saved.
	scoring: normalizeScoring(null),
	scoringDraft: null,
	scoringTab: "overall",
	scoringDirty: false,
	data: { submissions: [], events: [], courses: {}, customForms: [], settings: {} },
	session: { mode: "local", isAdmin: false },
	month: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
	timer: null,
};
const app = document.querySelector("#app");
const modal = document.querySelector("#modal");
const content = document.querySelector("#modal-content");
const number = (value) => Number(value || 0);

// What the feature modules (courses.js, formbuilder.js, customforms.js) are allowed to use from this file.
const ctx = {
	state,
	store,
	toast,
	modal,
	content,
	pageHeader,
	render: () => render(),
	setRoute: (route) => setRoute(route),
	applyScoring: (cfg) => applyScoring(cfg),
	// Opens the shared dialog; `wide` gives forms and course pictures more room.
	openModal: ({ wide = false } = {}) => {
		modal.classList.toggle("wide", wide);
		modal.addEventListener("close", () => modal.classList.remove("wide"), {
			once: true,
		});
		modal.showModal();
	},
};

function toast(message) {
	const n = document
		.querySelector("#toast-template")
		.content.firstElementChild.cloneNode(true);
	n.textContent = message;
	document.body.append(n);
	setTimeout(() => n.remove(), 3500);
}
// Pages that only an administrator may open (the Firestore rules protect the data itself).
const ADMIN_ROUTES = ["analysis", "scoring", "course-builder", "forms", "admin"];
const ROUTE_KEY = "drivelab-route";
function setRoute(route) {
	if (
		ADMIN_ROUTES.includes(route) &&
		!state.session.isAdmin
	)
		return openAdmin();
	// Leaving the Scoring settings page with unsaved changes asks first; the draft is dropped once the page is left.
	if (state.route === "scoring" && route !== "scoring") {
		if (scoringIsDirty(state) && !confirm("You have unsaved scoring changes. Leave this page and discard them?")) return;
		resetScoringDraft(state);
	}
	state.route = route;
	sessionStorage.setItem(ROUTE_KEY, route); // so a refresh reopens the same page
	document
		.querySelectorAll(".nav-link")
		.forEach((x) => x.classList.toggle("active", x.dataset.route === route));
	render();
}
// NOTE: each control needs a `name` as well as an `id`; FormData (used when submitting) only reads controls that have a name.
// One question: label, optional description (explains how to answer), the input, then an optional small hint.
function field(name, label, type, required, help = "", description = null) {
	const described = description ? `aria-describedby="${name}-desc"` : "";
	const value =
		type === "select"
			? `<select id="${name}" name="${name}" ${described} ${required ? "required" : ""}><option value="">Select grade</option>${GRADES.map((g) => `<option>${g}</option>`).join("")}</select>`
			: `<input id="${name}" name="${name}" ${described} type="${type}" ${type === "number" ? "min=0 step=any" : ""} ${required ? "required" : ""}/>`;
	return `<div class="field"><label for="${name}">${esc(label)} ${required ? '<span class="required">*</span>' : ""}</label>${description ? `<div class="q-desc" id="${name}-desc">${blocksHtml(description)}</div>` : ""}${value}${help ? `<span class="help">${esc(help)}</span>` : ""}</div>`;
}
function pageHeader(title, copy, action = "") {
	return `<div class="hero"><div><h2>${title}</h2><p>${copy}</p></div>${action}</div>`;
}
// Custom forms are offered once they have at least one question.
const publishedForms = () =>
	state.data.customForms.map(normalizeForm).filter(isPublished);
const currentCustomForm = () =>
	isCustomFacet(state.facet)
		? publishedForms().find((f) => formFacet(f.id) === state.facet) || null
		: null;
function renderPractice() {
	if (isCustomFacet(state.facet) && !currentCustomForm()) state.facet = "speed";
	const custom = currentCustomForm();
	const f = FACETS[custom ? "speed" : state.facet];
	return `${pageHeader("Record a practice", "Choose the drill, then record one driver's measured performance. A browser remembers only the name typed on this device.")}<div class="facet-grid">${Object.entries(
		FACETS,
	)
		.map(
			([id, x]) =>
				`<button class="facet-card ${id === state.facet ? "selected" : ""}" data-facet="${id}"><span class="tag">${x.short}</span><strong>${x.label}</strong><span>${x.timer === "countdown" ? "90-second paired drill" : "Timed course"}</span></button>`,
		)
		.join("")}${publishedForms()
		.map(
			(x) =>
				`<button class="facet-card ${formFacet(x.id) === state.facet ? "selected" : ""}" data-facet="${esc(formFacet(x.id))}"><span class="tag">CUSTOM</span><strong>${esc(x.title)}</strong><span>${x.sections.some((sec) => sec.tool.type !== "none") ? "Custom form with timer" : "Custom form"}</span></button>`,
		)
		.join(
			"",
		)}</div>${custom ? customFormHtml(custom, { courses: state.data.courses }) : `<form id="practice-form" class="panel form-panel"><div class="form-header"><h3>${f.label}</h3><div class="form-intro">${blocksHtml(f.intro)}</div></div><div class="form-section"><h3>Driver information</h3><p>Who is driving, and when the practice took place.</p><div class="field-grid">${f.driverFields.map((x) => fieldHtml(x, { facet: state.facet, courses: state.data.courses })).join("")}</div></div><div class="form-section"><h3>Driver performance</h3><p>Start the timer below, then answer each question about the driver's performance.</p>${f.timer ? timerHtml(f.timer) : ""}<div class="field-grid">${f.fields.map((x) => fieldHtml(x, { facet: state.facet, courses: state.data.courses })).join("")}</div></div><div class="form-section"><h3>Coach observations</h3><p>These notes support coaching and are deliberately excluded from the numerical score.</p><div class="checkboxes">${OBSERVATIONS.map((x) => `<label><input type="checkbox" name="observation" value="${x}"> ${x}</label>`).join("")}</div><div class="field full" style="margin-top:14px"><label for="notes">Notable driving / coaching note</label><textarea id="notes" name="notes" maxlength="600" placeholder="Describe what was notable about the driver's driving."></textarea></div></div><div class="form-actions"><button type="reset" class="button button-secondary">Clear</button><button class="button" type="submit">Submit practice</button></div></form>`}`;
}
// Builds the timer panel. Countdown drills get Start/Pause + Reset; the speed stopwatch also gets the Lap Split button.
function timerHtml(kind) {
	const count = kind === "countdown";
	const lapButton = count
		? ""
		: '<button type="button" class="button button-lap" id="timer-lap" disabled>Lap Split</button>';
	return `<div class="timer"><div><span class="tag">${count ? "90-SECOND TIMER" : "STOPWATCH"}</span><div class="timer-output" id="timer-output">${count ? "01:30.0" : "00:00.0"}</div></div><button type="button" class="button button-secondary" id="timer-toggle">Start</button>${lapButton}<button type="button" class="button button-secondary button-small" id="timer-reset">Reset</button><span class="help" id="timer-help">${count ? "Disable both robots when time reaches zero." : ""}</span></div>`;
}
// ======================================================================= Analysis (administrator only)
// The Analysis tab has its own view selector, independent of the drill chosen on the Practice form:
//   "general" -> statistics for all four facets plus the coverage-first driver leaderboard
//   a facet   -> attempts, standings, and statistics for that one facet
// Every view is computed from state.data.submissions, so a deleted attempt disappears from all of them at once.
const FACET_KEYS = ["speed", "defense", "offense", "shooting"];
const mean = (list) =>
	list.length ? list.reduce((a, b) => a + b, 0) / list.length : 0;
const score2 = (n) => Number(n).toFixed(2);
const newestFirst = (a, b) => b.createdAt.localeCompare(a.createdAt);

// ---------------------------------------------------------------- scoring settings in use
// Every built-in attempt is re-scored from its raw answers with the current scoring settings whenever data is loaded or the
// settings are saved, so the leaderboard, statistics, PDF, and the equations on the Analysis page always agree. (The score saved
// with each attempt at submission time is not changed in the database.) Custom-form attempts keep their ranking-question value.
function applyScoring(cfg = state.scoring) {
	state.scoring = cfg;
	state.data.submissions = state.data.submissions.map((x) =>
		FACET_KEYS.includes(x.facet) ? { ...x, score: scoreSubmission(x, cfg) } : x,
	);
}
async function loadData() {
	state.data = await store.loadAll();
	state.data.settings ??= {};
	applyScoring(normalizeScoring(state.data.settings.scoring));
}

// One row per driver using the coverage-first summary (see scoring.js). The grade shown is from the driver's most recent attempt.
function driverRows(submissions) {
	const grouped = {};
	submissions.forEach((x) => (grouped[x.driverName] ??= []).push(x));
	return Object.entries(grouped)
		.map(([name, entries]) => ({
			name,
			grade: [...entries].sort(newestFirst)[0].grade,
			attempts: entries.length,
			// For the enlarged leaderboard: attempts per facet and the most recent practice date.
			perFacet: Object.fromEntries(FACET_KEYS.map((k) => [k, entries.filter((x) => x.facet === k).length])),
			lastDate: entries.map((x) => x.date).sort().pop(),
			...driverSummary(entries, state.scoring),
		}))
		.sort((a, b) => b.overall - a.overall);
}
// Attempts, distinct drivers, average score, and best attempt for one facet.
function facetStats(facet, submissions) {
	const list = submissions.filter((x) => x.facet === facet);
	const best = list.reduce(
		(top, x) => (!top || x.score.final > top.score.final ? x : top),
		null,
	);
	return {
		list,
		attempts: list.length,
		drivers: new Set(list.map((x) => x.driverName)).size,
		average: mean(list.map((x) => x.score.final)),
		best,
	};
}
const metricTile = (label, value, accent = false) =>
	`<div class="metric panel ${accent ? "accent" : ""}"><p>${label}</p><strong>${value}</strong></div>`;

// The recorded-attempts panels (search, filters, Enlarge, Edit, Delete) are drawn by attempts.js. This is what they need from here.
const attemptsApi = {
	state,
	store,
	toast,
	modal,
	content,
	render: () => render(),
	applyScoring: () => applyScoring(),
	openDeleteAttempt: (id) => openDeleteAttempt(id),
	// Every attempt a panel can show: "general" = All recorded attempts (the four built-in drills), otherwise one drill.
	listFor: (scope) =>
		scope === "general" ? builtInSubmissions() : state.data.submissions.filter((x) => x.facet === scope),
};

// Built-in drills only. Attempts on custom forms have their own analysis and must never count toward the four-facet leaderboard.
const builtInSubmissions = () =>
	state.data.submissions.filter((x) => FACET_KEYS.includes(x.facet));
const attemptLabel = (x) => attemptLabelOf(state, x);

function renderAnalysis() {
	const forms = publishedForms();
	if (
		isCustomFacet(state.analysisView) &&
		!forms.some((f) => formFacet(f.id) === state.analysisView)
	)
		state.analysisView = "general"; // that form was deleted
	const view = state.analysisView;
	const options = `<option value="general" ${view === "general" ? "selected" : ""}>General statistics (all facets)</option>${FACET_KEYS.map((k) => `<option value="${k}" ${view === k ? "selected" : ""}>${FACETS[k].label}</option>`).join("")}${forms.length ? `<optgroup label="Custom forms">${forms.map((f) => `<option value="${esc(formFacet(f.id))}" ${view === formFacet(f.id) ? "selected" : ""}>${esc(f.title)}</option>`).join("")}</optgroup>` : ""}`;
	const picker = `<div class="hero-actions"><label class="view-picker"><span>View</span><select id="analysis-view">${options}</select></label><button class="button" id="export-pdf">Download PDF</button></div>`;
	if (view === "general")
		return `${pageHeader("Analysis", `General statistics across all four facets. Ranking method: ${esc(OVERALL_METHODS[state.scoring.overall.method].label)}. ${esc(OVERALL_METHODS[state.scoring.overall.method].help)}`, picker)}${analysisGeneral(builtInSubmissions())}`;
	if (isCustomFacet(view)) {
		const form = forms.find((f) => formFacet(f.id) === view);
		return `${pageHeader("Analysis", `${esc(form.title)}: standings, question summaries, and every recorded attempt. Choose General statistics for the overall leaderboard.`, picker)}${customAnalysisHtml(form, state.data.submissions, state.data.courses)}`;
	}
	return `${pageHeader("Analysis", `${FACETS[view].label}: standings, statistics, and every recorded attempt. Choose General statistics for the overall leaderboard.`, picker)}${analysisFacet(view, state.data.submissions)}`;
}

// The Driver leaderboard table. The enlarged version also shows each facet's number of attempts, the facet average, and the
// most recent practice date.
function leaderboardTable(rows, expanded = false) {
	const facetCell = (r, k) =>
		r.facets[k] === undefined
			? "<td>--</td>"
			: `<td>${r.facets[k].toFixed(2)}${expanded ? ` <small class="lb-sub">${r.perFacet[k]} attempt${r.perFacet[k] === 1 ? "" : "s"}</small>` : ""}</td>`;
	const cols = expanded ? 12 : 10;
	const body = rows.length
		? rows
				.map(
					(r, i) =>
						`<tr><td class="rank">#${i + 1}</td><td><strong>${esc(r.name)}</strong></td><td>${esc(r.grade)}</td><td>${r.completed}/4</td><td>${r.attempts}</td>${FACET_KEYS.map((k) => facetCell(r, k)).join("")}${expanded ? `<td>${r.completed ? r.average.toFixed(2) : "--"}</td><td class="nowrap">${r.lastDate ? dateText(r.lastDate) : "--"}</td>` : ""}<td><div>${r.overall.toFixed(2)}</div><div class="bar"><i style="width:${r.overall * 10}%"></i></div></td></tr>`,
				)
				.join("")
		: `<tr><td colspan="${cols}" class="empty">No practice records yet. Submitted records will appear here for administrators.</td></tr>`;
	return `<div class="table-wrap${expanded ? " sheet-table" : ""}"><table><thead><tr><th>Rank</th><th>Driver</th><th>Grade</th><th>Facets</th><th title="Recorded attempts across all four drills">Attempts</th><th>Speed</th><th>Defense</th><th>Offense</th><th>Shooting</th>${expanded ? '<th title="Average of the completed facet scores">Facet average</th><th>Last practice</th>' : ""}<th>Overall</th></tr></thead><tbody>${body}</tbody></table></div>`;
}
function leaderboardSheetHtml() {
	return `<p class="help sheet-note">Each facet shows the driver's ${esc(ATTEMPT_RULES[state.scoring.overall.attempt].short)} and how many attempts they recorded there. Scores are out of 10. Press Esc or × to return to the page.</p>${leaderboardTable(driverRows(builtInSubmissions()), true)}<p class="legend sheet-note">${esc(overallLegend(state.scoring))}</p>`;
}

function analysisGeneral(submissions) {
	const rows = driverRows(submissions);
	const full = rows.filter((r) => r.completed === 4).length;
	const overview = FACET_KEYS.map((k) => {
		const s = facetStats(k, submissions);
		return `<tr><td><strong>${FACETS[k].label}</strong></td><td>${s.attempts}</td><td>${s.drivers}</td><td>${s.attempts ? score2(s.average) : "--"}</td><td>${s.best ? `${score2(s.best.score.final)} <small>(${esc(s.best.driverName)})</small>` : "--"}</td></tr>`;
	}).join("");
	return `<div class="metrics">${metricTile("Recorded attempts", submissions.length)}${metricTile("Drivers assessed", rows.length)}${metricTile("Top overall score", rows[0] ? rows[0].overall.toFixed(2) : "--", true)}${metricTile("Completed all four facets", full)}</div>
  <section class="panel analysis-panel" style="margin-bottom:18px"><div class="panel-heading"><div><h3>Statistics by facet</h3><p>Every recorded attempt, scores out of 10.</p></div></div><div class="table-wrap"><table><thead><tr><th>Facet</th><th>Attempts</th><th>Drivers</th><th>Average score</th><th>Best score</th></tr></thead><tbody>${overview}</tbody></table></div></section>
  <div class="analysis-layout" style="grid-template-columns:1fr"><section class="panel analysis-panel"><div class="panel-heading"><div><h3>Driver leaderboard</h3><p>Each facet shows the driver's ${esc(ATTEMPT_RULES[state.scoring.overall.attempt].short)}; scores are out of 10. Attempts counts every recorded attempt in the four drills.</p></div><button type="button" class="button button-secondary button-small enlarge-btn no-print" id="enlarge-leaderboard" title="Show the leaderboard larger, with more detail"><span aria-hidden="true">⤢</span> Enlarge</button></div>${leaderboardTable(rows)}<p class="legend">${esc(overallLegend(state.scoring))}</p></section>
  <aside class="panel leaderboard"><h3 style="margin-top:0">Top performers</h3>${
		rows
			.slice(0, 5)
			.map(
				(r, i) =>
					`<div class="leader-row"><span class="rank">${i + 1}</span><span><span class="leader-name">${esc(r.name)}</span><br><small>${r.completed} facet${r.completed === 1 ? "" : "s"} completed</small></span><span class="leader-score">${r.overall.toFixed(2)}</span></div>`,
			)
			.join("") || '<div class="empty">No rankings yet.</div>'
	}</aside></div>
  <section class="panel" style="margin-top:18px"><div class="panel-heading"><div><h3>How the overall score works</h3><p>${esc(OVERALL_METHODS[state.scoring.overall.method].label)}: ${esc(OVERALL_METHODS[state.scoring.overall.method].help)}</p></div></div>${bandsTableHtml(state.scoring)}<p class="legend">${esc(overallLegend(state.scoring))} The full equations are in Scoring equations below.</p></section>
  <div style="margin-top:18px">${attemptsSectionHtml(state, { scope: "general", list: submissions, title: "All recorded attempts", note: "Most recent first. Search or filter to narrow the list. Edit changes an attempt's answers; deleting removes it from every analysis view." })}</div>
  ${allEquationsHtml(Object.fromEntries(FACET_KEYS.map((k) => [k, FACETS[k].label])), state.scoring, state.data.courses)}`;
}

function analysisFacet(facet, submissions) {
	const s = facetStats(facet, submissions);
	// One row per driver in this facet: latest attempt (the one that counts toward the overall score), best, and average.
	const byDriver = {};
	s.list.forEach((x) => (byDriver[x.driverName] ??= []).push(x));
	const standings = Object.entries(byDriver)
		.map(([name, entries]) => {
			const sorted = [...entries].sort(newestFirst),
				scores = entries.map((x) => x.score.final);
			return {
				name,
				grade: sorted[0].grade,
				attempts: entries.length,
				latest: sorted[0].score.final,
				best: Math.max(...scores),
				average: mean(scores),
			};
		})
		.sort((a, b) => b.latest - a.latest);
	const table = standings.length
		? standings
				.map(
					(r, i) =>
						`<tr><td class="rank">#${i + 1}</td><td><strong>${esc(r.name)}</strong></td><td>${esc(r.grade)}</td><td>${r.attempts}</td><td><strong>${score2(r.latest)}</strong></td><td>${score2(r.best)}</td><td>${score2(r.average)}</td></tr>`,
				)
				.join("")
		: `<tr><td colspan="7" class="empty">No attempts for this facet.</td></tr>`;
	return `<div class="metrics">${metricTile("Attempts", s.attempts)}${metricTile("Drivers", s.drivers)}${metricTile("Average score", s.attempts ? score2(s.average) : "--")}${metricTile("Best score", s.best ? `${score2(s.best.score.final)}<small style="font-size:12px;color:var(--muted);font-weight:500"> ${esc(s.best.driverName)}</small>` : "--", true)}</div>
  <section class="panel analysis-panel" style="margin-bottom:18px"><div class="panel-heading"><div><h3>${FACETS[facet].label} standings</h3><p>Ranked by latest attempt. The overall ranking uses each driver's ${esc(ATTEMPT_RULES[state.scoring.overall.attempt].short)} in this facet.</p></div></div><div class="table-wrap"><table><thead><tr><th>Rank</th><th>Driver</th><th>Grade</th><th>Attempts</th><th>Latest</th><th>Best</th><th>Average</th></tr></thead><tbody>${table}</tbody></table></div></section>
  ${attemptsSectionHtml(state, { scope: facet, list: s.list, title: `${FACETS[facet].label} attempts`, note: "Most recent first, with the raw values behind each calculated score (each scored with its course's settings). Search or filter to narrow the list; Edit changes an attempt's answers." })}
  ${facetEquationsHtml(facet, FACETS[facet].label, state.scoring, state.data.courses)}`;
}

// Hooks for the Analysis tab: view dropdown, export button, and the per-row Delete buttons.
function bindAnalysis() {
	document.querySelector("#analysis-view").onchange = (e) => {
		state.analysisView = e.target.value;
		render();
	};
	document.querySelector("#export-pdf")?.addEventListener("click", exportPdf);
	bindAttemptsSections(app, attemptsApi); // search, filters, Enlarge, Edit, Delete
	document.querySelector("#enlarge-leaderboard")?.addEventListener("click", () =>
		openContentSheet(attemptsApi, { key: "leaderboard", title: "Driver leaderboard", html: leaderboardSheetHtml }),
	);
	// Custom-form spreadsheets draw their own Edit / Delete buttons (outside the attempts panels).
	app.querySelectorAll("[data-delete-attempt]").forEach((b) => {
		if (!b.closest("[data-attempts-scope]")) b.onclick = () => openDeleteAttempt(b.dataset.deleteAttempt);
	});
	app.querySelectorAll("[data-edit-attempt]").forEach((b) => {
		if (!b.closest("[data-attempts-scope]")) b.onclick = () => openEditAttempt(attemptsApi, b.dataset.editAttempt);
	});
}

// ---------------------------------------------------------------- PDF export: describes the view currently shown in plain data (see pdf.js)
const slug = (text) =>
	String(text)
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "") || "report";

function generalReport() {
	const subs = builtInSubmissions(),
		rows = driverRows(subs),
		full = rows.filter((r) => r.completed === 4).length;
	const facetRows = FACET_KEYS.map((k) => {
		const s = facetStats(k, subs);
		return [
			FACETS[k].label,
			String(s.attempts),
			String(s.drivers),
			s.attempts ? score2(s.average) : "--",
			s.best ? `${score2(s.best.score.final)} (${s.best.driverName})` : "--",
		];
	});
	return {
		fileName: `DriveLab-general-statistics-${todayKey()}.pdf`,
		title: "General statistics",
		subtitle: "All four driving facets | scores are out of 10",
		metrics: [
			{ label: "Recorded attempts", value: String(subs.length) },
			{ label: "Drivers assessed", value: String(rows.length) },
			{
				label: "Top overall score",
				value: rows[0] ? rows[0].overall.toFixed(2) : "--",
				accent: true,
			},
			{ label: "Completed all four facets", value: String(full) },
		],
		blocks: [
			{
				title: "Statistics by facet",
				orientation: "portrait",
				head: ["Facet", "Attempts", "Drivers", "Average score", "Best score"],
				align: ["left", "center", "center", "right", "left"],
				body: facetRows,
			},
			{
				type: "text",
				title: "How the overall score works",
				orientation: "portrait",
				lines: overallPdfLines(state.scoring), // generated from the current scoring settings
			},
			{
				title: "Driver leaderboard",
				note: `Each facet shows the driver's ${ATTEMPT_RULES[state.scoring.overall.attempt].short}; scores are out of 10.`,
				orientation: "landscape",
				nowrap: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
				align: [
					"center",
					"left",
					"left",
					"center",
					"center",
					"right",
					"right",
					"right",
					"right",
					"right",
				],
				head: [
					"Rank",
					"Driver",
					"Grade",
					"Facets",
					"Attempts",
					"Speed",
					"Defense",
					"Offense",
					"Shooting",
					"Overall",
				],
				body: rows.map((r, i) => [
					`#${i + 1}`,
					r.name,
					r.grade,
					`${r.completed}/4`,
					String(r.attempts),
					...FACET_KEYS.map((k) =>
						r.facets[k] === undefined ? "--" : r.facets[k].toFixed(2),
					),
					r.overall.toFixed(2),
				]),
			},
			{
				title: "All recorded attempts",
				note: "Most recent first.",
				orientation: "landscape",
				nowrap: [0, 1, 2, 3, 5, 6],
				head: [
					"Date",
					"Facet",
					"Driver",
					"Grade",
					"Course",
					"Robot",
					"Final score",
					"Observations",
				],
				align: ["left", "left", "left", "left", "left", "left", "right", "left"],
				body: [...subs]
					.sort(newestFirst)
					.map((x) => [
						dateText(x.date),
						FACETS[x.facet].label,
						x.driverName,
						x.grade,
						x.data?.course ? courseLabel(state.data.courses, x.data.course) : "--",
						x.data?.robot || "--",
						score2(x.score.final),
						x.data?.observations?.join(", ") || "--",
					]),
			},
		],
	};
}

function facetReport(facet) {
	const subs = state.data.submissions,
		s = facetStats(facet, subs),
		numeric = FACETS[facet].fields.filter((f) => f[2] === "number");
	const byDriver = {};
	s.list.forEach((x) => (byDriver[x.driverName] ??= []).push(x));
	const standings = Object.entries(byDriver)
		.map(([name, entries]) => {
			const sorted = [...entries].sort(newestFirst),
				scores = entries.map((x) => x.score.final);
			return {
				name,
				grade: sorted[0].grade,
				attempts: entries.length,
				latest: sorted[0].score.final,
				best: Math.max(...scores),
				average: mean(scores),
			};
		})
		.sort((a, b) => b.latest - a.latest);
	return {
		fileName: `DriveLab-${slug(FACETS[facet].label)}-${todayKey()}.pdf`,
		title: FACETS[facet].label,
		subtitle: "Drill analysis | scores are out of 10",
		metrics: [
			{ label: "Attempts", value: String(s.attempts) },
			{ label: "Drivers", value: String(s.drivers) },
			{ label: "Average score", value: s.attempts ? score2(s.average) : "--" },
			{
				label: "Best score",
				accent: true,
				value: s.best
					? `${score2(s.best.score.final)} (${s.best.driverName})`
					: "--",
			},
		],
		blocks: [
			{
				title: `${FACETS[facet].label} standings`,
				note: `Ranked by latest attempt. The overall ranking uses each driver's ${ATTEMPT_RULES[state.scoring.overall.attempt].short} in this facet.`,
				orientation: "portrait",
				nowrap: [0, 3, 4, 5, 6],
				head: [
					"Rank",
					"Driver",
					"Grade",
					"Attempts",
					"Latest",
					"Best",
					"Average",
				],
				align: ["center", "left", "left", "center", "right", "right", "right"],
				body: standings.map((r, i) => [
					`#${i + 1}`,
					r.name,
					r.grade,
					String(r.attempts),
					score2(r.latest),
					score2(r.best),
					score2(r.average),
				]),
			},
			{
				title: `${FACETS[facet].label} attempts`,
				note: "Most recent first, with the raw values behind each calculated score.",
				orientation: "landscape",
				nowrap: [0, 1, 2, 4, ...numeric.map((_, i) => i + 5), numeric.length + 5],
				head: [
					"Date",
					"Driver",
					"Grade",
					"Course",
					"Robot",
					...numeric.map((f) => f[6] || f[1]),
					"Final score",
					"Observations",
					"Notes",
				],
				body: [...s.list]
					.sort(newestFirst)
					.map((x) => [
						dateText(x.date),
						x.driverName,
						x.grade,
						x.data?.course ? courseLabel(state.data.courses, x.data.course) : "--",
						x.data?.robot || "--",
						...numeric.map((f) => String(x.data?.[f[0]] ?? "--")),
						score2(x.score.final),
						x.data?.observations?.join(", ") || "--",
						x.data?.notes || "--",
					]),
			},
		],
	};
}

async function exportPdf() {
	const button = document.querySelector("#export-pdf"),
		label = button.textContent,
		view = state.analysisView;
	button.disabled = true;
	button.textContent = "Preparing PDF...";
	try {
		let report;
		if (view === "general") report = generalReport();
		else if (isCustomFacet(view)) {
			const form = publishedForms().find((f) => formFacet(f.id) === view);
			report = {
				...customReport(form, state.data.submissions, state.data.courses),
				fileName: `DriveLab-${slug(form.title)}-${todayKey()}.pdf`,
			};
		} else report = facetReport(view);
		await downloadReport(report);
		toast("PDF downloaded.");
	} catch (err) {
		console.error(err);
		toast(`Could not create the PDF: ${err.message}`);
	} finally {
		button.disabled = false;
		button.textContent = label;
	}
}
// Asks for confirmation, deletes the record from storage, and only then removes it from the screen (so a failed delete never LOOKS successful).
function openDeleteAttempt(id) {
	if (!state.session.isAdmin) return; // the server rules enforce this too; this just keeps the UI honest
	const x = state.data.submissions.find((s) => s.id === id);
	if (!x) return;
	content.innerHTML = `<div class="modal-head"><div><p class="eyebrow">CONFIRM DELETE</p><h2>Delete this attempt?</h2></div><button class="close" id="close-modal">×</button></div><p><strong>${esc(x.driverName)}</strong> · ${esc(attemptLabel(x))} · ${dateText(x.date)}${isCustomFacet(x.facet) ? "" : ` · score ${score2(x.score.final)}`}</p><p class="help">This permanently removes the attempt from the database and from every analysis view (leaderboard, statistics, and standings). It cannot be undone.</p><div class="form-actions"><button class="button button-secondary" id="cancel-delete">Cancel</button><button class="button button-danger" id="confirm-delete">Delete attempt</button></div>`;
	modal.showModal();
	document.querySelector("#close-modal").onclick = document.querySelector(
		"#cancel-delete",
	).onclick = () => modal.close();
	document.querySelector("#confirm-delete").onclick = async (e) => {
		e.target.disabled = true;
		try {
			await store.removeRecord("submissions", id);
			state.data.submissions = state.data.submissions.filter(
				(s) => s.id !== id,
			);
			modal.close();
			render();
			toast("Attempt deleted.");
		} catch (err) {
			e.target.disabled = false;
			toast(`Could not delete: ${err.message}`);
		}
	};
}
// ---------------------------------------------------------------- Calendar times
// Times are saved as 24-hour "HH:MM" text (what <input type="time"> produces) and always DISPLAYED in 12-hour form.
// Events saved before start/end times existed have a single `time`, which is treated as the start time.
function time12(value) {
	const match = /^(\d{1,2}):(\d{2})/.exec(value || "");
	if (!match) return "";
	const hours = Number(match[1]);
	return `${hours % 12 || 12}:${match[2]} ${hours < 12 ? "AM" : "PM"}`;
}
const eventStart = (e) => e.startTime || e.time || "";
function eventTimeText(e) {
	const start = time12(eventStart(e)),
		end = time12(e.endTime);
	if (start && end) return `${start} – ${end}`;
	return start || (end ? `Ends ${end}` : "");
}
// A day's events in time order; events with no time come last.
const eventsOn = (day) =>
	state.data.events
		.filter((e) => e.date === day)
		.sort((a, b) =>
			(eventStart(a) || "99").localeCompare(eventStart(b) || "99"),
		);
// Monthly grid. On wide screens each event is a pill with its time and title. On phone-width screens the pills are replaced by
// small dots (so a busy day can never widen its column and push the calendar off the screen), and tapping a day opens a pop-up
// with every event's full details. A list of the month's practices under the grid gives phones a readable agenda as well.
function renderCalendar() {
	const m = state.month,
		first = new Date(m.getFullYear(), m.getMonth(), 1),
		start = new Date(first);
	start.setDate(1 - first.getDay());
	const days = Array.from({ length: 42 }, (_, i) => {
		const d = new Date(start);
		d.setDate(start.getDate() + i);
		return d;
	});
	const admin = state.session.isAdmin;
	const monthName = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" }).format(m);
	const actions = admin
		? '<div class="hero-actions"><button class="button button-secondary" id="export-gcal">Export to Team Google Calendar</button><button class="button" id="add-event">Add practice</button></div>'
		: "";
	const monthKey = `${m.getFullYear()}-${pad2(m.getMonth() + 1)}`;
	const monthEvents = state.data.events
		.filter((e) => String(e.date).startsWith(monthKey))
		.sort((a, b) => a.date.localeCompare(b.date) || (eventStart(a) || "99").localeCompare(eventStart(b) || "99"));
	const agenda = `<section class="panel calendar-agenda" aria-label="Practices in ${esc(monthName)}"><h3>Practices in ${esc(monthName)}</h3>${
		monthEvents.length
			? `<ul>${monthEvents
					.map(
						(e) =>
							`<li><button type="button" class="agenda-item" data-event="${esc(e.id)}"><span class="agenda-date"><strong>${parseDay(e.date).getDate()}</strong><small>${new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(parseDay(e.date))}</small></span><span class="agenda-text"><strong>${esc(e.title)}</strong>${eventTimeText(e) ? `<span class="event-when">${esc(eventTimeText(e))}</span>` : ""}</span><span class="agenda-go" aria-hidden="true">›</span></button></li>`,
					)
					.join("")}</ul>`
			: '<p class="help">No practices are scheduled this month.</p>'
	}</section>`;
	const exportHelp = admin
		? exportInstructionsHtml({
				syncUrl: state.data.settings?.calendarExport?.syncUrl || "",
				lastExport: state.data.settings?.calendarExport?.lastExport || null,
				firebase: store.isRemote(),
			})
		: "";
	return `${pageHeader("Practice calendar", "Everyone can see the calendar. Administrators can schedule, revise, and remove events.", actions)}<section class="panel calendar"><div class="calendar-head"><button class="button button-secondary button-small" data-month="-1" aria-label="Previous month">← <span class="cal-nav-text">Previous</span></button><h2>${esc(monthName)}</h2><button class="button button-secondary button-small" data-month="1" aria-label="Next month"><span class="cal-nav-text">Next</span> →</button></div><div class="calendar-grid">${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((x) => `<div class="day-name"><span class="day-long">${x}</span><span class="day-short" aria-hidden="true">${x[0]}</span></div>`).join("")}${days
		.map((d) => {
			const key = dateKey(d),
				events = eventsOn(key);
			const label = `${dateText(key)}${events.length ? `, ${events.length} event${events.length === 1 ? "" : "s"}` : ""}`;
			return `<div class="calendar-cell ${d.getMonth() !== m.getMonth() ? "muted" : ""} ${key === todayKey() ? "today" : ""} ${events.length ? "has-events" : ""}" data-day="${key}" role="button" tabindex="0" aria-label="${esc(label)}"><span class="day-num">${d.getDate()}</span>${events
				.map((e) => {
					const when = eventTimeText(e);
					return `<div class="event-pill" title="${esc([e.title, when, e.description].filter(Boolean).join("\n"))}">${when ? `<span class="event-time">${esc(when)}</span>` : ""}<span class="event-title">${esc(e.title)}</span></div>`;
				})
				.join("")}${events.length ? `<span class="event-dots" aria-hidden="true">${events
				.slice(0, 3)
				.map(() => "<i></i>")
				.join("")}${events.length > 3 ? `<b>+${events.length - 3}</b>` : ""}</span>` : ""}</div>`;
		})
		.join("")}</div></section>${agenda}${exportHelp}`;
}
function renderCourses() {
	return renderCourseGallery(ctx);
}
function renderCourseBuilderPage() {
	return renderCourseBuilder(ctx);
}
function renderForms() {
	return renderFormBuilder(ctx);
}
function renderAdmin() {
	return `${pageHeader("Administrator", "Security, data-source, and operating guidance.")}<div class="admin-grid"><section class="panel admin-card"><h3>Connection</h3><p>${store.isRemote() ? "Firebase is configured. Submitters cannot read records; only accounts listed in the admins collection can open analysis." : "Local preview is active. Data stays only in this browser and is not appropriate for shared team use."}</p>${store.isRemote() ? `<p><strong>Your Google UID:</strong><br><code>${esc(store.getAdminUid())}</code></p><p class="help">Add this UID as the document ID in <code>admins</code> through the Firebase console, then sign in again.</p>` : "<p>Follow the README's Firebase setup steps before publishing. Do not publish with the local-preview data as if it were shared, secure storage.</p>"}</section><section class="panel admin-card"><h3>Privacy controls</h3><p>Full names, grades, notes, and submissions are never embedded in this source repository. The app does not use analytics, advertising, or a shared public name list.</p><p class="help">Name suggestions are local to each browser so a student does not need to retype their own name without exposing other students' names.</p></section><section class="panel admin-card"><h3>Export</h3><p>Use the Analysis screen's Download PDF button. It downloads a formatted, dated PDF report of the view currently selected (general statistics, one drill, or one custom form).</p></section><section class="panel admin-card"><h3>Operational rule</h3><p>Use the same selected course layout for each facet throughout a single day. Pair defense and offense on the shared course and record each driver separately.</p></section></div>`;
}
function render() {
	const views = {
		practice: renderPractice,
		analysis: renderAnalysis,
		scoring: () => renderScoringEditor(ctx),
		calendar: renderCalendar,
		courses: renderCourses,
		"course-builder": renderCourseBuilderPage,
		forms: renderForms,
		admin: renderAdmin,
	};
	document.querySelector("#page-title").textContent = {
		practice: "Practice form",
		analysis: "Analysis",
		scoring: "Scoring settings",
		calendar: "Practice calendar",
		courses: "Courses",
		"course-builder": "Course builder",
		forms: "Form builder",
		admin: "Administrator",
	}[state.route];
	app.innerHTML = views[state.route]();
	bindView();
	refreshSheet(); // keep the enlarged attempts view (if open) in step with the page
}
function bindView() {
	if (state.route === "practice") {
		document.querySelectorAll("[data-facet]").forEach(
			(b) =>
				(b.onclick = () => {
					state.facet = b.dataset.facet;
					render();
				}),
		);
		const custom = currentCustomForm();
		if (custom) bindCustomForm(custom, ctx);
		else {
			const cached = localStorage.getItem("drivelab-last-name");
			if (cached) document.querySelector("#driverName").value = cached;
			document.querySelector("#practiceDate").value = todayKey();
			bindTimer();
			document.querySelector("#practice-form").onsubmit = submitPractice;
		}
	}
	if (state.route === "analysis") bindAnalysis();
	if (state.route === "scoring") bindScoringEditor(ctx);
	if (state.route === "calendar") {
		document.querySelectorAll("[data-month]").forEach(
			(b) =>
				(b.onclick = () => {
					state.month.setMonth(
						state.month.getMonth() + Number(b.dataset.month),
					);
					render();
				}),
		);
		document.querySelector("#add-event")?.addEventListener("click", openEvent);
		document.querySelector("#export-gcal")?.addEventListener("click", openExport);
		document.querySelectorAll("[data-day]").forEach((c) => {
			c.onclick = () => showDay(c.dataset.day);
			c.onkeydown = (e) => {
				if (e.key === "Enter" || e.key === " ") {
					e.preventDefault();
					showDay(c.dataset.day);
				}
			};
		});
		document
			.querySelectorAll("[data-event]")
			.forEach((b) => (b.onclick = () => showEvent(b.dataset.event)));
	}
	if (state.route === "courses") bindCourseGallery(ctx);
	if (state.route === "course-builder") bindCourseBuilder(ctx);
	if (state.route === "forms") bindFormBuilder(ctx);
}
// Wires up the on-page timer for the selected facet.
//  - Countdown drills (defense / offense / shooting): Start-Pause and Reset only.
//  - Speed stopwatch: Lap Split can be pressed ONCE per run, at the end of lap 1.
//      Lap Split -> "First lap split"  = stopwatch reading at that moment; the button then disappears.
//      Stop      -> "Total drive time" = final stopwatch reading, and
//                   "Second lap split" = final reading - first lap split (the length of lap 2 alone).
//    After Lap Split the only controls left are Stop (the Start/Stop button) and Reset; Reset brings Lap Split back.
function bindTimer() {
	const output = document.querySelector("#timer-output");
	if (!output) return; // this facet has no timer
	const isCountdown = FACETS[state.facet].timer === "countdown";
	const toggle = document.querySelector("#timer-toggle");
	const resetButton = document.querySelector("#timer-reset");
	const lapButton = document.querySelector("#timer-lap"); // null on countdown drills
	const help = document.querySelector("#timer-help");
	const START_MS = isCountdown ? 90000 : 0;

	let value = START_MS; // milliseconds currently shown on the timer
	let running = false;
	let last; // performance.now() when `value` was last brought up to date

	// Lap-split bookkeeping (stopwatch only).
	let lapTaken = false; // true once Lap Split has been pressed for this run
	let firstSplit = null; // first split in seconds, kept as a fallback if the box is blanked
	const written = {}; // what this timer last wrote into each box, so resuming never erases something a person typed

	const box = (id) => document.querySelector(`#${id}`);
	const toSeconds = (ms) => Math.round(ms / 10) / 100; // milliseconds -> seconds with 2 decimals (the timer shows tenths; the box keeps hundredths)
	const write = (id, secs) => {
		const text = secs.toFixed(2);
		box(id).value = text;
		written[id] = text;
	};
	const clearWritten = (id) => {
		if (box(id).value === written[id]) box(id).value = "";
		written[id] = undefined;
	};
	// The first split as it currently appears in its box (honours a manual correction); falls back to the captured value.
	const firstSplitSeconds = () => {
		const typed = parseFloat(box("lap1").value);
		return Number.isFinite(typed) ? typed : firstSplit;
	};

	const display = () => {
		const x = Math.max(0, value),
			mins = Math.floor(x / 60000),
			secs = Math.floor((x % 60000) / 1000),
			tenths = Math.floor((x % 1000) / 100);
		output.textContent = `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}.${tenths}`;
	};
	// Animation frames only update `value` about every 16 ms. Before reading the clock for the split or the final time,
	// add the time since the last frame so the number recorded is the exact instant of the button press.
	const settle = () => {
		if (!running) return;
		const t = performance.now();
		value += t - last;
		last = t;
	};

	// Lap Split is visible until it has been used once, and only clickable while the stopwatch is running.
	const syncLapButton = () => {
		if (!lapButton) return;
		lapButton.hidden = lapTaken;
		lapButton.disabled = !running;
	};

	const updateHelp = () => {
		if (isCountdown || !help) return;
		if (!running && value > 0)
			help.textContent =
				"Stopped. The timing boxes above are filled in. Press Reset to time another run.";
		else if (!lapTaken)
			help.textContent =
				"Press Lap Split once, at the end of lap 1. When lap 2 ends, press Stop and lap 2 and the total fill in automatically.";
		else
			help.textContent =
				"Lap 1 recorded. Press Stop when the driver finishes lap 2.";
	};

	const tick = (t) => {
		if (!running) return;
		const delta = t - last;
		last = t;
		value += isCountdown ? -delta : delta;
		display();
		if (value <= 0 && isCountdown) {
			running = false;
			toast("Time is up - disable robots.");
			return;
		}
		state.timer = requestAnimationFrame(tick);
	};

	// Called when the stopwatch is stopped: record the final reading, and lap 2 (final reading - first split) if lap 1 was recorded.
	const finishRun = () => {
		const total = toSeconds(value);
		write("totalTime", total);
		if (lapTaken)
			write("lap2", Math.round((total - firstSplitSeconds()) * 100) / 100);
	};
	// Called when the stopwatch is started again after a Stop: the run is not finished after all, so the total and lap 2 are no
	// longer final and are withdrawn (only if they still hold what the timer wrote). The first split stays; Lap Split stays hidden.
	const resumeRun = () => {
		clearWritten("totalTime");
		clearWritten("lap2");
	};

	toggle.onclick = () => {
		if (!running) {
			// START or RESUME
			if (!isCountdown && value > 0) resumeRun();
			running = true;
			last = performance.now();
			state.timer = requestAnimationFrame(tick);
			toggle.textContent = isCountdown ? "Pause" : "Stop";
		} else {
			// PAUSE (countdown) or STOP (stopwatch)
			cancelAnimationFrame(state.timer);
			if (!isCountdown) {
				settle();
				display();
				finishRun();
			}
			running = false;
			toggle.textContent = "Start";
		}
		syncLapButton();
		updateHelp();
	};

	if (lapButton)
		lapButton.onclick = () => {
			if (!running || lapTaken) return; // one press per run
			settle();
			display(); // exact reading at the moment of the click
			firstSplit = toSeconds(value);
			write("lap1", firstSplit);
			lapTaken = true;
			syncLapButton();
			updateHelp(); // the button disappears; only Stop and Reset remain
		};

	// Reset (the timer's own button, or the form's Clear / a successful submit) returns everything to a fresh run.
	const resetTimer = () => {
		cancelAnimationFrame(state.timer);
		running = false;
		value = START_MS;
		display();
		toggle.textContent = "Start";
		if (!isCountdown) {
			lapTaken = false;
			firstSplit = null;
			["lap1", "lap2", "totalTime"].forEach((id) => {
				box(id).value = "";
				written[id] = undefined;
			});
		}
		syncLapButton();
		updateHelp();
	};
	resetButton.onclick = resetTimer;
	document
		.querySelector("#practice-form")
		?.addEventListener("reset", resetTimer);

	display();
	syncLapButton();
	updateHelp();
}
async function submitPractice(e) {
	e.preventDefault();
	const form = e.currentTarget;
	if (!form.reportValidity()) return;
	const d = Object.fromEntries(new FormData(form));
	d.observations = [
		...form.querySelectorAll('[name="observation"]:checked'),
	].map((x) => x.value);
	const item = {
		id: uid(),
		facet: state.facet,
		driverName: d.driverName.trim(),
		grade: d.grade,
		date: d.practiceDate,
		data: d,
		createdAt: now(),
	};
	item.score = scoreSubmission(item, state.scoring); // the current scoring settings (read by everyone)
	try {
		await store.addSubmission(item);
		state.data.submissions.push(item);
		localStorage.setItem("drivelab-last-name", item.driverName);
		toast(
			`${FACETS[item.facet].label} score: ${item.score.final.toFixed(2)} / 10`,
		);
		form.reset();
		document.querySelector("#practiceDate").value = todayKey();
		document.querySelector("#driverName").value = item.driverName;
	} catch (err) {
		toast(`Could not save: ${err.message}`);
	}
}
function openAdmin() {
	content.innerHTML = `<div class="modal-head"><div><p class="eyebrow">RESTRICTED AREA</p><h2>Administrator sign in</h2></div><button class="close" id="close-modal">×</button></div><p>Analysis, form building, and course management require an administrator account.</p>${store.isRemote() ? '<button class="button" id="google-signin">Continue with Google</button>' : '<div class="notice">This local preview cannot securely protect an administrator password. Configure the free Firebase option described in README.md before publishing.</div>'}`;
	modal.showModal();
	document.querySelector("#close-modal").onclick = () => modal.close();
	document
		.querySelector("#google-signin")
		?.addEventListener("click", async () => {
			try {
				const s = await store.signInAdmin();
				if (!s.isAdmin)
					throw new Error(
						"This Google account is not on the administrator allow-list.",
					);
				state.session = s;
				await loadData();
				updateStatus();
				updateAccount();
				modal.close();
				render();
				toast("Administrator access granted.");
			} catch (err) {
				toast(err.message);
			}
		});
}
// Returns to guest recorder mode. Administrator data is dropped from memory and the page leaves any administrator-only screen.
async function logout() {
	try {
		state.session = await store.signOutAdmin();
		await loadData();
		updateStatus(); // reloaded as a guest: only public data comes back (calendar, courses, forms)
	} catch (err) {
		toast(`Could not log out: ${err.message}`);
		return;
	}
	updateAccount();
	setRoute("practice");
	toast("Logged out. You are now recording as a guest.");
}
function updateAccount() {
	document
		.querySelectorAll(".admin-only")
		.forEach((x) => (x.hidden = !state.session.isAdmin));
	document.querySelector("#account-label").textContent = state.session.isAdmin
		? "Administrator"
		: "Guest recorder";
	document.querySelector("#admin-button").textContent = state.session.isAdmin
		? "Log out"
		: "Administrator sign in";
}
function openEvent() {
	content.innerHTML = `<div class="modal-head"><h2>Schedule practice</h2><button class="close" id="close-modal">×</button></div><form id="event-form" class="event-form">${field("event-title", "Title", "text", true)}${field("event-date", "Date", "date", true)}<div><div class="field-grid">${field("event-start", "Start time", "time", false)}${field("event-end", "End time", "time", false)}</div><p class="help event-time-help">Both times are optional and are shown in 12-hour format (for example 4:00 PM - 6:00 PM). An end time needs a start time.</p><p class="event-time-error" id="event-time-error" role="alert" hidden></p></div><div class="field"><label for="event-description">Description</label><textarea id="event-description" maxlength="500"></textarea></div><div class="form-actions"><button class="button" type="submit">Save event</button></div></form>`;
	modal.showModal();
	document.querySelector("#close-modal").onclick = () => modal.close();
	document.querySelector("#event-form").onsubmit = async (e) => {
		e.preventDefault();
		const f = new FormData(e.currentTarget),
			startTime = f.get("event-start") || "",
			endTime = f.get("event-end") || "";
		const error = document.querySelector("#event-time-error");
		// "HH:MM" strings compare correctly as text, so a plain comparison checks that the end is after the start.
		const problem =
			endTime && !startTime
				? "Add a start time, or clear the end time."
				: startTime && endTime && endTime <= startTime
					? "The end time must be later than the start time."
					: "";
		error.textContent = problem;
		error.hidden = !problem;
		if (problem) return;
		const item = {
			id: uid(),
			title: f.get("event-title"),
			date: f.get("event-date"),
			startTime,
			endTime,
			description: document.querySelector("#event-description").value,
		};
		try {
			await store.saveRecord("events", item);
		} catch (err) {
			toast(`Could not save the event: ${err.message}`);
			return;
		}
		state.data.events.push(item);
		modal.close();
		render();
		toast("Practice scheduled.");
	};
}
// Pop-up with the full details of every event on one day (or of a single event, from the month list).
function eventDetailHtml(e) {
	return `<div class="custom-item event-detail"><span><strong>${esc(e.title)}</strong>${eventTimeText(e) ? `<br><span class="event-when">${esc(eventTimeText(e))}</span>` : '<br><span class="event-when">All day</span>'}<br><small>${esc(e.description || "No description.")}</small></span>${state.session.isAdmin ? `<button class="button button-danger button-small" data-remove-event="${esc(e.id)}">Remove</button>` : ""}</div>`;
}
function showDay(day, onlyId = null) {
	const events = eventsOn(day).filter((e) => !onlyId || e.id === onlyId);
	content.innerHTML = `<div class="modal-head"><h2>${dateText(day)}</h2><button class="close" id="close-modal" aria-label="Close">×</button></div>${events.length ? events.map(eventDetailHtml).join("") : "<p>No scheduled practice.</p>"}`;
	modal.showModal();
	document.querySelector("#close-modal").onclick = () => modal.close();
	document.querySelectorAll("[data-remove-event]").forEach(
		(b) =>
			(b.onclick = async () => {
				b.disabled = true;
				try {
					await store.removeRecord("events", b.dataset.removeEvent);
				} catch (err) {
					b.disabled = false;
					toast(`Could not remove the event: ${err.message}`);
					return;
				}
				state.data.events = state.data.events.filter(
					(x) => x.id !== b.dataset.removeEvent,
				);
				modal.close();
				render();
				toast("Practice removed.");
			}),
	);
}
function showEvent(id) {
	const e = state.data.events.find((x) => x.id === id);
	if (e) showDay(e.date, id);
}

// ---------------------------------------------------------------- Export to the team Google Calendar (administrators; see gcal.js)
function openExport() {
	if (!state.session.isAdmin) return;
	const saved = state.data.settings?.calendarExport || {};
	const all = state.data.events;
	const google = store.canUseGoogleCalendar();
	content.innerHTML = exportDialogHtml({
		syncUrl: saved.syncUrl || "",
		count: all.length,
		upcoming: upcomingOnly(all).length,
		firebase: google,
	});
	ctx.openModal();
	const form = document.querySelector("#gcal-form"),
		status = document.querySelector("#gcal-status"),
		go = document.querySelector("#gcal-go");
	const selected = () => (document.querySelector("#gcal-upcoming").checked ? upcomingOnly(all) : [...all]);
	const say = (html, kind = "") => {
		status.hidden = false;
		status.className = `gcal-status ${kind}`;
		status.innerHTML = html;
	};
	let finished = false;
	document.querySelector("#close-modal").onclick = () => modal.close();
	modal.addEventListener("close", () => finished && state.route === "calendar" && render(), { once: true });
	document.querySelector("#gcal-ics").onclick = () => {
		const events = selected();
		if (!events.length) return say("There are no practices to put in the file.", "bad");
		downloadIcs(events);
		say(`Downloaded a file with ${events.length} practice${events.length === 1 ? "" : "s"}. In Google Calendar open <strong>Settings → Import &amp; export</strong>, choose the file, set <strong>Add to calendar</strong> to the team calendar, and press <strong>Import</strong>. Practices that are already there are skipped.`, "ok");
	};
	form.onsubmit = async (e) => {
		e.preventDefault();
		if (!google) return;
		const syncUrl = document.querySelector("#gcal-url").value.trim();
		if (!isSyncUrl(syncUrl))
			return say("Paste the Web app URL from the one-time setup (Part C). It starts with https://script.google.com/macros/s/ and ends in /exec.", "bad");
		const events = selected();
		const removeDeleted = document.querySelector("#gcal-remove").checked;
		if (!events.length && !removeDeleted) return say("There are no practices to export.", "bad");
		go.disabled = true;
		try {
			say(`Exporting… 0 of ${events.length}`);
			const idToken = await store.getIdToken();
			const result = await exportViaScript({
				url: syncUrl,
				idToken,
				events,
				allEvents: all,
				removeDeleted,
				onProgress: (done, total) => say(`Exporting… ${done} of ${total}`),
			});
			const record = {
				syncUrl,
				calendarName: result.calendar.name,
				lastExport: {
					at: now(),
					calendarName: result.calendar.name,
					added: result.added,
					skipped: result.skipped,
					failed: result.failed.length,
					removed: result.removed,
				},
			};
			state.data.settings = { ...(state.data.settings || {}), [CALENDAR_SETTINGS_ID]: record };
			try {
				await store.saveSetting(CALENDAR_SETTINGS_ID, record);
			} catch (err) {
				console.warn("Could not save the export summary", err);
			}
			finished = true;
			say(
				`<strong>Done: exported to “${esc(result.calendar.name || "the team calendar")}”.</strong><br>${result.added} new practice${result.added === 1 ? "" : "s"} added · ${result.skipped} already in Google Calendar (skipped, not duplicated)${removeDeleted ? ` · ${result.removed} removed` : ""}${result.failed.length ? ` · <span class="bad-text">${result.failed.length} failed</span>` : ""}.${result.failed.length ? `<ul>${result.failed
							.slice(0, 5)
							.map((f) => `<li>${esc(f.event.title)}${f.event.date ? ` (${esc(dateText(f.event.date))})` : ""}: ${esc(f.message)}</li>`)
							.join("")}</ul>` : ""}<br><a href="https://calendar.google.com/calendar/r" target="_blank" rel="noopener">Open Google Calendar</a>`,
				result.failed.length ? "bad" : "ok",
			);
			go.textContent = "Export again";
		} catch (err) {
			say(esc(err.message), "bad");
		} finally {
			go.disabled = false;
		}
	};
}

// Sidebar status. If the deployed Firestore rules are older than this version, forms and courses cannot be read by guests; say so.
function updateStatus() {
	const warnings = store.getLoadWarnings(),
		el = document.querySelector("#connection-status");
	el.textContent = !store.isRemote()
		? "Private local preview"
		: warnings.length
			? "Firebase connected - update the Firestore rules (see README)"
			: "Protected Firebase connected";
	if (warnings.length)
		console.warn(
			`Firestore denied public reads of: ${warnings.join(", ")}. Publish the current firestore.rules so guests can see forms and courses.`,
		);
}
// ---------------------------------------------------------------- Light / dark mode
// The choice is saved in this browser (localStorage). With no saved choice the site follows the device's setting.
// index.html applies the saved theme before the page is drawn, so there is no flash of the wrong colors.
const THEME_KEY = "drivelab-theme";
const currentTheme = () =>
	document.documentElement.dataset.theme === "dark" ? "dark" : "light";
function applyTheme(theme) {
	document.documentElement.dataset.theme = theme;
	const button = document.querySelector("#theme-toggle");
	if (!button) return;
	const dark = theme === "dark";
	button.setAttribute("aria-pressed", String(dark));
	button.title = dark ? "Switch to light mode" : "Switch to dark mode";
	button.querySelector(".theme-label").textContent = dark
		? "Light mode"
		: "Dark mode";
}
function bindThemeToggle() {
	applyTheme(currentTheme());
	document.querySelector("#theme-toggle").onclick = () => {
		const next = currentTheme() === "dark" ? "light" : "dark";
		try {
			localStorage.setItem(THEME_KEY, next);
		} catch {
			/* storage blocked: the theme still changes for this visit */
		}
		applyTheme(next);
	};
	// Follow a change in the device's setting, unless the person has picked a theme on this site.
	window.matchMedia?.("(prefers-color-scheme: dark)").addEventListener?.("change", (e) => {
		if (!localStorage.getItem(THEME_KEY)) applyTheme(e.matches ? "dark" : "light");
	});
}
async function init() {
	// Bind navigation and the sign-in button FIRST. They need no network, so the page stays usable
	// (and an administrator can still reach the sign-in dialog) even if Firebase setup fails below.
	document
		.querySelectorAll(".nav-link")
		.forEach((x) => (x.onclick = () => setRoute(x.dataset.route)));
	// While signed in as an administrator this same button becomes "Log out".
	document.querySelector("#admin-button").onclick = () =>
		state.session.isAdmin ? logout() : openAdmin();
	// The DriveLab title always goes to the Practice form page.
	document.querySelector(".brand").onclick = (e) => {
		e.preventDefault();
		setRoute("practice");
	};
	bindThemeToggle();
	try {
		state.session = await store.initializeStorage();
		await loadData();
		updateStatus();
		updateAccount();
		// Reopen the page this tab was on before a refresh (an administrator page only if the administrator session was restored).
		const saved = sessionStorage.getItem(ROUTE_KEY);
		const known = saved && document.querySelector(`.nav-link[data-route="${saved}"]`);
		setRoute(
			known && (state.session.isAdmin || !ADMIN_ROUTES.includes(saved))
				? saved
				: "practice",
		);
	} catch (error) {
		console.error(error);
		document.querySelector("#connection-status").textContent =
			"Storage setup failed - see browser console";
		toast("Storage setup failed. Local preview remains available.");
		render();
	}
}
init();
