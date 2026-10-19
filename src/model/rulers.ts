import type { DisplayUnit } from './schema';
import { fromUnit } from './units';

export interface Ticks {
	/** Positions in mm (board coordinates) with labels in the display unit. */
	major: { mm: number; label: string }[];
	minor: number[];
}

/** "Nice" major steps per unit, smallest first. */
const STEPS: Record<DisplayUnit, number[]> = {
	mm: [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000],
	cm: [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500],
	in: [0.125, 0.25, 0.5, 1, 2, 5, 10, 20, 50, 100],
};
const MINOR_DIVISIONS: Record<DisplayUnit, number> = { mm: 5, cm: 5, in: 4 };

/**
 * Ruler ticks between `startMm` and `endMm` (board mm), measured from `originMm`, with major ticks
 * at least `minGapPx` apart on screen. Pure, so spacing rules are unit-tested.
 */
export function rulerTicks(startMm: number, endMm: number, originMm: number, pxPerMm: number, unit: DisplayUnit, minGapPx = 60): Ticks {
	const step = STEPS[unit].find((s) => fromUnit(s, unit) * pxPerMm >= minGapPx) ?? STEPS[unit][STEPS[unit].length - 1]!;
	const stepMm = fromUnit(step, unit);
	const minorMm = stepMm / MINOR_DIVISIONS[unit];
	const first = Math.ceil((startMm - originMm) / minorMm);
	const last = Math.floor((endMm - originMm) / minorMm);
	const major: Ticks['major'] = [];
	const minor: number[] = [];
	// Index-based so float accumulation never drifts over long rulers.
	for (let i = first; i <= last && i - first < 5000; i++) {
		const mm = originMm + i * minorMm;
		if (i % MINOR_DIVISIONS[unit] === 0) major.push({ mm, label: String(Number(((i / MINOR_DIVISIONS[unit]) * step).toFixed(3))) });
		else minor.push(mm);
	}
	return { major, minor };
}
