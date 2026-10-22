// Recorded attempts on the Analysis tab (administrators): the searchable, filterable attempts list, its enlarged view, and the
// "Edit attempt" pop-up.
//
//  - attemptsSectionHtml(scope, ...) draws an attempts panel with a search box, a Filters menu, active-filter chips, a result count,
//    an "Enlarge" button, and the table. Each list has a SCOPE ("general" = All recorded attempts, or a drill key such as "speed")
//    and its search / filters are kept in state.attemptFilters[scope], so they survive re-renders and are shared by the normal and
//    the enlarged view. Typing or ticking a filter redraws only the table, never the search box, so focus is never lost.
//  - The enlarged view is an in-page layer (a <dialog>) over the page, about 94% of the width and 88% of the height of the window,
//    with extra columns (every response, notes, when it was recorded, and whether it was edited).
//  - The Edit pop-up is a medium-sized layer showing the form the driver completed, filled in with their answers, using the drill's
//    CURRENT questions, so a question added later (for example Course driven) can be answered for older attempts. Save writes the
//    changes; "Revert to original" loads the values as they were first submitted (kept in `original` the first time an attempt is
//    edited); Cancel closes without saving.
import { FACETS, GRADES, OBSERVATIONS, ROBOTS, FACET_COURSE_GROUP } from "./constants.js";
import { fieldHtml, courseOptions } from "./fields.js";
import { courseLabel, COURSE_GROUPS, publishedCourses } from "./courses.js";
import { scoreSubmission, FACET_ORDER } from "./scoring.js";
import { esc, now, dateText } from "./util.js";
import {
	normalizeForm,
	formFacet,
	isCustomFacet,
	formIdOf,
	allQuestions,
	customFormHtml,
	collectAnswers,
	metricOf,
	answerText,
} from "./customforms.js";
import { drillForm, drillFormHtml, drillLabel, addedQuestions, addedPart, observationChoices } from "./drillforms.js";

const FACET_KEYS = FACET_ORDER; // the scored drills (Shooting only was removed in Update 47)
const score2 = (n) => Number(n).toFixed(2);
const newestFirst = (a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || ""));
const when = (iso) => (iso ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso)) : "");

// ---------------------------------------------------------------- reading an attempt
const customFormOf = (state, x) =>
	isCustomFacet(x.facet) ? state.data.customForms.map(normalizeForm).find((f) => formFacet(f.id) === x.facet) || null : null;
export function attemptLabelOf(state, x) {
	return FACETS[x.facet]?.label || customFormOf(state, x)?.title || x.data?.formTitle || "Custom form";
}
const courseOf = (x) => x.data?.course || "";
const robotOf = (x) => x.data?.robot || "";
// The other driver in a paired drill.
const partnerOf = (x) =>
	x.facet === "defense"
		? [x.data?.opponentName, x.data?.opponentGrade].filter(Boolean).join(", ")
		: x.facet === "offense"
			? [x.data?.defenderName, x.data?.defenderGrade].filter(Boolean).join(", ")
			: "";
// Every scored or recorded answer as "Question: answer" pairs (the Responses column of the enlarged view).
function responses(state, x) {
	if (FACETS[x.facet]) {
		const def = drillForm(state, x.facet);
		const scored = FACETS[x.facet].fields.map((f) => [drillLabel(def, f[0]), x.data?.[f[0]] ?? ""]);
		const added = addedQuestions(def).map((q) => [q.label, answerText(q, x.data?.answers?.[q.id])]);
		return [...scored, ...added].filter(([, v]) => v !== "" && v !== "--" && v !== null);
	}
	const form = customFormOf(state, x);
	if (!form) return [];
	return allQuestions(form)
		.map((q) => {
			const v = x.data?.answers?.[q.id];
			return [q.label, Array.isArray(v) ? v.join(", ") : v ?? ""];
		})
		.filter(([, v]) => v !== "" && v !== null);
}
const missingInfo = (x) => !courseOf(x) || !robotOf(x);

