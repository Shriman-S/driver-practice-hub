// Territory Breakthrough: the Offensive / Defensive driving practice (Release 1.6).
//
// This file holds only PURE logic (no DOM, no database), so every formula is easy to audit and test:
//   - the scoring formulas for the Offensive and Defensive drivers of one round,
//   - the structure of a best-of-3 match (3 rounds, drivers alternate roles and robots),
//   - the round / match winner rules,
//   - the Offensive and Defensive rankings, and the "closest skill level" pairing suggestions (administrators only).
// The screens are in territory.js.
//
// ---- The practice in one paragraph
// One ROUND is one 60-second run: the Offensive Driver must cross checkpoints G1, G2, G3 in order and then reach the finish zone;
// the Defensive Driver tries to stop that. A MATCH is three rounds (one run each, so only 3 robot batteries per practice): the two
// drivers alternate roles every round (Driver A offense in rounds 1 and 3, Driver B in round 2) and switch robots with their roles.
// The checkpoint results are recorded by ONE scorer (the Offensive form's) and used for both drivers, so the offensive and defensive
// scores of a round always add up to the same total. The round winner is the driver with the higher score in that round.

export const TERRITORY_DEFAULTS = {
	duration: 60, // seconds per round
	gate1Points: 20, // points for crossing G1 (offense) / for denying it (defense)
	gate2Points: 20, // ... G2
	gate3Points: 20, // ... G3
	finishPoints: 20, // points for reaching the finish zone (offense) / preventing it (defense)
	timeBonus: 20, // the most the finish-time bonus (offense) or the delay credit (defense) can be worth
	bonusCurve: "linear", // how fast the time bonus shrinks as the offense takes longer: linear, strict, or generous (see BONUS_CURVES)
	penaltyPoints: 0, // points taken off a driver's own score for each penalty they receive (0 = penalties are only recorded)
	countdown: 3, // seconds between "both scorers ready" and the start of the timer, on both laptops
	rankBasis: "mean", // what a driver's rank in each role is based on: mean, recent, or best (see RANK_BASES)
	recentRounds: 5, // for rankBasis "recent": how many of a driver's most recent rounds in that role count
	priorScore: 50, // pairing: the score assumed for a role a driver has not played yet (out of the points in a round)
	priorWeight: 2, // pairing: how many "assumed" rounds that starting score counts for (0 = use only real results)
	pairWeightOffense: 1, // pairing: how much a gap in OFFENSIVE skill counts toward "not well matched"
	pairWeightDefense: 1, // pairing: how much a gap in DEFENSIVE skill counts
};
// Time bonus: x = (duration - finish time) / duration is the share of the round left when the robot finished (1 = instant, 0 = at the
// time limit). The offense earns bonus x curve(x); the defense earns the rest, so the two always add up to the bonus.
export const BONUS_CURVES = {
	linear: { label: "Linear (recommended)", note: "Every second counts the same. Finishing with half the time left earns half of the bonus.", f: (x) => x },
	strict: { label: "Strict", note: "Only fast finishes earn most of the bonus. Finishing with half the time left earns a quarter of it.", f: (x) => x * x },
	generous: { label: "Generous", note: "A slow finish still earns a good share. Finishing with half the time left earns about 71% of it.", f: (x) => Math.sqrt(x) },
};
export const RANK_BASES = {
	mean: { label: "Mean of all rounds (recommended)", note: "Rank by the average of every round the driver has played in that role." },
	recent: { label: "Mean of the most recent rounds", note: "Rank by the average of only the latest rounds, so improvement shows sooner." },
	best: { label: "Best single round", note: "Rank by the driver's highest score in that role." },
};
const NUMERIC_KEYS = ["duration", "gate1Points", "gate2Points", "gate3Points", "finishPoints", "timeBonus", "penaltyPoints", "countdown", "recentRounds", "priorScore", "priorWeight", "pairWeightOffense", "pairWeightDefense"];
export const GATES = 3;
export const ROUNDS = 3;
export const ROLES = { offense: "Offensive Driver", defense: "Defensive Driver" };

