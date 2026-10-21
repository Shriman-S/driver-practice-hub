// Scoring for the four built-in drills and the coverage-first overall ranking.
//
// Every number that shapes a score (weights, benchmarks, curves, penalty costs, how the overall ranking is built) lives in a
// SCORING SETTINGS object. Each drill has DEFAULT settings (cfg.facets[facet]) and may have its OWN settings for each course
// (cfg.byCourse[facet][courseKey], e.g. cfg.byCourse.speed["speed-2"]), because courses take different amounts of time while
// assessing the same skills. An attempt is scored with its course's settings; an attempt with no course recorded, or on a course
// without its own settings, uses the drill's default settings (settingsFor()). Administrators change it on the Scoring settings page (scoringeditor.js); it is saved in Firestore as
// settings/scoring and read by everyone, so a guest's on-the-spot score uses the same rules the Analysis page shows.
// DEFAULT_SCORING reproduces the original DriveLab scoring exactly (see driver-scoring-functions.pdf).
//
// The functions below stay pure: no DOM or database calls, which keeps the formulas auditable and easy to test.

const clamp = (value, low = 0, high = 10) => Math.max(low, Math.min(high, value));
const round = (value) => Math.round(value * 100) / 100;
// A missing or unreadable answer counts as 0, so one blank box can never turn a whole score into NaN.
const num = (value) => {
	const n = Number(value);
	return Number.isFinite(n) ? n : 0;
};
export const FACET_ORDER = ["speed", "defense", "offense", "shooting"];

// ---------------------------------------------------------------- component types
// Each facet score is a weighted sum of components, and every component is one of four types:
//   range    - a measured value mapped onto 0-10 between a "zero points" value and a "full marks" value. If full marks is SMALLER
//              than zero points (a time), lower is better. `curve` bends the line: linear, sqrt (early gains count most) or square
//              (points come mostly near the benchmark).
//   pace     - lap consistency: 10 x (1 - strictness x |lap1 - lap2| / longer lap)
//   penalty  - 10 minus a fixed cost per penalty
//   accuracy - fuel scored / fuel shot, where `target` percent accuracy earns full marks
// COMPONENTS is fixed by the forms (it says which answers each component reads); the numbers come from the settings.
export const CURVES = {
	linear: { label: "Straight line (every unit is worth the same)" },
	sqrt: { label: "Diminishing returns (early progress counts most)" },
	square: { label: "Accelerating (points come mostly near full marks)" },
};
export const COMPONENTS = {
	speed: [
		{ key: "time", kind: "range", label: "Time", symbol: "T", input: "totalTime", variable: "t", unit: "s", unitWord: "seconds", inputLabel: "total drive time", per: "second" },
		{ key: "pace", kind: "pace", label: "Pace (lap consistency)", symbol: "P", inputs: ["lap1", "lap2"] },
		{ key: "penalty", kind: "penalty", label: "Penalties", symbol: "N", input: "penalties" },
	],
	defense: [
		{ key: "scoring", kind: "range", label: "Scoring preventions", symbol: "C", input: "scorePreventions", variable: "preventions", unit: "", unitWord: "scoring preventions", inputLabel: "scoring preventions", per: "scoring prevention" },
		{ key: "fuel", kind: "range", label: "Fuel preventions", symbol: "F", input: "fuelPreventions", variable: "fuel preventions", unit: "", unitWord: "fuel preventions", inputLabel: "fuel preventions", per: "fuel prevention" },
		{ key: "wasted", kind: "range", label: "Time wasted", symbol: "W", input: "secondsWasted", variable: "seconds", unit: "s", unitWord: "seconds wasted", inputLabel: "seconds of the opponent's time wasted", per: "second wasted" },
	],
	offense: [
		{ key: "shot", kind: "range", label: "Volume (fuel shot)", symbol: "V", input: "fuelShot", variable: "shots", unit: "", unitWord: "shots", inputLabel: "fuel shot", per: "shot" },
		{ key: "scored", kind: "range", label: "Fuel scored", symbol: "S", input: "fuelScored", variable: "scored", unit: "", unitWord: "scored fuel", inputLabel: "fuel scored", per: "scored fuel" },
		{ key: "accuracy", kind: "accuracy", label: "Accuracy", symbol: "A", inputs: ["fuelScored", "fuelShot"] },
		{ key: "evasion", kind: "range", label: "Evasions", symbol: "E", input: "evasions", variable: "evasions", unit: "", unitWord: "evasions", inputLabel: "successful evasions", per: "evasion" },
	],
	shooting: [
		{ key: "shot", kind: "range", label: "Volume (fuel shot)", symbol: "V", input: "fuelShot", variable: "shots", unit: "", unitWord: "shots", inputLabel: "fuel shot", per: "shot" },
		{ key: "scored", kind: "range", label: "Fuel scored", symbol: "S", input: "fuelScored", variable: "scored", unit: "", unitWord: "scored fuel", inputLabel: "fuel scored", per: "scored fuel" },
		{ key: "accuracy", kind: "accuracy", label: "Accuracy", symbol: "A", inputs: ["fuelScored", "fuelShot"] },
		{ key: "penalty", kind: "penalty", label: "Penalties", symbol: "N", input: "penalties" },
	],
};
// The overall ranking methods an administrator can choose from.
export const OVERALL_METHODS = {
	coverage: {
		label: "Coverage first (recommended)",
		help: "Completing more facets always ranks higher. The facet average only orders drivers who completed the same number of facets.",
	},
	average: {
		label: "Average of completed facets",
		help: "Only the facets a driver has completed are averaged. The number of facets completed does not matter.",
	},
	missingZero: {
		label: "Missing facets count as zero",
		help: "Every facet is included; a facet a driver has not completed scores 0. Coverage helps, but a strong score can beat a weak extra facet.",
	},
};
export const ATTEMPT_RULES = {
	latest: { label: "Most recent attempt", short: "most recent attempt" },
	best: { label: "Best attempt", short: "best attempt" },
	average: { label: "Average of all attempts", short: "average of all attempts" },
};