// ---------------------------------------------------------------- search and filters
const EMPTY_FILTER = () => ({ q: "", facet: [], grade: [], observation: [], robot: [], course: [], status: [] });
export function filterOf(state, scope) {
	state.attemptFilters ??= {};
	return (state.attemptFilters[scope] ??= EMPTY_FILTER());
}
// The filter groups offered for a list (only choices that make sense for it).
function filterGroups(state, scope, list) {
	const courses = state.data.courses || {};
	const groups = [];
	if (scope === "general") groups.push({ key: "facet", label: "Drill", options: FACET_KEYS.map((k) => [k, FACETS[k].label]) });
	groups.push({ key: "grade", label: "Grade level", options: GRADES.map((g) => [g, g]) });
	groups.push({ key: "robot", label: "Robot", options: [...ROBOTS.map((r) => [r, r]), ["", "Not recorded"]] });
	// Courses: the published ones for the drill(s) in this list, any course an attempt in the list names, and "Not recorded".
	const families = scope === "general" ? COURSE_GROUPS.map((g) => g.key) : [FACET_COURSE_GROUP[scope]];
	const keys = new Set(families.flatMap((g) => publishedCourses(courses, g).map((c) => c.key)));
	list.forEach((x) => courseOf(x) && keys.add(courseOf(x)));
	const familyName = (key) => COURSE_GROUPS.find((g) => g.key === key.split("-")[0])?.label || "";
	groups.push({
		key: "course",
		label: "Course",
		options: [...[...keys].sort((a, b) => families.indexOf(a.split("-")[0]) - families.indexOf(b.split("-")[0]) || a.localeCompare(b)).map((k) => [k, scope === "general" ? `${familyName(k)}: ${courseLabel(courses, k)}` : courseLabel(courses, k)]), ["", "Not recorded"]],
	});
	const seen = new Set([...OBSERVATIONS, ...FACET_KEYS.flatMap((k) => observationChoices(drillForm(state, k)))]);
	list.forEach((x) => (x.data?.observations || []).forEach((o) => seen.add(o)));
	groups.push({ key: "observation", label: "Coach observations", options: [...seen].map((o) => [o, o]) });
	groups.push({
		key: "status",
		label: "Record status",
		options: [
			["edited", "Edited by an administrator"],
			["missing", "Missing course or robot"],
		],
	});
	return groups;
}
// Lower-case text an attempt can be found by.
function haystack(state, x) {
	const courses = state.data.courses || {};
	return [
		x.driverName,
		x.grade,
		attemptLabelOf(state, x),
		x.date,
		dateText(x.date),
		courseLabel(courses, courseOf(x)),
		robotOf(x),
		partnerOf(x),
		x.data?.timerName,
		...(x.data?.observations || []),
		x.data?.notes,
		...responses(state, x).map(([q, v]) => `${q} ${v}`),
		x.editedAt ? "edited" : "",
		score2(x.score?.final ?? 0),
	]
		.filter(Boolean)
		.join(" ")
		.toLowerCase();
}
export function applyFilter(state, scope, list) {
	const f = filterOf(state, scope);
	const words = f.q.toLowerCase().split(/\s+/).filter(Boolean);
	return list.filter((x) => {
		if (f.facet.length && !f.facet.includes(x.facet)) return false;
		if (f.grade.length && !f.grade.includes(x.grade)) return false;
		if (f.robot.length && !f.robot.includes(robotOf(x))) return false;
		if (f.course.length && !f.course.includes(courseOf(x))) return false;
		if (f.observation.length && !f.observation.some((o) => (x.data?.observations || []).includes(o))) return false;
		if (f.status.includes("edited") && !x.editedAt) return false;
		if (f.status.includes("missing") && !missingInfo(x)) return false;
		if (words.length) {
			const text = haystack(state, x);
			if (!words.every((w) => text.includes(w))) return false;
		}
		return true;
	});
}
const activeCount = (f) => ["facet", "grade", "observation", "robot", "course", "status"].reduce((n, k) => n + f[k].length, 0);

