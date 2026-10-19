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

/** Pages in output order: the manual list first (when manual), then everything else in reading order. */
export function orderedPages(file: Pick<PatchworkFile, 'pages' | 'board'>): Page[] {
	const reading = readingOrder(file.pages);
	if (file.board.order !== 'manual' || !file.board.pageOrder) return reading;
	const byId = new Map(file.pages.map((p) => [p.id, p]));
	const listed = file.board.pageOrder.map((id) => byId.get(id)).filter((p): p is Page => !!p);
	const listedIds = new Set(listed.map((p) => p.id));
	return [...listed, ...reading.filter((p) => !listedIds.has(p.id))];
}

/** Drop pageOrder IDs that no longer match a page (SPEC 5.4: removed on save). Returns a new object only if needed. */
export function cleanPageOrder(file: PatchworkFile): PatchworkFile {
	const order = file.board.pageOrder;
	if (!order) return file;
	const ids = new Set(file.pages.map((p) => p.id));
	const kept = order.filter((id, i) => ids.has(id) && order.indexOf(id) === i);
	if (kept.length === order.length) return file;
	return { ...file, board: { ...file.board, pageOrder: kept } };
}
