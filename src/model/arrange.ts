import { PAGE_GAP_MM } from './defaults';
import type { Point } from './geometry';
import { orderedPages } from './ordering';
import type { PatchworkFile } from './schema';

/**
 * Auto-arrange (SPEC 5.4): lay pages out in their output order, as one row or a grid that wraps
 * after `columns` pages. Rows align at the top; each row starts below the tallest page above.
 * Returns new positions by page ID; the first page stays where it is.
 */
export function arrangePages(file: PatchworkFile, layout: 'row' | 'grid', gap = PAGE_GAP_MM, columns?: number): Map<string, Point> {
	const pages = orderedPages(file);
	const out = new Map<string, Point>();
	if (pages.length === 0) return out;
	const cols = layout === 'row' ? pages.length : Math.max(1, columns ?? Math.ceil(Math.sqrt(pages.length)));
	const origin = { x: pages[0]!.x, y: pages[0]!.y };
	let x = origin.x, y = origin.y, rowHeight = 0;
	pages.forEach((p, i) => {
		if (i > 0 && i % cols === 0) {
			x = origin.x;
			y += rowHeight + gap;
			rowHeight = 0;
		}
		out.set(p.id, { x, y });
		x += p.w + gap;
		rowHeight = Math.max(rowHeight, p.h);
	});
	return out;
}
