import type { Rect } from './geometry';

export interface GuideSnap {
	/** Snapped position, per axis, or null when nothing was close enough on that axis. */
	x: number | null;
	y: number | null;
	/** Guide lines to draw: board/page coordinates of the matched edges or centres. */
	vertical: number[];
	horizontal: number[];
}

const stops = (start: number, size: number) => [start, start + size / 2, start + size];

/** Best alignment of one axis: the moving rect's start/centre/end against every target stop. */
function snapAxis(start: number, size: number, targets: number[], threshold: number): { pos: number; line: number } | null {
	let best: { pos: number; line: number; dist: number } | null = null;
	stops(start, size).forEach((s, i) => {
		for (const t of targets) {
			const dist = Math.abs(t - s);
			if (dist <= threshold && (!best || dist < best.dist)) best = { pos: t - (i * size) / 2, line: t, dist };
		}
	});
	return best;
}

/**
 * Smart guides (SPEC 5.6): snap a moving rect's edges and centre to those of `others` when within
 * `threshold` (same units as the rects). Each axis snaps independently.
 */
export function snapToGuides(moving: Rect, others: readonly Rect[], threshold: number): GuideSnap {
	const xs = others.flatMap((o) => stops(o.x, o.w));
	const ys = others.flatMap((o) => stops(o.y, o.h));
	const sx = snapAxis(moving.x, moving.w, xs, threshold);
	const sy = snapAxis(moving.y, moving.h, ys, threshold);
	return { x: sx?.pos ?? null, y: sy?.pos ?? null, vertical: sx ? [sx.line] : [], horizontal: sy ? [sy.line] : [] };
}