export const DEFAULT_SCORING = {
	version: 1,
	facets: {
		speed: {
			time: { weight: 70, zero: 30, full: 15, curve: "linear" },
			pace: { weight: 10, strictness: 1 },
			penalty: { weight: 20, perPenalty: 2 },
		},
		defense: {
			scoring: { weight: 35, zero: 0, full: 6, curve: "linear" },
			fuel: { weight: 25, zero: 0, full: 4, curve: "linear" },
			wasted: { weight: 40, zero: 0, full: 30, curve: "linear" },
		},
		offense: {
			shot: { weight: 20, zero: 0, full: 30, curve: "linear" },
			scored: { weight: 30, zero: 0, full: 20, curve: "linear" },
			accuracy: { weight: 25, target: 100 },
			evasion: { weight: 25, zero: 0, full: 5, curve: "linear" },
		},
		shooting: {
			shot: { weight: 20, zero: 0, full: 30, curve: "linear" },
			scored: { weight: 45, zero: 0, full: 20, curve: "linear" },
			accuracy: { weight: 25, target: 100 },
			penalty: { weight: 10, perPenalty: 2 },
		},
	},
	overall: {
		method: "coverage",
		attempt: "latest",
		weights: { speed: 25, defense: 25, offense: 25, shooting: 25 },
	},
	// Per-course settings, same shape as facets[facet]. Empty means every course uses its drill's default settings.
	byCourse: { speed: {}, defense: {}, offense: {}, shooting: {} },
};
// Course ids look like "speed-1" ... "shooting-3"; defense and offense both use the "defense-N" (paired drill) courses.
export const COURSE_KEY = /^(speed|defense|shooting)-[1-3]$/;
// The settings that score an attempt of `facet` driven on `courseKey`.
export function settingsFor(config, facet, courseKey) {
	return (courseKey && config.byCourse?.[facet]?.[courseKey]) || config.facets[facet];
}
const copy = (value) => JSON.parse(JSON.stringify(value));

