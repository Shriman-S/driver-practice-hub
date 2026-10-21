// Scoring equations and explanations shown to administrators on the Analysis tab (and previewed live on the Scoring settings page).
//
// Nothing here is typed by hand any more: every equation, number, and sentence is GENERATED from the scoring settings object
// (see scoring.js). When an administrator changes a weight, benchmark, curve, penalty cost, or the overall ranking method, the
// Analysis page explains the new formula automatically, with worked examples calculated by the same code that scores attempts.
// The original design notes (why each formula was chosen) are still shown, but only for the parts that are unchanged from the
// original DriveLab scoring, because a note written for a 70% weight would be misleading once the weight is 50%.
//
// Markup helpers: v() is a variable, frac() a stacked fraction, clamp() the "limit to 0-10" wrapper used by every component.
import {
	COMPONENTS,
	CURVES,
	DEFAULT_SCORING,
	FACET_ORDER,
	OVERALL_METHODS,
	ATTEMPT_RULES,
	rangeScore,
	paceScore,
	penaltyScore,
	accuracyScore,
	overallFromFacets,
	settingsFor,
} from "./scoring.js";
import { esc } from "./util.js";
import { FACET_COURSE_GROUP } from "./constants.js";
import { publishedCourses, courseLabel } from "./courses.js";

const v = (name, sub = "") => `<var>${name}</var>${sub ? `<sub>${sub}</sub>` : ""}`;
const frac = (top, bottom) => `<span class="frac"><span>${top}</span><span>${bottom}</span></span>`;
const paren = (inner) => `<span class="paren">(</span>${inner}<span class="paren">)</span>`;
const clamp = (inner) => `clamp${paren(inner)}`;
const times = " × ";
const minus = " − ";

// Numbers as people write them: at most 2 decimals, no trailing zeros (15, 22.5, 0.67).
export const fmt = (n) => String(Math.round(Number(n) * 100) / 100);
const two = (n) => (Math.round(Number(n) * 100) / 100).toFixed(2);
// A weight as a multiplier: 70 -> 0.70, 33.33 -> 0.3333.
const mult = (w) => {
	const x = Number(w) / 100;
	const text = String(Math.round(x * 10000) / 10000);
	return text.includes(".") && text.split(".")[1].length >= 2 ? text : x.toFixed(2);
};
const pct = (w) => `${fmt(w)}%`;
const list = (items) =>
	items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export const FACET_NAMES = { speed: "Speed driving", defense: "Defensive driving", offense: "Offensive driving", shooting: "Shooting only" };
const FACET_SHORT = { speed: "Speed", defense: "Defense", offense: "Offense", shooting: "Shooting" };

// ---------------------------------------------------------------- original design notes (shown only while a part is unchanged)
const DESIGN = {
	"speed.time": "A straight line from 10 points at the 15-second excellent time to 0 at the 30-second slow cutoff, so every second saved is worth the same 0.67 points, which is easy to explain to a driver.",
	"speed.pace": "A driver who drives one lap extremely quickly and the next one erratically is not showing controlled high-speed driving, so pacing is a small check on control.",
	"speed.penalty": "Hitting objects or leaving the field is a meaningful driving failure; a flat cost per penalty makes every mistake equally visible without letting penalties overwhelm a fast run.",
	"speed.final": "The drill exists to measure speed, so time carries most of the weight. Penalties are next because a fast run that hits the course is not match-ready, and pace is a small tiebreaker that rewards control.",
	"defense.scoring": "6 prevented scoring attempts in 90 seconds is the benchmark for an excellent defender.",
	"defense.fuel": "Fuel denials are rarer than scoring denials, so the benchmark is lower.",
	"defense.wasted": "30 seconds of the opponent's 90 wasted (one third of the match) is the benchmark for full marks.",
	"defense.final": "Each count is divided by its own benchmark, so different units can be combined fairly. Time wasted has the largest weight because it captures every kind of disruption, not only the moments a recorder can count. Scoring preventions rank above fuel preventions because they stop points directly.",
	"offense.shot": "30 shots in 90 seconds is the benchmark, so the score grows steadily with every extra cycle.",
	"offense.scored": "Points on the board are what win matches, so this is the core output measure.",
	"offense.accuracy": "A ratio rather than a count, so it rewards clean shooting at any volume and stops a driver from scoring well just by spraying shots.",
	"offense.evasion": "Evading defense is the skill that sets this drill apart from Shooting only.",
	"offense.final": "Fuel scored is the largest single part because it is the result that counts. Accuracy and evasion share equal weight so a driver must both shoot cleanly and get free of the defender, and volume rewards fast cycling without letting it dominate.",
	"shooting.shot": "30 shots in 90 seconds is the benchmark, so the score grows steadily with every extra cycle.",
	"shooting.scored": "Points on the board are what win matches, so this is the core output measure.",
	"shooting.accuracy": "A ratio rather than a count, so it rewards clean shooting at any volume and stops a driver from scoring well just by spraying shots.",
	"shooting.penalty": "Penalties (including driving after 90 seconds) are a small deduction because the drill is about scoring.",
	"shooting.final": "With no defender, the drill is a pure test of scoring output, so fuel scored carries almost half the weight. Accuracy keeps shot selection honest, and penalties are a small deduction.",
};

