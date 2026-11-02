// Swerve Chassis experience (shown on a driver's profile, administrators only).
//
// "Experience" is how many recorded attempts the driver has had on the Swerve Chassis, counted across EVERY drill and form that
// records a robot (Speed, Offensive and Defensive rounds, older Offensive / Defensive attempts, and custom forms). The count is turned
// into a level the administrator can read at a glance: a coloured badge with a five-step meter, the attempt count, and what share of
// the driver's attempts were on the Swerve.
//
//   0 attempts  = No experience     1-2 = Beginner     3-5 = Developing     6-9 = Experienced     10 or more = Very experienced
import { esc, dateText } from "./util.js";

export const SWERVE = "Swerve Chassis";
export const SWERVE_LEVELS = [
	{ min: 0, label: "No experience", steps: 0, tone: "none", note: "Has not driven the Swerve Chassis yet." },
	{ min: 1, label: "Beginner", steps: 1, tone: "low", note: "Very few attempts on the Swerve Chassis." },
	{ min: 3, label: "Developing", steps: 3, tone: "mid", note: "Some attempts, still building experience." },
	{ min: 6, label: "Experienced", steps: 4, tone: "good", note: "Plenty of attempts on the Swerve Chassis." },
	{ min: 10, label: "Very experienced", steps: 5, tone: "great", note: "Extensive attempts on the Swerve Chassis." },
];
const levelFor = (count) => [...SWERVE_LEVELS].reverse().find((l) => count >= l.min);
// `attempts` = every submission of one driver.
export function swerveExperience(attempts) {
	const robotOf = (x) => x.data?.robot || "";
	const swerve = attempts.filter((x) => robotOf(x) === SWERVE);
	const withRobot = attempts.filter((x) => robotOf(x)).length;
	const last = swerve.map((x) => String(x.date || "")).sort().at(-1) || "";
	const level = levelFor(swerve.length);
	return { count: swerve.length, total: attempts.length, withRobot, share: withRobot ? Math.round((swerve.length / withRobot) * 100) : 0, last, level };
}
export function swerveExperienceHtml(e) {
	const l = e.level;
	const pips = Array.from({ length: 5 }, (_, i) => `<i class="${i < l.steps ? "on" : ""}"></i>`).join("");
	return `<section class="driver-section swerve-exp swerve-${l.tone}"><h3>Swerve Chassis experience</h3>
  <div class="swerve-row"><span class="swerve-badge">${esc(l.label)}</span><span class="swerve-meter" role="img" aria-label="${l.steps} of 5">${pips}</span><span class="swerve-count"><b>${e.count}</b> attempt${e.count === 1 ? "" : "s"} on the Swerve Chassis</span></div>
  <p class="help">${esc(l.note)} ${e.count ? `${e.share}% of this driver's attempts with a recorded robot were on the Swerve Chassis${e.last ? `; last drove it on ${esc(dateText(e.last))}` : ""}.` : ""} Levels: 1-2 attempts Beginner, 3-5 Developing, 6-9 Experienced, 10 or more Very experienced.</p></section>`;
}
