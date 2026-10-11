// Builds and downloads a formatted PDF report. This module knows nothing about drivers, forms, or the database: it receives a plain
// description of the report (title, summary numbers, tables) and lays it out. app.js and customforms.js build that description.
//
// A report looks like:
// {
//   fileName: "DriveLab-speed-2026-10-10.pdf",
//   title: "Speed driving", subtitle: "Analysis report",
//   metrics: [ { label: "Attempts", value: "12" }, ... ],            // up to 4 summary boxes on the first page
//   blocks: [
//     { title: "Standings", note: "optional small text", orientation: "portrait" | "landscape",
//       head: ["Rank", "Driver", ...], body: [["#1", "Alex R", ...], ...],
//       align: ["center", "left", ...]   (optional: horizontal alignment per column)
//       nowrap: [0, 2]                   (optional: columns sized to fit their content so dates, grades and numbers never wrap)
//       compact: true                    (optional: smaller type and tighter rows, for long summary tables) },
//     { type: "text", title: "How the score works", lines: ["...", "..."], orientation: "portrait" }
//   ]
// }
// Wide tables are put on landscape pages automatically; summaries stay on portrait pages.

const SCRIPT_FILES = [
	"./vendor/jspdf.umd.min.js",
	"./vendor/jspdf.plugin.autotable.min.js",
];
let loading = null;

// The PDF libraries are about 450 KB, so they are only downloaded the first time someone exports.
function loadScript(relativePath) {
	return new Promise((resolve, reject) => {
		const script = document.createElement("script");
		script.src = new URL(relativePath, import.meta.url).href; // relative to this file, so it works on GitHub Pages sub-folders
		script.onload = resolve;
		script.onerror = () => reject(new Error(`Could not load ${relativePath}`));
		document.head.append(script);
	});
}
function loadLibraries() {
	loading ??= (async () => {
		for (const file of SCRIPT_FILES) await loadScript(file); // in order: jsPDF first, then the table plugin
		if (!window.jspdf?.jsPDF) throw new Error("The PDF library did not load.");
	})().catch((error) => {
		loading = null;
		throw error;
	}); // allow a retry after a failure
	return loading;
}

// jsPDF's built-in fonts only contain Western-European characters. Swap common typographic symbols for plain ones and replace
// anything else (for example emoji) with "?" so a stray symbol in a note can never corrupt the whole PDF.
export function pdfText(value) {
	return String(value ?? "")
		.replace(/[\u2018\u2019]/g, "'")
		.replace(/[\u201C\u201D]/g, '"')
		.replace(/[\u2013\u2014]/g, "-")
		.replace(/\u2026/g, "...")
		.replace(/\u00A0/g, " ")
		.replace(/[\r\n]+/g, " ")
		.replace(/[^\u0020-\u007E\u00A1-\u00FF]/g, "?");
}

const COLORS = {
	ink: [17, 29, 39],
	muted: [98, 113, 129],
	accent: [231, 88, 45],
	line: [214, 223, 230],
	panel: [244, 247, 249],
	head: [29, 45, 59],
};
const MARGIN = 14; // millimetres of white space at the left and right edges
const TOP = 27; // content starts below the page header band
const BOTTOM = 16; // reserved for the footer