const round2 = (v) => Math.round(v * 100) / 100;
const num = (v) => {
	if (v === "" || v === null || v === undefined) return null;
	const n = Number(v);
	return Number.isFinite(n) ? n : null;
};
// Merges saved territory settings over the defaults, ignoring anything that is not usable. (Settings saved before Release 1.9 had one
// "gatePoints" value for all three checkpoints; it becomes the value of each.)
export function territorySettings(saved) {
	const out = { ...TERRITORY_DEFAULTS };
	const old = num(saved?.gatePoints);
	for (const k of NUMERIC_KEYS) {
		let n = num(saved?.[k]);
		if (n === null && /^gate\dPoints$/.test(k) && old !== null) n = old;
		if (n !== null && n >= 0) out[k] = n;
	}
	if (out.duration <= 0) out.duration = TERRITORY_DEFAULTS.duration;
	if (out.recentRounds < 1) out.recentRounds = 1;
	out.recentRounds = Math.round(out.recentRounds);
	if (BONUS_CURVES[saved?.bonusCurve]) out.bonusCurve = saved.bonusCurve;
	if (RANK_BASES[saved?.rankBasis]) out.rankBasis = saved.rankBasis;
	return out;
}
// Plain-language problems with a territory settings object (empty list = fine).
export function validateTerritory(t) {
	const problems = [];
	const need = (key, label, min = 0) => {
		const n = num(t?.[key]);
		if (n === null || n < min) problems.push(`Territory Breakthrough, ${label}: enter a number${min > 0 ? ` of ${min} or more` : " of 0 or more"}.`);
	};
	need("duration", "round length", 1);
	need("gate1Points", "points for G1");
	need("gate2Points", "points for G2");
	need("gate3Points", "points for G3");
	need("finishPoints", "points for the finish");
	need("timeBonus", "time bonus");
	need("penaltyPoints", "points lost per penalty");
	need("countdown", "start countdown");
	need("recentRounds", "number of recent rounds", 1);
	need("priorScore", "assumed score for new drivers");
	need("priorWeight", "weight of the assumed score");
	need("pairWeightOffense", "pairing weight for offense");
	need("pairWeightDefense", "pairing weight for defense");
	if (!BONUS_CURVES[t?.bonusCurve]) problems.push("Territory Breakthrough, time bonus: choose a bonus curve.");
	if (!RANK_BASES[t?.rankBasis]) problems.push("Territory Breakthrough, rankings: choose what ranks are based on.");
	if (!problems.length && pool(t) <= 0) problems.push("Territory Breakthrough: at least one scoring part must be worth points.");
	if (!problems.length && num(t.priorScore) > pool(t)) problems.push("Territory Breakthrough: the assumed score for new drivers cannot be above the points available in a round.");
	if (!problems.length && Number(t.pairWeightOffense) + Number(t.pairWeightDefense) <= 0) problems.push("Territory Breakthrough: at least one pairing weight must be above 0.");
	return problems;
}
export const gatePoints = (t, i) => Number(t[`gate${i + 1}Points`]) || 0; // i = 0, 1, 2
// Points available in one round: the offense and defense scores of a round always add up to this (100 with the defaults; penalties, if
// they cost points, are taken off afterwards).
export const pool = (t = TERRITORY_DEFAULTS) => gatePoints(t, 0) + gatePoints(t, 1) + gatePoints(t, 2) + t.finishPoints + t.timeBonus;


