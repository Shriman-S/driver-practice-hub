// Territory Breakthrough in the Analysis page (administrators) and the editor for the two scorer forms' coach-feedback questions.
//   - view "territory": both leaderboards, every match with its round-by-round result, checkpoint statistics.
//   - views "offense" / "defense": one role's leaderboard (mean points), checkpoint completion, coach-rating averages, every attempt.
// Rankings use the MEAN of a driver's points in a role (core.roleRanking). Attempts recorded before Release 1.6 are not included.
import { esc, dateText } from "./util.js";
import * as core from "./territorycore.js";
import { summaryHtml } from "./territory.js";

const pts = (n) => (Number.isFinite(Number(n)) ? String(Math.round(Number(n) * 10) / 10) : "--");
const tile = (label, value) => `<div class="metric panel"><p>${label}</p><strong>${value}</strong></div>`;
const link = (name) => `<button class="driver-link" data-driver-detail="${esc(name)}">${esc(name)}</button>`;
export const territoryOnly = (subs) => subs.filter(core.isTerritory);
export const legacyCount = (subs) => subs.filter((x) => (x.facet === "offense" || x.facet === "defense") && !core.isTerritory(x)).length;

function leaderboard(subs, role, settings) {
	const rows = core.roleRanking(subs, role, settings);
	const byValue = settings.rankBasis !== "mean";
	const body = rows.map((r) => {
		const s = core.roleStats(r.list, settings);
		return `<tr><td class="rank">#${r.rank}</td><td>${link(r.name)}</td><td>${esc(r.grade)}</td><td>${r.heats}</td>${byValue ? `<td><strong>${pts(r.value)}</strong></td><td>${pts(r.mean)}</td>` : `<td><strong>${pts(r.mean)}</strong></td>`}<td>${pts(r.best)}</td><td>${s.avgGates ?? "--"}</td><td>${s.finishRate}%</td><td>${s.avgFinish ?? "--"}</td></tr>`;
	}).join("");
	return `<div class="table-wrap"><table><thead><tr><th>Rank</th><th>Driver</th><th>Grade</th><th>Rounds</th>${byValue ? `<th title="What the rank is based on: ${esc(core.RANK_BASES[settings.rankBasis].label)}">Ranking score</th><th>Mean points</th>` : `<th title="Mean points in this role, out of ${core.pool(settings)}">Mean points</th>`}<th>Best</th><th>Avg gates</th><th>Finish rate</th><th>Avg finish (s)</th></tr></thead><tbody>${body || `<tr><td colspan="9" class="empty">No ${role} rounds recorded yet.</td></tr>`}</tbody></table></div>`;
}
function checkpointTable(list, settings, view) {
	const s = core.roleStats(list, settings);
	const runs = list.map((x) => core.readRun(x.data, settings));
	const avgTime = (i) => {
		const t = runs.filter((r) => r.gates > i).map((r) => r.times[i]);
		return t.length ? `${(Math.round((t.reduce((a, b) => a + b, 0) / t.length) * 10) / 10).toFixed(1)} s` : "--";
	};
	const rows = ["G1", "G2", "G3"].map((g, i) => `<tr><td>${g}</td><td>${s.gateRates[i]}% of rounds</td><td>${avgTime(i)}</td></tr>`).join("");
	return `<div class="table-wrap"><table><thead><tr><th>Checkpoint</th><th>Crossed in</th><th>Average time when crossed</th></tr></thead><tbody>${rows}<tr><td>Finish zone</td><td>${s.finishRate}% of rounds</td><td>${s.avgFinish !== null ? `${s.avgFinish} s` : "--"}</td></tr></tbody></table></div><p class="help">${s.penalties} regular penalt${s.penalties === 1 ? "y" : "ies"}${view === "defense" ? ` and ${s.pinning} pinning penalt${s.pinning === 1 ? "y" : "ies"}` : ""} recorded in ${s.heats} round${s.heats === 1 ? "" : "s"}.</p>`;
}
const legacyNote = (subs) => (legacyCount(subs) ? `<p class="help">${legacyCount(subs)} Offensive / Defensive attempt${legacyCount(subs) === 1 ? "" : "s"} recorded before Release 1.7 (including the short-lived two-heat format) stay in the database but are not shown or ranked, because they were scored on a different basis.</p>` : "");

