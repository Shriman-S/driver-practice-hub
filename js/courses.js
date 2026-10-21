// Course layouts: the administrator's grid painter (Course builder page) and the Courses page everyone can view.
//
// A course is a grid of cells that are either empty (0) or wall (1), plus optional markers and robot paths drawn on top. It is saved as
//   { name, cols, rows,
//     grid:  ["0010...", "0000...", ...],                     one string of 0/1 characters per row (walls)
//     start: { col, row } | null,                             green circle: where drivers start
//     end:   { col, row } | null,                             red square: where drivers finish
//     paths: [ { lap: 1, points: ["5,5", "20,5", ...] }, ... ],  the route drivers follow; each point is "column,row"
//     updatedAt }
// Firestore cannot store an array inside an array, so rows are strings and each path point is a "column,row" string.
// Speed driving courses can have a path for Lap 1 and a separate path for Lap 2; every other drill has a single Robot path (lap 1).
// Courses are saved under the id "<group>-<number>", for example "speed-1" or "defense-3" (defense and offense share their courses).
import { esc } from "./util.js";

export const COURSE_COLS = 48; // a 2:1 field: 48 columns by 24 rows
export const COURSE_ROWS = 24;
export const COURSE_GROUPS = [
	{ key: "speed", label: "Speed driving", note: "Independent course" },
	{
		key: "defense",
		label: "Defensive + Offensive driving",
		note: "Shared by the paired drill",
	},
	{ key: "shooting", label: "Shooting only", note: "Independent course" },
];
export const courseKey = (group, number) => `${group}-${number}`;
const groupOf = (key) =>
	COURSE_GROUPS.find((g) => g.key === key) || COURSE_GROUPS[0];
const hasLaps = (group) => group === "speed"; // only Speed driving courses have a Lap 1 and a Lap 2 path

// ---------------------------------------------------------------- course choices (shared by the forms, Analysis, and Scoring settings)
// The courses that exist for one course family, in slot order: [{ key: "speed-1", number: 1, name: "Cone weave" }, ...].
// A course "exists" once it has been saved in the Course builder (it then appears on the Courses page).
export function publishedCourses(courses = {}, group) {
	return [1, 2, 3]
		.map((number) => ({ key: courseKey(group, number), number }))
		.filter((c) => courses[c.key])
		.map((c) => ({ ...c, name: courses[c.key].name || `${groupOf(group).label} Course ${c.number}` }));
}
// Display name for a saved course answer ("speed-2"). A course that has since been deleted is still named, so old attempts stay readable.
export function courseLabel(courses = {}, key) {
	if (!key) return "";
	const [group, number] = String(key).split("-");
	const course = courses[key];
	if (course) return course.name || `Course ${number}`;
	return COURSE_GROUPS.some((g) => g.key === group) && /^[1-3]$/.test(number) ? `Course ${number} (deleted)` : String(key);
}

// One colour per feature, used by the pictures AND the key so they always match.
// (Walls and the background are also recoloured by CSS in dark mode through the course-wall-fill / course-bg-fill classes.)
export const COLORS = {
	wall: "#263c49",
	start: "#1fa355",
	end: "#d63a3a",
	path: "#1d6fe0",
	lap1: "#1d6fe0",
	lap2: "#e8710a",
	background: "#eaf1f4",
};

// ---------------------------------------------------------------- saved data <-> in-memory model
const emptyGrid = () => new Array(COURSE_COLS * COURSE_ROWS).fill(0);
const inBounds = (c, r) =>
	Number.isInteger(c) &&
	Number.isInteger(r) &&
	c >= 0 &&
	c < COURSE_COLS &&
	r >= 0 &&
	r < COURSE_ROWS;

// Layouts saved by the earlier drag-and-drop builder were lists of 2x4 wall pieces placed at pixel positions on a 28 px background grid
// ({ kind: "horizontal" | "vertical", x, y }). Each piece was about 4 cells long, so it is converted to 4 filled cells.
function legacyWallsToGrid(walls) {
	const grid = emptyGrid(),
		CELL = 28,
		LENGTH = 4;
	for (const wall of walls) {
		const col = Math.round(wall.x / CELL),
			row = Math.round(wall.y / CELL);
		for (let i = 0; i < LENGTH; i++) {
			const c = wall.kind === "vertical" ? col : col + i,
				r = wall.kind === "vertical" ? row + i : row;
			if (inBounds(c, r)) grid[r * COURSE_COLS + c] = 1;
		}
	}
	return grid;
}
// Saved course -> flat array of 0/1 values (row by row). Understands the current format and the legacy format.
export function gridFromCourse(course) {
	if (Array.isArray(course?.grid)) {
		const grid = emptyGrid();
		course.grid.forEach((line, r) =>
			String(line)
				.split("")
				.forEach((ch, c) => {
					if (inBounds(c, r) && ch === "1") grid[r * COURSE_COLS + c] = 1;
				}),
		);
		return grid;
	}
	if (Array.isArray(course?.walls)) return legacyWallsToGrid(course.walls);
	return emptyGrid();
}
const gridToRows = (grid) =>
	Array.from({ length: COURSE_ROWS }, (_, r) =>
		grid.slice(r * COURSE_COLS, (r + 1) * COURSE_COLS).join(""),
	);