// ---------------------------------------------------------------- reading what the scorer recorded
// A run is { g1, g2, g3, finishTime } where each value is the elapsed time in seconds, or empty when it did not happen.
// Checkpoints must be crossed IN ORDER: G2 only counts once G1 has, G3 only after G2, the finish only after G3. A later checkpoint
// recorded without the earlier one is ignored for scoring (and reported by runProblems()).
export function readRun(data = {}, t = TERRITORY_DEFAULTS) {
	const times = [num(data.g1), num(data.g2), num(data.g3)];
	let gates = 0;
	while (gates < GATES && times[gates] !== null) gates++;
	const finishRaw = num(data.finishTime);
	const finished = gates === GATES && finishRaw !== null;
	const finishTime = finished ? Math.min(Math.max(finishRaw, 0), t.duration) : null;
	return { times, gates, finished, finishTime, time: finished ? finishTime : t.duration };
}
// Things that look wrong in a run, for the scorer to fix before saving. (Never blocks a legal run.)
export function runProblems(data = {}, t = TERRITORY_DEFAULTS) {
	const problems = [];
	const times = [num(data.g1), num(data.g2), num(data.g3)];
	const finish = num(data.finishTime);
	for (let i = 1; i < GATES; i++) if (times[i] !== null && times[i - 1] === null) problems.push(`G${i + 1} cannot count unless G${i} was crossed first.`);
	if (finish !== null && times.some((x) => x === null)) problems.push("The finish cannot count unless G1, G2 and G3 were all crossed first.");
	const seq = [...times, finish];
	const labels = ["G1", "G2", "G3", "the finish"];
	for (let i = 1; i < seq.length; i++) if (seq[i] !== null && seq[i - 1] !== null && seq[i] < seq[i - 1]) problems.push(`${labels[i]} cannot be earlier than ${labels[i - 1]}.`);
	for (let i = 0; i < seq.length; i++) if (seq[i] !== null && (seq[i] < 0 || seq[i] > t.duration)) problems.push(`The time for ${labels[i]} must be between 0 and ${t.duration} seconds.`);
	return problems;
}

// ---------------------------------------------------------------- the two scores of a round
// Offense:  the points of each checkpoint crossed  +  (if finished) finish points  +  bonus x curve((duration - t) / duration)
// Defense:  the points of each checkpoint NOT crossed  +  (if not finished) finish points  +  bonus x (1 - curve(...))  (t = duration when not finished).
// Without penalty costs the two always add up to pool() (100 with the defaults), so a round is zero-sum. When penalties cost points,
// each driver loses penaltyPoints x (their own penalties), never going below 0.
const bonusShare = (r, t) => (r.finished ? (BONUS_CURVES[t.bonusCurve] || BONUS_CURVES.linear).f(Math.max(0, (t.duration - r.finishTime) / t.duration)) : 0);
const penaltyCost = (data, t) => Math.max(0, num(data?.penalties) || 0) * (t.penaltyPoints || 0);
export function offensePoints(data, t = TERRITORY_DEFAULTS) {
	const r = readRun(data, t);
	let gates = 0;
	for (let i = 0; i < r.gates; i++) gates += gatePoints(t, i);
	const finish = r.finished ? t.finishPoints : 0;
	const bonus = t.timeBonus * bonusShare(r, t);
	const penalty = penaltyCost(data, t);
	return { gates: round2(gates), finish: round2(finish), bonus: round2(bonus), penalty: round2(penalty), points: round2(Math.max(0, gates + finish + bonus - penalty)), run: r };
}
export function defensePoints(data, t = TERRITORY_DEFAULTS) {
	const r = readRun(data, t);
	let denied = 0;
	for (let i = r.gates; i < GATES; i++) denied += gatePoints(t, i);
	const prevented = r.finished ? 0 : t.finishPoints;
	const delay = t.timeBonus * (1 - bonusShare(r, t));
	const penalty = penaltyCost(data, t);
	return { denied: round2(denied), prevented: round2(prevented), delay: round2(delay), penalty: round2(penalty), points: round2(Math.max(0, denied + prevented + delay - penalty)), run: r };
}
// The score object stored with an attempt: `final` is out of 10 (like every other drill), `points` out of the round's pool.
export function territoryScore(facet, data, t = TERRITORY_DEFAULTS) {
	const total = pool(t) || 100;
	const scale = (p) => round2((p / total) * 10);
	if (facet === "offense") {
		const s = offensePoints(data, t);
		return { gates: scale(s.gates), finish: scale(s.finish), bonus: scale(s.bonus), final: scale(s.points), points: s.points };
	}
	const s = defensePoints(data, t);
	return { denied: scale(s.denied), prevented: scale(s.prevented), delay: scale(s.delay), final: scale(s.points), points: s.points };
}
// Release 1.7 attempts (one run per round) carry data.format "rounds". Release 1.6 attempts (two heats per round) are not counted.
export const isTerritory = (x) => x?.data?.mode === "territory" && x.data.format === "rounds" && (x.facet === "offense" || x.facet === "defense");
export const isLegacyTerritory = (x) => x?.data?.mode === "territory" && x.data.format !== "rounds";

