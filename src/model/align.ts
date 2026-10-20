import { bounds, type Point, type Rect } from './geometry';

export type AlignMode = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom';

/** New top-left positions aligning every rect to the selection's bounding box (SPEC 5.6). */
export function alignRects(rects: readonly Rect[], mode: AlignMode): Point[] {
	const b = bounds(rects);
	if (!b) return [];
	return rects.map((r) => {
		switch (mode) {
			case 'left':
				return { x: b.x, y: r.y };
			case 'hcenter':
				return { x: b.x + (b.w - r.w) / 2, y: r.y };
			case 'right':
				return { x: b.x + b.w - r.w, y: r.y };
			case 'top':
				return { x: r.x, y: b.y };
			case 'vcenter':
				return { x: r.x, y: b.y + (b.h - r.h) / 2 };
			case 'bottom':
				return { x: r.x, y: b.y + b.h - r.h };
		}
	});
}

/**
 * Equal gaps between rects along an axis, keeping the first and last (by position) where they are.
 * Returns positions in the input order. Needs at least three rects to change anything.
 */
export function distributeRects(rects: readonly Rect[], axis: 'h' | 'v'): Point[] {
	const out = rects.map((r) => ({ x: r.x, y: r.y }));
	if (rects.length < 3) return out;
	const pos = (r: Rect) => (axis === 'h' ? r.x : r.y);
	const size = (r: Rect) => (axis === 'h' ? r.w : r.h);
	const order = rects.map((r, i) => ({ r, i })).sort((a, b) => pos(a.r) - pos(b.r));
	const first = order[0]!.r, last = order[order.length - 1]!.r;
	const span = pos(last) + size(last) - pos(first);
	const gap = (span - order.reduce((s, o) => s + size(o.r), 0)) / (order.length - 1);
	let cursor = pos(first);
	for (const { r, i } of order) {
		if (axis === 'h') out[i]!.x = cursor;
		else out[i]!.y = cursor;
		cursor += size(r) + gap;
	}
	return out;
}
