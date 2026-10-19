import type { AnyModule, PatchworkFile } from './schema';

/** New path for `path` after `oldPath` was renamed to `newPath` (a file, or a folder and its contents). */
function renamed(path: string, oldPath: string, newPath: string): string | null {
	if (path === oldPath) return newPath;
	if (path.startsWith(`${oldPath}/`)) return newPath + path.slice(oldPath.length);
	return null;
}

/**
 * Update every module reference after a vault rename (SPEC 6). Only `file` fields of known module
 * types are references; unknown types are left untouched. Returns the same object if nothing changed.
 */
export function rewritePaths(file: PatchworkFile, oldPath: string, newPath: string): PatchworkFile {
	let changed = false;
	const pages = file.pages.map((p) => {
		let pageChanged = false;
		const modules = p.modules.map((m: AnyModule) => {
			if (!['note', 'pdf', 'image'].includes(m.type) || typeof m.file !== 'string') return m;
			const next = renamed(m.file, oldPath, newPath);
			if (next === null) return m;
			pageChanged = true;
			return { ...m, file: next };
		});
		if (!pageChanged) return p;
		changed = true;
		return { ...p, modules };
	});
	return changed ? { ...file, pages } : file;
}