// ---------------------------------------------------------------- the structure of a match
// Driver A is the first Offensive Driver, Driver B the first Defensive Driver. Round 1: A offense, B defense. Round 2: B offense,
// A defense. Round 3: A offense, B defense.
export function roundPlan(round) {
	const aOffense = round % 2 === 1;
	return { round, offense: aOffense ? "A" : "B", defense: aOffense ? "B" : "A" };
}

// Collects the saved attempts of one match into rounds. `records` are attempts with data.mode "territory". A round has one offense
// attempt and one defense attempt (the two scorers' forms). The round winner is the driver with more points in that round.
export function matchSummary(records, drivers) {
	const mine = records.filter(isTerritory);
	const pointsOf = (round, role) => {
		const r = mine.find((x) => Number(x.data.round) === round && x.facet === role);
		return r ? Number(r.score?.points ?? 0) : null;
	};
	const rounds = [];
	const wins = { A: 0, B: 0 };
	const totals = { A: 0, B: 0 };
	const roleScores = { A: { offense: [], defense: [] }, B: { offense: [], defense: [] } };
	for (let round = 1; round <= ROUNDS; round++) {
		const plan = roundPlan(round);
		const off = pointsOf(round, "offense"),
			def = pointsOf(round, "defense");
		const row = { round, offenseSide: plan.offense, defenseSide: plan.defense, A: { role: plan.offense === "A" ? "offense" : "defense", points: null }, B: { role: plan.offense === "B" ? "offense" : "defense", points: null }, complete: off !== null && def !== null, winner: null };
		row[plan.offense].points = off;
		row[plan.defense].points = def;
		if (row.complete) {
			row.winner = off > def ? plan.offense : def > off ? plan.defense : "tie";
			if (row.winner !== "tie") wins[row.winner]++;
			totals[plan.offense] += off;
			totals[plan.defense] += def;
			roleScores[plan.offense].offense.push(off);
			roleScores[plan.defense].defense.push(def);
		}
		rounds.push(row);
	}
	const done = rounds.filter((r) => r.complete).length;
	// Best of 3: decided as soon as someone has 2 round wins; otherwise after round 3 the higher total points breaks a 1-1 (or drawn) match.
	let winner = null;
	if (wins.A >= 2) winner = "A";
	else if (wins.B >= 2) winner = "B";
	else if (done === ROUNDS) winner = totals.A > totals.B ? "A" : totals.B > totals.A ? "B" : "draw";
	const mean = (l) => (l.length ? round2(l.reduce((a, b) => a + b, 0) / l.length) : null);
	return {
		rounds,
		wins,
		totals: { A: round2(totals.A), B: round2(totals.B) },
		done,
		complete: done === ROUNDS,
		winner,
		decidedEarly: winner !== null && done < ROUNDS,
		means: { A: { offense: mean(roleScores.A.offense), defense: mean(roleScores.A.defense) }, B: { offense: mean(roleScores.B.offense), defense: mean(roleScores.B.defense) } },
	};
}
// Groups territory attempts by match id: { matchId: { id, date, drivers: {A, B}, records: [...] } } (A = the Offensive Driver of round 1).
export function groupMatches(submissions) {
	const matches = {};
	for (const x of submissions.filter(isTerritory)) {
		const id = x.data.matchId || x.id;
		const m = (matches[id] ??= { id, date: x.date, createdAt: x.createdAt, drivers: { A: "", B: "" }, records: [] });
		m.records.push(x);
		if (x.data.driverSide) m.drivers[x.data.driverSide] = x.driverName;
		if (String(x.createdAt || "") < String(m.createdAt || "")) m.createdAt = x.createdAt;
	}
	return Object.values(matches).sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
}

