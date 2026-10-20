/** Round to the nearest multiple of `grid` (mm). A grid ≤ 0 disables snapping. */
export function snapValue(v: number, grid: number): number {
	if (!(grid > 0)) return v;
	// Rounding the quotient then multiplying can leave float noise (e.g. 0.30000000000000004).
	return Number((Math.round(v / grid) * grid).toFixed(6));
}

export function snapPoint(p: { x: number; y: number }, grid: number): { x: number; y: number } {
	return { x: snapValue(p.x, grid), y: snapValue(p.y, grid) };
}

/**
 * Spacing in px of the grid lines to draw. When the real grid would be denser than `minPx`, draw every
 * 1st/2nd/5th/10th… line (the smallest such multiple that fits), so lines stay on grid points and the
 * drawn spacing stays close to the real one instead of jumping in big steps.
 */
export function gridDrawStep(stepPx: number, minPx: number): number {
	if (!(stepPx > 0) || stepPx >= minPx) return stepPx;
	for (let decade = 1; ; decade *= 10) {
		for (const m of [1, 2, 5]) if (stepPx * m * decade >= minPx) return stepPx * m * decade;
	}
}
