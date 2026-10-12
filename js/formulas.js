// Scoring equations shown to administrators on the Analysis tab.
// This file only DESCRIBES the formulas; the numbers themselves are calculated in scoring.js. If a weight or benchmark
// changes there, update the matching text here so the Analysis page keeps telling the truth.
//
// Markup helpers: v() is a variable, frac() a stacked fraction, clamp() the "limit to 0-10" wrapper used by every component.

const v = (name, sub = "") => `<var>${name}</var>${sub ? `<sub>${sub}</sub>` : ""}`;
const frac = (top, bottom) =>
	`<span class="frac"><span>${top}</span><span>${bottom}</span></span>`;
const clamp = (inner) => `clamp<span class="paren">(</span>${inner}<span class="paren">)</span>`;
const times = " × ";
const minus = " − ";

// Shared component definitions (offense and shooting use the same shot, scored, and accuracy benchmarks).
const SHOT = {
	name: "Volume (fuel shot)",
	eq: `${v("V")} = ${clamp(`10${times}${frac(v("shots"), "30")}`)}`,
	why: "30 shots in 90 seconds is the benchmark for full marks, so the score grows steadily with every extra cycle.",
};
const SCORED = {
	name: "Fuel scored",
	eq: `${v("S")} = ${clamp(`10${times}${frac(v("scored"), "20")}`)}`,
	why: "20 scored fuel earns full marks. Points on the board are what win matches, so this is the core output measure.",
};
const ACCURACY = {
	name: "Accuracy",
	eq: `${v("A")} = ${clamp(`10${times}${frac(v("scored"), v("shots"))}`)}&nbsp; (0 if no shots)`,
	why: "A ratio rather than a count, so it rewards clean shooting at any volume and stops a driver from scoring well just by spraying shots.",
};
const PENALTY = {
	name: "Penalties",
	eq: `${v("N")} = ${clamp(`10${minus}2${times}${v("penalties")}`)}`,
	why: "Each penalty costs a flat 2 points, so every mistake is equally visible, and five or more penalties remove this part entirely.",
};

export const SCORING_DOCS = {
	speed: {
		components: [
			{
				name: "Time",
				eq: `${v("T")} = ${clamp(`10${times}${frac(`30${minus}${v("t")}`, `30${minus}15`)}`)}`,
				why: "A straight line from 10 points at the 15-second excellent time to 0 at the 30-second slow cutoff. Every second saved is worth the same 0.67 points, which is easy to explain to a driver.",
			},
			{
				name: "Pace (lap consistency)",
				eq: `${v("P")} = ${clamp(`10${times}<span class="paren">(</span>1${minus}${frac(`|${v("L", "1")}${minus}${v("L", "2")}|`, `max(${v("L", "1")}, ${v("L", "2")}, 1)`)}<span class="paren">)</span>`)}`,
				why: "Measures the gap between the two laps as a share of the longer lap, so it is fair on short and long courses alike. Equal laps score 10; a lap twice as long as the other scores 5.",
			},
			PENALTY,
		],
		final: `${v("Speed")} = 0.70${v("T")} + 0.10${v("P")} + 0.20${v("N")}`,
		why: "The drill exists to measure speed, so time carries most of the weight. Penalties are next because a fast run that hits the course is not match-ready, and pace is a small tiebreaker that rewards control.",
		vars: `${v("t")} = total drive time (s), ${v("L", "1")} and ${v("L", "2")} = lap lengths (s).`,
	},
	defense: {
		components: [
			{
				name: "Scoring preventions",
				eq: `${v("C")} = ${clamp(`10${times}${frac(v("preventions"), "6")}`)}`,
				why: "6 prevented scoring attempts in 90 seconds earns full marks.",
			},
			{
				name: "Fuel preventions",
				eq: `${v("F")} = ${clamp(`10${times}${frac(v("fuel preventions"), "4")}`)}`,
				why: "Fuel denials are rarer than scoring denials, so the benchmark is lower: 4 earns full marks.",
			},
			{
				name: "Time wasted",
				eq: `${v("W")} = ${clamp(`10${times}${frac(v("seconds"), "30")}`)}`,
				why: "30 seconds of the opponent's 90 wasted (one third of the match) earns full marks.",
			},
		],
		final: `${v("Defense")} = 0.35${v("C")} + 0.25${v("F")} + 0.40${v("W")}`,
		why: "Each count is divided by its own benchmark, so different units can be combined fairly. Time wasted has the largest weight because it captures every kind of disruption, not only the moments a recorder can count. Scoring preventions rank above fuel preventions because they stop points directly.",
		vars: "",
	},
	offense: {
		components: [
			SHOT,
			SCORED,
			ACCURACY,
			{
				name: "Evasions",
				eq: `${v("E")} = ${clamp(`10${times}${frac(v("evasions"), "5")}`)}`,
				why: "5 successful evasions earns full marks. Evading defense is the skill that sets this drill apart from Shooting only.",
			},
		],
		final: `${v("Offense")} = 0.20${v("V")} + 0.30${v("S")} + 0.25${v("A")} + 0.25${v("E")}`,
		why: "Fuel scored is the largest single part because it is the result that counts. Accuracy and evasion share equal weight so a driver must both shoot cleanly and get free of the defender, and volume rewards fast cycling without letting it dominate.",
		vars: "",
	},
	shooting: {
		components: [SHOT, SCORED, ACCURACY, PENALTY],
		final: `${v("Shooting")} = 0.20${v("V")} + 0.45${v("S")} + 0.25${v("A")} + 0.10${v("N")}`,
		why: "With no defender, the drill is a pure test of scoring output, so fuel scored carries almost half the weight. Accuracy keeps shot selection honest, and penalties (including driving after 90 seconds) are a small deduction.",
		vars: "",
	},
};