// ---------------------------------------------------------------- rankings
// One leaderboard per role. A driver's rank is by the MEAN of their points in that role (out of the round's pool). Only attempts
// recorded in Territory Breakthrough (one run per round) count. `rule` could be extended, but the practice's definition is the mean.
export function roleRanking(submissions, role, t = TERRITORY_DEFAULTS) {
	const by = {};
	for (const x of submissions.filter((x) => isTerritory(x) && x.facet === role)) (by[x.driverName] ??= []).push(x);
	const mean = (l) => l.reduce((a, b) => a + b, 0) / l.length;
	const rows = Object.entries(by).map(([name, list]) => {
		const newestFirst = [...list].sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
		const points = list.map((x) => Number(x.score?.points ?? 0));
		const recent = newestFirst.slice(0, t.recentRounds || 5).map((x) => Number(x.score?.points ?? 0));
		const basis = t.rankBasis === "best" ? Math.max(...points) : t.rankBasis === "recent" ? mean(recent) : mean(points);
		return { name, grade: newestFirst[0].grade, heats: list.length, mean: round2(mean(points)), best: Math.max(...points), value: round2(basis), list };
	});
	rows.sort((a, b) => b.value - a.value || b.mean - a.mean || b.heats - a.heats || a.name.localeCompare(b.name));
	let last = null;
	rows.forEach((r, i) => {
		r.rank = last && last.value === r.value ? last.rank : i + 1; // equal ranking scores share a rank
		last = r;
	});
	return rows;
}
// Statistics shown on a role's analysis page (checkpoint completion, times, violations, coach ratings).
export function roleStats(list, t = TERRITORY_DEFAULTS) {
	const runs = list.map((x) => readRun(x.data, t));
	const n = list.length || 1;
	const finishTimes = runs.filter((r) => r.finished).map((r) => r.finishTime);
	const avg = (l) => (l.length ? round2(l.reduce((a, b) => a + b, 0) / l.length) : null);
	const rate = (g) => Math.round((runs.filter((r) => r.gates >= g).length / n) * 100);
	return {
		heats: list.length,
		gateRates: [rate(1), rate(2), rate(3)],
		finishRate: Math.round((runs.filter((r) => r.finished).length / n) * 100),
		avgFinish: avg(finishTimes),
		avgGates: avg(runs.map((r) => r.gates)),
		penalties: list.reduce((a, x) => a + (num(x.data.penalties) || 0), 0),
	};
}