// ---------------------------------------------------------------- one component: equation + generated explanation
function rangeEq(c, s) {
	const x = v(c.variable);
	const higher = s.full > s.zero;
	const ratio =
		s.zero === 0
			? frac(x, fmt(s.full))
			: higher
				? frac(`${x}${minus}${fmt(s.zero)}`, `${fmt(s.full)}${minus}${fmt(s.zero)}`)
				: frac(`${fmt(s.zero)}${minus}${x}`, `${fmt(s.zero)}${minus}${fmt(s.full)}`);
	if (s.curve === "sqrt") return `${v(c.symbol)} = 10${times}√${paren(`clamp<sub>0–1</sub>${paren(ratio)}`)}`;
	if (s.curve === "square") return `${v(c.symbol)} = 10${times}${paren(`clamp<sub>0–1</sub>${paren(ratio)}`)}<sup>2</sup>`;
	return `${v(c.symbol)} = ${clamp(`10${times}${ratio}`)}`;
}
function rangeText(c, s) {
	const u = (n) => `${fmt(n)}${c.unit === "s" ? " s" : ""}`;
	const higher = s.full > s.zero;
	const span = Math.abs(s.full - s.zero);
	const mid = (s.full + s.zero) / 2;
	const parts = [];
	if (higher)
		parts.push(
			s.zero === 0
				? `${u(s.full)} ${c.unit === "s" ? "or more" : `${c.unitWord} or more`} earns full marks (10); none earns 0.`
				: `${u(s.full)} or more earns full marks (10); ${u(s.zero)} or fewer earns 0.`,
		);
	else parts.push(`${u(s.full)} or faster earns full marks (10); ${u(s.zero)} or slower earns 0.`);
	if (s.curve === "linear")
		parts.push(
			higher
				? `In between, the score rises in a straight line: each ${c.per} is worth ${fmt(10 / span)} points.`
				: `In between, the score falls in a straight line: every second saved is worth the same ${fmt(10 / span)} points.`,
		);
	else if (s.curve === "sqrt")
		parts.push(
			`In between, the score follows a diminishing-returns curve: the first improvements earn the most, so halfway (${u(mid)}) already earns ${two(rangeScore(mid, s))}.`,
		);
	else
		parts.push(
			`In between, the score follows an accelerating curve: most points are earned close to full marks, so halfway (${u(mid)}) earns only ${two(rangeScore(mid, s))}.`,
		);
	return parts.join(" ");
}
function componentDoc(facet, c, s) {
	let eq, text;
	if (c.kind === "range") {
		eq = rangeEq(c, s);
		text = rangeText(c, s);
	} else if (c.kind === "pace") {
		const k = s.strictness === 1 ? "" : `${fmt(s.strictness)}${times}`;
		eq = `${v("P")} = ${clamp(`10${times}${paren(`1${minus}${k}${frac(`|${v("L", "1")}${minus}${v("L", "2")}|`, `max(${v("L", "1")}, ${v("L", "2")}, 1)`)}`)}`)}`;
		if (s.strictness === 0) text = "Strictness is 0, so lap consistency is ignored and every run earns full marks for pace.";
		else {
			const zeroAt = 1 / s.strictness;
			text = `Equal laps score 10. The gap between the laps is measured as a share of the longer lap, so it is fair on short and long courses; a lap twice as long as the other scores ${two(paceScore(10, 5, s))}.${
				zeroAt < 1
					? ` Laps that differ by ${fmt(zeroAt * 100)}% of the longer lap or more score 0.`
					: s.strictness < 1
						? ` Even the largest possible gap only lowers this part to ${two(10 * (1 - s.strictness))}.`
						: ""
			}`;
		}
	} else if (c.kind === "penalty") {
		eq = `${v("N")} = ${clamp(`10${minus}${fmt(s.perPenalty)}${times}${v("penalties")}`)}`;
		text =
			s.perPenalty === 0
				? "Penalties cost nothing, so this part is always 10."
				: `Each penalty costs a flat ${fmt(s.perPenalty)} point${s.perPenalty === 1 ? "" : "s"} (1 penalty = ${two(penaltyScore(1, s))}, 2 = ${two(penaltyScore(2, s))}), and ${Math.ceil(10 / s.perPenalty - 1e-9)} or more penalties remove this part entirely.`;
	} else {
		const bottom = s.target === 100 ? v("shots") : `${mult(s.target)}${times}${v("shots")}`;
		eq = `${v("A")} = ${clamp(`10${times}${frac(v("scored"), bottom)}`)}&nbsp; (0 if no shots)`;
		text =
			s.target === 100
				? `Fuel scored divided by fuel shot: 18 scored from 20 shots (90%) earns ${two(accuracyScore(18, 20, s))}.`
				: `${fmt(s.target)}% accuracy or better earns full marks; below that the score falls in a straight line (for example, ${fmt(s.target / 2)}% earns ${two(accuracyScore(s.target / 2, 100, s))}).`;
	}
	if (Number(s.weight) === 0) text += " This part has 0% weight, so it does not change the final score.";
	const unchanged = same(s, DEFAULT_SCORING.facets[facet][c.key]);
	return { name: c.label, eq, text, design: unchanged ? DESIGN[`${facet}.${c.key}`] : "" };
}