// ---------------------------------------------------------------- sorting
// Clicking a column heading sorts by that column; clicking it again reverses the order. Dates (and Recorded) start with the earliest,
// scores and other numbers with the highest, and words (drill, course, robot) from A to Z; grades go 9th -> 12th. Attempts without a
// value always go last. Columns that cannot be ordered sensibly (Driver, responses, observations, notes, Actions) are not sortable.
// The sort is kept per list in state.attemptSort[scope] (null = the default: most recently recorded first) and is shared with the
// enlarged view; "Reset sorting" (shown only while sorted) returns to the default.
export function sortOf(state, scope) {
	state.attemptSort ??= {};
	return state.attemptSort[scope] || null;
}
function sorters(state, facet) {
	const courses = state.data.courses || {};
	const def = facet ? drillForm(state, facet) : null;
	const list = {
		date: { label: "Date", first: "asc", get: (x) => x.date || null },
		drill: { label: "Drill", first: "asc", get: (x) => attemptLabelOf(state, x) },
		grade: { label: "Grade", first: "asc", get: (x) => (GRADES.includes(x.grade) ? GRADES.indexOf(x.grade) : null) },
		course: { label: "Course", first: "asc", get: (x) => (courseOf(x) ? courseLabel(courses, courseOf(x)) : null) },
		robot: { label: "Robot", first: "asc", get: (x) => robotOf(x) || null },
		final: { label: "Final score", first: "desc", get: (x) => Number(x.score?.final ?? 0) },
		recorded: { label: "Recorded", first: "asc", get: (x) => x.createdAt || null },
	};
	if (facet) {
		for (const f of FACETS[facet].fields.filter((f) => f[2] === "number"))
			list[`f:${f[0]}`] = { label: drillLabel(def, f[0]), first: "desc", get: (x) => (x.data?.[f[0]] === "" || x.data?.[f[0]] === undefined ? null : Number(x.data[f[0]])) };
		for (const q of addedQuestions(def).filter((q) => q.type === "number" || q.type === "scale"))
			list[`q:${q.id}`] = { label: q.label, first: "desc", get: (x) => (typeof x.data?.answers?.[q.id] === "number" ? x.data.answers[q.id] : null) };
	}
	return list;
}
function sortList(state, scope, list) {
	const sort = sortOf(state, scope);
	const by = sort && sorters(state, scope === "general" ? null : scope)[sort.key];
	if (!by) return [...list].sort(newestFirst); // the default order
	const dir = sort.dir === "desc" ? -1 : 1;
	const empty = (v) => v === null || v === undefined || v === "" || Number.isNaN(v);
	return [...list].sort((a, b) => {
		const va = by.get(a),
			vb = by.get(b);
		if (empty(va) || empty(vb)) return empty(va) === empty(vb) ? newestFirst(a, b) : empty(va) ? 1 : -1; // no value: always last
		const c = typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb), undefined, { numeric: true });
		return c ? c * dir : newestFirst(a, b);
	});
}
const sortDescription = (state, scope) => {
	const sort = sortOf(state, scope);
	const by = sort && sorters(state, scope === "general" ? null : scope)[sort.key];
	if (!by) return "";
	const words = { date: ["earliest first", "latest first"], recorded: ["earliest first", "latest first"], grade: ["9th to 12th", "12th to 9th"] }[sort.key];
	const isNumber = sort.key === "final" || sort.key.startsWith("f:") || sort.key.startsWith("q:");
	const [up, down] = words || (isNumber ? ["lowest first", "highest first"] : ["A to Z", "Z to A"]);
	return `Sorted by ${by.label}, ${sort.dir === "asc" ? up : down}`;
};
function sortResetHtml(state, scope) {
	const text = sortDescription(state, scope);
	return `<span class="sort-status" data-sort-status ${text ? "" : "hidden"}><span data-sort-text>${esc(text)}</span><button type="button" class="button button-secondary button-small" data-sort-reset title="Back to the default order: most recently recorded first">Reset sorting</button></span>`;
}

