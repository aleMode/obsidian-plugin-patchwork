import { App, getLinkpath, resolveSubpath, TFile } from 'obsidian';
import type { NoteModule } from '../model/schema';
import { parseCssClasses } from './cssClasses';
import { sliceNote } from './noteSlice';

export type NoteContent =
	| { ok: true; markdown: string; file: TFile }
	| { ok: false; reason: string; missingFile: boolean };

/** The markdown a note module shows: its file, narrowed to the subpath and line range. */
export async function loadNoteContent(app: App, m: Pick<NoteModule, 'file' | 'subpath' | 'lines' | 'includeHeading'>): Promise<NoteContent> {
	const file = app.vault.getAbstractFileByPath(m.file);
	if (!(file instanceof TFile)) return { ok: false, reason: `Note not found: ${m.file}`, missingFile: true };
	const text = await app.vault.cachedRead(file);
	if (!m.subpath) return { ok: true, file, markdown: sliceNote(text, null, { lines: m.lines }) };

	const cache = app.metadataCache.getFileCache(file);
	const hit = cache ? resolveSubpath(cache, m.subpath) : null;
	if (!hit || hit.type === 'footnote') return { ok: false, reason: `Section not found: ${m.file}${m.subpath}`, missingFile: false };
	const range = { kind: hit.type, start: hit.start.offset, end: hit.end?.offset ?? null };
	return { ok: true, file, markdown: sliceNote(text, range, { includeHeading: m.includeHeading, lines: m.lines }) };
}

/** The classes a note asks for in its frontmatter (`cssclasses`, or the older `cssclass`). */
export function noteCssClasses(app: App, path: string): string[] {
	const file = app.vault.getAbstractFileByPath(path);
	const fm = file instanceof TFile ? app.metadataCache.getFileCache(file)?.frontmatter : undefined;
	return parseCssClasses(fm?.cssclasses ?? fm?.cssclass);
}

/**
 * Every file whose change can alter what a note module shows: the note plus everything it
 * embeds, transitively (MarkdownRenderer expands embeds itself, spike S2).
 */
export function noteDependencies(app: App, path: string): Set<string> {
	const deps = new Set<string>();
	const visit = (p: string) => {
		if (deps.has(p)) return;
		deps.add(p);
		const file = app.vault.getAbstractFileByPath(p);
		if (!(file instanceof TFile)) return;
		for (const e of app.metadataCache.getFileCache(file)?.embeds ?? []) {
			const dest = app.metadataCache.getFirstLinkpathDest(getLinkpath(e.link), file.path);
			if (dest) visit(dest.path);
		}
	};
	visit(path);
	return deps;
}
