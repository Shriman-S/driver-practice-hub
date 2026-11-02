// Territory Breakthrough page (Release 1.7): the Offensive / Defensive driving practice.
//
// One page holds everything a recorder needs:
//   1. The MATCH MANAGER: start a match (choose the two drivers, the course and the two robots) or join one started on the other laptop.
//      Administrators also see the current Offensive and Defensive rankings and get pairing suggestions; everyone else types the
//      drivers in by hand.
//   2. The SCORING CONSOLE for one round at a time: a shared 60-second timer, checkpoint buttons that record the elapsed time, and the
//      Offensive and Defensive scorers' forms (objective results first, coach feedback after).
//
// A match is 3 rounds of ONE 60-second run each (so only three robot batteries per practice). The drivers alternate roles every
// round (A: offense, B: offense, A: offense) and switch robots with their roles.
//
// ONE SET OF OBJECTIVE RESULTS. The Offensive form's scorer records the checkpoint times (G1, G2, G3, finish) for the round. They are
// shared live with the Defensive form's scorer and used for BOTH drivers, so a disagreement between two scorers' reaction times can
// never give the two drivers inconsistent scores, and the two scores of a round always add up to the same total. The Defensive scorer
// watches the same numbers appear, records their own driver's penalties, and fills in the coach feedback. Pressing Finish ends the
// round on both laptops at that moment, because the run is over once the Offensive Driver has completed the route.
//
// TWO LAPTOPS (the default). Each laptop can only open http://localhost:5000, so they cannot talk to each other directly. Instead both
// pages are connected to the same Firebase database: a small `matches/<code>` document holds the shared round state and the shared
// results, and both pages watch it live. When both scorers press Ready, one page writes a start time in SERVER time a few seconds
// ahead; each page converts that to its own clock (using a measured offset, storage.syncClock) and starts its timer at that same
// moment, so the two timers agree to within a few tens of milliseconds. ONE LAPTOP (fallback): the same console shows both scorers'
// forms side by side with one shared timer; nothing needs the network, so it also works in local preview mode.
//
// The pure rules and formulas are in territorycore.js; scores are saved as ordinary submissions (facet "offense" or "defense",
// data.mode "territory", data.format "rounds"), so the rest of DriveLab (Analysis, profiles, PDFs) uses them like any other attempt.
import { esc, uid, now, todayKey, dateText } from "./util.js";
import { GRADES, ROBOTS } from "./constants.js";
import { publishedCourses, courseLabel, courseModel, courseSvg, courseKeyHtml } from "./courses.js";
import { scoreSubmission } from "./scoring.js";
import * as core from "./territorycore.js";

const SESSION_KEY = "drivelab-territory";
const CODE_LETTERS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O/1/I, so a code read aloud or typed is never ambiguous
const newCode = () => Array.from({ length: 6 }, () => CODE_LETTERS[Math.floor(Math.random() * CODE_LETTERS.length)]).join("");
const one = (n) => (Math.round(Number(n) * 10) / 10).toFixed(1);
const pts = (n) => (Number.isFinite(Number(n)) ? String(Math.round(Number(n) * 10) / 10) : "--");
const KEYS = { off: "offense", def: "defense" };

// Everything about the match this browser is part of lives here (not in the app state, because a timer must survive re-draws).
const T = {
	ctx: null,
	match: null, // the shared match document (see makeMatch())
	role: null, // "off" = Offensive form, "def" = Defensive form, "both" = one laptop doing both forms
	code: "",
	unsub: null,
	offset: 0, // this computer's clock + offset = database server time (milliseconds)
	clock: "", // text describing the clock measurement
	problem: "", // a connection problem to show (for example, the match was not found)
	entries: {}, // the forms being filled in for the current round: { off: entry, def: entry }
	entryRound: 0,
	restart: 0,
	signature: "",
	phase: "",
	ticker: null,
	autoKeys: new Set(),
	draft: null, // the set-up form's values, so a redraw never clears what was typed
	pair: { present: [], other: "", result: null, opponents: null },
	scorerName: { off: "", def: "" },
};
const settings = () => T.ctx.state.scoring.territory || core.TERRITORY_DEFAULTS;
const serverNow = () => Date.now() + T.offset;
const isAdmin = () => Boolean(T.ctx.state.session.isAdmin);
const blankEntry = (role) => ({ scorer: T.scorerName[role] || "", penalties: "0", answers: {}, notes: "", saved: false, saving: false });
const entryOf = (role) => (T.entries[role] ??= blankEntry(role));
const rolesHere = () => (T.role === "both" ? ["off", "def"] : [T.role]);

// ---------------------------------------------------------------- the shared match document
// Only these top-level keys are allowed when a match is created (firestore.rules); later updates add `run`, `endAt` and `results`.
function makeMatch(f) {
	return {
		id: f.code,
		createdAt: now(),
		date: f.date,
		mode: f.mode, // "sync" = two laptops, "single" = one laptop
		drivers: { A: f.first.off, B: f.first.def }, // A is the Offensive Driver of round 1, B the Defensive Driver of round 1
		grades: { A: f.first.offGrade, B: f.first.defGrade },
		course: f.course,
		robots: { offense: f.robotOff, defense: f.robotDef },
		scorers: { offense: "", defense: "" },
		host: f.role,
		round: 1,
		status: "active",
		ready: { off: false, def: false },
		done: { off: false, def: false },
		startAt: null,
		restart: 0,
	};
}
const setDeep = (object, path, value) => {
	const keys = path.split(".");
	let target = object;
	for (const key of keys.slice(0, -1)) target = target[key] = target[key] && typeof target[key] === "object" ? target[key] : {};
	target[keys.at(-1)] = value;
};
// Changes the match on this computer at once and, for a two-laptop match, in the shared database (the other laptop sees it live).
async function update(patch) {
	const match = T.match;
	if (!match) return;
	for (const [path, value] of Object.entries(patch)) setDeep(match, path, value);
	if (match.mode === "sync") {
		try {
			await T.ctx.store.patchMatch(match.id, patch);
		} catch (error) {
			T.ctx.toast(`Could not reach the shared match: ${error.message}`);
		}
	} else persist();
	onMatch(match, true);
}
const persist = () => {
	try {
		sessionStorage.setItem(SESSION_KEY, JSON.stringify({ code: T.code, role: T.role, offset: T.offset, match: T.match?.mode === "single" ? T.match : null }));
	} catch {
		/* storage unavailable: the match simply cannot be resumed after a refresh */
	}
};

// ---------------------------------------------------------------- who plays this round
export function roundPeople(m) {
	const plan = core.roundPlan(m.round);
	return {
		round: plan.round,
		off: { side: plan.offense, name: m.drivers[plan.offense], grade: m.grades[plan.offense], robot: m.robots.offense },
		def: { side: plan.defense, name: m.drivers[plan.defense], grade: m.grades[plan.defense], robot: m.robots.defense },
	};
}
// waiting -> countdown -> running -> timeup. The round ends when the 60 seconds are over OR when the Offensive scorer records the
// finish (or presses End round), which writes `endAt` (server time) for both laptops.
function phaseOf(m) {
	if (!m) return "";
	if (m.status === "complete") return "complete";
	if (!m.startAt) return "waiting";
	const t = serverNow();
	if (t < m.startAt) return "countdown";
	if (m.endAt && t >= m.endAt) return "timeup";
	return t < m.startAt + settings().duration * 1000 ? "running" : "timeup";
}
const endedBy = (m) => (m.endAt && m.endAt < m.startAt + settings().duration * 1000 ? (m.run?.finishTime !== undefined && m.run?.finishTime !== "" ? "finish" : "ended") : "time");
// Seconds since the round started (frozen at the moment the round ended).
const elapsedSeconds = (m) => Math.max(0, ((m.endAt ? Math.min(serverNow(), m.endAt) : serverNow()) - m.startAt) / 1000);
// The shared official results for the round: { g1, g2, g3, finishTime } as numbers or "" (recorded by the Offensive form's scorer).
const officialRun = (m = T.match) => ({ g1: m?.run?.g1 ?? "", g2: m?.run?.g2 ?? "", g3: m?.run?.g3 ?? "", finishTime: m?.run?.finishTime ?? "" });