// ---------------------------------------------------------------- table
function tableHtml(state, scope, list, expanded) {
	const courses = state.data.courses || {};
	const facet = scope === "general" ? null : scope;
	const def = facet ? drillForm(state, facet) : null;
	const numeric = facet ? FACETS[facet].fields.filter((f) => f[2] === "number") : [];
	const added = facet ? addedQuestions(def) : [];
	const paired = facet === "defense" || facet === "offense";
	const keys = sorters(state, facet);
	// Each column: [heading, cell, sort key (or null when the column cannot be sorted)]
	const cols = [
		["Date", (x) => `<td class="nowrap">${dateText(x.date)}${x.editedAt ? ' <span class="edited-pill" title="Edited ' + esc(when(x.editedAt)) + '">Edited</span>' : ""}</td>`, "date"],
		...(facet ? [] : [["Drill", (x) => `<td>${esc(attemptLabelOf(state, x))}</td>`, "drill"]]),
		["Driver", (x) => `<td><strong>${esc(x.driverName)}</strong></td>`, null],
		["Grade", (x) => `<td>${esc(x.grade)}</td>`, "grade"],
		["Course", (x) => (courseOf(x) ? `<td>${esc(courseLabel(courses, courseOf(x)))}</td>` : '<td class="missing">Not recorded</td>'), "course"],
		["Robot", (x) => (robotOf(x) ? `<td class="nowrap">${esc(robotOf(x))}</td>` : '<td class="missing">Not recorded</td>'), "robot"],
		...(expanded && paired ? [[facet === "defense" ? "Driver 1 (opponent)" : "Driver 2 (defender)", (x) => `<td>${esc(partnerOf(x) || "--")}</td>`, null]] : []),
		...(expanded && facet === "speed" ? [["Timer / observer", (x) => `<td>${esc(x.data?.timerName || "--")}</td>`, null]] : []),
		...numeric.map((f) => [drillLabel(def, f[0]), (x) => `<td>${esc(x.data?.[f[0]] ?? "--")}</td>`, `f:${f[0]}`]),
		...added.map((q) => [q.label, (x) => `<td>${esc(answerText(q, x.data?.answers?.[q.id]))}</td>`, keys[`q:${q.id}`] ? `q:${q.id}` : null]),
		...(expanded && !facet
			? [["Responses", (x) => `<td class="resp-cell">${responses(state, x).map(([q, v]) => `<span><b>${esc(q)}:</b> ${esc(v)}</span>`).join("") || "--"}</td>`, null]]
			: []),
		["Final score", (x) => `<td><strong>${score2(x.score?.final ?? 0)}</strong></td>`, "final"],
		["Observations", (x) => `<td>${esc(x.data?.observations?.join(", ") || "--")}</td>`, null],
		...(facet || expanded ? [["Notes", (x) => `<td class="note-cell${expanded ? " wide" : ""}" title="${esc(x.data?.notes || "")}">${esc(x.data?.notes || "--")}</td>`, null]] : []),
		...(expanded ? [["Recorded", (x) => `<td class="nowrap">${esc(when(x.createdAt))}</td>`, "recorded"]] : []),
		[
			'<span class="no-print">Actions</span>',
			(x) =>
				`<td class="no-print nowrap"><button class="button button-secondary button-small" data-edit-attempt="${esc(x.id)}">Edit</button> <button class="button button-danger button-small" data-delete-attempt="${esc(x.id)}">Delete</button></td>`,
			null,
		],
	];
	const sort = sortOf(state, scope);
	const head = ([h, , key]) => {
		const label = h.startsWith("<") ? h : esc(h);
		if (!key) return `<th>${label}</th>`;
		const active = sort?.key === key;
		const aria = active ? (sort.dir === "asc" ? "ascending" : "descending") : "none";
		const arrow = active ? (sort.dir === "asc" ? "▲" : "▼") : "↕";
		return `<th aria-sort="${aria}"><button type="button" class="th-sort${active ? " active" : ""}" data-sort="${esc(key)}" title="Sort by ${esc(h)}">${label}<span class="sort-arrow" aria-hidden="true">${arrow}</span></button></th>`;
	};
	const rows = sortList(state, scope, list)
		.map((x) => `<tr>${cols.map(([, cell]) => cell(x)).join("")}</tr>`)
		.join("");
	return `<div class="table-wrap${expanded ? " sheet-table" : ""}"><table><thead><tr>${cols.map(head).join("")}</tr></thead><tbody>${rows || `<tr><td colspan="${cols.length}" class="empty">No attempts match.</td></tr>`}</tbody></table></div>`;
}

function chipsHtml(state, scope, groups) {
	const f = filterOf(state, scope);
	const chips = [];
	for (const g of groups)
		for (const value of f[g.key]) {
			const label = g.options.find(([v]) => v === value)?.[1] ?? value;
			chips.push(`<button type="button" class="filter-chip" data-chip="${g.key}" data-value="${esc(value)}" title="Remove this filter">${esc(g.label)}: ${esc(label)} <span aria-hidden="true">×</span></button>`);
		}
	return chips.length ? `${chips.join("")}<button type="button" class="filter-clear" data-clear-filters>Clear all</button>` : "";
}
function filterMenuHtml(state, scope, groups) {
	const f = filterOf(state, scope);
	const n = activeCount(f);
	return `<details class="filter-menu"><summary class="button button-secondary button-small">Filters${n ? ` (${n})` : ""}</summary><div class="filter-pop">${groups
		.map(
			(g) =>
				`<fieldset><legend>${esc(g.label)}</legend>${g.options
					.map(([value, label]) => `<label><input type="checkbox" data-filter="${g.key}" value="${esc(value)}" ${f[g.key].includes(value) ? "checked" : ""}> ${esc(label)}</label>`)
					.join("")}</fieldset>`,
		)
		.join("")}<div class="filter-foot"><button type="button" class="button button-secondary button-small" data-clear-filters>Clear filters</button></div></div></details>`;
}

