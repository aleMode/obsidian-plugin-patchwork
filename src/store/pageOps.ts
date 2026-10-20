import { newPage } from '../model/defaults';
import type { AnyModule, Page, PatchworkFile } from '../model/schema';

// Immutable edits used with BoardStore.update. Each returns the same object when nothing changes,
// so no-op edits don't create undo steps.

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
	const pages = file.pages.filter((p) => p.id !== id);
	return pages.length === file.pages.length ? file : { ...file, pages };
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
	const removed = file.pages.find((p) => p.id === pageId)?.modules.find((m) => m.id === moduleId);
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

/** Copy of a module with a new ID, nudged so it doesn't sit exactly on the original. */
export function duplicateModule(file: PatchworkFile, pageId: string, moduleId: string, newId: string, offset = 5): PatchworkFile {
	return mapPage(file, pageId, (p) => {
		const m = p.modules.find((x) => x.id === moduleId);
		return m ? { ...p, modules: [...p.modules, { ...structuredClone(m), id: newId, x: m.x + offset, y: m.y + offset, locked: undefined }] } : p;
	});
}

/** Copy of a page and its modules (all with new IDs), placed to the right of everything. */
export function duplicatePage(file: PatchworkFile, pageId: string, ids: () => string): PatchworkFile {
	const p = file.pages.find((x) => x.id === pageId);
	if (!p) return file;
	const right = Math.max(...file.pages.map((x) => x.x + x.w));
	const copy = { ...structuredClone(p), id: ids(), x: right + 20, name: p.name ? `${p.name} copy` : undefined };
	copy.modules = copy.modules.map((m) => ({ ...m, id: ids() }));
	return { ...file, pages: [...file.pages, copy] };
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
	const m = file.pages.find((p) => p.id === fromPageId)?.modules.find((x) => x.id === moduleId);
	if (!m || !file.pages.some((p) => p.id === toPageId)) return file;
	return addModule(removeModule(file, fromPageId, moduleId), toPageId, { ...m, x, y });
}