// ---------------------------------------------------------------- entering, leaving and following a match
async function enterMatch(match, role, { fresh = false } = {}) {
	leaveMatch(false);
	T.match = match;
	T.code = match.id;
	T.role = role;
	T.problem = "";
	T.entries = {};
	T.entryRound = match.round;
	T.restart = match.restart || 0;
	T.autoKeys = new Set();
	T.signature = "";
	T.clock = match.mode === "sync" ? "Measuring the clock..." : "";
	persist();
	if (match.mode === "sync") {
		T.unsub = T.ctx.store.watchMatch(
			match.id,
			(m) => onMatch(m),
			(error) => {
				T.problem = `Could not follow the match: ${error.message}. If this says permission denied, publish the newest firestore.rules in Firebase.`;
				T.ctx.render();
			},
		);
		measureClock(role === "def" ? "def" : "off");
	}
	startTicker();
	T.ctx.render();
	if (fresh) T.ctx.toast(match.mode === "sync" ? `Match ${match.id} created. Enter this code on the other laptop.` : "Match started.");
}
// Both laptops must agree on "now". Preferred method: measure each computer's offset from the Firebase server's clock (storage.syncClock).
// If that cannot be measured on a laptop, a peer method takes over: the Defensive laptop pings the Offensive laptop through the match
// record and measures the offset between the two computers directly (NTP style: offset = their time - the midpoint of the round trip).
// The Offensive laptop's clock (corrected to server time when it could be) is always the shared reference, and `clockRef` in the
// match record tells the Defensive laptop which frame the start times are written in.
const showClock = (text) => {
	T.clock = text;
	const box = document.querySelector("#t-clock-status");
	if (box) box.textContent = text;
};
async function measureClock(key) {
	showClock("Measuring the clock...");
	let serverOk = false;
	try {
		const { offset, error } = await T.ctx.store.syncClock(T.code, key);
		T.offset = offset;
		serverOk = true;
		showClock(error ? `Clock synced with the server (within about ${error} ms)` : "Clock synced");
	} catch (error) {
		T.offset = 0;
		T.serverProblem = error.message;
	}
	if (key === "off") {
		await update({ clockRef: serverOk ? "server" : "offense" });
		if (!serverOk) showClock(`Using this laptop's clock as the shared reference (the server clock could not be measured: ${T.serverProblem})`);
	} else if (!serverOk) await peerSync();
	else if (T.match?.clockRef === "offense") await peerSync();
	T.clockMode = serverOk ? "server" : "peer";
	persist();
}
let pinging = false;
async function peerSync() {
	if (pinging || !T.match || T.role !== "def") return;
	pinging = true;
	showClock("Synchronizing with the other laptop...");
	let best = null;
	for (let i = 0; i < 5; i++) {
		const id = uid();
		const t0 = Date.now();
		await update({ ping: { id, t0 } });
		const deadline = Date.now() + 4000;
		while (Date.now() < deadline && T.match?.pong?.id !== id) await new Promise((r) => setTimeout(r, 40));
		const t2 = Date.now();
		if (T.match?.pong?.id !== id) continue;
		const sample = { offset: Math.round(T.match.pong.t1 - (t0 + t2) / 2), error: Math.round((t2 - t0) / 2) };
		if (!best || sample.error < best.error) best = sample;
	}
	pinging = false;
	if (best) {
		T.offset = best.offset;
		showClock(`Clock synced with the other laptop (within about ${best.error} ms)`);
	} else showClock("Clock not synchronized: the other laptop did not answer. Make sure it has joined this match, then press Re-measure clock.");
	persist();
}
// The Offensive laptop answers clock pings, and the Defensive laptop switches to the peer method when told the reference is not the server.
function clockHousekeeping(m) {
	if (m.mode !== "sync") return;
	if (T.role === "off" && m.ping?.id && m.ping.id !== T.lastPing) {
		T.lastPing = m.ping.id;
		update({ pong: { id: m.ping.id, t1: Date.now() + T.offset } });
	}
	if (T.role === "def" && T.clockMode === "server" && m.clockRef === "offense" && !pinging) {
		T.clockMode = "peer";
		peerSync();
	}
}
export function leaveMatch(redraw = true) {
	T.unsub?.();
	T.unsub = null;
	clearInterval(T.ticker);
	T.ticker = null;
	T.match = null;
	T.role = null;
	T.code = "";
	T.entries = {};
	T.phase = "";
	try {
		sessionStorage.removeItem(SESSION_KEY);
	} catch {
		/* nothing to clear */
	}
	if (redraw) T.ctx.render();
}
// A new snapshot of the match (from the database, or from this page's own change). A full redraw happens only when something that
// changes the screen's structure changed, so a partner's tap never interrupts typing in a feedback box.
function onMatch(m, local = false) {
	if (!m) {
		T.problem = "This match no longer exists.";
		T.ctx.render();
		return;
	}
	if (!local) T.match = m;
	else if (T.match !== m) T.match = m;
	const match = T.match;
	if (match.round !== T.entryRound || (match.restart || 0) !== T.restart) {
		T.entries = {};
		T.entryRound = match.round;
		T.restart = match.restart || 0;
	}
	const signature = JSON.stringify([match.round, match.status, match.startAt, match.endAt, Boolean(match.run?.confirmed), match.ready, match.done, match.restart, Object.keys(match.results || {}).length]);
	autoActions();
	clockHousekeeping(match);
	const runSig = JSON.stringify(match.run || {});
	if (signature !== T.signature) {
		T.signature = signature;
		T.runSig = runSig;
		if (T.ctx.state.route === "territory") T.ctx.render();
	} else if (runSig !== T.runSig) {
		// Only the shared checkpoint results changed: redraw just those tables, so nothing being typed is interrupted.
		T.runSig = runSig;
		for (const role of rolesHere()) {
			const box = document.querySelector(`#run-${role}`);
			if (box) box.innerHTML = runHtml(role);
		}
	}
}
// Steps that must happen exactly once for the whole match, taken by one laptop (the Offensive scorer's; the Defensive scorer's laptop
// does the same after a short delay in case the other laptop has gone away, which is harmless because the check is repeated).
function autoActions() {
	const m = T.match;
	if (!m || m.status !== "active") return;
	const delay = T.role === "def" ? 1800 : 0;
	if (m.mode === "sync" && !m.startAt && m.ready?.off && m.ready?.def) {
		const key = `start-${m.round}-${m.restart || 0}`;
		if (!T.autoKeys.has(key)) {
			T.autoKeys.add(key);
			setTimeout(() => {
				const cur = T.match;
				if (cur && cur.round === m.round && !cur.startAt && cur.ready?.off && cur.ready?.def) update({ startAt: Math.round(serverNow() + settings().countdown * 1000) });
			}, delay);
		}
	}
	if (m.done?.off && m.done?.def) {
		const key = `advance-${m.round}`;
		if (!T.autoKeys.has(key)) {
			T.autoKeys.add(key);
			setTimeout(() => {
				const cur = T.match;
				if (cur && cur.round === m.round && cur.done?.off && cur.done?.def) advance();
			}, delay + 600);
		}
	}
}
function advance() {
	const m = T.match;
	const reset = { ready: { off: false, def: false }, startAt: null, endAt: null, run: {} };
	update(m.round >= core.ROUNDS ? { status: "complete", ...reset } : { round: m.round + 1, done: { off: false, def: false }, ...reset });
}
// One laptop: both forms are on this screen, so "ready" is automatic and pressing Start begins the countdown.
const startSingle = () => update({ startAt: Date.now() + settings().countdown * 1000, endAt: null, ready: { off: true, def: true } });
const toggleReady = () => {
	const key = T.role === "def" ? "def" : "off";
	update({ [`ready.${key}`]: !T.match.ready?.[key] });
};
const restartRound = () => {
	if (!confirm("Restart this round? The timer is cleared on both laptops and the checkpoint results and anything entered for this round are discarded.")) return;
	update({ startAt: null, endAt: null, run: {}, ready: { off: false, def: false }, restart: (T.match.restart || 0) + 1 });
};
// The Offensive scorer records a checkpoint: the time is shared with the Defensive scorer at once. Finishing ends the round.
function recordGate(field) {
	const m = T.match;
	if (phaseOf(m) !== "running") return;
	const t = Math.round(Math.min(elapsedSeconds(m), settings().duration) * 10) / 10;
	const patch = { [`run.${field}`]: t };
	if (field === "finishTime") patch.endAt = Math.round(serverNow());
	update(patch);
}
const endRound = () => {
	if (phaseOf(T.match) === "running") update({ endAt: Math.round(serverNow()) });
};

