/** Round to the nearest multiple of `grid` (mm). A grid ≤ 0 disables snapping. */
export function snapValue(v: number, grid: number): number {
	if (!(grid > 0)) return v;
	// Rounding the quotient then multiplying can leave float noise (e.g. 0.30000000000000004).
	return Number((Math.round(v / grid) * grid).toFixed(6));
}

export function snapPoint(p: { x: number; y: number }, grid: number): { x: number; y: number } {
	return { x: snapValue(p.x, grid), y: snapValue(p.y, grid) };
}
