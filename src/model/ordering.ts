import type { Page, PatchworkFile } from './schema';

/**
 * Reading order: rows top to bottom, then left to right within a row.
 * A page joins the current row when its top edge is above the vertical centre of the row's first
 * page, so slightly misaligned pages still read as one row, but a page clearly below starts a new one.
 */
export function readingOrder<T extends Pick<Page, 'id' | 'x' | 'y' | 'h'>>(pages: readonly T[]): T[] {
	const byTop = [...pages].sort((a, b) => a.y - b.y || a.x - b.x || a.id.localeCompare(b.id));
	const rows: T[][] = [];
	let rowCentre = -Infinity;
	for (const p of byTop) {
		const row = rows[rows.length - 1];
		if (row && p.y < rowCentre) row.push(p);
		else {
			rows.push([p]);
			rowCentre = p.y + p.h / 2;
		}
	}
	return rows.flatMap((row) => row.sort((a, b) => a.x - b.x || a.id.localeCompare(b.id)));
}

/** Pages in output order: reading order (SPEC 5.4). */
export function orderedPages(file: Pick<PatchworkFile, 'pages'>): Page[] {
	return readingOrder(file.pages);
}