// "Time carries the most weight (70%), followed by Penalties (20%) and Pace (10%)."
function weightSentence(items) {
	const on = items.filter((x) => Number(x.weight) > 0);
	const off = items.filter((x) => Number(x.weight) === 0);
	const groups = [];
	[...on]
		.sort((a, b) => b.weight - a.weight)
		.forEach((x) => {
			const g = groups.find((g) => g.weight === Number(x.weight));
			g ? g.names.push(x.name) : groups.push({ weight: Number(x.weight), names: [x.name] });
		});
	const say = (g) => `${list(g.names)} (${pct(g.weight)}${g.names.length > 1 ? " each" : ""})`;
	let text = "";
	if (groups.length === 1)
		text = groups[0].names.length > 1 ? `${list(groups[0].names)} share the weight equally (${pct(groups[0].weight)} each).` : `${groups[0].names[0]} decides the whole score (100%).`;
	else {
		const [first, ...rest] = groups;
		text = `${list(first.names)} ${first.names.length > 1 ? "carry" : "carries"} the most weight (${pct(first.weight)}${first.names.length > 1 ? " each" : ""}), followed by ${list(rest.map(say))}.`;
	}
	if (off.length) text += ` ${list(off.map((x) => x.name))} ${off.length > 1 ? "are" : "is"} switched off (0%).`;
	return text;
}

// Everything the Analysis page needs to explain one facet: each component, the final weighted equation, and its explanation.
export function facetDoc(facet, cfg, courseKey = "") {
	const settings = settingsFor(cfg, facet, courseKey);
	const components = COMPONENTS[facet].map((c) => componentDoc(facet, c, settings[c.key]));
	const terms = COMPONENTS[facet]
		.filter((c) => Number(settings[c.key].weight) > 0)
		.map((c) => `${mult(settings[c.key].weight)}${v(c.symbol)}`);
	const final = `${v(FACET_SHORT[facet])} = ${terms.join(" + ") || "0"}`;
	const why = `${weightSentence(COMPONENTS[facet].map((c) => ({ name: c.label.split(" (")[0], weight: settings[c.key].weight })))} Every part is scored out of 10 and the weights add up to 100%, so the final score is also out of 10.`;
	const unchanged = same(settings, DEFAULT_SCORING.facets[facet]);
	const vars =
		facet === "speed" ? `${v("t")} = total drive time (s), ${v("L", "1")} and ${v("L", "2")} = lap lengths (s).` : "";
	return { components, final, why, design: unchanged ? DESIGN[`${facet}.final`] : "", vars };
}

