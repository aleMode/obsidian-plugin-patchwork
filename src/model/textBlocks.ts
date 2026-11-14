import { tidyCrop } from './pdfGeometry';
import type { Crop } from './schema';

// "Crop to block" in the crop editor (review F10): from the text under a double-click, grow to the
// paragraph or table it belongs to. Works on text item boxes as fractions of the displayed page. Pure.

/** A text item's box, as fractions of the displayed page (0…1, y down). */
export interface TextBox {
	x0: number;
	y0: number;
	x1: number;
	y1: number;
}

const gap = (a0: number, a1: number, b0: number, b1: number) => Math.max(0, Math.max(a0, b0) - Math.min(a1, b1));
const overlaps = (a0: number, a1: number, b0: number, b1: number) => Math.min(a1, b1) - Math.max(a0, b0) > 0;

/**
 * Items of the same block as the one at `p`: the next line down is close (well under a blank line
 * away) and overlaps it sideways; words on one line are close sideways. Null when no text is at or
 * right next to `p`.
 */
export function blockAround(items: readonly TextBox[], p: { x: number; y: number }): TextBox | null {
	const boxes = items.filter((b) => b.x1 > b.x0 && b.y1 > b.y0);
	const near = 0.01;
	const seed = boxes.find((b) => p.x >= b.x0 - near && p.x <= b.x1 + near && p.y >= b.y0 - near && p.y <= b.y1 + near);
	if (!seed) return null;
	const line = seed.y1 - seed.y0;
	const linked = (a: TextBox, b: TextBox) => {
		const sameLine = overlaps(a.y0, a.y1, b.y0, b.y1) && gap(a.x0, a.x1, b.x0, b.x1) <= line * 1.5;
		const nextLine = gap(a.y0, a.y1, b.y0, b.y1) <= line * 0.6 && overlaps(a.x0, a.x1, b.x0, b.x1);
		return sameLine || nextLine;
	};
	const block = new Set([seed]);
	const queue = [seed];
	while (queue.length) {
		const a = queue.pop()!;
		for (const b of boxes) {
			if (block.has(b) || !linked(a, b)) continue;
			block.add(b);
			queue.push(b);
		}
	}
	const all = [...block];
	return { x0: Math.min(...all.map((b) => b.x0)), y0: Math.min(...all.map((b) => b.y0)), x1: Math.max(...all.map((b) => b.x1)), y1: Math.max(...all.map((b) => b.y1)) };
}

/** A crop around a block, with a small margin, inside the page. */
export function cropAroundBlock(b: TextBox, margin = 0.01): Crop {
	const c = (v: number) => Math.min(1, Math.max(0, v));
	return tidyCrop([c(b.x0 - margin), c(b.y0 - margin), c(b.x1 + margin), c(b.y1 + margin)]);
}