// ---------------------------------------------------------------- the timer (updated 20 times a second without redrawing the page)
let audio = null;
function beep(freq = 880, ms = 120) {
	try {
		audio ??= new (window.AudioContext || window.webkitAudioContext)();
		const osc = audio.createOscillator(),
			gain = audio.createGain();
		osc.frequency.value = freq;
		gain.gain.value = 0.08;
		osc.connect(gain).connect(audio.destination);
		osc.start();
		osc.stop(audio.currentTime + ms / 1000);
	} catch {
		/* sound is a convenience only */
	}
}
function startTicker() {
	clearInterval(T.ticker);
	T.lastCount = null;
	T.ticker = setInterval(tick, 50);
}
function clockText(m) {
	const phase = phaseOf(m),
		dur = settings().duration;
	if (phase === "countdown") return String(Math.ceil((m.startAt - serverNow()) / 1000));
	if (phase === "running" || phase === "timeup") return one(Math.max(0, dur - elapsedSeconds(m)));
	return one(dur);
}
function tick() {
	const m = T.match;
	if (!m || T.ctx.state.route !== "territory") return;
	const phase = phaseOf(m);
	const clock = document.querySelector("#t-clock");
	if (clock) {
		clock.textContent = clockText(m);
		clock.dataset.phase = phase;
	}
	if (phase === "countdown") {
		const n = Math.ceil((m.startAt - serverNow()) / 1000);
		if (n !== T.lastCount) {
			T.lastCount = n;
			beep(660);
		}
	}
	if (phase !== T.phase) {
		const previous = T.phase;
		T.phase = phase;
		if (phase === "running") beep(1320, 350);
		if (phase === "timeup" && previous === "running") beep(440, 700);
		T.ctx.render(); // the buttons change with the phase
	}
}

// ---------------------------------------------------------------- saving a scorer's form
const feedbackFor = (role) => core.feedbackQuestions(T.ctx.state.data.customForms.find((f) => f.id === core.territoryFormId(KEYS[role])), KEYS[role]);
// The attempt's data. The checkpoint results are the shared official ones (recorded by the Offensive form's scorer), the same for both.
function dataOf(role, entry, people, run) {
	const mine = people[role],
		other = people[role === "off" ? "def" : "off"];
	const num = (v) => (v === "" || v === null || v === undefined ? "" : Number(v));
	const answers = {};
	for (const q of feedbackFor(role)) {
		const v = entry.answers[q.id];
		if (v !== undefined && v !== "" && !(Array.isArray(v) && !v.length)) answers[q.id] = v;
	}
	const read = core.readRun(run, settings());
	return {
		mode: "territory",
		format: "rounds",
		matchId: T.match.id,
		round: people.round,
		driverSide: mine.side,
		opponentName: other.name,
		opponentGrade: other.grade,
		robot: mine.robot,
		course: T.match.course || "",
		scorer: entry.scorer.trim(),
		g1: num(run.g1),
		g2: num(run.g2),
		g3: num(run.g3),
		finishTime: num(run.finishTime),
		gatesCrossed: read.gates,
		finished: read.finished,
		penalties: Number(entry.penalties) || 0,
		answers,
		notes: String(entry.notes || "").slice(0, 1000),
	};
}
async function saveEntry(role) {
	const m = T.match,
		entry = entryOf(role);
	if (entry.saved || entry.saving) return;
	const run = officialRun(m);
	const problems = [];
	if (!entry.scorer.trim()) problems.push("Enter the coach / scorer's name.");
	if (role === "def" && !m.run?.confirmed) problems.push("Wait for the Offensive scorer to save the checkpoint results first.");
	problems.push(...core.runProblems(run, settings()));
	if (Number(entry.penalties) < 0 || !Number.isFinite(Number(entry.penalties))) problems.push("Penalties must be 0 or more.");
	if (role === "off" && phaseOf(m) !== "timeup") problems.push("Wait until the round is over before saving.");
	if (problems.length) return T.ctx.toast(problems[0]);
	const people = roundPeople(m);
	const mine = people[role];
	const item = { id: uid(), facet: KEYS[role], driverName: mine.name.trim(), grade: mine.grade, date: m.date, data: dataOf(role, entry, people, run), createdAt: now() };
	item.score = scoreSubmission(item, T.ctx.state.scoring);
	entry.saving = true;
	try {
		await T.ctx.store.addSubmission(item);
		T.ctx.state.data.submissions.push(item);
		entry.saved = true;
		entry.result = item.score.points;
		T.scorerName[role] = entry.scorer.trim();
		T.ctx.toast(`${core.ROLES[KEYS[role]]} form saved: ${pts(item.score.points)} points for ${mine.name}.`);
		const patch = { [`done.${role}`]: true, [`results.r${m.round}.${role}`]: { driver: mine.name, points: item.score.points }, [`scorers.${KEYS[role]}`]: entry.scorer.trim() };
		if (role === "off") patch["run.confirmed"] = true; // releases the Defensive form, which uses these same results
		await update(patch);
	} catch (error) {
		entry.saving = false;
		T.ctx.toast(`Could not save: ${error.message}`);
	}
	entry.saving = false;
	T.ctx.render();
}

// ---------------------------------------------------------------- results of the match so far (works on every laptop)
export function recordsFromResults(m) {
	const records = [];
	for (const [key, value] of Object.entries(m.results || {})) {
		const round = Number(key.slice(1)),
			plan = core.roundPlan(round);
		for (const role of ["off", "def"]) {
			const r = value?.[role];
			if (!r) continue;
			const side = role === "off" ? plan.offense : plan.defense;
			records.push({ facet: KEYS[role], driverName: m.drivers[side], data: { mode: "territory", format: "rounds", round, driverSide: side }, score: { points: Number(r.points) } });
		}
	}
	return records;
}
// The round-by-round table, the match winner and each driver's average for each role.
export function summaryHtml(summary, drivers) {
	const name = (side) => esc(drivers[side] || `Driver ${side}`);
	const cell = (v) => (v === null || v === undefined ? "--" : pts(v));
	const roleName = (r) => (r === "offense" ? "Offense" : "Defense");
	const rows = summary.rounds
		.map((r) => {
			const win = (side) => (r.winner === side ? ' class="t-win"' : "");
			const one = (side) => `<td${win(side)}>${roleName(r[side].role)}</td><td${win(side)}><strong>${cell(r[side].points)}</strong></td>`;
			return `<tr><td><strong>Round ${r.round}</strong></td>${one("A")}${one("B")}<td>${r.complete ? (r.winner === "tie" ? "Tie" : name(r.winner)) : "--"}</td></tr>`;
		})
		.join("");
	const verdict = summary.winner
		? summary.winner === "draw"
			? "The match is a draw."
			: `${name(summary.winner)} wins the match ${summary.wins[summary.winner]}-${summary.wins[summary.winner === "A" ? "B" : "A"]}${summary.decidedEarly ? " (decided before round 3)" : ""}.`
		: `Rounds won so far: ${name("A")} ${summary.wins.A}, ${name("B")} ${summary.wins.B}.`;
	return `<div class="table-wrap"><table class="t-summary"><thead><tr><th rowspan="2">Round</th><th colspan="2">${name("A")}</th><th colspan="2">${name("B")}</th><th rowspan="2">Round winner</th></tr><tr><th>Role</th><th>Points</th><th>Role</th><th>Points</th></tr></thead><tbody>${rows}</tbody></table></div>
  <p class="t-verdict"><strong>${verdict}</strong></p>
  <p class="help">Each round is one 60-second run, and the drivers alternate roles. The two scores of a round add up to ${pts(core.pool(settings()))}, and the driver with more points wins the round. The first driver to win 2 of the 3 rounds wins the match. Role averages so far: ${name("A")} offense ${cell(summary.means.A.offense)}, defense ${cell(summary.means.A.defense)}; ${name("B")} offense ${cell(summary.means.B.offense)}, defense ${cell(summary.means.B.defense)}.</p>`;
}