export async function downloadReport(report) {
	await loadLibraries();
	const { jsPDF } = window.jspdf;
	const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
	const generated = new Date().toLocaleString();
	const pageSize = () => ({
		w: doc.internal.pageSize.getWidth(),
		h: doc.internal.pageSize.getHeight(),
	});
	const orientationNow = () => {
		const { w, h } = pageSize();
		return w > h ? "landscape" : "portrait";
	};
	const newPage = (orientation) => {
		doc.addPage("a4", orientation);
		return TOP;
	};

	// ---- Title and summary boxes (first page) ----
	let y = TOP;
	doc
		.setFont("helvetica", "bold")
		.setFontSize(19)
		.setTextColor(...COLORS.ink);
	doc.text(pdfText(report.title), MARGIN, y);
	y += 6.5;
	if (report.subtitle) {
		doc
			.setFont("helvetica", "normal")
			.setFontSize(10.5)
			.setTextColor(...COLORS.muted);
		doc.text(pdfText(report.subtitle), MARGIN, y);
		y += 4;
	}
	y += 3;
	if (report.metrics?.length) {
		const gap = 4,
			count = Math.min(4, report.metrics.length),
			{ w } = pageSize();
		const boxW = (w - MARGIN * 2 - gap * (count - 1)) / count,
			boxH = 19;
		report.metrics.slice(0, 4).forEach((m, i) => {
			const x = MARGIN + i * (boxW + gap);
			doc
				.setFillColor(...COLORS.panel)
				.setDrawColor(...COLORS.line)
				.roundedRect(x, y, boxW, boxH, 2, 2, "FD");
			// The small label shrinks too if it would run past the edge of the box.
			const labelText = pdfText(m.label).toUpperCase();
			let labelSize = 8;
			doc.setFont("helvetica", "normal").setTextColor(...COLORS.muted);
			for (; labelSize > 5.5; labelSize -= 0.25) {
				doc.setFontSize(labelSize);
				if (doc.getTextWidth(labelText) <= boxW - 8) break;
			}
			doc.setFontSize(labelSize);
			doc.text(labelText, x + 4, y + 6);
			// Long values (for example "30.00 (Hana H)") shrink until they fit on one line inside the box.
			const valueText = pdfText(m.value);
			let size = 15;
			doc
				.setFont("helvetica", "bold")
				.setTextColor(...(m.accent ? COLORS.accent : COLORS.ink));
			for (; size > 8; size -= 0.5) {
				doc.setFontSize(size);
				if (doc.getTextWidth(valueText) <= boxW - 8) break;
			}
			doc.setFontSize(size);
			doc.text(valueText, x + 4, y + 14.5, { maxWidth: boxW - 8 });
		});
		y += boxH + 9;
	}

	// ---- Blocks ----
	for (const block of report.blocks) {
		const wanted = block.orientation || "portrait";
		// Move to a fresh page when the block needs a different orientation, or when its heading would be stranded at the bottom.
		if (wanted !== orientationNow()) y = newPage(wanted);
		else if (y > pageSize().h - BOTTOM - 38) y = newPage(wanted);

		doc
			.setFont("helvetica", "bold")
			.setFontSize(12.5)
			.setTextColor(...COLORS.ink)
			.text(pdfText(block.title), MARGIN, y);
		y += 2.5;
		if (block.note) {
			y += 3.5;
			doc
				.setFont("helvetica", "normal")
				.setFontSize(8.5)
				.setTextColor(...COLORS.muted);
			doc.text(pdfText(block.note), MARGIN, y, {
				maxWidth: pageSize().w - MARGIN * 2,
			});
		}
		y += 3;

		if (block.type === "text") {
			doc
				.setFont("helvetica", "normal")
				.setFontSize(9.5)
				.setTextColor(...COLORS.ink);
			for (const line of block.lines) {
				const wrapped = doc.splitTextToSize(
					pdfText(line),
					pageSize().w - MARGIN * 2,
				);
				if (y + wrapped.length * 4.6 > pageSize().h - BOTTOM)
					y = newPage(orientationNow());
				doc.text(wrapped, MARGIN, y + 3);
				y += wrapped.length * 4.6 + 1.5;
			}
			y += 6;
			continue;
		}

		const wide = block.head.length > 7;
		doc.autoTable({
			startY: y,
			head: [block.head.map(pdfText)],
			body: block.body.length
				? block.body.map((row) => row.map(pdfText))
				: [
						[
							{
								content: "No data recorded.",
								colSpan: block.head.length,
								styles: { halign: "center", textColor: COLORS.muted },
							},
						],
					],
			margin: { top: TOP, bottom: BOTTOM, left: MARGIN, right: MARGIN }, // overflow pages keep the same margins as the first page
			theme: "grid",
			styles: {
				font: "helvetica",
				fontSize:
					block.head.length > 12 ? 7 : block.compact ? 8.5 : wide ? 8 : 9,
				cellPadding: block.compact ? 1.5 : wide ? 1.8 : 2.4,
				textColor: COLORS.ink,
				lineColor: COLORS.line,
				lineWidth: 0.2,
				overflow: "linebreak",
				valign: "middle",
			},
			headStyles: {
				fillColor: COLORS.head,
				textColor: 255,
				fontStyle: "bold",
				halign: "left",
			},
			alternateRowStyles: { fillColor: [248, 250, 251] },
			columnStyles: Object.fromEntries(
				block.head.map((_, i) => [
					i,
					{
						...(block.align?.[i] ? { halign: block.align[i] } : {}),
						...(block.nowrap?.includes(i) ? { cellWidth: "wrap" } : {}),
					},
				]),
			),
			rowPageBreak: "avoid", // a table row is never split across two pages
		});
		y = doc.lastAutoTable.finalY + 9;
	}

	// ---- Page header and footer, drawn last so "Page X of Y" knows the final page count ----
	const pages = doc.getNumberOfPages();
	for (let i = 1; i <= pages; i++) {
		doc.setPage(i);
		const { w, h } = pageSize();
		doc.setFillColor(...COLORS.head).rect(0, 0, w, 15, "F");
		doc
			.setFillColor(...COLORS.accent)
			.roundedRect(MARGIN, 4, 7, 7, 1.2, 1.2, "F");
		doc
			.setFont("helvetica", "bold")
			.setFontSize(6.5)
			.setTextColor(255)
			.text("DL", MARGIN + 3.5, 8.6, { align: "center" });
		doc.setFontSize(11).text("DriveLab", MARGIN + 10, 9);
		doc
			.setFont("helvetica", "normal")
			.setFontSize(8.5)
			.setTextColor(205, 215, 223)
			.text(pdfText(`Generated ${generated}`), w - MARGIN, 9, {
				align: "right",
			});
		doc.setDrawColor(...COLORS.line).line(MARGIN, h - 11, w - MARGIN, h - 11);
		doc.setFontSize(8).setTextColor(...COLORS.muted);
		doc.text(
			pdfText(`${report.title} | Contains student names and performance data`),
			MARGIN,
			h - 6.5,
		);
		doc.text(`Page ${i} of ${pages}`, w - MARGIN, h - 6.5, { align: "right" });
	}
	doc.save(report.fileName || "DriveLab-report.pdf");
}
