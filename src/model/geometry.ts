import type { Fit } from './schema';

export interface Rect {
	x: number;
	y: number;
	w: number;
	h: number;
}

export interface Point {
	x: number;
	y: number;
}

export const right = (r: Rect) => r.x + r.w;
export const bottom = (r: Rect) => r.y + r.h;
export const center = (r: Rect): Point => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

/** Touching edges do not count as intersecting, so adjacent pages are not "overlapping". */
export function intersects(a: Rect, b: Rect): boolean {
	return a.x < right(b) && b.x < right(a) && a.y < bottom(b) && b.y < bottom(a);
}

export function containsPoint(r: Rect, p: Point): boolean {
	return p.x >= r.x && p.x <= right(r) && p.y >= r.y && p.y <= bottom(r);
}

/** Smallest rect containing all rects, or null for an empty list. */
export function bounds(rects: readonly Rect[]): Rect | null {
	if (rects.length === 0) return null;
	let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
	for (const r of rects) {
		x0 = Math.min(x0, r.x);
		y0 = Math.min(y0, r.y);
		x1 = Math.max(x1, right(r));
		y1 = Math.max(y1, bottom(r));
	}
	return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export function inset(r: Rect, by: number): Rect {
	return { x: r.x - by, y: r.y - by, w: r.w + 2 * by, h: r.h + 2 * by };
}

/** Translate a page-relative rect onto the board. */
export function toBoard(rect: Rect, page: Point): Rect {
	return { ...rect, x: page.x + rect.x, y: page.y + rect.y };
}

/**
 * Place content of the given aspect ratio (w/h) inside a box.
 * contain: whole content visible, centred. cover: box filled, centred, overflow clipped by the caller.
 * stretch: content takes the box exactly.
 */
export function fitRect(aspect: number, box: Rect, fit: Fit): Rect {
	if (fit === 'stretch' || !(aspect > 0)) return { ...box };
	const boxAspect = box.w / box.h;
	const widthLimited = fit === 'contain' ? aspect >= boxAspect : aspect < boxAspect;
	const w = widthLimited ? box.w : box.h * aspect;
	const h = widthLimited ? box.w / aspect : box.h;
	return { x: box.x + (box.w - w) / 2, y: box.y + (box.h - h) / 2, w, h };
}

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
