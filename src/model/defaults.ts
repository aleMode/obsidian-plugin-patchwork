import { bounds, right } from './geometry';
import { newId } from './ids';
import type { BoardSettings, Page, PatchworkFile } from './schema';
import { SCHEMA_VERSION } from './schema';

export function defaultBoardSettings(): BoardSettings {
	return {
		grid: { size: 5, snap: true, visible: true },
		displayUnit: 'mm',
		numbering: { enabled: false, start: 1, format: 'arabic', position: 'bottom-center', skipFirst: false },
		useAppTheme: false,
		export: { format: 'pdf', sheet: 'native', orientation: 'auto', tileOverlap: 0, cropMarks: false, dpi: 200, quality: 'best' },
	};
}

/** Gap between pages placed automatically, so they read as separate sheets. */
export const PAGE_GAP_MM = 20;

export function allIds(file: PatchworkFile): Set<string> {
	const ids = new Set<string>();
	for (const p of file.pages) {
		ids.add(p.id);
		for (const m of p.modules) ids.add(m.id);
	}
	return ids;
}

/** Where a new page goes: right of everything, aligned with the top of the board. */
export function nextPagePosition(pages: readonly Page[]): { x: number; y: number } {
	const b = bounds(pages);
	return b ? { x: right(b) + PAGE_GAP_MM, y: b.y } : { x: 0, y: 0 };
}

export function newPage(file: PatchworkFile, size: { w: number; h: number }, name?: string): Page {
	const { x, y } = nextPagePosition(file.pages);
	const page: Page = { id: newId(allIds(file)), x, y, w: size.w, h: size.h, modules: [] };
	if (name) page.name = name;
	return page;
}

export function newBoardFile(opts: { title?: string; created?: string; firstPage?: { w: number; h: number } } = {}): PatchworkFile {
	const file: PatchworkFile = {
		version: SCHEMA_VERSION,
		unit: 'mm',
		meta: {},
		board: defaultBoardSettings(),
		pages: [],
	};
	if (opts.title) file.meta!.title = opts.title;
	if (opts.created) file.meta!.created = opts.created;
	if (opts.firstPage) file.pages.push(newPage(file, opts.firstPage, 'Page 1'));
	return file;
}
