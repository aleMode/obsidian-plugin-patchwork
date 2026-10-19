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