export function territoryAnalysisHtml(state, view, attemptsSection) {
	const settings = state.scoring.territory;
	const all = state.data.submissions;
	const subs = territoryOnly(all);
	if (view === "offense" || view === "defense") {
		const list = subs.filter((x) => x.facet === view);
		const rows = core.roleRanking(subs, view, settings);
		const mean = list.length ? list.reduce((a, x) => a + Number(x.score.points), 0) / list.length : null;
		const name = view === "offense" ? "Offensive" : "Defensive";
		return `<div class="metrics">${tile("Rounds", list.length)}${tile("Drivers", rows.length)}${tile("Mean points", mean === null ? "--" : pts(mean))}${tile("Top driver", rows[0] ? `${esc(rows[0].name)} <small>${pts(rows[0].value)}</small>` : "--")}</div>
  <section class="panel analysis-panel" style="margin-bottom:18px"><div class="panel-heading"><div><h3>Territory Breakthrough: ${name} rankings</h3><p>Drivers ranked by their mean ${name.toLowerCase()} points (out of ${core.pool(settings)}) across all their rounds.</p></div></div>${leaderboard(subs, view, settings)}${legacyNote(all)}</section>
  <section class="panel analysis-panel" style="margin-bottom:18px"><div class="panel-heading"><div><h3>${view === "offense" ? "Checkpoint completion" : "How far the Offensive Driver got against this defense"}</h3></div></div>${checkpointTable(list, settings, view)}</section>
  ${attemptsSection({ scope: view, list, title: `${name} rounds`, note: "Most recent first. Checkpoint times, penalties, and each round's points. Edit corrects a recorded time." })}`;
	}
	const matches = core.groupMatches(subs);
	const rowsM = matches.map((m) => {
		const names = m.drivers;
		const s = core.matchSummary(m.records, names);
		const result = s.winner ? (s.winner === "draw" ? "Draw" : `${esc(names[s.winner])} (${s.wins[s.winner]}-${s.wins[s.winner === "A" ? "B" : "A"]})`) : `In progress (${s.done}/3 rounds)`;
		return `<tr><td class="nowrap">${dateText(m.date)}</td><td>${link(names.A)} vs ${link(names.B)}</td><td>${s.wins.A}-${s.wins.B}</td><td>${result}</td><td><button type="button" class="button button-secondary button-small" data-match-detail="${esc(m.id)}">Rounds</button></td></tr>`;
	}).join("");
	const drivers = new Set(subs.map((x) => x.driverName)).size;
	return `<div class="metrics">${tile("Matches", matches.length)}${tile("Rounds recorded", Math.floor(subs.length / 2))}${tile("Drivers", drivers)}${tile("Forms saved", subs.length)}</div>
  <div class="t-grid"><section class="panel analysis-panel"><div class="panel-heading"><div><h3>Offensive rankings</h3></div></div>${leaderboard(subs, "offense", settings)}</section>
  <section class="panel analysis-panel"><div class="panel-heading"><div><h3>Defensive rankings</h3></div></div>${leaderboard(subs, "defense", settings)}</section></div>${legacyNote(all)}
  <section class="panel analysis-panel" style="margin-top:18px"><div class="panel-heading"><div><h3>Matches</h3><p>Best of 3 rounds. Each round is one 60-second run; the driver with more points wins the round.</p></div></div><div class="table-wrap"><table><thead><tr><th>Date</th><th>Drivers (round 1 offense vs defense)</th><th>Rounds</th><th>Winner</th><th></th></tr></thead><tbody>${rowsM || '<tr><td colspan="5" class="empty">No matches recorded yet.</td></tr>'}</tbody></table></div></section>`;
}
export function bindTerritoryAnalysis(ctx) {
	document.querySelectorAll("[data-match-detail]").forEach((b) => (b.onclick = () => {
		const m = core.groupMatches(territoryOnly(ctx.state.data.submissions)).find((x) => x.id === b.dataset.matchDetail);
		if (!m) return;
		ctx.content.innerHTML = `<div class="modal-head"><div><p class="eyebrow">MATCH ${esc(m.id)}</p><h2>${esc(m.drivers.A)} vs ${esc(m.drivers.B)}</h2><p class="help">${dateText(m.date)}</p></div><button class="close" id="close-modal">\u00d7</button></div>${summaryHtml(core.matchSummary(m.records, m.drivers), m.drivers)}`;
		ctx.openModal({ wide: true });
		document.querySelector("#close-modal").onclick = () => ctx.modal.close();
	}));
}