const designHtml = (text) => (text ? `<p class="eq-design"><strong>Design note:</strong> ${esc(text)}</p>` : "");
export function facetCard(key, label, cfg, courseKey = "", subtitle = "") {
	const d = facetDoc(key, cfg, courseKey);
	return `<article class="eq-card"><h4>${esc(label)}${subtitle ? ` <small class="eq-method">${esc(subtitle)}</small>` : ""}</h4>${d.components
		.map((c) => `<div class="eq-row"><p class="eq-name">${esc(c.name)}</p><div class="eq">${c.eq}</div><p class="eq-why">${esc(c.text)}</p>${designHtml(c.design)}</div>`)
		.join("")}<div class="eq-row eq-final"><p class="eq-name">Final score</p><div class="eq">${d.final}</div><p class="eq-why">${esc(d.why)}</p>${designHtml(d.design)}</div>${d.vars ? `<p class="eq-vars">Where ${d.vars}</p>` : ""}</article>`;
}

// ---------------------------------------------------------------- overall ranking
const weightsEqual = (cfg) => FACET_ORDER.every((k) => Number(cfg.overall.weights[k]) === Number(cfg.overall.weights.speed));
const weightList = (cfg) => FACET_ORDER.map((k) => `${FACET_SHORT[k]} ${pct(cfg.overall.weights[k])}`).join(", ");

// The lowest and highest overall score possible for each number of completed facets, worked out by the scoring code itself.
export function overallBands(cfg) {
	const subsets = [];
	for (let mask = 1; mask < 16; mask++) subsets.push(FACET_ORDER.filter((_, i) => mask & (1 << i)));
	return [1, 2, 3, 4].map((k) => {
		const mine = subsets.filter((s) => s.length === k);
		const at = (value) => mine.map((s) => overallFromFacets(Object.fromEntries(s.map((f) => [f, value])), cfg).overall);
		return { k, low: Math.min(...at(0)), high: Math.max(...at(10)) };
	});
}
// The two drivers from the original scoring explanation, scored with the current settings.
function exampleDrivers(cfg) {
	const a = overallFromFacets({ speed: 10 }, cfg).overall;
	const b = overallFromFacets({ speed: 6, defense: 6, offense: 6, shooting: 6 }, cfg).overall;
	return `Example: Driver A completed only Speed with 10.00 and scores ${two(a)}; Driver B scored 6.00 in all four facets and scores ${two(b)}, so ${a > b ? "Driver A ranks higher" : a < b ? "Driver B ranks higher" : "they tie"}.`;
}
export function overallDoc(cfg) {
	const o = cfg.overall;
	const rule = ATTEMPT_RULES[o.attempt].short;
	const avgWord = weightsEqual(cfg) ? "average" : "weighted average";
	const weightNote = weightsEqual(cfg)
		? "The completed facet scores count equally."
		: `The facets are weighted ${weightList(cfg)} (a facet with a larger weight moves the ${o.method === "missingZero" ? "overall score" : "average"} more).`;
	let eq, vars, why;
	if (o.method === "average") {
		eq = `${v("Overall")} = ${v("Ā")}`;
		vars = `${v("Ā")} = ${avgWord} of the driver's ${rule} in each completed facet.`;
		why = `Only the facets a driver has completed are averaged, so the number of facets completed does not change the score and every driver is scored out of 10. ${weightNote}`;
	} else if (o.method === "missingZero") {
		eq = `${v("Overall")} = ${FACET_ORDER.filter((k) => Number(o.weights[k]) > 0)
			.map((k) => `${mult(o.weights[k])}${times}${v(FACET_SHORT[k])}`)
			.join(" + ")}`;
		vars = `each facet value is the driver's ${rule} in that facet, or 0 if the facet has not been completed.`;
		why = `Every facet is always included, so a facet that has not been completed counts as 0. Completing more facets usually helps, but a strong score in one facet can outrank a weak score spread over more facets. ${weightNote}`;
	} else {
		eq = `${v("Overall")} = 2.5${times}${paren(`${v("K")}${minus}1`)} + 0.249${times}${v("Ā")} + 0.01${times}[${v("K")} = 4]`;
		vars = `${v("K")} = number of facets completed (1-4), ${v("Ā")} = ${avgWord} of the driver's ${rule} in each completed facet, [${v("K")} = 4] = 1 when all four are complete, otherwise 0.`;
		why = `Coverage first: each extra facet adds 2.5 points, while the average can add at most 0.249 × 10 = 2.49. A driver with more facets completed therefore always ranks above one with fewer, and the average only decides order among drivers with the same coverage. The 0.01 bonus lifts every four-facet driver above 7.50, so the four bands never overlap. ${weightNote}`;
	}
	return { eq, vars, why: `${why} ${exampleDrivers(cfg)}`, method: OVERALL_METHODS[o.method].label };
}
export function overallCard(cfg) {
	const d = overallDoc(cfg);
	return `<article class="eq-card eq-overall"><h4>Overall ranking score <small class="eq-method">${esc(d.method)}</small></h4><div class="eq-row eq-final"><div class="eq">${d.eq}</div><p class="eq-why">${esc(d.why)}</p></div><p class="eq-vars">Where ${d.vars}</p></article>`;
}
// The score-band table under the leaderboard ("How the overall score works").
export function bandsTableHtml(cfg) {
	return `<div class="table-wrap"><table style="min-width:420px"><thead><tr><th>Facets completed</th><th>Possible overall score</th></tr></thead><tbody>${overallBands(cfg)
		.map((b) => `<tr><td>${b.k}</td><td>${two(b.low)} – ${two(b.high)}</td></tr>`)
		.join("")}</tbody></table></div>`;
}
// Short one-line versions for the leaderboard legend and the PDF report.
export function overallLegend(cfg) {
	const o = cfg.overall,
		rule = ATTEMPT_RULES[o.attempt].short,
		avg = weightsEqual(cfg) ? "average" : `weighted average (${weightList(cfg)})`;
	if (o.method === "average") return `Overall = ${avg} of the completed facet scores (each facet uses the driver's ${rule}).`;
	if (o.method === "missingZero")
		return `Overall = ${FACET_ORDER.map((k) => `${mult(o.weights[k])} × ${FACET_SHORT[k]}`).join(" + ")}, with a facet that is not completed counted as 0 (each facet uses the driver's ${rule}).`;
	return `Overall = 2.5 × (completed facets − 1) + 0.249 × ${avg} of the completed facet scores, plus 0.01 when all four are complete (each facet uses the driver's ${rule}).`;
}
export function overallPdfLines(cfg) {
	const bands = overallBands(cfg)
		.map((b) => `${b.k} facet${b.k > 1 ? "s" : ""} = ${two(b.low)}-${two(b.high)}`)
		.join(" | ");
	return [
		`Ranking method: ${OVERALL_METHODS[cfg.overall.method].label}.`,
		overallLegend(cfg).replace(/×/g, "x").replace(/−/g, "-"),
		`Score bands: ${bands}.`,
		exampleDrivers(cfg),
	];
}