// ================================================================= drawing the page
export function renderTerritory(ctx) {
	T.ctx = ctx;
	resumeIfNeeded();
	const m = T.match;
	const header = ctx.pageHeader(
		"Territory Breakthrough",
		"The Offensive / Defensive driving practice: a best-of-3 match, scored from what actually happens on the field.",
		m ? `<span class="hero-actions"><button class="button button-secondary" id="t-leave">Leave match</button></span>` : isAdmin() ? `<span class="hero-actions"><button class="button button-secondary" id="t-edit-forms">Edit scorer forms</button></span>` : "",
	);
	return `${header}${explainerHtml()}<div id="t-root">${m ? consoleHtml() : managerHtml()}</div>`;
}
// After a refresh, rejoin the match this tab was in.
function resumeIfNeeded() {
	if (T.match || T.resumed) return;
	T.resumed = true;
	try {
		const saved = JSON.parse(sessionStorage.getItem(SESSION_KEY));
		if (!saved) return;
		if (saved.match) {
			T.offset = 0;
			T.match = saved.match;
			T.code = saved.code;
			T.role = saved.role;
			T.entryRound = saved.match.round;
			T.restart = saved.match.restart || 0;
			startTicker();
		} else if (saved.code) {
			T.offset = saved.offset || 0;
			T.ctx.store.getMatch(saved.code).then((match) => {
				if (match) enterMatch(match, saved.role);
			}).catch(() => {});
		}
	} catch {
		/* a damaged saved match is ignored */
	}
}

// ---------------------------------------------------------------- the explanation of the practice (collapsed until opened)
// Built from the current scoring settings, so the numbers always match what the website really does.
export function explainerHtml() {
	const t = settings();
	const g = [t.gate1Points, t.gate2Points, t.gate3Points];
	const total = core.pool(t);
	const same = g[0] === g[1] && g[1] === g[2];
	const ex = [["Finishes in 30 s", { g1: 5, g2: 10, g3: 20, finishTime: 30 }], ["Finishes at the time limit", { g1: 5, g2: 10, g3: 20, finishTime: t.duration }], ["Crosses 2 gates, no finish", { g1: 5, g2: 10 }], ["Crosses 1 gate, no finish", { g1: 5 }], ["Crosses no gates", {}]];
	const rows = ex.map(([n, d]) => `<tr><td>${n}</td><td>${pts(core.offensePoints(d, t).points)}</td><td>${pts(core.defensePoints(d, t).points)}</td></tr>`).join("");
	const open = T.explainerOpen ? " open" : "";
	return `<details class="t-explain"${open} id="t-explain"><summary>How does this practice work?</summary>
  <div class="t-explain-body">
    <h4>What it assesses</h4>
    <p>Territory Breakthrough measures how well an <strong>Offensive Driver</strong> can get a robot through a defender and across the field, and how well a <strong>Defensive Driver</strong> can stop them. The offense practices finding routes, accelerating through openings, turning precisely, and reacting to the defender under time pressure. The defense practices reading the offense's route, blocking the important openings, repositioning, and covering the field.</p>
    <h4>The field</h4>
    <ul><li>The offensive robot starts in a marked <strong>starting zone</strong> on one side. The defensive robot starts in a <strong>central starting area</strong>.</li>
    <li>Walls and barriers leave three <strong>checkpoints (G1, G2, G3)</strong>, each a line the robot must cross in the direction of its arrow. The <strong>finishing zone</strong> is on the opposite side.</li>
    <li>The defender can move through the middle of the field but cannot enter the offensive starting zone or the no-go buffer around the finish. D1, D2 and D3 mark places a defender often positions; they are for coaching only and never earn points.</li></ul>
    <h4>How a match works</h4>
    <ul><li>Two drivers play a <strong>best-of-3 match: 3 rounds</strong>, one ${t.duration}-second run each.</li>
    <li>The drivers <strong>alternate roles every round</strong> (the first Offensive Driver plays offense in rounds 1 and 3, the other driver in round 2) and switch robots with their roles. The two robots keep their offensive and defensive jobs all match; any of the three robots can fill either job.</li>
    <li>In a round the Offensive Driver must cross G1, then G2, then G3, then reach the finish zone. A checkpoint counts only when the center of the robot has completely crossed its line in the arrow's direction. The round ends when the offense finishes or when time runs out.</li>
    <li>The Defensive Driver may stand wherever they like. They never have to leave a good position to earn points: they are scored on what the offense actually achieves.</li></ul>
    <h4>How scoring works</h4>
    <ul><li><strong>Offense:</strong> ${same ? `${g[0]} points for each checkpoint crossed` : `${g[0]} / ${g[1]} / ${g[2]} points for G1 / G2 / G3`}, ${t.finishPoints} points for reaching the finish zone, plus up to ${t.timeBonus} bonus points for a quick finish (the bonus is only earned by finishing the whole route).</li>
    <li><strong>Defense:</strong> the points of every checkpoint the offense did not cross, ${t.finishPoints} points if the finish was prevented, and the part of the time bonus the offense did not earn.${t.penaltyPoints ? ` Each penalty costs the driver who received it ${t.penaltyPoints} point${t.penaltyPoints === 1 ? "" : "s"}.` : ""}</li>
    <li>${t.penaltyPoints ? "Without penalties, the" : "The"} offensive and defensive scores of a round always add up to ${pts(total)}, so waiting never helps the offense and standing still never helps the defense.</li></ul>
    <div class="table-wrap"><table><thead><tr><th>Example round</th><th>Offense</th><th>Defense</th></tr></thead><tbody>${rows}</tbody></table></div>
    <p class="help">Scores come only from measurable events. How smooth or effective a drive looked goes in the coach feedback questions and never changes the score.</p>
    <h4>Winning</h4>
    <ul><li>In each round, the driver with <strong>more points wins the round</strong>. The first driver to win <strong>2 of the 3 rounds</strong> wins the match; if it is 1-1 after round 3, the higher total points decide.</li>
    <li>Separately from who wins, each driver's results feed two leaderboards: the <strong>Offensive ranking</strong> and the <strong>Defensive ranking</strong>.</li></ul>
    <h4>Who does what</h4>
    <ul><li>Two scorers run each round. The <strong>Offensive scorer</strong> records the checkpoints (G1, G2, G3, finish) with the checkpoint buttons; these official results are shared live with the <strong>Defensive scorer</strong> and used for both drivers, so the two scores never disagree.</li>
    <li>Each scorer records the penalties of their own driver and fills in the coach feedback. The Defensive form is saved after the Offensive form.</li>
    <li>With <strong>two laptops</strong>, start the match on one laptop and join it on the other with the 6-letter code; both timers start together once both scorers press Ready. With <strong>one laptop</strong>, both forms appear side by side with one timer.</li>
    <li>Administrators can also see the current rankings and get suggested pairings of drivers with similar skill; everyone can type the two drivers' names themselves.</li></ul>
  </div></details>`;
}