// Fills anything missing (or of the wrong type) from the defaults, so an older or partial saved object can never break scoring.
// One drill's settings: everything missing (or of the wrong type) is taken from `base`.
function normalizeFacet(facet, from, base) {
	const out = copy(base);
	if (!from || typeof from !== "object") return out;
	for (const c of COMPONENTS[facet]) {
		const src = from[c.key];
		if (!src) continue;
		const into = out[c.key];
		for (const key of Object.keys(into)) {
			if (key === "curve") {
				if (CURVES[src.curve]) into.curve = src.curve;
			} else if (Number.isFinite(Number(src[key])) && src[key] !== "" && src[key] !== null) into[key] = Number(src[key]);
		}
	}
	return out;
}
export function normalizeScoring(saved) {
	const out = copy(DEFAULT_SCORING);
	if (!saved || typeof saved !== "object") return out;
	for (const facet of FACET_ORDER) out.facets[facet] = normalizeFacet(facet, saved.facets?.[facet], DEFAULT_SCORING.facets[facet]);
	for (const facet of FACET_ORDER)
		for (const [key, value] of Object.entries(saved.byCourse?.[facet] || {}))
			if (COURSE_KEY.test(key) && value && typeof value === "object")
				out.byCourse[facet][key] = normalizeFacet(facet, value, out.facets[facet]);
	const o = saved.overall || {};
	if (OVERALL_METHODS[o.method]) out.overall.method = o.method;
	if (ATTEMPT_RULES[o.attempt]) out.overall.attempt = o.attempt;
	for (const facet of FACET_ORDER)
		if (Number.isFinite(Number(o.weights?.[facet])) && o.weights?.[facet] !== "")
			out.overall.weights[facet] = Number(o.weights[facet]);
	if (saved.updatedAt) out.updatedAt = String(saved.updatedAt);
	return out;
}

// Plain-language problems that would make a scoring settings object unusable. An empty list means it can be saved.
export function validateScoring(cfg) {
	const problems = [];
	const bad = (v) => v === "" || v === null || v === undefined || !Number.isFinite(Number(v));
	const facetNames = { speed: "Speed driving", defense: "Defensive driving", offense: "Offensive driving", shooting: "Shooting only" };
	const checkSet = (facet, settings, title) => {
		let total = 0;
		for (const c of COMPONENTS[facet]) {
			const s = settings[c.key];
			const where = `${title}, ${c.label}`;
			if (bad(s.weight) || s.weight < 0 || s.weight > 100) problems.push(`${where}: the weight must be a number from 0 to 100.`);
			total += Number(s.weight) || 0;
			if (c.kind === "range") {
				if (bad(s.zero) || bad(s.full) || s.zero < 0 || s.full < 0)
					problems.push(`${where}: "zero points" and "full marks" must both be numbers of 0 or more.`);
				else if (Number(s.zero) === Number(s.full))
					problems.push(`${where}: "zero points" and "full marks" cannot be the same value.`);
				if (!CURVES[s.curve]) problems.push(`${where}: choose a scoring curve.`);
			}
			if (c.kind === "pace" && (bad(s.strictness) || s.strictness < 0 || s.strictness > 10))
				problems.push(`${where}: strictness must be a number from 0 to 10.`);
			if (c.kind === "penalty" && (bad(s.perPenalty) || s.perPenalty < 0 || s.perPenalty > 10))
				problems.push(`${where}: points lost per penalty must be a number from 0 to 10.`);
			if (c.kind === "accuracy" && (bad(s.target) || s.target < 1 || s.target > 100))
				problems.push(`${where}: the accuracy for full marks must be from 1% to 100%.`);
		}
		if (Math.abs(total - 100) > 0.001)
			problems.push(`${title}: the weights add up to ${round(total)}%. They must add up to exactly 100%.`);
	};
	for (const facet of FACET_ORDER) {
		checkSet(facet, cfg.facets[facet], `${facetNames[facet]} (default)`);
		for (const [key, settings] of Object.entries(cfg.byCourse?.[facet] || {}))
			checkSet(facet, settings, `${facetNames[facet]}, Course ${key.split("-")[1]}`);
	}
	let total = 0;
	for (const facet of FACET_ORDER) {
		const w = cfg.overall.weights[facet];
		if (bad(w) || w < 0 || w > 100) problems.push(`Overall ranking, ${facetNames[facet]}: the weight must be a number from 0 to 100.`);
		total += Number(w) || 0;
	}
	if (Math.abs(total - 100) > 0.001)
		problems.push(`Overall ranking: the facet weights add up to ${round(total)}%. They must add up to exactly 100%.`);
	return problems;
}