// ---------------------------------------------------------------- pairing suggestions (administrators only)
// A driver's rating in a role is their mean points there, pulled toward the "assumed score" while they have few rounds
// (priorWeight assumed rounds), so one lucky round cannot make someone look elite. Two drivers are well matched when BOTH their
// offensive and defensive ratings are close, because each plays both roles in a match.
export function ratingsFor(submissions, t = TERRITORY_DEFAULTS) {
	const ratings = {};
	for (const role of ["offense", "defense"]) {
		for (const row of roleRanking(submissions, role, t)) {
			const sum = row.list.reduce((a, x) => a + Number(x.score?.points ?? 0), 0);
			(ratings[row.name] ??= { offense: null, defense: null, offenseHeats: 0, defenseHeats: 0, grade: row.grade })[role] = round2((sum + t.priorScore * t.priorWeight) / (row.heats + t.priorWeight));
			ratings[row.name][`${role}Heats`] = row.heats;
		}
	}
	return ratings;
}
export function ratingOf(ratings, name, t = TERRITORY_DEFAULTS) {
	const r = ratings[name];
	return { offense: r?.offense ?? t.priorScore, defense: r?.defense ?? t.priorScore, known: Boolean(r) };
}
// Skill gap between two drivers (smaller = better matched), in points out of the round's pool.
export function skillGap(ratings, a, b, t = TERRITORY_DEFAULTS) {
	const x = ratingOf(ratings, a, t),
		y = ratingOf(ratings, b, t);
	return round2(t.pairWeightOffense * Math.abs(x.offense - y.offense) + t.pairWeightDefense * Math.abs(x.defense - y.defense));
}
// The best pairings for the drivers who are present: the minimum total skill gap over all ways of pairing them (exact search for
// up to 14 drivers, closest-first otherwise). With an odd number, the driver left out is returned as `bye`.
export function suggestPairings(names, ratings, t = TERRITORY_DEFAULTS) {
	const list = [...new Set(names.map((n) => String(n).trim()).filter(Boolean))];
	const gap = (i, j) => skillGap(ratings, list[i], list[j], t);
	const n = list.length;
	let pairs = [];
	let bye = null;
	if (n < 2) return { pairs, bye: list[0] || null };
	if (n <= 14) {
		// Dynamic programming over subsets: best[mask] = the smallest total gap that pairs up every driver in `mask`.
		const memo = new Map();
		const solve = (mask) => {
			if (mask === 0) return { cost: 0, picks: [] };
			if (memo.has(mask)) return memo.get(mask);
			const i = [...Array(n).keys()].find((k) => mask & (1 << k));
			let best = null;
			const rest = mask & ~(1 << i);
			for (let j = i + 1; j < n; j++) {
				if (!(rest & (1 << j))) continue;
				const sub = solve(rest & ~(1 << j));
				const cost = sub.cost + gap(i, j);
				if (!best || cost < best.cost) best = { cost, picks: [[i, j], ...sub.picks] };
			}
			if (!best && rest === 0) best = { cost: 0, picks: [], left: i };
			memo.set(mask, best);
			return best;
		};
		const full = (1 << n) - 1;
		if (n % 2 === 0) pairs = solve(full).picks;
		else {
			// Try leaving each driver out; keep the cheapest. Prefer leaving out a driver with the fewest recorded rounds on ties.
			let best = null;
			for (let k = 0; k < n; k++) {
				const sub = solve(full & ~(1 << k));
				if (!best || sub.cost < best.cost) best = { cost: sub.cost, picks: sub.picks, left: k };
			}
			pairs = best.picks;
			bye = list[best.left];
		}
		pairs = pairs.map(([i, j]) => [list[i], list[j]]);
	} else {
		const edges = [];
		for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) edges.push([gap(i, j), i, j]);
		edges.sort((a, b) => a[0] - b[0]);
		const used = new Set();
		for (const [, i, j] of edges) if (!used.has(i) && !used.has(j)) { used.add(i); used.add(j); pairs.push([list[i], list[j]]); }
		bye = list.find((_, i) => !used.has(i)) || null;
	}
	return { pairs: pairs.map(([a, b]) => ({ a, b, gap: skillGap(ratings, a, b, t) })).sort((p, q) => p.gap - q.gap), bye };
}
// The closest-skilled opponents for one driver (for "suggest an opponent for ...").
export function closestOpponents(name, candidates, ratings, t = TERRITORY_DEFAULTS, limit = 3) {
	return [...new Set(candidates)]
		.filter((c) => c && c !== name)
		.map((c) => ({ name: c, gap: skillGap(ratings, name, c, t) }))
		.sort((a, b) => a.gap - b.gap)
		.slice(0, limit);
}