// ---------------------------------------------------------------- scorer form editor (administrators)
// The objective checkpoint questions are fixed (the score is calculated from them). The coach-feedback questions can be reworded,
// reordered, removed and added. The edited list is saved as customForms/builtin-territory-<role>.
export function territoryFormsPanelHtml(state) {
	const row = (role, name) => {
		const saved = state.data.customForms.find((f) => f.id === core.territoryFormId(role));
		const n = core.feedbackQuestions(saved, role).length;
		return `<div class="custom-item"><span><strong>Territory Breakthrough: ${name} form</strong> <span class="drill-status${saved ? " edited" : ""}">${saved ? "Edited" : "Original form"}</span><br><small>Fixed checkpoint questions | ${n} coach feedback question${n === 1 ? "" : "s"}</small></span><span class="item-actions"><button class="button button-secondary button-small" data-tform-edit="${role}">Edit</button>${saved ? `<button class="button button-secondary button-small" data-tform-restore="${role}">Restore original</button>` : ""}</span></div>`;
	};
	return `<section class="panel form-panel" style="margin-top:18px"><div class="panel-heading"><div><h3>Offensive / Defensive forms (Territory Breakthrough)</h3><p>Used on the Offense / Defense page. The checkpoint results are fixed because they calculate the score; the coach feedback questions can be changed.</p></div></div><div class="custom-list">${row("offense", "Offensive")}${row("defense", "Defensive")}</div></section>`;
}
export function bindTerritoryForms(ctx) {
	document.querySelectorAll("[data-tform-edit]").forEach((b) => (b.onclick = () => openFormEditor(ctx, b.dataset.tformEdit)));
	document.querySelectorAll("[data-tform-restore]").forEach((b) => (b.onclick = async () => {
		if (!confirm("Restore the original coach feedback questions? Recorded answers are kept.")) return;
		const id = core.territoryFormId(b.dataset.tformRestore);
		await ctx.store.removeRecord("customForms", id);
		ctx.state.data.customForms = ctx.state.data.customForms.filter((f) => f.id !== id);
		ctx.render();
	}));
}
export function openFormEditor(ctx, role) {
	const saved = ctx.state.data.customForms.find((f) => f.id === core.territoryFormId(role));
	const qs = core.feedbackQuestions(saved, role).map((q) => ({ ...q }));
	const draw = () => {
		ctx.content.innerHTML = `<div class="modal-head"><div><p class="eyebrow">EDIT FORM</p><h2>${role === "offense" ? "Offensive" : "Defensive"} form: coach feedback</h2></div><button class="close" id="close-modal">\u00d7</button></div>
    <p class="help">The checkpoint questions (G1, G2, G3, finish, penalties) are fixed. Changes apply to rounds recorded from now on.</p>
    <div id="tf-list">${qs.map((q, i) => `<div class="custom-item tf-q" data-i="${i}"><div style="flex:1"><label class="field"><span>Question</span><input data-f="label" value="${esc(q.label)}"></label>
      <div class="t-two"><label class="field"><span>Answer type</span><select data-f="type">${Object.entries(core.FEEDBACK_TYPES).map(([k, v]) => `<option value="${k}" ${q.type === k ? "selected" : ""}>${v}</option>`).join("")}</select></label>
      <label class="field"><span>Hint (optional)</span><input data-f="help" value="${esc(q.help || "")}"></label></div>
      ${q.type === "choice" || q.type === "multi" ? `<label class="field"><span>Choices (one per line)</span><textarea rows="3" data-f="options">${esc((q.options || []).join("\n"))}</textarea></label>` : ""}${q.type === "paragraph" ? `<label class="field"><span>Example responses (one per line, shown in grey inside the box until the scorer types)</span><textarea rows="3" data-f="examples">${esc((q.examples || []).join("\n"))}</textarea></label>` : ""}</div>
      <span class="item-actions"><button type="button" class="button button-secondary button-small" data-up="${i}" ${i ? "" : "disabled"}>Up</button><button type="button" class="button button-secondary button-small" data-down="${i}" ${i < qs.length - 1 ? "" : "disabled"}>Down</button><button type="button" class="button button-danger button-small" data-del="${i}">Remove</button></span></div>`).join("")}</div>
    <div class="toolbox-row"><button type="button" class="button button-secondary" id="tf-add">Add question</button><button type="button" class="button" id="tf-save">Save form</button></div>`;
		document.querySelector("#close-modal").onclick = () => ctx.modal.close();
		const read = () => document.querySelectorAll(".tf-q").forEach((row) => {
			const q = qs[Number(row.dataset.i)];
			row.querySelectorAll("[data-f]").forEach((el) => {
				q[el.dataset.f] = el.dataset.f === "options" || el.dataset.f === "examples" ? el.value.split(/\r?\n/).map((s) => s.trim()).filter(Boolean) : el.value;
			});
		});
		document.querySelectorAll('[data-f="type"]').forEach((el) => (el.onchange = () => { read(); draw(); }));
		document.querySelectorAll("[data-up]").forEach((b) => (b.onclick = () => { read(); const i = Number(b.dataset.up); [qs[i - 1], qs[i]] = [qs[i], qs[i - 1]]; draw(); }));
		document.querySelectorAll("[data-down]").forEach((b) => (b.onclick = () => { read(); const i = Number(b.dataset.down); [qs[i + 1], qs[i]] = [qs[i], qs[i + 1]]; draw(); }));
		document.querySelectorAll("[data-del]").forEach((b) => (b.onclick = () => { read(); qs.splice(Number(b.dataset.del), 1); draw(); }));
		document.querySelector("#tf-add").onclick = () => { read(); qs.push({ id: `q${Date.now().toString(36)}`, type: "paragraph", label: "", help: "", options: [], examples: [] }); draw(); };
		document.querySelector("#tf-save").onclick = async () => {
			read();
			if (qs.some((q) => !q.label.trim())) return ctx.toast("Every question needs wording.");
			if (qs.some((q) => (q.type === "choice" || q.type === "multi") && q.options.length < 2)) return ctx.toast("Choice questions need at least two choices.");
			const form = { id: core.territoryFormId(role), builtin: `territory-${role}`, title: `Territory Breakthrough ${role} form`, feedback: qs.map((q) => ({ id: q.id, type: q.type, label: q.label.trim(), help: (q.help || "").trim(), options: q.options || [], examples: q.type === "paragraph" ? q.examples || [] : [] })), updatedAt: new Date().toISOString() };
			try {
				await ctx.store.saveRecord("customForms", form);
				const list = ctx.state.data.customForms;
				const at = list.findIndex((f) => f.id === form.id);
				at < 0 ? list.push(form) : (list[at] = form);
				ctx.modal.close();
				ctx.render();
				ctx.toast("Form saved.");
			} catch (error) {
				ctx.toast(`Could not save: ${error.message}`);
			}
		};
	};
	draw();
	ctx.openModal({ wide: true });
}

