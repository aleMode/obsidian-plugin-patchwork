import type { AnyModule, PatchworkFile } from './schema';

/** New path for `path` after `oldPath` was renamed to `newPath` (a file, or a folder and its contents). */
function renamed(path: string, oldPath: string, newPath: string): string | null {
	if (path === oldPath) return newPath;
	if (path.startsWith(`${oldPath}/`)) return newPath + path.slice(oldPath.length);
	return null;
}

/**
 * The file a link pointed to before `oldPath` was renamed to `newPath`, as it is called now, or null
 * if the link didn't point into the renamed file or folder. `moved` are the current paths of the
 * files that moved (the file itself, or everything in the folder). Like Obsidian, a link may be a full
 * path, a trailing part of one, or just a name, with or without `.md`, in any letter case.
 */
export function renamedLinkTarget(linkpath: string, oldPath: string, newPath: string, moved: readonly string[]): string | null {
	const link = linkpath.replace(/^\/+/, '').toLowerCase();
	if (!link) return null;
	for (const now of moved) {
		const before = (oldPath + now.slice(newPath.length)).toLowerCase();
		for (const form of [before, before.replace(/\.md$/, '')]) {
			if (form === link || form.endsWith(`/${link}`)) return now;
		}
	}
	return null;
}

/** New link text for a link path, or null to leave the link as it is. */
export type Retarget = (linkpath: string) => string | null;

// [[target#sub|alias]] and ![[...]]; [text](target) and ![alt](target), the target optionally in <>.
const WIKILINK = /(!?\[\[)([^\]|#\n]*)([^\]\n]*\]\])/g;
const MDLINK = /(!?\[[^\]\n]*\]\()(<[^>\n]*>|[^)\s]*)(\))/g;

/**
 * Point the links in `markdown` somewhere else (Obsidian does this for notes; text inside a board is
 * ours to update). `retarget` gets each link's path without its #subpath or alias, which are kept.
 */
export function rewriteMarkdownLinks(markdown: string, retarget: Retarget): string {
	const wiki = markdown.replace(WIKILINK, (all, open: string, target: string, rest: string) => {
		const next = target ? retarget(target) : null;
		return next === null ? all : open + next + rest;
	});
	return wiki.replace(MDLINK, (all, open: string, href: string, close: string) => {
		const angled = href.startsWith('<');
		const raw = angled ? href.slice(1, -1) : href;
		// External links (https:, obsidian:, mailto:) are not vault paths.
		if (!raw || /^[a-z][a-z0-9+.-]*:/i.test(raw)) return all;
		const hash = raw.indexOf('#');
		const path = hash < 0 ? raw : raw.slice(0, hash);
		const sub = hash < 0 ? '' : raw.slice(hash);
		let decoded: string;
		try {
			decoded = decodeURIComponent(path);
		} catch {
			return all;
		}
		const next = path ? retarget(decoded) : null;
		if (next === null) return all;
		return open + (angled ? `<${next}${sub}>` : encodeURI(next) + sub) + close;
	});
}

/**
 * Update every module reference after a vault rename (SPEC 6). Only `file` fields of known module
 * types are references; unknown types are left untouched. With `retarget`, links written in text
 * modules and frozen notes follow too. Returns the same object if nothing changed.
 */
export function rewritePaths(file: PatchworkFile, oldPath: string, newPath: string, retarget?: Retarget): PatchworkFile {
	let changed = false;
	const pages = file.pages.map((p) => {
		let pageChanged = false;
		const modules = p.modules.map((m: AnyModule) => {
			let next = retarget ? rewriteModuleLinks(m, retarget) : m;
			if (['note', 'pdf', 'image'].includes(next.type) && typeof next.file === 'string') {
				const path = renamed(next.file, oldPath, newPath);
				if (path !== null) next = { ...next, file: path };
			}
			if (next !== m) pageChanged = true;
			return next;
		});
		if (!pageChanged) return p;
		changed = true;
		return { ...p, modules };
	});
	return changed ? { ...file, pages } : file;
}

/** Links in a text module's markdown, or in a frozen note's snapshot (the link target is not content). */
function rewriteModuleLinks(m: AnyModule, retarget: Retarget): AnyModule {
	if (m.type === 'text' && typeof m.markdown === 'string') {
		const markdown = rewriteMarkdownLinks(m.markdown, retarget);
		return markdown === m.markdown ? m : { ...m, markdown };
	}
	const frozen = m.type === 'note' ? (m.frozen as { markdown?: unknown } | undefined) : undefined;
	if (frozen && typeof frozen.markdown === 'string') {
		const markdown = rewriteMarkdownLinks(frozen.markdown, retarget);
		return markdown === frozen.markdown ? m : { ...m, frozen: { ...frozen, markdown } };
	}
	return m;
}