// ---------------------------------------------------------------- coach feedback questions (not part of the numerical score)
// Types: "rating" (1-5), "choice" (pick one), "multi" (tick any), "paragraph". Administrators can reword, add, and remove these on
// the Form builder page; the objective checkpoint questions are fixed because the score is calculated from them.
const FAIL_REASONS = ["Defensive positioning prevented progress", "Offensive Driver made a driving or steering error", "Robot issue", "Time expired", "Other / unclear"];
export const DEFAULT_FEEDBACK = {
	defense: [
		{ id: "positions", type: "multi", label: "Which defensive positioning areas did the driver use?", options: ["D1", "D2", "D3", "Other"], help: "Select all that apply. For coaching analysis only: the driver gets no points for visiting an area." },
		{ id: "adjusted", type: "choice", label: "Did the Defensive Driver adjust their positioning in response to the Offensive Driver's movement?", options: ["Yes", "No", "Not observable"] },
		{ id: "anticipate", type: "rating", label: "How effectively did the Defensive Driver anticipate the Offensive Driver's next movement?" },
		{ id: "reposition", type: "rating", label: "How effectively did the Defensive Driver reposition throughout the round?" },
		{ id: "failReason", type: "choice", label: "If the Offensive Driver did not complete a checkpoint, what was the main reason?", options: FAIL_REASONS, help: "Leave blank when the Offensive Driver finished. Used to tell strong defense from an offensive mistake; it is never part of the numerical score." },
		{ id: "bestDecision", type: "paragraph", label: "What was the most effective defensive decision made during the round?", examples: ["Moved to guard G2 as soon as the offense cleared G1.", "Held position near D1 and forced the offense onto the long route.", "Cut off the shortest path to G3 at the right moment."] },
		{ id: "improve", type: "paragraph", label: "What is one thing the Defensive Driver should improve?", examples: ["Reposition sooner after the offense passes G1.", "Stay between the offense and the next checkpoint instead of chasing it.", "Keep the robot out of the no-go area."] },
		{ id: "notable", type: "paragraph", label: "What did you see in the driver's driving that was notable?", examples: ["Smooth, confident turns the whole round.", "Reacted late when the offense changed direction.", "Recovered quickly after catching a wall."] },
	],
	offense: [
		{ id: "navigate", type: "rating", label: "How effectively did the driver navigate toward each checkpoint?" },
		{ id: "efficient", type: "rating", label: "How efficiently did the driver move between checkpoints?" },
		{ id: "adjust", type: "rating", label: "How well did the driver adjust their route in response to the Defensive Driver?" },
		{ id: "stationary", type: "choice", label: "Did the driver spend excessive time stationary when a viable route was available?", options: ["Yes", "No"] },
		{ id: "unnecessary", type: "choice", label: "Did the driver make unnecessary movements or corrections?", options: ["Yes", "No"] },
		{ id: "bestManeuver", type: "paragraph", label: "What was the most effective offensive maneuver?", examples: ["Cut tightly around the wall to reach G2 before the defender.", "Faked toward the defender's side, then took the open lane to G3.", "Accelerated straight through the gap as soon as it opened."] },
		{ id: "improve", type: "paragraph", label: "What should the Offensive Driver improve?", examples: ["Slow down before G3 to make a cleaner turn.", "Look for a second route sooner when the first one is blocked.", "Avoid stopping while a route is open."] },
		{ id: "notable", type: "paragraph", label: "What did you see in the driver's driving that was notable?", examples: ["Very steady driving with few corrections.", "Hesitated at the start of the round.", "Good use of the full width of the field."] },
	],
};
export const FEEDBACK_TYPES = { rating: "1-5 rating", choice: "Pick one", multi: "Tick all that apply", paragraph: "Paragraph" };
export const territoryFormId = (role) => `builtin-territory-${role}`;
// The feedback questions in use for a role: the administrator's saved version or the original. Each question keeps a stable id so
// answers recorded earlier stay readable after a form is edited.
export function feedbackQuestions(savedForm, role) {
	const saved = Array.isArray(savedForm?.feedback) ? savedForm.feedback : null;
	if (!saved) return DEFAULT_FEEDBACK[role].map((q) => ({ ...q }));
	return saved
		.filter((q) => q && typeof q.id === "string" && typeof q.label === "string" && FEEDBACK_TYPES[q.type])
		.map((q) => ({ id: q.id, type: q.type, label: q.label, help: q.help || "", options: Array.isArray(q.options) ? q.options.map(String) : [], examples: Array.isArray(q.examples) ? q.examples.map(String).filter(Boolean) : [] }));
}

// The most one scored part can earn, on the same 0-10 scale as `score` (so parts of different sizes can be compared fairly).
export function partMax(key, t = TERRITORY_DEFAULTS) {
	const total = pool(t) || 100;
	const size = { gates: gatePoints(t, 0) + gatePoints(t, 1) + gatePoints(t, 2), denied: gatePoints(t, 0) + gatePoints(t, 1) + gatePoints(t, 2), finish: t.finishPoints, prevented: t.finishPoints, bonus: t.timeBonus, delay: t.timeBonus }[key] ?? 0;
	return (size / total) * 10;
}