// ---------------------------------------------------------------- what changed from the original scoring
const SETTING_NAMES = {
	weight: ["weight", (x) => pct(x)],
	zero: ["zero points at", (x) => fmt(x)],
	full: ["full marks at", (x) => fmt(x)],
	curve: ["curve", (x) => CURVES[x].label.split(" (")[0].toLowerCase()],
	strictness: ["pace strictness", (x) => fmt(x)],
	perPenalty: ["points lost per penalty", (x) => fmt(x)],
	target: ["accuracy for full marks", (x) => pct(x)],
};
export function changesFromDefault(cfg, courseNames = {}) {
	const out = [];
	for (const facet of FACET_ORDER)
		for (const c of COMPONENTS[facet]) {
			const now = cfg.facets[facet][c.key],
				was = DEFAULT_SCORING.facets[facet][c.key];
			const diffs = Object.keys(was)
				.filter((k) => now[k] !== was[k])
				.map((k) => {
					const [name, show] = SETTING_NAMES[k];
					return `${name} ${show(now[k])} (was ${show(was[k])})`;
				});
			if (diffs.length) out.push(`${FACET_NAMES[facet]}, ${c.label}: ${diffs.join("; ")}`);
		}
	// Courses with their own settings: every difference from the original DriveLab scoring for that drill.
	for (const facet of FACET_ORDER)
		for (const [key, own] of Object.entries(cfg.byCourse?.[facet] || {})) {
			const name = courseNames?.[key] || `Course ${key.split("-")[1]}`;
			const diffs = [];
			for (const c of COMPONENTS[facet]) {
				const was = DEFAULT_SCORING.facets[facet][c.key];
				const parts = Object.keys(was)
					.filter((k) => own[c.key][k] !== was[k])
					.map((k) => `${SETTING_NAMES[k][0]} ${SETTING_NAMES[k][1](own[c.key][k])}`);
				if (parts.length) diffs.push(`${c.label}: ${parts.join("; ")}`);
			}
			out.push(`${FACET_NAMES[facet]}, ${name} has its own settings${diffs.length ? ` (${diffs.join(" · ")})` : " (currently the same as the original scoring)"}`);
		}
	const o = cfg.overall,
		d = DEFAULT_SCORING.overall;
	if (o.method !== d.method) out.push(`Overall ranking method: ${OVERALL_METHODS[o.method].label} (was ${OVERALL_METHODS[d.method].label})`);
	if (o.attempt !== d.attempt) out.push(`Each facet now uses the driver's ${ATTEMPT_RULES[o.attempt].short} (was the ${ATTEMPT_RULES[d.attempt].short})`);
	if (!same(o.weights, d.weights)) out.push(`Overall facet weights: ${weightList(cfg)} (was 25% each)`);
	return out;
}
function changesHtml(cfg, courseNames) {
	const changes = changesFromDefault(cfg, courseNames);
	const when = cfg.updatedAt
		? ` Last changed ${new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(cfg.updatedAt))}.`
		: "";
	return changes.length
		? `<div class="eq-changes"><p><strong>Scoring has been customised by an administrator.</strong>${esc(when)} Changes from the original DriveLab scoring:</p><ul>${changes.map((c) => `<li>${esc(c)}</li>`).join("")}</ul></div>`
		: `<p class="eq-note">These are the original DriveLab scoring settings.${esc(when)}</p>`;
}

