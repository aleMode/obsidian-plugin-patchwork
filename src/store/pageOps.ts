import { newPage } from '../model/defaults';
import { flowChains } from '../model/flow';
import type { AnyModule, Page, PatchworkFile } from '../model/schema';

// Immutable edits used with BoardStore.update. Each returns the same object when nothing changes,
// so no-op edits don't create undo steps.

/** The module `moduleId` on page `pageId`, if both exist. */
export function findModule(file: PatchworkFile, pageId: string | undefined, moduleId: string | undefined): AnyModule | undefined {
	return file.pages.find((p) => p.id === pageId)?.modules.find((m) => m.id === moduleId);
}

export function mapPage(file: PatchworkFile, id: string, fn: (p: Page) => Page): PatchworkFile {
	let changed = false;
	const pages = file.pages.map((p) => {
		if (p.id !== id) return p;
		const next = fn(p);
		changed ||= next !== p;
		return next;
	});
	return changed ? { ...file, pages } : file;
}

export function addPage(file: PatchworkFile, size: { w: number; h: number }, name?: string): { file: PatchworkFile; page: Page } {
	const page = newPage(file, size, name);
	return { file: { ...file, pages: [...file.pages, page] }, page };
}

export function movePage(file: PatchworkFile, id: string, x: number, y: number): PatchworkFile {
	return mapPage(file, id, (p) => (p.x === x && p.y === y ? p : { ...p, x, y }));
}

export function removePage(file: PatchworkFile, id: string): PatchworkFile {
	// Take its modules out one by one first, so linked frames on this page close up their chains.
	const emptied = (file.pages.find((p) => p.id === id)?.modules ?? []).reduce((acc, m) => removeModule(acc, id, m.id), file);
	const pages = emptied.pages.filter((p) => p.id !== id);
	return pages.length === emptied.pages.length ? emptied : { ...emptied, pages };
}

export function addModule(file: PatchworkFile, pageId: string, module: AnyModule): PatchworkFile {
	return mapPage(file, pageId, (p) => ({ ...p, modules: [...p.modules, module] }));
}

export function mapModule(file: PatchworkFile, pageId: string, moduleId: string, fn: (m: AnyModule) => AnyModule): PatchworkFile {
	return mapPage(file, pageId, (p) => {
		let changed = false;
		const modules = p.modules.map((m) => {
			if (m.id !== moduleId) return m;
			const next = fn(m);
			changed ||= next !== m;
			return next;
		});
		return changed ? { ...p, modules } : p;
	});
}

export function moveModule(file: PatchworkFile, pageId: string, moduleId: string, x: number, y: number): PatchworkFile {
	return mapModule(file, pageId, moduleId, (m) => (m.x === x && m.y === y ? m : { ...m, x, y }));
}

export function removeModule(file: PatchworkFile, pageId: string, moduleId: string): PatchworkFile {
	const removed = findModule(file, pageId, moduleId);
	const next = mapPage(file, pageId, (p) => {
		const modules = p.modules.filter((m) => m.id !== moduleId);
		return modules.length === p.modules.length ? p : { ...p, modules };
	});
	// Deleting a linked frame joins its neighbours, so the text keeps flowing (M5).
	if (removed?.type !== 'frame' || next === file) return next;
	return {
		...next,
		pages: next.pages.map((p) => (p.modules.some((m) => m.from === moduleId) ? { ...p, modules: p.modules.map((m) => (m.from === moduleId ? { ...m, from: removed.from } : m)) } : p)),
	};
}

/**
 * Move a module to the top or bottom of the page's draw order. Order is by `z`, then array order
 * (SPEC 6), so the module also takes the extreme `z` when other modules use one.
 */
export function restack(file: PatchworkFile, pageId: string, moduleId: string, to: 'front' | 'back'): PatchworkFile {
	return mapPage(file, pageId, (p) => {
		const m = p.modules.find((x) => x.id === moduleId);
		if (!m) return p;
		const rest = p.modules.filter((x) => x !== m);
		const zs = rest.map((x) => x.z ?? 0);
		const z = to === 'front' ? Math.max(0, ...zs) : Math.min(0, ...zs);
		const moved = (m.z ?? 0) === z ? m : { ...m, z };
		return { ...p, modules: to === 'front' ? [...rest, moved] : [moved, ...rest] };
	});
}

/**
 * Copies of modules, each nudged on its own page, with new IDs. Linked frames are re-linked so no two
 * frames continue the same text: a copy whose source was copied too continues that copy (a copied
 * chain is a new chain); any other copied frame joins the end of its original chain.
 */