// ---------------------------------------------------------------- Match manager
function courseOptions(robotOff, robotDef, selected) {
	const courses = publishedCourses(T.ctx.state.data.courses, "defense").filter((c) => {
		const allowed = T.ctx.state.data.courses[c.key]?.robots;
		return !allowed?.length || (allowed.includes(robotOff) && allowed.includes(robotDef));
	});
	if (!courses.length) return '<option value="">No course published for these robots yet</option>';
	return `<option value="">Select course</option>${courses.map((c) => `<option value="${esc(c.key)}" ${selected === c.key ? "selected" : ""}>${esc(c.name)}</option>`).join("")}`;
}
const gradeOptions = (selected) => `<option value="">Select grade</option>${GRADES.map((g) => `<option ${g === selected ? "selected" : ""}>${g}</option>`).join("")}`;
const robotOptions = (selected) => ROBOTS.map((r) => `<option ${r === selected ? "selected" : ""}>${esc(r)}</option>`).join("");
function managerHtml() {
	const d = (T.draft ??= { date: todayKey(), mode: "sync", role: "off", off: "", offGrade: "", def: "", defGrade: "", robotOff: ROBOTS[0], robotDef: ROBOTS[1], course: "", scorer: "", joinCode: "", joinRole: "off" });
	const admin = isAdmin();
	const hint = admin
		? `<p class="help t-admin-note"><strong>Administrator:</strong> type the drivers yourself, or use the pairing suggestions below. Suggestions only fill in the boxes; you can change any name.</p>`
		: `<p class="help">Type the two drivers' names (first name and last initial). The drivers alternate between offense and defense every round.</p>`;
	const selectedCourse = d.course && T.ctx.state.data.courses[d.course] ? d.course : "";
	const picture = selectedCourse ? `<div class="t-course-pic">${courseSvg(courseModel(T.ctx.state.data.courses[selectedCourse]), courseLabel(T.ctx.state.data.courses, selectedCourse), "defense")}${courseKeyHtml(courseModel(T.ctx.state.data.courses[selectedCourse]), "defense", { compact: true })}</div>` : "";
	return `<div class="t-grid">
  <section class="panel t-card"><h3>Start a new match</h3>
    <form id="t-new" autocomplete="off">
      ${hint}
      <label class="field"><span>Date of practice <b class="required">*</b></span><input type="date" id="tn-date" value="${esc(d.date)}" required></label>
      <fieldset class="t-pair"><legend>Round 1</legend>
        <div class="t-two"><label class="field"><span>Offensive Driver <b class="required">*</b></span><input id="tn-off" name="off" value="${esc(d.off)}" autocomplete="off" required></label>
        <label class="field"><span>Grade <b class="required">*</b></span><select id="tn-offgrade" required>${gradeOptions(d.offGrade)}</select></label></div>
        <div class="t-two"><label class="field"><span>Defensive Driver <b class="required">*</b></span><input id="tn-def" name="def" value="${esc(d.def)}" autocomplete="off" required></label>
        <label class="field"><span>Grade <b class="required">*</b></span><select id="tn-defgrade" required>${gradeOptions(d.defGrade)}</select></label></div>
        <p class="help">The drivers swap roles (and robots) after every round: the first Offensive Driver plays offense in rounds 1 and 3, the other driver in round 2.</p>
      </fieldset>
      <div class="t-two"><label class="field"><span>Offensive robot <b class="required">*</b></span><select id="tn-robotoff">${robotOptions(d.robotOff)}</select></label>
      <label class="field"><span>Defensive robot <b class="required">*</b></span><select id="tn-robotdef">${robotOptions(d.robotDef)}</select></label></div>
      <p class="help">These two robots keep their offensive and defensive jobs for the whole match; the drivers switch robots when they switch roles. Any of the three robots can be used for either job.</p>
      <label class="field"><span>Course <b class="required">*</b></span><select id="tn-course">${courseOptions(d.robotOff, d.robotDef, d.course)}</select></label>
      ${picture}
      <fieldset class="t-pair"><legend>Scoring laptops</legend>
        <label class="t-radio"><input type="radio" name="tn-mode" value="sync" ${d.mode === "sync" ? "checked" : ""}> <span><strong>Two laptops, timers synchronized</strong><br><small>One laptop scores the Offensive form and the other the Defensive form. Both timers start at the same moment when both scorers press Ready. Needs the Firebase connection.</small></span></label>
        <label class="t-radio"><input type="radio" name="tn-mode" value="single" ${d.mode === "single" ? "checked" : ""}> <span><strong>One laptop</strong><br><small>Both scorers share this laptop: the Offensive and Defensive forms are shown side by side with one timer.</small></span></label>
        <div id="tn-role-box" ${d.mode === "sync" ? "" : "hidden"}><label class="field"><span>This laptop scores the</span><select id="tn-role"><option value="off" ${d.role === "off" ? "selected" : ""}>Offensive form</option><option value="def" ${d.role === "def" ? "selected" : ""}>Defensive form</option></select></label></div>
      </fieldset>
      <button class="button" type="submit">Create match</button>
    </form></section>
  <section class="panel t-card"><h3>Join a match started on the other laptop</h3>
    <form id="t-join" autocomplete="off"><p class="help">Enter the 6-letter code shown on the other laptop, and choose which form this laptop scores.</p>
      <div class="t-two"><label class="field"><span>Match code</span><input id="tj-code" value="${esc(d.joinCode)}" maxlength="8" style="text-transform:uppercase" autocomplete="off" required></label>
      <label class="field"><span>This laptop scores the</span><select id="tj-role"><option value="off" ${d.joinRole === "off" ? "selected" : ""}>Offensive form</option><option value="def" ${d.joinRole === "def" ? "selected" : ""}>Defensive form</option></select></label></div>
      <button class="button" type="submit">Join match</button><p class="help" id="tj-status"></p></form>
    <hr><details class="t-rules"><summary>Rules that apply to every round</summary>${rulesHtml()}</details></section>
  </div>${admin ? adminToolsHtml() : ""}`;
}
export function rulesHtml() {
	const s = settings();
	return `<ul><li><strong>Checkpoint completion:</strong> a checkpoint counts only when the robot's center point has completely crossed the checkpoint line in the direction of its arrow. Approaching, touching, or partly entering it does not count.</li>
  <li><strong>Order:</strong> G1, then G2, then G3, then the finish zone. A later checkpoint cannot count unless the earlier ones did.</li>
  <li><strong>Course boundaries:</strong> a boundary violation (a penalty) happens when the robot's center point crosses outside the marked field. The Defensive Driver may not enter the offensive starting zone or the no-go buffer around the finish zone.</li>
  <li><strong>Round length:</strong> ${s.duration} seconds. The round ends when time is up or as soon as the Offensive Driver reaches the finish zone; both robots must then be disabled.</li>
  <li><strong>Numerical scores come only from measurable events.</strong> Smoothness, effectiveness and similar observations go in the coach feedback questions and never change the score.</li></ul>`;
}
// Administrators only: the two rankings and pairing suggestions.
function adminToolsHtml() {
	const subs = T.ctx.state.data.submissions;
	const rankTable = (role) => {
		const rows = core.roleRanking(subs, role, settings()).slice(0, 8);
		return `<div class="table-wrap"><table><thead><tr><th>Rank</th><th>Driver</th><th>${settings().rankBasis === "mean" ? "Mean points" : "Ranking score"}</th><th>Rounds</th></tr></thead><tbody>${rows.map((r) => `<tr><td class="rank">#${r.rank}</td><td>${esc(r.name)}</td><td><strong>${pts(r.value)}</strong></td><td>${r.heats}</td></tr>`).join("") || '<tr><td colspan="4" class="empty">No Territory Breakthrough rounds recorded yet.</td></tr>'}</tbody></table></div>`;
	};
	const ratings = core.ratingsFor(subs, settings());
	const known = Object.keys(ratings).sort((a, b) => (ratings[b].offense + ratings[b].defense) - (ratings[a].offense + ratings[a].defense));
	const present = new Set(T.pair.present);
	return `<div class="t-grid" style="margin-top:18px">
  <section class="panel t-card"><h3>Current Offensive ranking</h3>${rankTable("offense")}</section>
  <section class="panel t-card"><h3>Current Defensive ranking</h3>${rankTable("defense")}</section></div>
  <section class="panel t-card" style="margin-top:18px" id="t-pairing"><h3>Suggested pairings</h3>
    <p class="help">Choose who is here today. DriveLab pairs drivers whose offensive AND defensive skill levels are closest, because each plays both roles. The suggestion only fills in the Start a new match boxes; you decide who actually plays. A driver with no recorded rounds yet is treated as average.</p>
    <div class="t-chips">${known.map((n) => `<label class="t-chip"><input type="checkbox" data-present="${esc(n)}" ${present.has(n) ? "checked" : ""}> ${esc(n)} <small>O ${pts(ratings[n].offense)} / D ${pts(ratings[n].defense)}</small></label>`).join("") || '<span class="help">No ranked drivers yet. Add names below.</span>'}</div>
    <label class="field"><span>Other drivers here today (separate names with commas)</span><input id="tp-other" value="${esc(T.pair.other)}" autocomplete="off"></label>
    <div class="toolbox-row"><button type="button" class="button" id="tp-suggest">Suggest pairings</button><button type="button" class="button button-secondary" id="tp-opponent">Suggest an opponent for the Offensive Driver typed above</button></div>
    <div id="tp-result">${pairResultHtml()}</div></section>`;
}
function pairResultHtml() {
	const r = T.pair.result,
		o = T.pair.opponents;
	if (o) return `<p><strong>Closest in skill to ${esc(o.name)}:</strong></p><ul class="t-pairs">${o.list.map((x) => `<li><span>${esc(x.name)} <small>skill gap ${pts(x.gap)}</small></span><button type="button" class="button button-secondary button-small" data-use-pair="${esc(o.name)}|${esc(x.name)}">Use</button></li>`).join("") || "<li>Add more drivers above.</li>"}</ul>`;
	if (!r) return "";
	if (!r.pairs.length) return '<p class="help">Choose at least two drivers.</p>';
	return `<ul class="t-pairs">${r.pairs.map((p) => `<li><span><strong>${esc(p.a)}</strong> vs <strong>${esc(p.b)}</strong> <small>skill gap ${pts(p.gap)} (smaller = closer)</small></span><button type="button" class="button button-secondary button-small" data-use-pair="${esc(p.a)}|${esc(p.b)}">Use this pairing</button></li>`).join("")}</ul>${r.bye ? `<p class="help">${esc(r.bye)} has no partner in this list.</p>` : ""}`;
}
const allPresent = () => [...T.pair.present, ...T.pair.other.split(",")].map((s) => s.trim()).filter(Boolean);