// One attempts panel. `list` is every attempt this panel can show (before search / filters).
export function attemptsSectionHtml(state, { scope, list, title, note, expanded = false }) {
	const f = filterOf(state, scope);
	const groups = filterGroups(state, scope, list);
	const shown = applyFilter(state, scope, list);
	const missing = list.filter(missingInfo).length;
	return `<section class="panel attempts-section${expanded ? " expanded" : ""}" data-attempts-scope="${esc(scope)}" ${expanded ? "data-expanded" : ""}>
  <div class="panel-heading"><div><h3>${esc(title)}</h3><p>${esc(note)}</p></div>${expanded ? "" : `<button type="button" class="button button-secondary button-small enlarge-btn" data-enlarge="${esc(scope)}" title="Show this list larger, with every detail"><span aria-hidden="true">⤢</span> Enlarge</button>`}</div>
  <div class="attempts-tools no-print"><label class="attempts-search"><span class="sr-only">Search attempts</span><input type="search" data-attempt-search value="${esc(f.q)}" placeholder="Search driver, course, robot, notes, date…" autocomplete="off"></label>${filterMenuHtml(state, scope, groups)}${sortResetHtml(state, scope)}<span class="attempts-count" data-attempts-count>${shown.length === list.length ? `${list.length} attempt${list.length === 1 ? "" : "s"}` : `Showing ${shown.length} of ${list.length}`}</span></div>
  <div class="filter-chips no-print" data-attempts-chips>${chipsHtml(state, scope, groups)}</div>
  ${missing ? `<p class="help attempts-missing no-print">${missing} attempt${missing === 1 ? " has" : "s have"} no course or robot recorded. Use <strong>Edit</strong> to add them, or filter by <em>Record status → Missing course or robot</em>.</p>` : ""}
  <div data-attempts-body>${tableHtml(state, scope, shown, expanded)}</div>
</section>`;
}

// ---------------------------------------------------------------- binding (works for the page and for the enlarged view)
// `api` comes from app.js: { state, store, toast, modal, content, render, applyScoring, openDeleteAttempt, listFor(scope) }
// One listener for the whole page closes an open Filters menu when the administrator clicks anywhere else.
let menuCloserBound = false;
function bindMenuCloser() {
	if (menuCloserBound) return;
	menuCloserBound = true;
	document.addEventListener("click", (e) => {
		document.querySelectorAll(".filter-menu[open]").forEach((menu) => {
			if (!menu.contains(e.target)) menu.open = false;
		});
	});
}
export function bindAttemptsSections(root, api) {
	bindMenuCloser();
	root.querySelectorAll("[data-attempts-scope]").forEach((section) => {
		const scope = section.dataset.attemptsScope;
		const expanded = section.hasAttribute("data-expanded");
		const f = filterOf(api.state, scope);
		const redrawTable = () => {
			const list = api.listFor(scope);
			const shown = applyFilter(api.state, scope, list);
			const groups = filterGroups(api.state, scope, list);
			section.querySelector("[data-attempts-body]").innerHTML = tableHtml(api.state, scope, shown, expanded);
			section.querySelector("[data-attempts-count]").textContent =
				shown.length === list.length ? `${list.length} attempt${list.length === 1 ? "" : "s"}` : `Showing ${shown.length} of ${list.length}`;
			section.querySelector("[data-attempts-chips]").innerHTML = chipsHtml(api.state, scope, groups);
			section.querySelector(".filter-menu summary").textContent = `Filters${activeCount(f) ? ` (${activeCount(f)})` : ""}`;
			section.querySelectorAll("[data-filter]").forEach((box) => (box.checked = f[box.dataset.filter].includes(box.value)));
			const status = section.querySelector("[data-sort-status]");
			const text = sortDescription(api.state, scope);
			status.hidden = !text; // the Reset sorting button is shown only while the list is not in its default order
			status.querySelector("[data-sort-text]").textContent = text;
		};
		section.querySelector("[data-attempt-search]").oninput = (e) => {
			f.q = e.target.value;
			redrawTable();
		};
		section.querySelector(".filter-pop").onchange = (e) => {
			const box = e.target.closest("[data-filter]");
			if (!box) return;
			const values = f[box.dataset.filter];
			if (box.checked && !values.includes(box.value)) values.push(box.value);
			if (!box.checked) values.splice(values.indexOf(box.value), 1);
			redrawTable();
		};
		section.onclick = (e) => {
			const chip = e.target.closest("[data-chip]");
			if (chip) {
				const values = f[chip.dataset.chip];
				values.splice(values.indexOf(chip.dataset.value), 1);
				return redrawTable();
			}
			if (e.target.closest("[data-clear-filters]")) {
				for (const k of ["facet", "grade", "observation", "robot", "course", "status"]) f[k] = [];
				return redrawTable();
			}
			const sortBtn = e.target.closest("[data-sort]");
			if (sortBtn) {
				const key = sortBtn.dataset.sort;
				const now = sortOf(api.state, scope);
				const first = sorters(api.state, scope === "general" ? null : scope)[key]?.first || "asc";
				api.state.attemptSort[scope] = now?.key === key ? { key, dir: now.dir === "asc" ? "desc" : "asc" } : { key, dir: first };
				redrawTable();
				return section.querySelector(`[data-sort="${CSS.escape(key)}"]`)?.focus();
			}
			if (e.target.closest("[data-sort-reset]")) {
				api.state.attemptSort[scope] = null;
				redrawTable();
				return section.querySelector("[data-attempt-search]")?.focus();
			}
			const edit = e.target.closest("[data-edit-attempt]");
			if (edit) return openEditAttempt(api, edit.dataset.editAttempt);
			const del = e.target.closest("[data-delete-attempt]");
			if (del) return api.openDeleteAttempt(del.dataset.deleteAttempt);
			const big = e.target.closest("[data-enlarge]");
			if (big) return openSheet(api, big.dataset.enlarge);
		};
	});
}