const wallCount = (grid) => grid.reduce((a, b) => a + b, 0);

const parseCell = (v) =>
	v && inBounds(v.col, v.row) ? { col: v.col, row: v.row } : null;
const parsePoints = (list) =>
	(Array.isArray(list) ? list : [])
		.map((s) => String(s).split(",").map(Number))
		.filter(([c, r]) => inBounds(c, r));

// Everything drawn on a course, in the shape the renderer and the builder work with. Older courses simply have no markers or paths.
//   { grid, start: {col,row}|null, end: {col,row}|null, paths: [ { lap: 1, points: [[c, r], ...] }, { lap: 2, points: [...] } ] }
export function courseModel(course) {
	return {
		grid: gridFromCourse(course),
		start: parseCell(course?.start),
		end: parseCell(course?.end),
		paths: [1, 2].map((lap) => ({
			lap,
			points: parsePoints(
				course?.paths?.find((p) => Number(p.lap) === lap)?.points,
			),
		})),
	};
}
// A path needs at least two points to be a route; a single point is only a work in progress and is not saved or listed in the key.
const usablePaths = (model) => model.paths.filter((p) => p.points.length >= 2);
// The model as it is saved (see the format at the top of this file).
function modelToSaved(model, name) {
	return {
		name,
		cols: COURSE_COLS,
		rows: COURSE_ROWS,
		grid: gridToRows(model.grid),
		start: model.start ? { ...model.start } : null,
		end: model.end ? { ...model.end } : null,
		paths: usablePaths(model).map((p) => ({
			lap: p.lap,
			points: p.points.map(([c, r]) => `${c},${r}`),
		})),
		updatedAt: new Date().toISOString(),
	};
}

// ---------------------------------------------------------------- pictures
// Arrowheads along a path so drivers can see which way to go: one near the start, then one every few cells, and one at the very end.
function arrowPolygons(pts, size, color) {
	const segments = [];
	let total = 0;
	for (let i = 1; i < pts.length; i++) {
		const dx = pts[i][0] - pts[i - 1][0],
			dy = pts[i][1] - pts[i - 1][1],
			len = Math.hypot(dx, dy);
		if (len > 0) {
			segments.push({
				from: pts[i - 1],
				ux: dx / len,
				uy: dy / len,
				len,
				start: total,
			});
			total += len;
		}
	}
	if (!total) return "";
	const distances = [];
	for (let d = Math.min(3, total / 2); d < total - 2; d += 6) distances.push(d);
	distances.push(Math.max(0, total - 0.5));
	return distances
		.map((d) => {
			const s =
					segments.find((seg) => d <= seg.start + seg.len + 1e-9) ||
					segments.at(-1),
				along = d - s.start;
			const x = s.from[0] + s.ux * along,
				y = s.from[1] + s.uy * along,
				nx = -s.uy,
				ny = s.ux;
			const tip = [x + s.ux * size * 0.6, y + s.uy * size * 0.6],
				bx = x - s.ux * size * 0.4,
				by = y - s.uy * size * 0.4;
			const left = [bx + nx * size * 0.5, by + ny * size * 0.5],
				right = [bx - nx * size * 0.5, by - ny * size * 0.5];
			return `<polygon points="${tip.map((n) => n.toFixed(2)).join(",")} ${left.map((n) => n.toFixed(2)).join(",")} ${right.map((n) => n.toFixed(2)).join(",")}" fill="${color}" stroke="#fff" stroke-width=".08"/>`;
		})
		.join("");
}