// ---------------------------------------------------------------- correcting a recorded round (administrators)
// Edits the measured facts of one saved form (names, checkpoint times, penalties, notes); the score is recalculated from them.
export function openEditTerritoryAttempt(api, id) {
	const { state, content, modal } = api;
	const x = state.data.submissions.find((s) => s.id === id);
	if (!x) return;
	const d = x.data || {};
	const field = (key, label, value, extra = "") => `<label class="field"><span>${label}</span><input data-k="${key}" value="${esc(value ?? "")}" ${extra}></label>`;
	content.innerHTML = `<div class="modal-head"><div><p class="eyebrow">EDIT ${x.facet === "offense" ? "OFFENSIVE" : "DEFENSIVE"} FORM</p><h2>${esc(x.driverName)}, round ${esc(d.round)}</h2></div><button class="close" id="close-modal">\u00d7</button></div>
  <div class="t-two">${field("driverName", "Driver name", x.driverName)}${field("grade", "Grade", x.grade)}</div>
  <div class="t-two">${field("g1", "G1 time (s), empty = not crossed", d.g1, 'type="number" step="0.1" min="0"')}${field("g2", "G2 time (s)", d.g2, 'type="number" step="0.1" min="0"')}${field("g3", "G3 time (s)", d.g3, 'type="number" step="0.1" min="0"')}${field("finishTime", "Finish time (s)", d.finishTime, 'type="number" step="0.1" min="0"')}</div>
  ${field("penalties", "Regular penalties", d.penalties ?? 0, 'type="number" min="0" step="1"')}${x.facet === "defense" ? field("pinningPenalties", "Pinning penalties", d.pinningPenalties ?? 0, 'type="number" min="0" step="1"') : ""}
  <label class="field"><span>Notes</span><textarea data-k="notes" rows="2">${esc(d.notes || "")}</textarea></label>
  <p class="help" id="te-msg"></p><div class="form-actions"><button class="button button-secondary" id="te-cancel">Cancel</button><button class="button" id="te-save">Save changes</button></div>`;
	api.modal.showModal?.();
	if (!modal.open) modal.showModal();
	const get = () => Object.fromEntries([...content.querySelectorAll("[data-k]")].map((el) => [el.dataset.k, el.value]));
	const draftOf = (v) => ({ ...d, g1: v.g1 === "" ? "" : Number(v.g1), g2: v.g2 === "" ? "" : Number(v.g2), g3: v.g3 === "" ? "" : Number(v.g3), finishTime: v.finishTime === "" ? "" : Number(v.finishTime), penalties: Number(v.penalties) || 0, pinningPenalties: x.facet === "defense" ? Number(v.pinningPenalties) || 0 : 0, notes: v.notes });
	content.querySelector("#close-modal").onclick = content.querySelector("#te-cancel").onclick = () => modal.close();
	content.querySelector("#te-save").onclick = async () => {
		const v = get();
		const data = draftOf(v);
		const problems = core.runProblems(data, state.scoring.territory);
		if (problems.length) return (content.querySelector("#te-msg").textContent = problems[0]);
		const run = core.readRun(data, state.scoring.territory);
		data.gatesCrossed = run.gates;
		data.finished = run.finished;
		const item = { ...x, driverName: v.driverName.trim() || x.driverName, grade: v.grade || x.grade, data, original: x.original || { driverName: x.driverName, grade: x.grade, data: d }, editedAt: new Date().toISOString() };
		try {
			await api.store.saveRecord("submissions", item);
		} catch (error) {
			return (content.querySelector("#te-msg").textContent = `Could not save: ${error.message}`);
		}
		state.data.submissions = state.data.submissions.map((s) => (s.id === id ? item : s));
		api.applyScoring();
		modal.close();
		api.render();
		api.toast("Round updated and re-scored.");
	};
}

