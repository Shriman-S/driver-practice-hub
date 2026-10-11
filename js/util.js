// Small helpers shared by app.js and the feature modules (forms, courses, PDF). Nothing here touches the database.

// Escapes text before it is placed into generated HTML, so names or notes can never inject markup.
export const esc = (value = "") =>
	String(value).replace(
		/[&<>'"]/g,
		(c) =>
			({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[
				c
			],
	);
export const uid = () => crypto.randomUUID();
export const now = () => new Date().toISOString();

// ---- Calendar dates ----
// A practice date or event date is a plain calendar day stored as text, "YYYY-MM-DD" (exactly what <input type="date"> produces).
// It has no time zone, so it must never be passed through `new Date("YYYY-MM-DD")` or `.toISOString()`: JavaScript reads that text as
// midnight UTC, and in the US (UTC-4/-5) that is the evening of the PREVIOUS day, which is what made every date appear one day early.
// These helpers build and read days from their local year / month / day parts instead, so no time-zone conversion ever happens.
export const pad2 = (n) => String(n).padStart(2, "0");
export const dateKey = (d) =>
	`${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; // Date -> "YYYY-MM-DD" using the LOCAL day
export const todayKey = () => dateKey(new Date()); // today's local date (not today's UTC date)
export const parseDay = (key) => {
	const [y, m, d] = String(key).split("-").map(Number);
	return new Date(y, m - 1, d);
}; // "YYYY-MM-DD" -> local midnight
export const dateText = (key) =>
	new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(
		parseDay(key),
	);

// ---- Text blocks ----
// A "text block" array is how descriptions are stored for the built-in forms: a plain string is a paragraph and an array of strings
// is a bulleted list shown beneath the paragraph above it. blocksHtml() turns one into HTML.
export function blocksHtml(blocks) {
	return blocks
		.map((b) =>
			Array.isArray(b)
				? `<ul>${b.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>`
				: `<p>${esc(b)}</p>`,
		)
		.join("");
}
// Administrators type descriptions as plain text in the form builder. Lines starting with "- " (or a bullet) become bullet points and
// every other non-empty line becomes a paragraph; this converts that text into a text block.
export function textToBlocks(text = "") {
	const blocks = [];
	let list = null;
	String(text)
		.split(/\r?\n/)
		.map((line) => line.trim())
		.forEach((line) => {
			const bullet = line.match(/^[-*\u2022]\s+(.*)$/);
			if (bullet) {
				if (!list) {
					list = [];
					blocks.push(list);
				}
				list.push(bullet[1]);
			} else if (line) {
				list = null;
				blocks.push(line);
			} else list = null; // a blank line ends a list
		});
	return blocks;
}