// The markers and paths as SVG shapes in "cell" units (the picture is 48 x 24 units). The Course builder lays this over its grid and
// the Courses page draws it over the walls, so what administrators draw is exactly what viewers see.
export function overlayInner(model, group) {
	const laps = hasLaps(group);
	let paths = "",
		badges = "";
	for (const p of model.paths) {
		if (!p.points.length || (!laps && p.lap !== 1)) continue;
		const color = laps && p.lap === 2 ? COLORS.lap2 : COLORS.path,
			pts = p.points.map(([c, r]) => [c + 0.5, r + 0.5]);
		if (pts.length === 1) {
			paths += `<circle cx="${pts[0][0]}" cy="${pts[0][1]}" r=".4" fill="${color}"/>`;
			continue;
		}
		// Lap 1 is a wide solid line; Lap 2 is a thinner dashed line, so two laps that follow the same route can both be seen (and told apart in black and white).
		const width = laps ? (p.lap === 1 ? 0.44 : 0.24) : 0.42,
			dash = laps && p.lap === 2 ? ' stroke-dasharray=".8 .55"' : "";
		paths += `<polyline points="${pts.map((q) => q.join(",")).join(" ")}" fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"${dash}/>`;
		paths += arrowPolygons(pts, laps && p.lap === 2 ? 0.8 : 1, color);
		if (laps) {
			// Numbered circle where this lap's path begins: Lap 1 sits up-left of its start and Lap 2 up-right, so two laps that begin at the
			// same place (a loop) do not hide each other. Clamped so the circle always stays inside the picture.
			const [x0, y0] = pts[0],
				bx = Math.min(
					COURSE_COLS - 0.9,
					Math.max(0.9, x0 + (p.lap === 1 ? -1.5 : 1.5)),
				),
				by = Math.max(0.9, y0 - 1.2);
			badges += `<circle cx="${bx}" cy="${by}" r=".85" fill="${color}" stroke="#fff" stroke-width=".16"/><text x="${bx}" y="${by + 0.04}" font-size="1.15" font-weight="700" font-family="Arial,sans-serif" text-anchor="middle" dominant-baseline="central" fill="#fff">${p.lap}</text>`;
			const [xa, ya] = pts.at(-2),
				[xb, yb] = pts.at(-1),
				len = Math.hypot(xb - xa, yb - ya) || 1,
				nx = -(yb - ya) / len,
				ny = (xb - xa) / len; // bar across the path where this lap ends
			badges += `<line x1="${xb - nx * 1}" y1="${yb - ny * 1}" x2="${xb + nx * 1}" y2="${yb + ny * 1}" stroke="${color}" stroke-width=".36"/>`;
		}
	}
	// Loops often start and finish on the same cell. The end square is drawn first and the start circle on top (smaller in that case),
	// so a green circle sits inside the red square and both stay visible.
	const same =
		model.start &&
		model.end &&
		model.start.col === model.end.col &&
		model.start.row === model.end.row;
	const end = model.end
		? `<rect x="${model.end.col + 0.5 - 0.9}" y="${model.end.row + 0.5 - 0.9}" width="1.8" height="1.8" rx=".2" fill="${COLORS.end}" stroke="#fff" stroke-width=".2"/>`
		: "";
	const start = model.start
		? `<circle cx="${model.start.col + 0.5}" cy="${model.start.row + 0.5}" r="${same ? 0.55 : 0.95}" fill="${COLORS.start}" stroke="#fff" stroke-width="${same ? 0.14 : 0.22}"/>`
		: "";
	return paths + badges + end + start;
}

// The whole course as a vector picture: walls, then markers and paths.
export function courseSvg(model, label = "Course layout", group = "speed") {
	let rects = "";
	for (let r = 0; r < COURSE_ROWS; r++) {
		let c = 0;
		while (c < COURSE_COLS) {
			if (!model.grid[r * COURSE_COLS + c]) {
				c++;
				continue;
			}
			let start = c;
			while (c < COURSE_COLS && model.grid[r * COURSE_COLS + c]) c++;
			rects += `<rect x="${start}" y="${r}" width="${c - start}" height="1"/>`;
		}
	}
	return `<svg class="course-svg" viewBox="0 0 ${COURSE_COLS} ${COURSE_ROWS}" role="img" aria-label="${esc(label)}" preserveAspectRatio="xMidYMid meet"><rect class="course-bg-fill" width="${COURSE_COLS}" height="${COURSE_ROWS}" fill="${COLORS.background}"/><g class="course-wall-fill" fill="${COLORS.wall}" shape-rendering="crispEdges">${rects}</g>${overlayInner(model, group)}</svg>`;
}

// ---------------------------------------------------------------- the key
// Symbols (drawn in a 30 x 22 box) and wording for each feature. A course's key lists only the features that course actually uses.
const ARROW = (color, extra = "") =>
	`<line x1="3" y1="11" x2="19" y2="11" stroke="${color}" stroke-width="${extra ? 2.6 : 4}" stroke-linecap="round"${extra}/><polygon points="27,11 17,5.5 17,16.5" fill="${color}"/>`;
const KEY = {
	wall: {
		label: "Wall",
		icon: `<rect class="course-wall-fill" x="8" y="3" width="16" height="16" rx="1.5" fill="${COLORS.wall}"/>`,
	},
	start: {
		label: "Starting position",
		icon: `<circle cx="15" cy="11" r="8" fill="${COLORS.start}" stroke="#fff" stroke-width="1.5"/>`,
	},
	end: {
		label: "Ending position",
		icon: `<rect x="6" y="2" width="18" height="18" rx="2" fill="${COLORS.end}" stroke="#fff" stroke-width="1.5"/>`,
	},
	path: { label: "Robot path (follow the arrows)", icon: ARROW(COLORS.path) },
	lap1: { label: "Robot path: Lap 1 (solid line)", icon: ARROW(COLORS.lap1) },
	lap2: {
		label: "Robot path: Lap 2 (dashed line)",
		icon: ARROW(COLORS.lap2, ' stroke-dasharray="4 3"'),
	},
	lapstart: {
		label: "Lap start (numbered circle)",
		icon: `<circle cx="9" cy="11" r="7" fill="${COLORS.lap1}"/><text x="9" y="11.5" font-size="9" font-weight="700" font-family="Arial,sans-serif" text-anchor="middle" dominant-baseline="central" fill="#fff">1</text><circle cx="23" cy="11" r="7" fill="${COLORS.lap2}"/><text x="23" y="11.5" font-size="9" font-weight="700" font-family="Arial,sans-serif" text-anchor="middle" dominant-baseline="central" fill="#fff">2</text>`,
	},
	lapend: {
		label: "Lap end (bar across the path)",
		icon: `<line x1="3" y1="11" x2="13" y2="11" stroke="${COLORS.lap1}" stroke-width="2.6" stroke-linecap="round"/><line x1="15" y1="2" x2="15" y2="20" stroke="${COLORS.lap1}" stroke-width="3.2"/><line x1="17" y1="11" x2="27" y2="11" stroke="${COLORS.lap2}" stroke-width="2.6" stroke-linecap="round" stroke-dasharray="4 3"/>`,
	},
};
// Which features does this course use? Order: walls, start, end, then the path(s) and lap markers.
export function courseFeatures(model, group) {
	const features = [],
		used = usablePaths(model);
	if (wallCount(model.grid)) features.push("wall");
	if (model.start) features.push("start");
	if (model.end) features.push("end");
	if (hasLaps(group)) {
		used.forEach((p) => features.push(`lap${p.lap}`));
		if (used.length) features.push("lapstart", "lapend");
	} else if (used.some((p) => p.lap === 1)) features.push("path");
	return features;
}
export function courseKeyHtml(model, group, { compact = false } = {}) {
	const features = courseFeatures(model, group);
	if (!features.length) return "";
	return `<ul class="course-key${compact ? " compact" : ""}" aria-label="Key">${features.map((f) => `<li data-key="${f}"><svg class="key-icon" viewBox="0 0 30 22" width="30" height="22" aria-hidden="true">${KEY[f].icon}</svg><span>${KEY[f].label}</span></li>`).join("")}</ul>`;
}