export function duplicateModules(file: PatchworkFile, picks: readonly { pageId: string; moduleId: string }[], ids: () => string, offset = 5): { file: PatchworkFile; copies: { pageId: string; moduleId: string }[] } {
	const idMap = new Map<string, string>();
	const copies: { pageId: string; moduleId: string }[] = [];
	let next = file;
	for (const { pageId, moduleId } of picks) {
		const m = findModule(file, pageId, moduleId);
		if (!m || idMap.has(m.id)) continue;
		const id = ids();
		idMap.set(m.id, id);
		copies.push({ pageId, moduleId: id });
		next = addModule(next, pageId, { ...structuredClone(m), id, x: m.x + offset, y: m.y + offset, locked: undefined });
	}
	return { file: relinkCopiedFrames(file, next, idMap), copies };
}

/** Copy of a page and its modules (all with new IDs), placed to the right of everything. */
export function duplicatePage(file: PatchworkFile, pageId: string, ids: () => string): PatchworkFile {
	const p = file.pages.find((x) => x.id === pageId);
	if (!p) return file;
	const right = Math.max(...file.pages.map((x) => x.x + x.w));
	const copy = { ...structuredClone(p), id: ids(), x: right + 20, name: p.name ? `${p.name} copy` : undefined };
	const idMap = new Map<string, string>();
	copy.modules = copy.modules.map((m) => {
		const id = ids();
		idMap.set(m.id, id);
		return { ...m, id };
	});
	return relinkCopiedFrames(file, { ...file, pages: [...file.pages, copy] }, idMap);
}

/**
 * Point copied frames somewhere valid (see duplicateModules). `before` is the file without the copies,
 * whose chains say where each original frame's chain ends; `idMap` maps original IDs to copies.
 */
function relinkCopiedFrames(before: PatchworkFile, after: PatchworkFile, idMap: ReadonlyMap<string, string>): PatchworkFile {
	const chains = flowChains(before);
	/** Current end of each original chain, by head ID, as copies are appended to it. */
	const tails = new Map<string, string>();
	const from = new Map<string, string>();
	for (const [original, copy] of idMap) {
		const info = chains.get(original);
		const m = before.pages.flatMap((p) => p.modules).find((x) => x.id === original);
		if (m?.type !== 'frame' || typeof m.from !== 'string') continue;
		if (idMap.has(m.from)) {
			from.set(copy, idMap.get(m.from)!);
			continue;
		}
		if (!info?.ok) continue;
		const head = info.chain[0]!.module.id;
		from.set(copy, tails.get(head) ?? info.chain[info.chain.length - 1]!.module.id);
		tails.set(head, copy);
	}
	if (from.size === 0) return after;
	return {
		...after,
		pages: after.pages.map((p) => (p.modules.some((m) => from.has(m.id)) ? { ...p, modules: p.modules.map((m) => (from.has(m.id) ? { ...m, from: from.get(m.id) } : m)) } : p)),
	};
}

/** Where a new module goes: inside a 10 mm margin, cascading so new modules don't hide each other. */
export function defaultModuleRect(page: Page, size?: { w: number; h: number }): { x: number; y: number; w: number; h: number } {
	const margin = 10;
	const offset = (page.modules.length % 8) * 10;
	const w = Math.min(size?.w ?? page.w - 2 * margin, page.w - 2 * margin - offset);
	const h = Math.min(size?.h ?? page.h - 2 * margin, page.h - 2 * margin - offset);
	return { x: margin + offset, y: margin + offset, w: Math.max(10, w), h: Math.max(10, h) };
}

/** Move a module to another page, at the given position relative to that page (SPEC 5.2 re-parenting). */
export function moveModuleToPage(file: PatchworkFile, fromPageId: string, moduleId: string, toPageId: string, x: number, y: number): PatchworkFile {
	if (fromPageId === toPageId) return moveModule(file, fromPageId, moduleId, x, y);
	const m = findModule(file, fromPageId, moduleId);
	if (!m || !file.pages.some((p) => p.id === toPageId)) return file;
	// Taken off its page directly, not with removeModule: a moved frame stays in its chain, so its
	// neighbours must not be re-linked around it.
	const taken = mapPage(file, fromPageId, (p) => ({ ...p, modules: p.modules.filter((x) => x.id !== moduleId) }));
	return addModule(taken, toPageId, { ...m, x, y });
}
