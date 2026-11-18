import type { Rect } from './geometry';

// Where the context bar, or the pill it folds into, floats next to the selection. Pure (hard rule 5).

export interface FloatView {
	width: number;
	height: number;
	/** Space at the top taken by the toolbar: nothing floats under it. */
	top: number;
}

/**
 * Above the selection, else below it, else just inside its top edge; centred on the part of the
 * selection that is on screen and kept inside the view. Null when none of the selection is on screen.
 *
 * The side is chosen for `reserveH` (the open bar's height), not just the element's own height, so the
 * pill sits where the bar will open: a pill that fitted above while the bar didn't opened the bar below,
 * away from the pointer, and it folded up again before it could be reached. Above, the element's bottom
 * edge is fixed; below, its top edge; so the bar opens over the pill either way.
 */
export function placeFloating(sel: Rect, view: FloatView, size: { w: number; h: number }, reserveH: number, gap = 10): { x: number; y: number } | null {
	const vx0 = Math.max(sel.x, 0);
	const vx1 = Math.min(sel.x + sel.w, view.width);
	const vy0 = Math.max(sel.y, view.top);
	const vy1 = Math.min(sel.y + sel.h, view.height);
	if (vx1 <= vx0 || vy1 <= vy0) return null;
	const tall = Math.max(size.h, reserveH);
	let y: number;
	if (vy0 - tall - gap >= view.top) y = vy0 - size.h - gap;
	else if (vy1 + gap + tall <= view.height - gap) y = vy1 + gap;
	else y = Math.max(view.top, vy0 + gap);
	const x = Math.min(Math.max(gap, (vx0 + vx1) / 2 - size.w / 2), Math.max(gap, view.width - size.w - gap));
	return { x, y };
}