// ---------------------------------------------------------------- component maths
const bend = (r, curve) => (curve === "sqrt" ? Math.sqrt(r) : curve === "square" ? r * r : r);
export function rangeScore(value, s) {
	const x = num(value);
	// The straight line is written in the same arithmetic order as the original formulas, so default scores match them exactly.
	if (s.curve === "linear" || !CURVES[s.curve])
		return s.zero === 0 ? clamp((x / s.full) * 10) : clamp((10 * (x - s.zero)) / (s.full - s.zero));
	const r = clamp((x - s.zero) / (s.full - s.zero), 0, 1);
	return 10 * bend(r, s.curve);
}
export function paceScore(lap1, lap2, s) {
	const one = num(lap1),
		two = num(lap2);
	// Equal laps are perfect; the gap as a share of the longer lap reduces the score. (Both boxes hold the length of that lap alone.)
	if (!(one > 0 && two >= 0)) return 0;
	return clamp(10 * (1 - (s.strictness * Math.abs(one - two)) / Math.max(one, two, 1)));
}
export const penaltyScore = (count, s) => clamp(10 - s.perPenalty * num(count));
export function accuracyScore(scored, shot, s) {
	const shots = num(shot);
	if (!shots) return 0;
	return clamp((10 * num(scored)) / shots / (s.target / 100));
}
// One component's 0-10 value from a submission's raw answers.
export function componentScore(component, settings, d) {
	if (component.kind === "range") return rangeScore(d[component.input], settings);
	if (component.kind === "pace") return paceScore(d.lap1, d.lap2, settings);
	if (component.kind === "penalty") return penaltyScore(d[component.input], settings);
	return accuracyScore(d.fuelScored, d.fuelShot, settings);
}

// The score of one built-in drill attempt: every component (0-10) plus `final`, all rounded to two decimals.
// The component keys (time, pace, penalty, scoring, fuel, wasted, shot, scored, accuracy, evasion) are the same as before.
export function scoreSubmission(submission, config = DEFAULT_SCORING) {
	const facet = COMPONENTS[submission.facet] ? submission.facet : "shooting";
	const d = submission.data || {};
	const settings = settingsFor(config, facet, d.course); // the course's own settings, or the drill's default
	const parts = {};
	let final = 0;
	for (const c of COMPONENTS[facet]) {
		const s = settings[c.key];
		const value = componentScore(c, s, d);
		parts[c.key] = value;
		final += (s.weight / 100) * value;
	}
	parts.final = final;
	return Object.fromEntries(Object.entries(parts).map(([key, value]) => [key, round(value)]));
}

// ---------------------------------------------------------------- overall ranking
const newest = (a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || ""));
// The score that represents a driver in one facet, from that facet's attempts (`latest`, `best`, or `average`).
export function facetValue(entries, rule = "latest") {
	if (!entries.length) return undefined;
	const scores = entries.map((x) => x.score.final);
	if (rule === "best") return Math.max(...scores);
	if (rule === "average") return round(scores.reduce((a, b) => a + b, 0) / scores.length);
	return [...entries].sort(newest)[0].score.final;
}
// The overall number from the facet values a driver has ({ speed: 7.2, ... } with missing facets left out).
export function overallFromFacets(facets, config = DEFAULT_SCORING) {
	const o = config.overall;
	// Facets are summed in the order they appear in `facets` (the order attempts were found), as the original code did.
	const done = Object.keys(facets).filter((k) => FACET_ORDER.includes(k) && facets[k] !== undefined);
	const completed = done.length;
	const weightDone = done.reduce((t, k) => t + Number(o.weights[k]), 0);
	// Weighted average of the completed facets (a plain average when the weights are equal).
	// When the completed facets all have the same weight this is exactly sum / count (the original formula, bit-for-bit).
	const equal = done.every((k) => Number(o.weights[k]) === Number(o.weights[done[0]]));
	const average = !completed || weightDone <= 0
		? 0
		: equal
			? done.reduce((t, k) => t + facets[k], 0) / completed
			: done.reduce((t, k) => t + Number(o.weights[k]) * facets[k], 0) / weightDone;
	let overall = 0;
	if (completed) {
		if (o.method === "average") overall = average;
		else if (o.method === "missingZero")
			overall = FACET_ORDER.reduce((t, k) => t + (Number(o.weights[k]) / 100) * (facets[k] ?? 0), 0);
		// Coverage-first rule: more completed facets always outweighs isolated excellence.
		else overall = 2.5 * (completed - 1) + 0.249 * average + (completed === 4 ? 0.01 : 0);
	}
	return { completed, average: round(average), overall: round(overall) };
}
export function driverSummary(submissions, config = DEFAULT_SCORING) {
	const byFacet = {};
	submissions.forEach((entry) => (byFacet[entry.facet] ??= []).push(entry));
	const facets = {};
	for (const k of Object.keys(byFacet)) if (FACET_ORDER.includes(k)) facets[k] = facetValue(byFacet[k], config.overall.attempt);
	return { ...overallFromFacets(facets, config), facets };
}
