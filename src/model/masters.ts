import { drawOrder } from './exportPlan';
import { orderedPages } from './ordering';
import type { AnyModule, Page, PatchworkFile } from './schema';

// Master pages (SPEC 4 M4): a master is an ordinary page on the board flagged `isMaster`, so it is
// edited with the same tools. Pages pointing at it with `master` show its modules underneath their
// own and inherit its header, footer, background and safe area. Pure.

/** Separates the page and master module IDs in an inherited module's ID; never valid in a real ID. */
export const INHERITED_SEP = '~';

/** Pages that are exported and numbered, in output order (master pages are left out). */
export function outputPages(file: Pick<PatchworkFile, 'pages' | 'board'>): Page[] {
	return orderedPages(file).filter((p) => !p.isMaster);
}

/** The master a page uses, if it names one that exists and is a master (no chains: masters have none). */
export function masterOf(file: Pick<PatchworkFile, 'pages'>, page: Page): Page | undefined {
	if (!page.master || page.isMaster) return undefined;
	const m = file.pages.find((p) => p.id === page.master);
	return m?.isMaster ? m : undefined;
}

export function isInheritedId(id: string): boolean {
	return id.includes(INHERITED_SEP);
}

/**
 * The page as it renders and exports: the master's modules first, below every module of the page
 * itself, with IDs unique per page (one master is shown on many pages), and the master's furniture
 * where the page sets none. Returns the page itself when it has no master.
 */
export function resolvePage(file: Pick<PatchworkFile, 'pages'>, page: Page): Page {
	const master = masterOf(file, page);
	if (!master) return page;
	const below = Math.min(0, ...page.modules.map((m) => m.z ?? 0)) - 1;
	const inherited: AnyModule[] = drawOrder(master.modules).map((m) => ({ ...m, id: `${page.id}${INHERITED_SEP}${m.id}`, z: below, locked: true }));
	const out: Page = { ...page, modules: [...inherited, ...page.modules] };
	for (const k of ['header', 'footer', 'background', 'safeArea'] as const) {
		if (out[k] === undefined && master[k] !== undefined) (out as Record<string, unknown>)[k] = master[k];
	}
	return out;
}

/** Pages using a master, for warnings before it is deleted or unflagged. */
export function pagesUsing(file: Pick<PatchworkFile, 'pages'>, masterId: string): Page[] {
	return file.pages.filter((p) => p.master === masterId && !p.isMaster);
}
