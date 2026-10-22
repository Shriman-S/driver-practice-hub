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

// Shared by the Defensive and Offensive forms: both are run at the same time on two laptops for 90 seconds.
const PAIRED_SESSION_BULLETS = [
	"This practice will take 90 seconds (1:30).",
	"As soon as the 90 seconds are over, both robots must be disabled.",
];

// Names and grades of the two drivers in a paired drill, written once so both forms use the same wording.
const DRIVER_1_NAME = "Driver 1 name (Offensive driver; REBUILT)";
const DRIVER_1_GRADE = "Driver 1 grade level (Offensive driver)";
const DRIVER_2_NAME = "Driver 2 name (Defensive driver; REEFSCAPE)";
const DRIVER_2_GRADE = "Driver 2 grade level (Defensive driver)";
// Extra hint on the driver who is being ASSESSED on that form (the name saved on the leaderboard).
const ASSESSED_HINT =
	"This is the driver being assessed on this form. First name with last initial.";

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

	defense: {
		label: "Defensive driving",
		short: "DEFENSE",
		timer: "countdown",
		intro: [
			"This driving practice form assesses the driver's ability to stop another robot from entering a certain area.",
			[
				"This driving form will be completed in tandem with the Offensive driving form (2 laptops will be required to track both drivers).",
				...PAIRED_SESSION_BULLETS,
			],
			[
				"The driver being assessed on this form is Driver 2 (they will be driving the REEFSCAPE robot).",
				"Driver 2's goal is to stop the REBUILT robot from scoring as many points as possible.",
			],
		],
		// Driver 1 is listed first on both paired forms so the two laptops show the drivers in the same order.
		driverFields: [
			["opponentName", DRIVER_1_NAME, "text", true],
			["opponentGrade", DRIVER_1_GRADE, "select", true],
			["driverName", DRIVER_2_NAME, "text", true, ASSESSED_HINT],
			["grade", DRIVER_2_GRADE, "select", true],
			["practiceDate", "Practice date", "date", true],
			COURSE_FIELD,
			robotField("Robot driven by Driver 2 (the assessed driver)"),
		],
		fields: [
			[
				"scorePreventions",
				"How many times did Driver 2 prevent Driver 1 from scoring?",
				"number",
				true,
				"",
				[
					'Driver 2 "prevents" Driver 1 from scoring if any of the following conditions are met:',
					[
						"If you believe Driver 1 could have continued scoring if Driver 2 wasn't there",
						"If you see Driver 1 needing to take a detour to score",
					],
				],
				"Times scoring was prevented",
			],
			[
				"fuelPreventions",
				"How many times did Driver 2 prevent Driver 1 from gathering fuel?",
				"number",
				true,
				"",
				[
					'Driver 2 "prevents" Driver 1 from gathering fuel if any of the following conditions are met:',
					[
						"If you believe Driver 1 could have continued gathering fuel if Driver 2 wasn't there",
						"If you see Driver 1 needing to take a detour to gather fuel",
					],
				],
				"Times fuel gathering was prevented",
			],
			[
				"secondsWasted",
				"How much time did Driver 2 waste for Driver 1?",
				"number",
				true,
				"Enter your estimate in seconds.",
				[
					"Time is wasted when Driver 2 forces Driver 1 to take longer to accomplish a goal.",
					[
						"Make an estimate for how much faster you think Driver 1 could have completed a goal, if Driver 2 wasn't there",
						"A goal could be anything like gathering fuel, scoring, moving to one side of the field, etc.",
						"Your answer below should be the estimate you come up with",
					],
				],
				"Estimated seconds wasted for Driver 1",
			],
		],
	},

	offense: {
		label: "Offensive driving",
		short: "OFFENSE",
		timer: "countdown",
		intro: [
			"This driving practice form assesses the driver's ability to continue scoring, even while a defensive robot tries to stop them.",
			[
				// The text supplied for this form said "offensive" here; it pairs with the DEFENSIVE form, so it is corrected.
				"This driving form will be completed in tandem with the Defensive driving form (2 laptops will be required to track both drivers).",
				...PAIRED_SESSION_BULLETS,
			],
			[
				"The driver being assessed on this form is Driver 1 (they will be driving the REBUILT robot).",
				"Driver 1's goal is to continue scoring, despite Driver 2 trying to stop them.",
			],
		],
		driverFields: [
			["driverName", DRIVER_1_NAME, "text", true, ASSESSED_HINT],
			["grade", DRIVER_1_GRADE, "select", true],
			["defenderName", DRIVER_2_NAME, "text", true],
			["defenderGrade", DRIVER_2_GRADE, "select", true],
			["practiceDate", "Practice date", "date", true],
			COURSE_FIELD,
			robotField("Robot driven by Driver 1 (the assessed driver)"),
		],
		fields: [
			[
				"fuelShot",
				"Total fuel shot",
				"number",
				true,
				"Count fuel that left the turret.",
			],
			["fuelScored", "Fuel scored", "number", true],
			[
				"evasions",
				"How many times did Driver 1 evade Driver 2?",
				"number",
				true,
				"",
				[
					'Driver 1 "evades" Driver 2\'s defenses if the following conditions are met:',
					[
						"If you believe that Driver 1 would have been able to score roughly the same amount of points, if Driver 2 wasn't there",
						"If you see Driver 2 struggling to keep up with Driver 1",
					],
				],
				"Successful evasions",
			],
		],
	},

};
// Shooting only was removed in Update 47. Attempts saved for it stay in the database but are no longer shown or counted.
export const GRADES = ["9th", "10th", "11th", "12th"];
export const OBSERVATIONS = ["Speed", "Agility", "Smooth driving", "Sporadic / Jittery Movement"];