// ---------------------------------------------------------------- reading one Offensive / Defensive form's responses
// A round has about a dozen answers, far too many for table cells, so the tables show a short summary and this viewer shows the
// whole form laid out for reading: the objective results, then each coach feedback question with its answer (ratings as a row of
// 1-5 dots, choices as chips, paragraphs as quoted blocks), then the notes.
const questionsOf = (state, x) => core.feedbackQuestions(state.data.customForms.find((f) => f.id === core.territoryFormId(x.facet)), x.facet);
const has = (v) => v !== undefined && v !== null && v !== "" && !(Array.isArray(v) && !v.length);
export function territorySummaryCell(state, x) {
	const d = x.data || {};
	const qs = questionsOf(state, x);
	const ratings = qs.filter((q) => q.type === "rating" && has(d.answers?.[q.id])).map((q) => Number(d.answers[q.id]));
	const comments = qs.filter((q) => q.type === "paragraph" && has(d.answers?.[q.id])).length;
	const pill = (t, cls = "") => `<span class="resp-pill ${cls}">${t}</span>`;
	const run = core.readRun(d, state.scoring.territory);
	return `<td class="resp-cell"><div class="resp-pills">${pill(`${run.gates}/3 gates`)}${pill(run.finished ? `Finished ${run.finishTime} s` : "No finish", run.finished ? "good" : "")}${ratings.length ? pill(`Avg rating ${(ratings.reduce((a, b) => a + b, 0) / ratings.length).toFixed(1)}/5`) : ""}${comments ? pill(`${comments} comment${comments === 1 ? "" : "s"}`) : ""}</div><button type="button" class="button button-secondary button-small" data-view-responses="${esc(x.id)}">View responses</button></td>`;
}
export function openTerritoryResponses(api, id) {
	const { state, content, modal } = api;
	const x = state.data.submissions.find((s) => s.id === id);
	if (!x) return;
	const d = x.data || {};
	const run = core.readRun(d, state.scoring.territory);
	const role = x.facet === "offense" ? "Offensive" : "Defensive";
	const meta = [["Driver", x.driverName + (x.grade ? `, ${x.grade}` : "")], ["Opponent", [d.opponentName, d.opponentGrade].filter(Boolean).join(", ") || "--"], ["Round", d.round ? `${d.round} of ${core.ROUNDS}` : "--"], ["Robot", d.robot || "--"], ["Scorer", d.scorer || "--"], ["Points", `${pts(x.score?.points)} of ${core.pool(state.scoring.territory)}`]];
	const cps = [["G1", d.g1], ["G2", d.g2], ["G3", d.g3], ["Finish zone", d.finishTime]].map(([n, v]) => `<tr><td>${n}</td><td><span class="t-yn ${has(v) ? "yes" : "no"}">${has(v) ? "Yes" : "No"}</span></td><td>${has(v) ? `${esc(v)} s` : "--"}</td></tr>`).join("");
	const answer = (q) => {
		const v = d.answers?.[q.id];
		if (!has(v)) return '<span class="resp-none">No answer</span>';
		if (q.type === "rating") return `<span class="resp-dots" aria-label="${v} out of 5">${[1, 2, 3, 4, 5].map((n) => `<i class="${n <= Number(v) ? "on" : ""}"></i>`).join("")}</span> <strong>${esc(v)}</strong> / 5`;
		if (q.type === "multi") return (Array.isArray(v) ? v : [v]).map((o) => `<span class="resp-pill">${esc(o)}</span>`).join(" ");
		if (q.type === "paragraph") return `<blockquote class="resp-quote">${esc(v)}</blockquote>`;
		return `<span class="resp-pill">${esc(v)}</span>`;
	};
	const qs = questionsOf(state, x);
	const group = (title, list) => (list.length ? `<h4>${title}</h4>${list.map((q) => `<div class="resp-item"><span class="resp-q">${esc(q.label)}</span><div>${answer(q)}</div></div>`).join("")}` : "");
	content.innerHTML = `<div class="modal-head"><div><p class="eyebrow">${role.toUpperCase()} FORM</p><h2>${esc(x.driverName)}, ${dateText(x.date)}</h2></div><button class="close" id="close-modal">\u00d7</button></div>
  <div class="resp-view"><dl class="resp-meta">${meta.map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join("")}</dl>
  <h4>Objective results</h4><div class="table-wrap"><table class="t-run"><thead><tr><th>Checkpoint</th><th>Crossed</th><th>Elapsed time</th></tr></thead><tbody>${cps}</tbody></table></div>
  <p class="help">${run.gates}/3 checkpoints, ${run.finished ? "finished" : "did not finish"}. Penalties: ${esc(d.penalties ?? 0)} regular${x.facet === "defense" ? `, ${esc(d.pinningPenalties ?? 0)} pinning` : ""}.</p>
  ${group("Ratings", qs.filter((q) => q.type === "rating"))}${group("Observations", qs.filter((q) => q.type === "choice" || q.type === "multi"))}${group("Written feedback", qs.filter((q) => q.type === "paragraph"))}
  ${has(d.notes) ? `<h4>Notes</h4><blockquote class="resp-quote">${esc(d.notes)}</blockquote>` : ""}
  <p class="help">Coach feedback is for coaching only and never changes the score.</p></div>`;
	content.querySelector("#close-modal").onclick = () => modal.close();
	if (!modal.open) modal.showModal();
}