const CLAMP_NOTE = `<p class="eq-note"><strong>clamp(x)</strong> limits a value to the range 0 to 10 (<strong>clamp<sub>0–1</sub></strong> limits it to 0 to 1), so one unusually large or small number cannot push a component past full marks or below zero. Every score is rounded to two decimals.</p>`;

// Which settings apply to which courses for one drill: the default card (with the courses that use it) and one card per course that
// has its own settings. `courses` is state.data.courses (for course names).
export function facetCourseCards(facet, label, cfg, courses = {}) {
	const own = cfg.byCourse?.[facet] || {};
	const published = publishedCourses(courses, FACET_COURSE_GROUP[facet]);
	const usingDefault = ["attempts with no course recorded", ...published.filter((c) => !own[c.key]).map((c) => c.name)];
	const ownKeys = Object.keys(own).sort();
	const cards = [facetCard(facet, label, cfg, "", ownKeys.length || published.length ? `Default settings: used by ${list(usingDefault)}` : "")];
	for (const key of ownKeys) cards.push(facetCard(facet, label, cfg, key, `${courseLabel(courses, key)} (its own settings)`));
	return cards.join("");
}
export const courseNameMap = (courses = {}) =>
	Object.fromEntries(Object.keys(courses).map((key) => [key, courseLabel(courses, key)]));

// Analysis tab, single facet view: that facet's equations (one card per set of settings in use).
export function facetEquationsHtml(key, label, cfg = DEFAULT_SCORING, courses = {}) {
	return `<section class="panel equations" style="margin-top:18px"><div class="panel-heading"><div><h3>How the ${esc(label)} score is calculated</h3><p>Each part is scored out of 10, then the parts are combined with the weights below into the final score out of 10. Each course can have its own settings; an attempt is scored with the settings of the course it was driven on. This explanation is generated from the current scoring settings.</p></div></div><div class="eq-body">${changesHtml(cfg, courseNameMap(courses))}<div class="eq-grid">${facetCourseCards(key, label, cfg, courses)}</div>${CLAMP_NOTE}</div></section>`;
}

// Analysis tab, General statistics view: the overall ranking formula and every drill's formulas (grouped by drill).
export function allEquationsHtml(facets, cfg = DEFAULT_SCORING, courses = {}) {
	return `<section class="panel equations" style="margin-top:18px"><div class="panel-heading"><div><h3>Scoring equations</h3><p>How every score on this page is calculated. This explanation is generated from the current scoring settings, so it updates whenever an administrator changes them. Each drill's courses can have their own settings.</p></div></div><div class="eq-body">${changesHtml(cfg, courseNameMap(courses))}${overallCard(cfg)}${Object.entries(facets)
		.map(([key, label]) => `<details class="eq-facet" open><summary>${esc(label)}</summary><div class="eq-grid">${facetCourseCards(key, label, cfg, courses)}</div></details>`)
		.join("")}${CLAMP_NOTE}</div></section>`;
}
