// All predefined drills are defined as data so the renderer and scoring code stay separate.
//
// Each drill (facet) has:
//   label        - name shown on the drill card and as the form title
//   short        - small tag shown on the drill card
//   timer        - "stopwatch" or "countdown" (the 90-second timer)
//   intro        - the form description shown at the top of the form (see "Text blocks" below)
//   driverFields - the "Driver information" section: who is driving, the practice date, and who is recording
//   fields       - the "Driver performance" section: the measured results that are scored
//
// A field is an array:  [ name, label, type, required, help, description, shortLabel ]
//   name        - the input's id/name; this is also the key the answer is saved under (scoring.js and the Analysis tab read it)
//   label       - the question as the recorder sees it
//   type        - "text", "number", "date", "select" (a grade dropdown), "robot" (the ROBOTS dropdown), or "course" (a dropdown of
//                 the published courses for this drill, from the Courses page; saved as the course id, e.g. "speed-1")
//   required    - true if the form cannot be submitted without it
//   help        - optional small hint shown UNDER the input
//   description - optional explanation shown between the question and its input, for questions recorders could interpret differently
//   shortLabel  - optional shorter name used for the column heading in the Analysis tab (defaults to the label)
//
// Text blocks (used by `intro` and by a field's `description`) are arrays where
//   a plain string      = a paragraph
//   an array of strings = a bulleted list shown beneath the paragraph above it
// Example:  [ "Main sentence.", [ "first bullet", "second bullet" ], "A closing sentence." ]

// The robots a driver can drive. Every form (built-in and custom) asks which one was driven.
export const ROBOTS = ["REBUILT Robot", "REEFSCAPE Robot", "Swerve Chassis"];
// Which course family each drill is driven on (defense and offense share the paired-drill courses). See courses.js.
export const FACET_COURSE_GROUP = { speed: "speed", defense: "defense", offense: "defense" };
// The two questions every form shares. The course answer selects the course's own scoring settings (scoring.js).
const COURSE_FIELD = [
	"course",
	"Course driven",
	"course",
	true,
	"Choose the layout used today. The layouts are on the Courses page.",
];
const robotField = (label) => ["robot", label, "robot", true];

// The penalty rules (shown on the Speed driving form).
const PENALTY_DESCRIPTION = [
	"1 penalty is added if the driver does any of the following:",
	[
		"Hits any object on the course (wood pieces, chairs, tables, cones, etc.)",
		"Drives the robot more than 50% off the field (this means the driver moved at least 50% of the robot outside of the field boundaries)",
	],
	"Drivers can get multiple penalties for the same criteria (ex. if the driver hits a chair 3 separate times, they receive 3 penalties).",
];

export const FACETS = {
	speed: {
		label: "Speed driving",
		short: "SPEED",
		timer: "stopwatch",
		intro: [
			"This driving practice form assesses the driver's ability to complete a course as fast as possible.",
		],
		driverFields: [
			[
				"driverName",
				"Driver name",
				"text",
				true,
				"First name with last initial.",
			],
			["grade", "Driver grade level", "select", true],
			["practiceDate", "Practice date", "date", true],
			["timerName", "Timer / observer name", "text", true],
			COURSE_FIELD,
			robotField("Robot driven"),
		],
		fields: [
			[
				"totalTime",
				"Total drive time (seconds)",
				"number",
				true,
				"Decimal seconds, e.g. 15.45. Filled in when you press Stop on the stopwatch.",
			],
			[
				"lap1",
				"First lap split (seconds)",
				"number",
				true,
				"Filled in by the Lap Split button (press it once, at the end of lap 1), or type it in.",
			],
			[
				"lap2",
				"Second lap split (seconds)",
				"number",
				true,
				"Length of the second lap only (not the running total). Filled in automatically when you press Stop, or type it in.",
			],
			[
				"penalties",
				"Number of penalties received",
				"number",
				true,
				"",
				PENALTY_DESCRIPTION,
				"Penalties received",
			],
		],
	},

	// Offensive and Defensive driving are ONE practice, Territory Breakthrough (Release 1.6). It has its own page (territory.js) with a
	// match manager and the two scorers' forms, so these entries only describe how its attempts appear in the Analysis tables:
	// `fields` are the measured numbers every attempt saves (the checkpoint times, the finish time, and penalties).
	// Attempts recorded before Release 1.6 (the fuel-based forms) stay in the database but are not shown or ranked.
	defense: {
		label: "Defensive driving",
		short: "DEFENSE",
		timer: "countdown",
		territory: true,
		intro: [
			"Territory Breakthrough: the Defensive Driver tries to stop the Offensive Driver from crossing G1, G2 and G3 in order and reaching the finish zone within 60 seconds.",
		],
		driverFields: [
			["driverName", "Defensive Driver's name", "text", true, "First name with last initial."],
			["grade", "Driver grade level", "select", true],
			["practiceDate", "Date of practice", "date", true],
			COURSE_FIELD,
			robotField("Robot used by the Defensive Driver"),
		],
		fields: [
			["g1", "Offensive Driver crossed G1 at (seconds)", "number", false, "", null, "G1 time (s)"],
			["g2", "Offensive Driver crossed G2 at (seconds)", "number", false, "", null, "G2 time (s)"],
			["g3", "Offensive Driver crossed G3 at (seconds)", "number", false, "", null, "G3 time (s)"],
			["finishTime", "Offensive Driver finished at (seconds)", "number", false, "", null, "Finish time (s)"],
			["penalties", "Penalties received by the Defensive Driver", "number", false, "", null, "Penalties"],
		],
	},

	offense: {
		label: "Offensive driving",
		short: "OFFENSE",
		timer: "countdown",
		territory: true,
		intro: [
			"Territory Breakthrough: the Offensive Driver must cross G1, G2 and G3 in order and reach the finish zone within 60 seconds, while a Defensive Driver tries to stop them.",
		],
		driverFields: [
			["driverName", "Offensive Driver's name", "text", true, "First name with last initial."],
			["grade", "Driver grade level", "select", true],
			["practiceDate", "Date of practice", "date", true],
			COURSE_FIELD,
			robotField("Robot used by the Offensive Driver"),
		],
		fields: [
			["g1", "Crossed G1 at (seconds)", "number", false, "", null, "G1 time (s)"],
			["g2", "Crossed G2 at (seconds)", "number", false, "", null, "G2 time (s)"],
			["g3", "Crossed G3 at (seconds)", "number", false, "", null, "G3 time (s)"],
			["finishTime", "Reached the finish zone at (seconds)", "number", false, "", null, "Finish time (s)"],
			["penalties", "Penalties received by the Offensive Driver", "number", false, "", null, "Penalties"],
		],
	},

};
// Shooting only was removed in Update 47. Attempts saved for it stay in the database but are no longer shown or counted.
export const GRADES = ["9th", "10th", "11th", "12th"];
export const OBSERVATIONS = ["Speed", "Agility", "Smooth driving", "Sporadic / Jittery Movement"];