// ---------------------------------------------------------------- enlarged view
const sheetEl = () => {
	let sheet = document.querySelector("#attempt-sheet");
	if (!sheet) {
		sheet = Object.assign(document.createElement("dialog"), { id: "attempt-sheet", className: "sheet" });
		sheet.setAttribute("aria-label", "Enlarged view");
		document.body.append(sheet);
		// Closing returns to the page, which is redrawn so it shows the same search and filters.
		sheet.addEventListener("close", () => sheet.dataset.scope && (delete sheet.dataset.scope, sheet.__api?.render()));
	}
	return sheet;
};
export function openSheet(api, scope) {
	const sheet = sheetEl();
	sheet.__api = api;
	sheet.__content = null;
	sheet.dataset.scope = scope;
	fillSheet(api, sheet);
	if (!sheet.open) sheet.showModal();
	sheet.querySelector("[data-attempt-search]")?.focus();
}
// Any other section shown in the same enlarged layer (for example the Driver leaderboard). `html()` is called again whenever the
// page is redrawn, so the enlarged copy always shows current data.
export function openContentSheet(api, { key, title, html }) {
	const sheet = sheetEl();
	sheet.__api = api;
	sheet.__content = { title, html };
	sheet.dataset.scope = `content:${key}`;
	fillSheet(api, sheet);
	if (!sheet.open) sheet.showModal();
}
function fillSheet(api, sheet) {
	const scope = sheet.dataset.scope;
	if (sheet.__content) {
		sheet.innerHTML = `<div class="sheet-head"><div><p class="eyebrow">ANALYSIS · ENLARGED VIEW</p><h2>${esc(sheet.__content.title)}</h2></div><button class="close" data-close-sheet aria-label="Close the enlarged view">×</button></div><div class="sheet-content">${sheet.__content.html()}</div>`;
		sheet.querySelector("[data-close-sheet]").onclick = () => sheet.close();
		return;
	}
	const title = scope === "general" ? "All recorded attempts" : `${FACETS[scope].label} attempts`;
	sheet.innerHTML = `<div class="sheet-head"><div><p class="eyebrow">ANALYSIS · ENLARGED VIEW</p><h2>${esc(title)}</h2></div><button class="close" data-close-sheet aria-label="Close the enlarged view">×</button></div>${attemptsSectionHtml(api.state, {
		scope,
		list: api.listFor(scope),
		title: "Every detail",
		note: "Search, filter, edit, or delete attempts here. Changes apply everywhere straight away. Press Esc or × to return to the page.",
		expanded: true,
	})}`;
	sheet.querySelector("[data-close-sheet]").onclick = () => sheet.close();
	bindAttemptsSections(sheet, api);
}
// Redraws the enlarged view after an edit or delete (called by app.js's render()).
export function refreshSheet() {
	const sheet = document.querySelector("#attempt-sheet");
	if (sheet?.open && sheet.dataset.scope && sheet.__api) {
		const search = sheet.querySelector("[data-attempt-search]");
		const hadFocus = document.activeElement === search;
		fillSheet(sheet.__api, sheet);
		if (hadFocus) sheet.querySelector("[data-attempt-search]")?.focus();
	}
}