// ---------------------------------------------------------------- Courses page (everyone can view; administrators also get Edit / Delete)
export function renderCourseGallery(ctx) {
	const { state } = ctx,
		admin = state.session.isAdmin;
	const groups = COURSE_GROUPS.map((g) => {
		const slots = [1, 2, 3]
			.map((n) => {
				const key = courseKey(g.key, n),
					course = state.data.courses[key],
					model = course ? courseModel(course) : null;
				const name = course?.name || `${g.label} Course ${n}`;
				const picture = course
					? `<button class="course-thumb" data-view-course="${key}" aria-label="View ${esc(name)} larger">${courseSvg(model, name, g.key)}</button>${courseKeyHtml(model, g.key, { compact: true })}`
					: `<div class="course-thumb empty"><span>Not published yet</span></div>`;
				const actions = admin
					? `<div class="course-actions"><button class="button button-secondary button-small" data-edit-course="${key}">${course ? "Edit" : "Create"}</button>${course ? `<button class="button button-danger button-small" data-delete-course="${key}">Delete</button>` : ""}</div>`
					: "";
				return `<article class="course-card"><div class="course-card-head"><strong>Course ${n}</strong><span>${course ? esc(name) : "&nbsp;"}</span></div>${picture}${actions}</article>`;
			})
			.join("");
		return `<section class="panel course-group"><div class="panel-heading"><div><h3>${esc(g.label)}</h3><p>${esc(g.note)}. Use the same layout for every driver in this drill on a given practice day.</p></div></div><div class="course-cards">${slots}</div></section>`;
	}).join("");
	const action = admin
		? `<button class="button" id="go-course-builder">Open course builder</button>`
		: "";
	return `${ctx.pageHeader("Courses", admin ? "Published course layouts. Use Edit to change a course or Create to add a missing one." : "The course layouts published for each drill. Select a course to view it larger.", action)}${groups}`;
}

export function bindCourseGallery(ctx) {
	const { state } = ctx;
	document
		.querySelectorAll("[data-view-course]")
		.forEach(
			(b) => (b.onclick = () => openCourseView(ctx, b.dataset.viewCourse)),
		);
	document
		.querySelector("#go-course-builder")
		?.addEventListener("click", () => ctx.setRoute("course-builder"));
	document.querySelectorAll("[data-edit-course]").forEach(
		(b) =>
			(b.onclick = () => {
				const [group, number] = b.dataset.editCourse.split("-");
				state.courseGroup = group;
				state.courseNumber = Number(number);
				state.courseDraft = null; // the builder loads this course
				ctx.setRoute("course-builder");
			}),
	);
	document
		.querySelectorAll("[data-delete-course]")
		.forEach(
			(b) =>
				(b.onclick = () => confirmDeleteCourse(ctx, b.dataset.deleteCourse)),
		);
}

function openCourseView(ctx, key) {
	const course = ctx.state.data.courses[key];
	if (!course) return;
	const group = key.split("-")[0],
		model = courseModel(course),
		name = course.name || key;
	ctx.content.innerHTML = `<div class="modal-head"><div><p class="eyebrow">${esc(groupOf(group).label.toUpperCase())}</p><h2>${esc(name)}</h2></div><button class="close" id="close-modal">\u00d7</button></div><div class="course-large">${courseSvg(model, name, group)}</div>${courseKeyHtml(model, group)}<p class="help">${wallCount(model.grid)} wall cells. Each square is one grid cell.</p>`;
	ctx.openModal({ wide: true });
	document.querySelector("#close-modal").onclick = () => ctx.modal.close();
}