// ---------------------------------------------------------------- Scoring console
function consoleHtml() {
	const m = T.match;
	T.phase = phaseOf(m);
	const people = roundPeople(m);
	const strip = Array.from({ length: core.ROUNDS }, (_, i) => {
		const r = i + 1,
			done = r < m.round || m.status === "complete",
			here = r === m.round && m.status === "active";
		const p = core.roundPlan(r);
		return `<li class="${done ? "done" : here ? "here" : ""}"><b>Round ${r}</b><small>${esc(m.drivers[p.offense])} on offense</small></li>`;
	}).join("");
	const summary = core.matchSummary(recordsFromResults(m), m.drivers);
	const robots = `Offensive robot: <strong>${esc(m.robots.offense)}</strong> &nbsp;&middot;&nbsp; Defensive robot: <strong>${esc(m.robots.defense)}</strong>`;
	const head = `<section class="panel t-card t-head">
    <div class="t-code"><span class="tag">MATCH CODE</span><strong>${esc(m.id)}</strong><small>${m.mode === "sync" ? "Two laptops (synchronized)" : "One laptop"}</small></div>
    <div class="t-who"><p><span class="tag t-off">OFFENSE</span><span><strong>${esc(people.off.name)}</strong> ${esc(people.off.grade || "")}</span></p><p><span class="tag t-def">DEFENSE</span><span><strong>${esc(people.def.name)}</strong> ${esc(people.def.grade || "")}</span></p><p class="help t-meta">${robots}<br>Course: ${esc(m.course ? courseLabel(T.ctx.state.data.courses, m.course) : "Not chosen")} <button type="button" class="button button-secondary button-small" id="t-view-course" ${m.course ? "" : "disabled"}>View course</button></p></div>
    <ol class="t-strip" aria-label="Rounds">${strip}</ol></section>
    ${T.problem ? `<p class="t-alert">${esc(T.problem)}</p>` : ""}`;
	if (m.status === "complete") return `${head}<section class="panel t-card"><h3>Match complete</h3>${summaryHtml(summary, m.drivers)}<div class="t-actions"><button class="button" id="t-finish">Finish and close match</button></div></section>`;
	const roleText = T.role === "both" ? "Both forms (one laptop)" : T.role === "off" ? "Offensive form" : "Defensive form";
	return `${head}<section class="panel t-card t-timerbox"><div class="t-timer-meta"><span class="tag">ROUND ${people.round} OF ${core.ROUNDS}</span><small>This laptop scores: ${roleText}</small>${m.mode === "sync" ? `<small id="t-clock-status">${esc(T.clock)}</small><button type="button" class="button button-secondary button-small" id="t-resync">Re-measure clock</button>` : ""}</div>
    <div class="t-clock" id="t-clock" data-phase="${T.phase}">${clockText(m)}</div>
    <div class="t-start">${startControls(m)}</div></section>
    <div class="t-panels ${T.role === "both" ? "two" : ""}">${rolesHere().map((role) => panelHtml(role, people)).join("")}</div>
    <section class="panel t-card"><h3>Match so far</h3>${summaryHtml(summary, m.drivers)}</section>`;
}
function startControls(m) {
	const phase = phaseOf(m);
	const anySaved = rolesHere().some((r) => entryOf(r).saved) || m.done?.off || m.done?.def;
	if (phase === "waiting") {
		if (m.mode === "single") return `<button class="button t-big" id="t-start">Start round ${m.round} (${settings().countdown}-second countdown)</button>`;
		const mine = m.ready?.[T.role === "def" ? "def" : "off"],
			other = m.ready?.[T.role === "def" ? "off" : "def"];
		return `<button class="button t-big ${mine ? "button-secondary" : ""}" id="t-ready">${mine ? "Not ready (cancel)" : "I'm ready"}</button><p class="help">${mine ? "Waiting for the other scorer. " : "Press when your driver's robot is in place. "}The other scorer is ${other ? "<strong>ready</strong>" : "not ready yet"}. When both are ready, both timers start together after a ${settings().countdown}-second countdown.</p>`;
	}
	if (phase === "countdown") return `<p class="t-banner">Get ready...</p>`;
	if (phase === "running") return `<p class="t-banner">Go! The Offensive scorer records each checkpoint as the robot's center crosses it.</p>`;
	const reason = endedBy(m);
	const text = reason === "finish" ? "Finish reached: the round is over. Both robots must be disabled." : reason === "ended" ? "The round was ended early. Both robots must be disabled." : "Time is up. Both robots must be disabled.";
	return `<p class="t-banner t-stop">${text}</p>${anySaved ? "" : '<div class="t-actions"><button type="button" class="button button-secondary button-small" id="t-restart">Restart this round</button></div>'}`;
}
// One scorer's form: who, the shared checkpoint results, penalties, coach feedback, notes, save.
function panelHtml(role, people) {
	const m = T.match,
		entry = entryOf(role),
		who = people[role];
	const title = role === "off" ? "Offensive form" : "Defensive form";
	const subject = role === "off" ? `Scoring <strong>${esc(who.name)}</strong> (Offensive Driver, ${esc(who.robot)})` : `Scoring <strong>${esc(who.name)}</strong> (Defensive Driver, ${esc(who.robot)}) against <strong>${esc(people.off.name)}</strong>`;
	if (entry.saved) {
		const other = m.done?.[role === "off" ? "def" : "off"];
		return `<section class="panel t-card t-panel" data-role="${role}"><h3>${title}</h3><p class="t-saved">Saved: ${pts(entry.result)} points for ${esc(who.name)}.</p><p class="help">${other ? "Both forms are saved. Moving to the next round..." : role === "off" ? "The checkpoint results are now released to the Defensive scorer. Waiting for their form." : "Waiting for the Offensive scorer to save their form."}</p></section>`;
	}
	const canSave = role === "off" ? phaseOf(m) === "timeup" : Boolean(m.run?.confirmed);
	const waiting = role === "def" && !m.run?.confirmed ? '<p class="help">The Defensive form is saved after the Offensive scorer confirms the checkpoint results. You can fill in the rest while you wait.</p>' : "";
	return `<section class="panel t-card t-panel" data-role="${role}"><h3>${title}</h3><p class="t-sub">${subject}</p>
    <label class="field"><span>Coach / scorer's name <b class="required">*</b></span><input data-e="${role}:scorer" value="${esc(entry.scorer)}" autocomplete="off"></label>
    <h4>Objective results</h4>
    <div id="run-${role}">${runHtml(role)}</div>
    <label class="field"><span>${role === "off" ? "How many penalties did the Offensive Driver receive?" : "How many penalties did the Defensive Driver receive?"}</span><input type="number" min="0" step="1" data-e="${role}:penalties" value="${esc(entry.penalties)}"><small class="help">${role === "def" ? "Did the Defensive Driver receive any penalties? Yes if this is above 0." : "Enter 0 if none."}</small></label>
    <h4>Coach feedback <small>(for coaching only; never part of the score)</small></h4>
    ${feedbackFor(role).map((q) => questionHtml(role, q, entry)).join("")}
    <label class="field"><span>Notes</span><textarea data-e="${role}:notes" maxlength="1000" rows="3">${esc(entry.notes)}</textarea></label>
    ${waiting}<div class="t-actions"><button class="button" type="button" data-save="${role}" ${canSave ? "" : "disabled"}>Save ${title.toLowerCase()} for round ${m.round}</button></div></section>`;
}
// The checkpoint buttons (Offensive form only), the Yes/No + time table, and the live score for one form. Redrawn alone while a round is
// being recorded. Both forms show the SAME official results; only the Offensive form can change them.
function runHtml(role) {
	const m = T.match,
		run = officialRun(m),
		phase = phaseOf(m),
		editable = role === "off" && !m.done?.off;
	const times = ["g1", "g2", "g3", "finishTime"],
		labels = ["G1", "G2", "G3", "the finish zone"];
	const crossed = times.filter((k) => run[k] !== "").length;
	const next = times[crossed];
	const live = phase === "running";
	const subject = role === "off" ? "the robot" : "the Offensive Driver";
	const buttons = editable
		? `<div class="t-gates">${times.map((k, i) => `<button type="button" class="button t-gate" data-gate="${k}" ${live && k === next ? "" : "disabled"}>${i < 3 ? `G${i + 1}` : "Finish"}${run[k] !== "" ? `<small>${one(run[k])} s</small>` : ""}</button>`).join("")}</div>
    <div class="t-actions"><button type="button" class="button button-secondary button-small" data-undo ${crossed ? "" : "disabled"}>Undo last</button><button type="button" class="button button-secondary button-small" id="t-end" ${live ? "" : "disabled"}>End round (robot disabled)</button></div>`
		: "";
	const rows = times
		.map((k, i) => {
			const yes = run[k] !== "";
			const cell = editable
				? `<input type="number" class="t-time" min="0" step="0.1" max="${settings().duration}" data-run="${k}" value="${esc(run[k])}" aria-label="${i < 3 ? `Elapsed time at ${labels[i]} crossing` : "Total time to finish"} (seconds)">`
				: yes ? `${one(run[k])} s` : "--";
			return `<tr><td>Did ${subject} ${role === "off" ? "successfully " : ""}${i < 3 ? `cross ${labels[i]}` : "reach the finish zone"}?</td><td><span class="t-yn ${yes ? "yes" : "no"}">${yes ? "Yes" : "No"}</span></td><td>${cell}</td></tr>`;
		})
		.join("");
	const problems = core.runProblems(run, settings());
	const off = core.offensePoints(run, settings()),
		def = core.defensePoints(run, settings());
	const own = role === "off" ? off.points : def.points;
	const note = editable
		? `Buttons record the elapsed time automatically while the round is running, and the round ends the moment Finish is pressed. You can also type or correct a time (leave it empty if the checkpoint was not crossed). If the finish is not reached the time counts as ${settings().duration} seconds. These results are shared with the Defensive scorer and used for both drivers.`
		: role === "off" ? "These results are saved and shared with the Defensive scorer." : "These are the official results recorded by the Offensive scorer. They appear here as they are recorded and are used for both drivers' scores.";
	return `${buttons}<div class="table-wrap"><table class="t-run"><thead><tr><th>Objective result</th><th>Yes / No</th><th>Elapsed time (s)</th></tr></thead><tbody>${rows}</tbody></table></div>
    <p class="help">${note}</p>
    ${problems.length ? `<p class="t-alert">${esc(problems.join(" "))}</p>` : ""}
    <p class="t-live">Points from the results so far: <strong>${pts(own)}</strong> for the ${role === "off" ? "Offensive" : "Defensive"} Driver <small>(${role === "off" ? `Defensive Driver would get ${pts(def.points)}` : `Offensive Driver would get ${pts(off.points)}`})</small></p>`;
}
function questionHtml(role, q, entry) {
	const id = `${role}:${q.id}`,
		value = entry.answers[q.id];
	const help = q.help ? `<small class="help">${esc(q.help)}</small>` : "";
	let input = "";
	if (q.type === "rating") input = `<div class="t-rating" role="radiogroup">${[1, 2, 3, 4, 5].map((n) => `<label><input type="radio" name="fb-${id}" data-fb="${id}" value="${n}" ${Number(value) === n ? "checked" : ""}><span>${n}</span></label>`).join("")}<small>1 = poor, 5 = excellent</small></div>`;
	else if (q.type === "choice") input = `<select data-fb="${id}"><option value="">Select</option>${q.options.map((o) => `<option ${value === o ? "selected" : ""}>${esc(o)}</option>`).join("")}</select>`;
	else if (q.type === "multi") input = `<div class="checkboxes">${q.options.map((o) => `<label><input type="checkbox" data-fb-multi="${id}" value="${esc(o)}" ${Array.isArray(value) && value.includes(o) ? "checked" : ""}> ${esc(o)}</label>`).join("")}</div>`;
	else {
		// Example responses are shown as grey placeholder text INSIDE the box: they disappear as soon as anything is typed, and a
		// placeholder is never part of the saved answer, the score, or the Analysis.
		const hint = q.examples?.length ? `For example:\n${q.examples.map((e) => `\u2022 ${e}`).join("\n")}` : "";
		input = `<textarea rows="${q.examples?.length ? 5 : 3}" maxlength="600" data-fb="${id}" placeholder="${esc(hint)}">${esc(value || "")}</textarea>`;
	}
	return `<div class="t-q"><span class="t-q-label">${esc(q.label)}</span>${input}${help}</div>`;
}