// ---------------------------------------------------------------- Edit attempt pop-up
// The answers an attempt can be edited for, as they appear in the form (values come from `snap`: { driverName, grade, date, data }).
function builtInFormHtml(api, facet, snap) {
	// The drill's CURRENT form (including questions an administrator added or reworded), filled in with this attempt's answers.
	const values = { ...(snap.data || {}), driverName: snap.driverName, grade: snap.grade, practiceDate: snap.date };
	return drillFormHtml(drillForm(api.state, facet), facet, { edit: true, values, courses: api.state.data.courses || {} });
}
// Puts saved answers back into a custom form's controls (text, numbers, dropdowns, radio buttons, rating scales, checkboxes).
function fillCustom(formEl, form, answers = {}) {
	for (const q of allQuestions(form)) {
		const v = answers[q.id];
		const els = [...formEl.querySelectorAll(`[name="${CSS.escape(q.id)}"]`)];
		if (q.type === "checkbox") els.forEach((e) => (e.checked = Array.isArray(v) && v.includes(e.value)));
		else if (q.type === "choice" || q.type === "scale") els.forEach((e) => (e.checked = v !== null && v !== undefined && String(v) === e.value));
		else if (els[0]) els[0].value = v ?? "";
		const empty = v === undefined || v === null || v === "" || (Array.isArray(v) && !v.length);
		const field = els[0]?.closest(".field");
		if (field && empty && !field.querySelector(".no-answer")) {
			field.classList.add("unanswered");
			field.querySelector("label, .q-label")?.insertAdjacentHTML("beforeend", ' <span class="no-answer">No answer yet</span>');
		}
	}
}
// What an attempt looks like as an "original" snapshot.
const snapshot = (x) => JSON.parse(JSON.stringify({ driverName: x.driverName, grade: x.grade, date: x.date, data: x.data || {} }));
// Blank answers are ignored when comparing, so adding an empty answer to a question is not counted as a change.
// Keys are sorted so the order answers were saved in never matters.
function comparable(value) {
	const clean = (v) => {
		if (Array.isArray(v)) return v.map(clean);
		if (v && typeof v === "object")
			return Object.fromEntries(
				Object.keys(v)
					.sort()
					.filter((k) => !(v[k] === "" || v[k] === null || v[k] === undefined || (Array.isArray(v[k]) && !v[k].length)))
					.map((k) => [k, clean(v[k])]),
			);
		return v;
	};
	return JSON.stringify(clean(value));
}

// The edited attempt as it would be saved, read from the pop-up's form.
function readEdit(api, x, formEl) {
	const form = customFormOf(api.state, x);
	if (FACETS[x.facet]) {
		const def = drillForm(api.state, x.facet);
		const d = { ...(x.data || {}), ...Object.fromEntries(new FormData(formEl)) };
		const added = addedQuestions(def);
		added.forEach((q) => delete d[q.id]); // added questions are saved under data.answers, not as top-level keys
		if (added.length || x.data?.answers) d.answers = { ...(x.data?.answers || {}), ...collectAnswers(addedPart(def), formEl) };
		d.observations = [...formEl.querySelectorAll('[name="observation"]:checked')].map((b) => b.value);
		if (!d.observations.length) delete d.observation; // FormData only adds `observation` when a box is ticked (as on the Practice form)
		const item = { ...x, driverName: String(d.driverName || "").trim(), grade: d.grade || "", date: d.practiceDate || "", data: d };
		item.score = scoreSubmission(item, api.state.scoring);
		return item;
	}
	const answers = { ...(x.data?.answers || {}), ...collectAnswers(form, formEl) }; // answers to deleted questions are kept
	const fd = new FormData(formEl);
	const data = { ...(x.data || {}), formTitle: form.title, answers, course: fd.get("course") || "", robot: fd.get("robot") || "" };
	const metric = metricOf(form, answers);
	return { ...x, driverName: String(fd.get("driverName") || "").trim(), grade: fd.get("grade") || "", date: fd.get("practiceDate") || "", data, score: { final: metric ?? 0, metric } };
}

