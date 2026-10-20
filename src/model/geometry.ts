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

export const containsRect = (outer: Rect, inner: Rect): boolean =>
	inner.x >= outer.x && inner.y >= outer.y && right(inner) <= right(outer) && bottom(inner) <= bottom(outer);

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

/**
 * Pull a page-relative rect back until at least `minVisible` of it (or all of it, if smaller) is
 * inside the page on each axis. Modules are clipped to their page, so one dropped entirely outside
 * would be invisible and impossible to grab; poking past an edge (bleed) is still allowed.
 */
export function keepGrabbable(r: Rect, page: { w: number; h: number }, minVisible: number): Rect {
	const pull = (pos: number, size: number, extent: number) => {
		const need = Math.min(minVisible, size, extent);
		if (Math.min(pos + size, extent) - Math.max(pos, 0) >= need) return pos;
		return pos < 0 ? need - size : extent - need;
	};
	return { ...r, x: pull(r.x, r.w, page.w), y: pull(r.y, r.h, page.h) };
}

export type Handle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

/**
 * Resize `start` by dragging `handle` by (dx, dy). Edges not on the handle stay put. The rect never
 * gets smaller than `min`; with `keepAspect` the original proportions are kept (corner handles).
 * `snap` rounds the moved edges, so snapping never shifts the fixed ones.
 */
export function resizeRect(start: Rect, handle: Handle, dx: number, dy: number, opts: { min: number; keepAspect?: boolean; snap?: (v: number) => number }): Rect {
	const snap = opts.snap ?? ((v: number) => v);
	let x0 = start.x, y0 = start.y, x1 = right(start), y1 = bottom(start);
	if (handle.includes('w')) x0 = Math.min(snap(x0 + dx), x1 - opts.min);
	if (handle.includes('e')) x1 = Math.max(snap(x1 + dx), x0 + opts.min);
	if (handle.includes('n')) y0 = Math.min(snap(y0 + dy), y1 - opts.min);
	if (handle.includes('s')) y1 = Math.max(snap(y1 + dy), y0 + opts.min);
	let r = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
	if (opts.keepAspect && handle.length === 2) r = keepAspect(start, r, handle);
	return r;
}

/** Grow the dragged rect to the start's aspect ratio, anchored at the corner opposite the handle. */
function keepAspect(start: Rect, r: Rect, handle: Handle): Rect {
	const aspect = start.w / start.h;
	const w = Math.max(r.w, r.h * aspect);
	const h = w / aspect;
	const x = handle.includes('w') ? right(r) - w : r.x;
	const y = handle.includes('n') ? bottom(r) - h : r.y;
	return { x, y, w, h };
}