// ================================================================= events
export function bindTerritory(ctx) {
	T.ctx = ctx;
	const root = document.querySelector("#t-root");
	if (!root) return;
	document.querySelector("#t-explain")?.addEventListener("toggle", (e) => (T.explainerOpen = e.target.open));
	document.querySelector("#t-leave")?.addEventListener("click", () => {
		if (!confirm("Leave this match? You can rejoin a two-laptop match with its code.")) return;
		leaveMatch();
	});
	document.querySelector("#t-edit-forms")?.addEventListener("click", () => ctx.openTerritoryForms?.());
	if (!T.match) return bindManager(root);
	bindConsole(root);
}
function bindManager(root) {
	const ctx = T.ctx;
	const d = T.draft;
	const val = (id) => root.querySelector(id)?.value ?? "";
	const keep = () => {
		Object.assign(d, {
			date: val("#tn-date"), off: val("#tn-off"), offGrade: val("#tn-offgrade"), def: val("#tn-def"), defGrade: val("#tn-defgrade"),
			robotOff: val("#tn-robotoff"), robotDef: val("#tn-robotdef"), course: val("#tn-course"), role: val("#tn-role") || d.role,
			mode: root.querySelector('[name="tn-mode"]:checked')?.value || d.mode, joinCode: val("#tj-code"), joinRole: val("#tj-role") || d.joinRole,
		});
	};
	root.addEventListener("input", keep);
	root.addEventListener("change", (e) => {
		keep();
		if (e.target.id === "tn-robotoff" || e.target.id === "tn-robotdef") {
			root.querySelector("#tn-course").innerHTML = courseOptions(d.robotOff, d.robotDef, d.course);
			keep();
		}
		if (e.target.id === "tn-course") ctx.render();
		if (e.target.name === "tn-mode") root.querySelector("#tn-role-box").hidden = d.mode !== "sync";
		if (e.target.dataset.present !== undefined) {
			T.pair.present = [...root.querySelectorAll("[data-present]:checked")].map((x) => x.dataset.present);
		}
	});
	root.querySelector("#t-new").onsubmit = async (e) => {
		e.preventDefault();
		keep();
		const names = [d.off.trim(), d.def.trim()];
		if (names.some((n) => !n)) return ctx.toast("Enter both drivers' names.");
		if (names[0].toLowerCase() === names[1].toLowerCase()) return ctx.toast("The two drivers must be different people.");
		if (!d.offGrade || !d.defGrade) return ctx.toast("Choose both drivers' grade levels.");
		if (d.robotOff === d.robotDef) return ctx.toast("Choose two different robots (one offensive, one defensive).");
		const available = publishedCourses(ctx.state.data.courses, "defense").some((c) => {
			const allowed = ctx.state.data.courses[c.key]?.robots;
			return !allowed?.length || (allowed.includes(d.robotOff) && allowed.includes(d.robotDef));
		});
		if (available && !d.course) return ctx.toast("Choose the course.");
		if (d.mode === "sync" && !ctx.store.isRemote()) ctx.toast("No Firebase connection here: the two laptops will only sync between tabs of this browser.");
		const role = d.mode === "single" ? "both" : d.role;
		const match = makeMatch({ code: newCode(), date: d.date, mode: d.mode, first: { off: names[0], def: names[1], offGrade: d.offGrade, defGrade: d.defGrade }, course: d.course, robotOff: d.robotOff, robotDef: d.robotDef, role });
		try {
			if (match.mode === "sync") {
				let made = false;
				for (let i = 0; i < 5 && !made; i++) {
					try {
						await ctx.store.createMatch(match);
						made = true;
					} catch (error) {
						if (!/already in use/.test(error.message)) throw error;
						match.id = newCode();
					}
				}
				if (!made) throw new Error("Could not find a free match code.");
			}
			await enterMatch(match, role, { fresh: true });
		} catch (error) {
			ctx.toast(`Could not create the match: ${error.message}`);
		}
	};
	root.querySelector("#t-join").onsubmit = async (e) => {
		e.preventDefault();
		keep();
		const code = d.joinCode.trim().toUpperCase();
		const status = root.querySelector("#tj-status");
		status.textContent = "Looking for the match...";
		try {
			const match = await ctx.store.getMatch(code);
			if (!match) {
				status.textContent = "No match with that code was found. Check the code on the other laptop.";
				return;
			}
			if (match.mode !== "sync") {
				status.textContent = "That match is a one-laptop match; it can only be scored on the laptop that started it.";
				return;
			}
			await enterMatch(match, d.joinRole);
		} catch (error) {
			status.textContent = `Could not join: ${error.message}`;
		}
	};
	// Administrator pairing tools
	root.querySelector("#tp-suggest")?.addEventListener("click", () => {
		T.pair.other = root.querySelector("#tp-other").value;
		const names = allPresent();
		T.pair.opponents = null;
		T.pair.result = core.suggestPairings(names, core.ratingsFor(ctx.state.data.submissions, settings()), settings());
		root.querySelector("#tp-result").innerHTML = pairResultHtml();
		bindUsePair(root);
	});
	root.querySelector("#tp-opponent")?.addEventListener("click", () => {
		T.pair.other = root.querySelector("#tp-other").value;
		const name = root.querySelector("#tn-off").value.trim();
		if (!name) return ctx.toast("Type the Offensive Driver's name first.");
		const ratings = core.ratingsFor(ctx.state.data.submissions, settings());
		const pool = [...allPresent(), ...(allPresent().length ? [] : Object.keys(ratings))];
		T.pair.result = null;
		T.pair.opponents = { name, list: core.closestOpponents(name, pool, ratings, settings()) };
		root.querySelector("#tp-result").innerHTML = pairResultHtml();
		bindUsePair(root);
	});
	bindUsePair(root);
}
function bindUsePair(root) {
	root.querySelectorAll("[data-use-pair]").forEach((b) => (b.onclick = () => {
		const [a, c] = b.dataset.usePair.split("|");
		const ratings = core.ratingsFor(T.ctx.state.data.submissions, settings());
		const gradeOf = (n) => ratings[n]?.grade || "";
		// The driver with the higher offensive rating starts on offense.
		const [first, second] = core.ratingOf(ratings, a, settings()).offense >= core.ratingOf(ratings, c, settings()).offense ? [a, c] : [c, a];
		Object.assign(T.draft, { off: first, offGrade: gradeOf(first) || T.draft.offGrade, def: second, defGrade: gradeOf(second) || T.draft.defGrade });
		T.ctx.render();
		T.ctx.toast(`${first} and ${second} filled in. Check the boxes, then create the match.`);
	}));
}
function bindConsole(root) {
	const m = T.match;
	document.querySelector("#t-start")?.addEventListener("click", startSingle);
	document.querySelector("#t-ready")?.addEventListener("click", toggleReady);
	document.querySelector("#t-restart")?.addEventListener("click", restartRound);
	document.querySelector("#t-end")?.addEventListener("click", endRound);
	document.querySelector("#t-resync")?.addEventListener("click", () => measureClock(T.role === "def" ? "def" : "off"));
	document.querySelector("#t-finish")?.addEventListener("click", () => leaveMatch());
	document.querySelector("#t-view-course")?.addEventListener("click", () => {
		const course = T.ctx.state.data.courses[m.course];
		if (!course) return;
		const model = courseModel(course);
		T.ctx.content.innerHTML = `<div class="modal-head"><div><p class="eyebrow">COURSE</p><h2>${esc(courseLabel(T.ctx.state.data.courses, m.course))}</h2></div><button class="close" id="close-modal">\u00d7</button></div><div class="course-large">${courseSvg(model, "Course", "defense")}</div>${courseKeyHtml(model, "defense")}`;
		T.ctx.openModal({ wide: true });
		document.querySelector("#close-modal").onclick = () => T.ctx.modal.close();
	});
	// Fields typed into (delegated, so redrawing a panel never loses the handlers)
	root.addEventListener("input", (e) => {
		const t = e.target;
		if (t.dataset.e) {
			const [role, field] = t.dataset.e.split(":");
			entryOf(role)[field] = t.value;
			if (field === "scorer") T.scorerName[role] = t.value;
		}
		if (t.dataset.fb) {
			const [role, id] = t.dataset.fb.split(":");
			entryOf(role).answers[id] = t.type === "radio" ? Number(t.value) : t.value;
		}
	});
	root.addEventListener("change", (e) => {
		const t = e.target;
		if (t.dataset.run !== undefined) {
			// A typed correction of a shared checkpoint result (Offensive form only)
			const field = t.dataset.run;
			update({ [`run.${field}`]: t.value === "" ? "" : Number(t.value) });
		}
		if (t.dataset.fbMulti) {
			const [role, id] = t.dataset.fbMulti.split(":");
			entryOf(role).answers[id] = [...root.querySelectorAll(`[data-fb-multi="${role}:${id}"]:checked`)].map((x) => x.value);
		}
	});
	root.addEventListener("click", (e) => {
		const gate = e.target.closest("[data-gate]");
		if (gate) return recordGate(gate.dataset.gate);
		if (e.target.closest("[data-undo]")) {
			const run = officialRun();
			const last = ["finishTime", "g3", "g2", "g1"].find((k) => run[k] !== "");
			if (last) update(last === "finishTime" ? { "run.finishTime": "", endAt: null } : { [`run.${last}`]: "" });
			return;
		}
		const save = e.target.closest("[data-save]");
		if (save) saveEntry(save.dataset.save);
	});
}