function confirmDeleteCourse(ctx, key) {
	if (!ctx.state.session.isAdmin) return;
	const course = ctx.state.data.courses[key];
	if (!course) return;
	ctx.content.innerHTML = `<div class="modal-head"><div><p class="eyebrow">CONFIRM DELETE</p><h2>Delete this course?</h2></div><button class="close" id="close-modal">\u00d7</button></div><p><strong>${esc(course.name || key)}</strong></p><p class="help">The layout is removed from the Courses page for everyone. This cannot be undone.</p><div class="form-actions"><button class="button button-secondary" id="cancel-delete">Cancel</button><button class="button button-danger" id="confirm-delete">Delete course</button></div>`;
	ctx.openModal();
	document.querySelector("#close-modal").onclick = document.querySelector(
		"#cancel-delete",
	).onclick = () => ctx.modal.close();
	document.querySelector("#confirm-delete").onclick = async (e) => {
		e.target.disabled = true;
		try {
			await ctx.store.removeCourse(key);
			delete ctx.state.data.courses[key];
			if (ctx.state.courseDraft?.key === key) ctx.state.courseDraft = null;
			ctx.modal.close();
			ctx.render();
			ctx.toast("Course deleted.");
		} catch (err) {
			e.target.disabled = false;
			ctx.toast(`Could not delete: ${err.message}`);
		}
	};
}

// ---------------------------------------------------------------- Course builder page (administrators)
// The draft being edited lives in state.courseDraft so it survives while the page re-renders:
//   { key, name, grid, start, end, paths, lap (which lap's path is being drawn), sig (the drawing as last saved), baseName (the name as last saved
//     or defaulted), savedName (null until this course has been saved), undo: [earlier states] }
const TOOLS = ["draw", "erase", "start", "end", "path"];
const signature = (d) =>
	JSON.stringify({
		g: d.grid.join(""),
		s: d.start,
		e: d.end,
		p: d.paths.map((p) => (p.points.length >= 2 ? p.points : [])),
	});
function ensureDraft(ctx) {
	const { state } = ctx,
		key = courseKey(state.courseGroup, state.courseNumber);
	if (state.courseDraft?.key === key) return state.courseDraft;
	const course = state.data.courses[key],
		model = courseModel(course);
	const name =
		course?.name ||
		`${groupOf(state.courseGroup).label} Course ${state.courseNumber}`;
	const d = {
		key,
		name,
		...model,
		lap: 1,
		undo: [],
		baseName: name,
		savedName: course ? name : null,
		converted: Boolean(
			course && !Array.isArray(course.grid) && course.walls?.length,
		),
	};
	d.paths = d.paths.map((p) =>
		p.points.length >= 2 ? p : { lap: p.lap, points: [] },
	); // a lone saved point cannot exist, but be safe
	d.sig = signature(d);
	return (state.courseDraft = d);
}
// Only real edits count: a new, untouched course (still on its default name) is not "unsaved".
const isDirty = (d) => signature(d) !== d.sig || d.name !== d.baseName;
const snapshotOf = (d) =>
	JSON.parse(
		JSON.stringify({
			grid: d.grid,
			start: d.start,
			end: d.end,
			paths: d.paths,
		}),
	);

// Ramer-Douglas-Peucker: turns a freehand stroke (a point in every cell the pointer crossed) into a few straight segments with corners.
function simplify(points, tolerance = 0.8) {
	if (points.length < 3) return points;
	const [ax, ay] = points[0],
		[bx, by] = points.at(-1),
		len = Math.hypot(bx - ax, by - ay);
	let worst = 0,
		index = 0;
	for (let i = 1; i < points.length - 1; i++) {
		const [px, py] = points[i];
		const dist =
			len === 0
				? Math.hypot(px - ax, py - ay)
				: Math.abs((bx - ax) * (ay - py) - (ax - px) * (by - ay)) / len;
		if (dist > worst) {
			worst = dist;
			index = i;
		}
	}
	if (worst <= tolerance) return [points[0], points.at(-1)];
	return [
		...simplify(points.slice(0, index + 1), tolerance).slice(0, -1),
		...simplify(points.slice(index), tolerance),
	];
}

