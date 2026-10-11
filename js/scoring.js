// Numerical helpers are kept pure: no DOM or database calls, which makes formulas auditable.
const clamp = (value, low = 0, high = 10) =>
	Math.max(low, Math.min(high, value));
const benchmark = (value, excellent) => clamp((Number(value) / excellent) * 10);
const round = (value) => Math.round(value * 100) / 100;

export function scoreSubmission(submission) {
	const d = submission.data;
	let parts;
	if (submission.facet === "speed") {
		const time = clamp((10 * (30 - Number(d.totalTime))) / (30 - 15));
		// Both boxes hold the length of that lap alone: lap 1 = time of the first split, lap 2 = (second split time - first split time).
		// (Older versions stored lap 2 as a running total and subtracted lap 1 here; the Lap Split button now does that subtraction.)
		const lapOne = Number(d.lap1);
		const lapTwo = Number(d.lap2);
		// Equal lap duration is perfect; the proportional difference reduces the pacing score.
		const pace =
			lapOne > 0 && lapTwo >= 0
				? clamp(
						10 * (1 - Math.abs(lapOne - lapTwo) / Math.max(lapOne, lapTwo, 1)),
					)
				: 0;
		const penalty = clamp(10 - 2 * Number(d.penalties));
		parts = {
			time,
			pace,
			penalty,
			final: 0.7 * time + 0.1 * pace + 0.2 * penalty,
		};
	} else if (submission.facet === "defense") {
		const scoring = benchmark(d.scorePreventions, 6);
		const fuel = benchmark(d.fuelPreventions, 4);
		const wasted = benchmark(d.secondsWasted, 30);
		parts = {
			scoring,
			fuel,
			wasted,
			final: 0.35 * scoring + 0.25 * fuel + 0.4 * wasted,
		};
	} else if (submission.facet === "offense") {
		const shot = benchmark(d.fuelShot, 30);
		const scored = benchmark(d.fuelScored, 20);
		const accuracy = Number(d.fuelShot)
			? clamp((10 * Number(d.fuelScored)) / Number(d.fuelShot))
			: 0;
		const evasion = benchmark(d.evasions, 5);
		parts = {
			shot,
			scored,
			accuracy,
			evasion,
			final: 0.2 * shot + 0.3 * scored + 0.25 * accuracy + 0.25 * evasion,
		};
	} else {
		const shot = benchmark(d.fuelShot, 30);
		const scored = benchmark(d.fuelScored, 20);
		const accuracy = Number(d.fuelShot)
			? clamp((10 * Number(d.fuelScored)) / Number(d.fuelShot))
			: 0;
		const penalty = clamp(10 - 2 * Number(d.penalties));
		parts = {
			shot,
			scored,
			accuracy,
			penalty,
			final: 0.2 * shot + 0.45 * scored + 0.25 * accuracy + 0.1 * penalty,
		};
	}
	return Object.fromEntries(
		Object.entries(parts).map(([key, value]) => [key, round(value)]),
	);
}

export function driverSummary(submissions) {
	const latestByFacet = new Map();
	submissions.forEach((entry) => {
		const old = latestByFacet.get(entry.facet);
		if (!old || entry.createdAt > old.createdAt)
			latestByFacet.set(entry.facet, entry);
	});
	const scores = [...latestByFacet.values()].map((entry) => entry.score.final);
	const completed = scores.length;
	const average = completed ? scores.reduce((a, b) => a + b, 0) / completed : 0;
	// Coverage-first rule: more completed facets always outweighs isolated excellence.
	const overall = completed
		? 2.5 * (completed - 1) + 0.249 * average + (completed === 4 ? 0.01 : 0)
		: 0;
	return {
		completed,
		average: round(average),
		overall: round(overall),
		facets: Object.fromEntries(
			[...latestByFacet].map(([key, entry]) => [key, entry.score.final]),
		),
	};
}