export const OVERALL_DOC = {
	eq: `${v("Overall")} = 2.5${times}<span class="paren">(</span>${v("K")}${minus}1<span class="paren">)</span> + 0.249${times}${v("Ā")} + 0.01${times}[${v("K")} = 4]`,
	vars: `${v("K")} = number of facets completed (1-4), ${v("Ā")} = average of the driver's latest score in each completed facet, [${v("K")} = 4] = 1 when all four are complete, otherwise 0.`,
	why: "Coverage first: each extra facet adds 2.5 points, while the average can add at most 0.249 × 10 = 2.49. A driver with more facets completed therefore always ranks above one with fewer, and the average only decides order among drivers with the same coverage. The 0.01 bonus lifts every four-facet driver above 7.50, so the four bands never overlap.",
};

// Equations and reasons for one facet: every component, then the weighted final score.
function facetCard(key, label) {
	const d = SCORING_DOCS[key];
	return `<article class="eq-card"><h4>${label}</h4>${d.components
		.map(
			(c) =>
				`<div class="eq-row"><p class="eq-name">${c.name}</p><div class="eq">${c.eq}</div><p class="eq-why">${c.why}</p></div>`,
		)
		.join(
			"",
		)}<div class="eq-row eq-final"><p class="eq-name">Final score</p><div class="eq">${d.final}</div><p class="eq-why">${d.why}</p></div>${d.vars ? `<p class="eq-vars">Where ${d.vars}</p>` : ""}</article>`;
}

const CLAMP_NOTE = `<p class="eq-note"><strong>clamp(x)</strong> limits a value to the range 0 to 10, so one unusually large or small number cannot push a component past full marks or below zero. Every score is rounded to two decimals.</p>`;

// Analysis tab, single facet view: that facet's equations.
export function facetEquationsHtml(key, label) {
	return `<section class="panel equations" style="margin-top:18px"><div class="panel-heading"><div><h3>How the ${label} score is calculated</h3><p>Each part is scored out of 10, then the parts are combined with fixed weights into the final score out of 10.</p></div></div><div class="eq-body">${facetCard(key, label)}${CLAMP_NOTE}</div></section>`;
}

// Analysis tab, General statistics view: the overall ranking formula and all four facet formulas.
export function allEquationsHtml(facets) {
	return `<section class="panel equations" style="margin-top:18px"><div class="panel-heading"><div><h3>Scoring equations</h3><p>How every score on this page is calculated, and why each formula was chosen.</p></div></div><div class="eq-body"><article class="eq-card eq-overall"><h4>Overall ranking score</h4><div class="eq-row eq-final"><div class="eq">${OVERALL_DOC.eq}</div><p class="eq-why">${OVERALL_DOC.why}</p></div><p class="eq-vars">Where ${OVERALL_DOC.vars}</p></article><div class="eq-grid">${Object.entries(
		facets,
	)
		.map(([key, label]) => facetCard(key, label))
		.join("")}</div>${CLAMP_NOTE}</div></section>`;
}