const TOOL_INFO = {
	draw: [
		"Draw walls",
		"Click and drag to fill cells as you move. Hold Shift while dragging to erase.",
	],
	erase: [
		"Erase",
		"Click and drag to remove walls. Erasing the start or end position removes it too.",
	],
	start: [
		"Start position",
		"Click a cell to place the green start circle. Click another cell to move it.",
	],
	end: [
		"End position",
		"Click a cell to place the red end square. Click another cell to move it.",
	],
	path: [
		"Robot path",
		"Click to add path points, or drag to trace the route freehand. Arrows show the direction drivers follow.",
	],
};
const toolIcon = (tool) =>
	({
		draw: `<svg viewBox="0 0 22 22" width="20" height="20"><rect class="course-wall-fill" x="3" y="3" width="16" height="16" rx="2" fill="${COLORS.wall}"/></svg>`,
		erase: `<svg viewBox="0 0 22 22" width="20" height="20"><rect x="3" y="3" width="16" height="16" rx="2" fill="#fff" stroke="#8aa0ad" stroke-width="2" stroke-dasharray="3 2"/></svg>`,
		start: `<svg viewBox="0 0 22 22" width="20" height="20"><circle cx="11" cy="11" r="8" fill="${COLORS.start}"/></svg>`,
		end: `<svg viewBox="0 0 22 22" width="20" height="20"><rect x="3" y="3" width="16" height="16" rx="2" fill="${COLORS.end}"/></svg>`,
		path: `<svg viewBox="0 0 22 22" width="20" height="20"><polyline points="2,17 9,7 15,13 19,5" fill="none" stroke="${COLORS.path}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
	})[tool];

export function renderCourseBuilder(ctx) {
	const { state } = ctx,
		d = ensureDraft(ctx),
		group = groupOf(state.courseGroup);
	if (!TOOLS.includes(state.courseTool)) state.courseTool = "draw";
	const cells = d.grid
		.map((v) => `<div class="cell${v ? " on" : ""}"></div>`)
		.join("");
	const cards = COURSE_GROUPS.map(
		(g) =>
			`<button class="facet-card ${state.courseGroup === g.key ? "selected" : ""}" data-cgroup="${g.key}"><span class="tag">COURSE</span><strong>${esc(g.label)}</strong><span>${esc(g.note)}</span></button>`,
	).join("");
	const tools = TOOLS.map(
		(t) =>
			`<button type="button" data-tool="${t}" class="${state.courseTool === t ? "active" : ""}">${toolIcon(t)}<span>${TOOL_INFO[t][0]}</span></button>`,
	).join("");
	return `${ctx.pageHeader("Course builder", "Draw walls, place the start and end, and trace the robot path. Saved layouts appear on the Courses page for everyone.", `<button class="button button-secondary" id="go-courses">View Courses page</button>`)}<div class="facet-grid facet-grid-3">${cards}</div>
  <div class="builder-layout"><aside class="panel toolbox"><h3>Course ${state.courseNumber}</h3>
    <div class="tool-list" role="group" aria-label="Drawing tool">${tools}</div>
    <p class="help" id="tool-help"></p>
    <div id="tool-options"></div>
    <div class="toolbox-row"><button type="button" class="button button-secondary button-small" id="course-undo">Undo</button><button type="button" class="button button-secondary button-small" id="course-clear">Clear walls</button></div>
    <hr><label class="field"><span>Layout number</span><select id="course-number">${[1, 2, 3].map((n) => `<option value="${n}" ${n === state.courseNumber ? "selected" : ""}>Course ${n}</option>`).join("")}</select></label>
    <label class="field"><span>Layout name</span><input id="course-name" value="${esc(d.name)}"></label>
    <button class="button" id="save-course" style="margin-top:13px">Save layout</button>
    <p class="help" id="course-status" style="margin-top:10px"></p>
  </aside><section class="panel canvas-panel"><div class="panel-heading" style="padding:0 0 13px"><div><h3>${esc(group.label)} - Course ${state.courseNumber}</h3><p>Keep the same selected course for all drivers in this drill on a day.${d.converted ? " This layout was converted from the old piece-based builder; please review it before saving." : ""}</p></div></div>
    <div class="course-wrap"><div class="course-grid" id="course-grid" style="grid-template-columns:repeat(${COURSE_COLS},1fr)" aria-label="Course grid. Use the selected tool to draw on it.">${cells}</div><svg class="course-overlay" id="course-overlay" viewBox="0 0 ${COURSE_COLS} ${COURSE_ROWS}" preserveAspectRatio="none" aria-hidden="true"></svg></div>
    <div class="key-panel"><strong>Key</strong><span class="help"> Lists only what this course uses, and is shown to everyone who views the course.</span><div id="course-key"></div></div></section></div>`;
}

export function bindCourseBuilder(ctx) {
	const { state } = ctx,
		d = ensureDraft(ctx),
		laps = hasLaps(state.courseGroup);
	const grid = document.querySelector("#course-grid"),
		cells = grid.children,
		status = document.querySelector("#course-status");
	const overlay = document.querySelector("#course-overlay"),
		keyBox = document.querySelector("#course-key");
	const leave = () =>
		!isDirty(d) ||
		confirm("You have unsaved changes to this course. Discard them?");
	const activePath = () => d.paths.find((p) => p.lap === (laps ? d.lap : 1));

	// Redraw the marker/path layer and the key from the draft, and update the status line. Cheap enough to run on every pointer move.
	const refreshOverlay = () => {
		overlay.innerHTML = overlayInner(d, state.courseGroup);
		const key = courseKeyHtml(d, state.courseGroup);
		keyBox.innerHTML =
			key ||
			'<p class="help">Nothing to show yet. Draw walls or place a start, end, or path and the key will list them.</p>';
	};
	const updateStatus = () => {
		const parts = [`${wallCount(d.grid)} wall cells`];
		if (d.start) parts.push("start set");
		if (d.end) parts.push("end set");
		const used = usablePaths(d).length;
		if (used)
			parts.push(
				laps ? `${used} lap path${used === 1 ? "" : "s"}` : "path set",
			);
		parts.push(
			isDirty(d) ? "Unsaved changes" : d.savedName ? "All changes saved" : "",
		);
		status.textContent = parts.filter(Boolean).join(" | ");
		status.classList.toggle("warn", isDirty(d));
	};
	const refreshAll = () => {
		d.grid.forEach((v, i) => cells[i].classList.toggle("on", Boolean(v)));
		refreshOverlay();
		updateStatus();
	};
	const pushUndo = (snapshot) => {
		d.undo.push(snapshot);
		if (d.undo.length > 60) d.undo.shift();
	};

	// ---- switching drill / layout number
	document.querySelectorAll("[data-cgroup]").forEach(
		(b) =>
			(b.onclick = () => {
				if (b.dataset.cgroup === state.courseGroup || !leave()) return;
				state.courseGroup = b.dataset.cgroup;
				state.courseDraft = null;
				ctx.render();
			}),
	);
	document.querySelector("#course-number").onchange = (e) => {
		if (!leave()) {
			e.target.value = state.courseNumber;
			return;
		}
		state.courseNumber = Number(e.target.value);
		state.courseDraft = null;
		ctx.render();
	};
	document.querySelector("#go-courses").onclick = () => ctx.setRoute("courses");

	// ---- tools. The options under the tool list depend on the selected tool (lap controls for the path, remove buttons for the markers).
	const options = document.querySelector("#tool-options");
	const renderOptions = () => {
		const tool = state.courseTool;
		document
			.querySelectorAll("[data-tool]")
			.forEach((x) => x.classList.toggle("active", x.dataset.tool === tool));
		document.querySelector("#tool-help").textContent = TOOL_INFO[tool][1];
		if (tool === "start")
			options.innerHTML = `<button type="button" class="button button-secondary button-small" id="remove-start" ${d.start ? "" : "disabled"}>Remove start</button>`;
		else if (tool === "end")
			options.innerHTML = `<button type="button" class="button button-secondary button-small" id="remove-end" ${d.end ? "" : "disabled"}>Remove end</button>`;
		else if (tool === "path") {
			options.innerHTML = `${
				laps
					? `<div class="seg" role="group" aria-label="Which lap's path"><button type="button" data-lap="1" class="${d.lap === 1 ? "active" : ""}">Lap 1 path</button><button type="button" data-lap="2" class="${d.lap === 2 ? "active" : ""}">Lap 2 path</button></div>
        ${d.lap === 1 ? '<button type="button" class="button button-secondary button-small" id="next-lap" style="margin-bottom:8px">End Lap 1 / start Lap 2 path</button>' : ""}`
					: ""
			}
        <button type="button" class="button button-secondary button-small" id="clear-path" ${activePath().points.length ? "" : "disabled"}>Clear ${laps ? `Lap ${d.lap} path` : "path"}</button>`;
		} else options.innerHTML = "";
		options.querySelector("#remove-start")?.addEventListener("click", () => {
			pushUndo(snapshotOf(d));
			d.start = null;
			refreshAll();
			renderOptions();
		});
		options.querySelector("#remove-end")?.addEventListener("click", () => {
			pushUndo(snapshotOf(d));
			d.end = null;
			refreshAll();
			renderOptions();
		});
		options.querySelectorAll("[data-lap]").forEach(
			(b) =>
				(b.onclick = () => {
					d.lap = Number(b.dataset.lap);
					renderOptions();
				}),
		);
		options.querySelector("#next-lap")?.addEventListener("click", () => {
			if (d.paths[0].points.length < 2)
				return ctx.toast("Draw the Lap 1 path first, then end it here.");
			d.lap = 2;
			renderOptions();
			ctx.toast("Lap 1 path ended. You are now drawing the Lap 2 path.");
		});
		options.querySelector("#clear-path")?.addEventListener("click", () => {
			const p = activePath();
			if (!p.points.length) return;
			pushUndo(snapshotOf(d));
			p.points = [];
			refreshAll();
			renderOptions();
		});
	};
	document.querySelectorAll("[data-tool]").forEach(
		(b) =>
			(b.onclick = () => {
				state.courseTool = b.dataset.tool;
				renderOptions();
			}),
	);
	document.querySelector("#course-undo").onclick = () => {
		const previous = d.undo.pop();
		if (!previous) return ctx.toast("Nothing to undo.");
		Object.assign(d, previous);
		refreshAll();
		renderOptions();
	};
	document.querySelector("#course-clear").onclick = () => {
		if (!wallCount(d.grid)) return;
		pushUndo(snapshotOf(d));
		d.grid = d.grid.map(() => 0);
		refreshAll();
	};
	document.querySelector("#course-name").oninput = (e) => {
		d.name = e.target.value;
		updateStatus();
	};

	// ---- pointer drawing: press on the grid, then drag. What happens depends on the selected tool.
	let active = false,
		value = 1,
		last = null,
		before = null,
		strokeStart = 0,
		tool = "draw";
	// Which cell is under the pointer? Computed from coordinates (not from the element under it) so touch input and drags that leave the grid work.
	const cellAt = (e) => {
		const rect = grid.getBoundingClientRect();
		const col = Math.floor(
				((e.clientX - rect.left) / rect.width) * COURSE_COLS,
			),
			row = Math.floor(((e.clientY - rect.top) / rect.height) * COURSE_ROWS);
		return {
			col: Math.max(0, Math.min(COURSE_COLS - 1, col)),
			row: Math.max(0, Math.min(COURSE_ROWS - 1, row)),
		};
	};
	const setCell = (col, row, v) => {
		const i = row * COURSE_COLS + col;
		if (d.grid[i] === v) return;
		d.grid[i] = v;
		cells[i].classList.toggle("on", Boolean(v));
	};
	// A fast mouse can skip cells between two events, so every cell on the straight line (Bresenham) from the previous cell to the current one is visited.
	const lineCells = (a, b) => {
		const out = [];
		let { col: x, row: y } = a;
		const dx = Math.abs(b.col - x),
			dy = -Math.abs(b.row - y),
			sx = x < b.col ? 1 : -1,
			sy = y < b.row ? 1 : -1;
		let err = dx + dy;
		for (;;) {
			out.push([x, y]);
			if (x === b.col && y === b.row) break;
			const e2 = 2 * err;
			if (e2 >= dy) {
				err += dy;
				x += sx;
			}
			if (e2 <= dx) {
				err += dx;
				y += sy;
			}
		}
		return out;
	};
	const isWall = (p) => d.grid[p.row * COURSE_COLS + p.col] === 1;
	// Painting a wall over the start or end marker (or erasing it) removes that marker, so a marker never sits inside a wall.
	const clearMarkersAt = (c, r) => {
		if (d.start && d.start.col === c && d.start.row === r) d.start = null;
		if (d.end && d.end.col === c && d.end.row === r) d.end = null;
	};
	const place = (kind, p, announce) => {
		// start / end marker
		if (isWall(p)) {
			if (announce) ctx.toast(`Choose an empty cell for the ${kind} position.`);
			return;
		}
		d[kind] = { col: p.col, row: p.row };
		refreshOverlay();
	};
	grid.addEventListener("pointerdown", (e) => {
		if (e.pointerType === "mouse" && e.button !== 0) return;
		e.preventDefault();
		grid.setPointerCapture(e.pointerId);
		active = true;
		before = snapshotOf(d);
		tool =
			state.courseTool === "draw" && e.shiftKey ? "erase" : state.courseTool;
		last = cellAt(e);
		if (tool === "draw" || tool === "erase") {
			value = tool === "erase" ? 0 : 1;
			setCell(last.col, last.row, value);
			clearMarkersAt(last.col, last.row);
		} else if (tool === "start" || tool === "end") place(tool, last, true);
		else if (tool === "path") {
			// a click adds a waypoint; dragging continues the stroke
			const path = activePath();
			strokeStart = path.points.length;
			const prev = path.points.at(-1);
			if (!prev || prev[0] !== last.col || prev[1] !== last.row)
				path.points.push([last.col, last.row]);
		}
		refreshOverlay();
		updateStatus();
	});
	grid.addEventListener("pointermove", (e) => {
		if (!active) return;
		const p = cellAt(e);
		if (p.col === last.col && p.row === last.row) return;
		if (tool === "draw" || tool === "erase") {
			lineCells(last, p).forEach(([c, r]) => {
				setCell(c, r, value);
				clearMarkersAt(c, r);
			});
		} else if (tool === "start" || tool === "end") place(tool, p, false);
		else if (tool === "path") {
			const path = activePath();
			lineCells(last, p)
				.slice(1)
				.forEach(([c, r]) => path.points.push([c, r]));
		}
		last = p;
		refreshOverlay();
		updateStatus();
	});
	const finish = () => {
		if (!active) return;
		active = false;
		if (tool === "path") {
			// straighten this stroke into a few segments with corners
			const path = activePath(),
				stroke = path.points.slice(strokeStart); // the points added since the pointer went down
			if (stroke.length > 2)
				path.points = [
					...path.points.slice(0, strokeStart),
					...simplify(stroke),
				];
		}
		if (before && JSON.stringify(before) !== JSON.stringify(snapshotOf(d)))
			pushUndo(before);
		before = null;
		refreshOverlay();
		updateStatus();
		renderOptions();
	};
	grid.addEventListener("pointerup", finish);
	grid.addEventListener("pointercancel", finish);

	// ---- save
	document.querySelector("#save-course").onclick = async () => {
		const name =
			d.name.trim() ||
			`${groupOf(state.courseGroup).label} Course ${state.courseNumber}`;
		const item = modelToSaved(
			{ ...d, paths: laps ? d.paths : d.paths.filter((p) => p.lap === 1) },
			name,
		);
		try {
			await ctx.store.saveCourse(d.key, item);
			state.data.courses[d.key] = item;
			d.name = name;
			d.baseName = name;
			d.savedName = name;
			d.sig = signature(d);
			d.converted = false;
			document.querySelector("#course-name").value = name;
			updateStatus();
			ctx.toast("Course layout saved. It now appears on the Courses page.");
		} catch (err) {
			ctx.toast(`Could not save: ${err.message}`);
		}
	};
	renderOptions();
	refreshAll();
}
