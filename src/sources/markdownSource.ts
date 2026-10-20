import { App, getLinkpath, resolveSubpath, TFile } from 'obsidian';
import type { NoteModule } from '../model/schema';
import { parseCssClasses } from './cssClasses';
import { type SectionRange, sliceBounds, sliceNote } from './noteSlice';
import { taskMarks, toggleTaskAt } from '../model/tasks';

export type NoteContent =
	| { ok: true; markdown: string; file: TFile }
	| { ok: false; reason: string; missingFile: boolean };

type NoteRef = Pick<NoteModule, 'file' | 'subpath' | 'lines' | 'includeHeading'>;

/**
 * Where a module's section lies in its note, per Obsidian's metadata cache: null for the whole note,
 * undefined when the section no longer exists.
 */
export function noteSection(app: App, file: TFile, subpath: string | undefined): SectionRange | null | undefined {
	if (!subpath) return null;
	const cache = app.metadataCache.getFileCache(file);
	const hit = cache ? resolveSubpath(cache, subpath) : null;
	if (!hit || hit.type === 'footnote') return undefined;
	return { kind: hit.type, start: hit.start.offset, end: hit.end?.offset ?? null };
}

/** The markdown a note module shows: its file, narrowed to the subpath and line range. */
export async function loadNoteContent(app: App, m: NoteRef): Promise<NoteContent> {
	const file = app.vault.getAbstractFileByPath(m.file);
	if (!(file instanceof TFile)) return { ok: false, reason: `Note not found: ${m.file}`, missingFile: true };
	const text = await app.vault.cachedRead(file);
	const range = noteSection(app, file, m.subpath);
	if (range === undefined) return { ok: false, reason: `Section not found: ${m.file}${m.subpath}`, missingFile: false };
	return { ok: true, file, markdown: sliceNote(text, range, { includeHeading: m.includeHeading, lines: m.lines }) };
}

/**
 * Tick or untick the `index`-th task a note module shows, in the note file. Only if the module still
 * shows `shown` (what was rendered): otherwise the click may point at another line, so nothing is
 * written and the result says why.
 */
export async function toggleNoteTask(app: App, m: NoteRef, index: number, shown: string): Promise<string | null> {
	const file = app.vault.getAbstractFileByPath(m.file);
	if (!(file instanceof TFile)) return `Note not found: ${m.file}`;
	let problem: string | null = null;
	await app.vault.process(file, (text) => {
		const range = noteSection(app, file, m.subpath);
		if (range === undefined) {
			problem = `Section not found: ${m.file}${m.subpath}`;
			return text;
		}
		const { start, end } = sliceBounds(text, range, { includeHeading: m.includeHeading, lines: m.lines });
		const mark = taskMarks(shown)[index];
		if (text.slice(start, end) !== shown || mark === undefined) {
			problem = 'The note changed since it was shown; nothing was ticked.';
			return text;
		}
		return toggleTaskAt(text, start + mark);
	});
	return problem;
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