export function openEditAttempt(api, id) {
	const { state, modal, content } = api;
	if (!state.session.isAdmin) return;
	const x = state.data.submissions.find((s) => s.id === id);
	if (!x) return;
	const form = customFormOf(state, x);
	if (!FACETS[x.facet] && !form) return api.toast("This attempt's custom form was deleted, so it can no longer be edited.");
	const original = x.original || snapshot(x);
	const label = attemptLabelOf(state, x);
	const formHtml = (snap) =>
		FACETS[x.facet]
			? builtInFormHtml(api, x.facet, snap)
			: customFormHtml(form, { edit: true, courses: state.data.courses, values: { driverName: snap.driverName, grade: snap.grade, practiceDate: snap.date, course: snap.data?.course, robot: snap.data?.robot } });
	content.innerHTML = `<div class="modal-head"><div><p class="eyebrow">EDIT ATTEMPT · ${esc(label.toUpperCase())}</p><h2>${esc(x.driverName)}, ${dateText(x.date)}</h2></div><button class="close" id="close-modal" aria-label="Close without saving">×</button></div>
<p class="help edit-meta">Recorded ${esc(when(x.createdAt))}.${x.editedAt ? ` Last edited ${esc(when(x.editedAt))}; the values first submitted are kept and can be restored with <strong>Revert to original</strong>.` : " Questions added to the form since then can be answered now (marked <em>No answer yet</em>)."}</p>
<div id="edit-status" class="edit-status" role="status" hidden></div>
<div class="edit-body" id="edit-body">${formHtml(snapshot(x))}</div>
<div class="edit-foot"><span class="edit-score" id="edit-score"></span><div class="form-actions"><button type="button" class="button button-secondary" id="edit-revert" title="Load the values exactly as they were first submitted">Revert to original</button><button type="button" class="button button-secondary" id="edit-cancel">Cancel</button><button type="button" class="button" id="edit-save">Save changes</button></div></div>`;
	modal.classList.add("edit-modal");
	modal.addEventListener("close", () => modal.classList.remove("edit-modal"), { once: true });
	if (!modal.open) modal.showModal();
	const body = content.querySelector("#edit-body");
	const status = content.querySelector("#edit-status");
	const say = (text, kind = "") => {
		status.hidden = !text;
		status.className = `edit-status ${kind}`;
		status.innerHTML = text;
	};
	const formEl = () => body.querySelector("form");
	const prepare = (snap) => {
		if (!FACETS[x.facet]) fillCustom(formEl(), form, snap.data?.answers);
		else fillCustom(formEl(), addedPart(drillForm(state, x.facet)), snap.data?.answers || {}); // questions an administrator added
		updateScore();
	};
	// Live score with the answers on screen, next to the saved score.
	const updateScore = () => {
		const next = readEdit(api, x, formEl());
		const value = FACETS[x.facet] ? next.score.final : next.score.metric;
		const before = FACETS[x.facet] ? x.score.final : x.score?.metric;
		content.querySelector("#edit-score").innerHTML =
			value === null || value === undefined
				? ""
				: `${FACETS[x.facet] ? "Final score" : "Ranking value"} with these answers: <strong>${score2(value)}</strong>${before !== null && before !== undefined && Math.abs(value - before) >= 0.005 ? ` <small>(saved: ${score2(before)})</small>` : ""}`;
	};
	body.addEventListener("input", updateScore);
	body.addEventListener("change", updateScore);
	prepare(snapshot(x));
	content.querySelector("#close-modal").onclick = content.querySelector("#edit-cancel").onclick = () => modal.close();
	content.querySelector("#edit-revert").onclick = () => {
		body.innerHTML = formHtml(original);
		prepare(original);
		say("The values first submitted are loaded. Press <strong>Save changes</strong> to keep them, or <strong>Cancel</strong> to leave the attempt as it is.", "info");
	};
	content.querySelector("#edit-save").onclick = async (e) => {
		const el = formEl();
		if (!el.reportValidity()) return;
		const item = readEdit(api, x, el);
		if (!item.driverName || !item.date) return say("The driver name and the practice date cannot be empty.", "bad");
		// Back to exactly the original values: the attempt is no longer marked as edited.
		if (comparable(snapshot(item)) === comparable(original)) {
			delete item.original;
			delete item.editedAt;
		} else {
			item.original = original;
			item.editedAt = now();
		}
		const button = e.currentTarget;
		button.disabled = true;
		try {
			await api.store.saveRecord("submissions", item);
		} catch (err) {
			button.disabled = false;
			return say(`Could not save: ${esc(err.message)}`, "bad");
		}
		state.data.submissions = state.data.submissions.map((s) => (s.id === id ? item : s));
		api.applyScoring();
		modal.close();
		api.render();
		api.toast(item.editedAt ? "Attempt updated." : "Attempt restored to its original values.");
	};
}
