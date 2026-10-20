import { type App, Notice, resolveSubpath, setIcon, TFile } from 'obsidian';
import { insertLink, type LineStyle, type Replace, toggleLines, toggleWrap } from '../model/mdFormat';
import type { AnyModule, NoteModule, TextModule } from '../model/schema';
import type { ModuleHost } from '../modules/ModuleHost';
import { type SectionRange, sliceBounds } from '../sources/noteSlice';
import type { BoardStore } from '../store/BoardStore';
import { mapModule } from '../store/pageOps';

export interface InlineEditDeps {
	app: App;
	store: BoardStore;
	modules: ModuleHost;
	/** Called when editing ends (to give the keyboard back to the board). */
	done: () => void;
	/** The board host the formatting toolbar floats in, and the lowest y it may use (below the rulers and toolbar). */
	host: HTMLElement;
	topInset: () => number;
}

/** Modules whose text can be edited where they sit: a text box (its markdown lives in the patchwork) or a note. */
export function canEditInline(m: AnyModule | undefined): boolean {
	return m?.type === 'text' || m?.type === 'note';
}

/**
 * Edit a text or note module in place, as raw markdown in a text area over the module (it scales
 * with the page). A text box saves into the patchwork as one undo step; a note is written back to its
 * file, only the part the module shows. Escape or clicking away finishes.
 */
export async function editInline(d: InlineEditDeps, pageId: string, moduleId: string): Promise<boolean> {
	const m = d.store.file.pages.find((p) => p.id === pageId)?.modules.find((x) => x.id === moduleId);
	if (!m || d.store.readOnly) return false;
	if (m.type === 'text') {
		const save = (value: string) => d.store.update((f) => mapModule(f, pageId, moduleId, (x) => ({ ...x, markdown: value })));
		return open(d, moduleId, (m as TextModule).markdown, save);
	}
	if (m.type === 'note') return editNote(d, pageId, m as NoteModule);
	return false;
}

async function editNote(d: InlineEditDeps, pageId: string, note: NoteModule): Promise<boolean> {
	if (note.frozen) {
		new Notice('This note is frozen. Unfreeze it to edit the note itself.');
		return false;
	}
	const file = d.app.vault.getAbstractFileByPath(note.file);
	if (!(file instanceof TFile)) {
		new Notice(`Note not found: ${note.file}`);
		return false;
	}
	const text = await d.app.vault.read(file);
	let range: SectionRange | null = null;
	if (note.subpath) {
		const cache = d.app.metadataCache.getFileCache(file);
		const hit = cache ? resolveSubpath(cache, note.subpath) : null;
		if (!hit || hit.type === 'footnote') {
			new Notice(`Section not found: ${note.file}${note.subpath}`);
			return false;
		}
		range = { kind: hit.type, start: hit.start.offset, end: hit.end?.offset ?? null };
	}
	const { start, end } = sliceBounds(text, range, { ...(note.includeHeading === undefined ? {} : { includeHeading: note.includeHeading }), ...(note.lines ? { lines: note.lines } : {}) });
	const initial = text.slice(start, end);

	const save = async (value: string) => {
		let changedUnderneath = false;
		await d.app.vault.process(file, (current) => {
			// Never overwrite something that changed while the text area was open.
			if (current.slice(start, end) !== initial) {
				changedUnderneath = true;
				return current;
			}
			return current.slice(0, start) + value + current.slice(end);
		});
		if (changedUnderneath) {
			await navigator.clipboard?.writeText(value).catch(() => undefined);
			new Notice('The note changed while you were editing, so nothing was saved. Your text is on the clipboard.', 8000);
			return;
		}
		followRenamedHeading(d, pageId, note, initial, value);
		await metadataUpdated(d.app, file.path);
	};
	return open(d, note.id, initial, save);
}

/** The module points at its section by heading; if that heading was retyped, point at the new one. */
function followRenamedHeading(d: InlineEditDeps, pageId: string, note: NoteModule, before: string, after: string) {
	if (!note.subpath || note.subpath.startsWith('#^') || note.includeHeading === false) return;
	const title = (s: string) => /^#{1,6}[ \t]+(.*?)[ \t]*#*[ \t]*$/.exec(s.split('\n')[0] ?? '')?.[1];
	const was = title(before);
	const now = title(after);
	if (!was || !now || was === now) return;
	d.store.update((f) => mapModule(f, pageId, note.id, (x) => ({ ...x, subpath: note.subpath!.replace(/#[^#]*$/, `#${now}`) })));
}

/** Obsidian re-parses a saved note a moment later; wait for it (or a second) so the module renders the new sections. */
function metadataUpdated(app: App, path: string): Promise<void> {
	return new Promise((resolve) => {
		const ref = app.metadataCache.on('changed', (f) => {
			if (f.path !== path) return;
			app.metadataCache.offref(ref);
			resolve();
		});
		window.setTimeout(() => {
			app.metadataCache.offref(ref);
			resolve();
		}, 1500);
	});
}

function open(d: InlineEditDeps, moduleId: string, initial: string, save: (value: string) => void | Promise<void>): boolean {
	let finished = false;
	const session = { commit: () => void finish() };
	const host = d.modules.beginEdit(moduleId, session);
	if (!host) {
		new Notice('Zoom in on the item to edit it.');
		return false;
	}
	const ta = host.body.createEl('textarea', { cls: 'pw-inline-editor', attr: { spellcheck: 'true', 'aria-label': 'Edit the text' } });
	ta.value = initial;
	const format = createFormatBar(d, ta, host.el);

	// Obsidian's own hotkey handling sees keys first; Escape is taken at the window so it always ends the edit.
	const win = ta.win;
	const onWindowKey = (e: KeyboardEvent) => {
		if (e.key !== 'Escape' || !ta.isConnected || ta.doc.querySelector('.menu, .modal-container')) return;
		e.preventDefault();
		e.stopPropagation();
		void finish();
	};
	win.addEventListener('keydown', onWindowKey, true);

	async function finish() {
		if (finished) return;
		finished = true;
		win.removeEventListener('keydown', onWindowKey, true);
		format.remove();
		const value = ta.value;
		// Stays visible (read-only) while a note is being saved, so there is no flash of the old text.
		ta.readOnly = true;
		if (value !== initial) {
			try {
				await save(value);
			} catch (e) {
				new Notice(`Could not save: ${e instanceof Error ? e.message : String(e)}`);
			}
		}
		ta.remove();
		d.modules.endEdit(moduleId);
		d.done();
	}

	// The board listens for pointers, wheel and keys on its root: typing here must not delete or move anything.
	for (const type of ['pointerdown', 'click', 'dblclick', 'contextmenu', 'keyup']) ta.addEventListener(type, (e) => e.stopPropagation());
	ta.addEventListener('wheel', (e) => {
		if (!e.ctrlKey && !e.metaKey) e.stopPropagation();
	});
	ta.addEventListener('keydown', (e) => {
		e.stopPropagation();
		if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === 'b' || e.key === 'i')) {
			e.preventDefault();
			format.run(toggleWrap(ta.value, ta.selectionStart, ta.selectionEnd, e.key === 'b' ? '**' : '*'));
			return;
		}
		// Not Ctrl+Enter: Obsidian's own hotkeys take it before this field sees it.
		if (e.key === 'Escape') {
			e.preventDefault();
			void finish();
		} else if (e.key === 'Tab' && !e.shiftKey) {
			// Tab indents a list item instead of leaving the field (which would end the edit).
			e.preventDefault();
			ta.setRangeText('\t', ta.selectionStart, ta.selectionEnd, 'end');
		}
	});
	ta.addEventListener('blur', () => void finish());
	ta.focus();
	ta.setSelectionRange(ta.value.length, ta.value.length);
	return true;
}

/**
 * The formatting toolbar that floats above the module being edited: wraps the selection or marks the
 * lines it touches. Its buttons never take the focus (that would end the edit).
 */
function createFormatBar(d: InlineEditDeps, ta: HTMLTextAreaElement, moduleEl: HTMLElement) {
	const bar = d.host.createDiv({ cls: 'pw-format-bar' });
	// The board listens for pointers, wheel and keys: none of that may reach it from here.
	for (const type of ['pointerdown', 'click', 'dblclick', 'contextmenu', 'wheel', 'keydown', 'keyup']) bar.addEventListener(type, (e) => e.stopPropagation());
	bar.addEventListener('mousedown', (e) => e.preventDefault());

	/** Apply a replacement as a normal edit, so the text area's undo history keeps working. */
	const run = (r: Replace) => {
		ta.focus();
		ta.setSelectionRange(r.from, r.to);
		// execCommand is deprecated (lint warns) but is the one way to insert text and keep the text area's native undo history.
		if (!ta.ownerDocument.execCommand('insertText', false, r.insert)) ta.setRangeText(r.insert, r.from, r.to, 'end');
		ta.setSelectionRange(r.selStart, r.selEnd);
		ta.dispatchEvent(new Event('input', { bubbles: true }));
	};
	const button = (icon: string, tip: string, make: () => Replace) => {
		const b = bar.createEl('button', { attr: { 'aria-label': tip } });
		setIcon(b, icon);
		b.addEventListener('click', () => run(make()));
	};
	const sep = () => bar.createDiv({ cls: 'pw-fb-sep' });
	const wrap = (mark: string) => () => toggleWrap(ta.value, ta.selectionStart, ta.selectionEnd, mark);
	const lines = (style: LineStyle) => () => toggleLines(ta.value, ta.selectionStart, ta.selectionEnd, style);
	button('bold', 'Bold', wrap('**'));
	button('italic', 'Italic', wrap('*'));
	button('strikethrough', 'Strikethrough', wrap('~~'));
	button('code', 'Code', wrap('`'));
	sep();
	button('heading-1', 'Heading 1', lines('h1'));
	button('heading-2', 'Heading 2', lines('h2'));
	button('heading-3', 'Heading 3', lines('h3'));
	sep();
	button('list', 'Bulleted list', lines('bullet'));
	button('list-ordered', 'Numbered list', lines('ordered'));
	button('quote', 'Quote', lines('quote'));
	button('link', 'Link', () => insertLink(ta.value, ta.selectionStart, ta.selectionEnd));

	// Above the module (below it when there is no room); follows it if the camera moves.
	const win = ta.win;
	let frame = 0;
	const place = () => {
		const m = moduleEl.getBoundingClientRect();
		const h = d.host.getBoundingClientRect();
		const w = bar.offsetWidth;
		const t = bar.offsetHeight;
		const gap = 8;
		let y = m.top - h.top - t - gap;
		if (y < d.topInset() + gap) y = m.bottom - h.top + gap;
		const x = Math.min(Math.max(gap, m.left - h.left + m.width / 2 - w / 2), Math.max(gap, h.width - w - gap));
		bar.setCssProps({ '--pw-fb-x': `${Math.round(x)}px`, '--pw-fb-y': `${Math.round(y)}px` });
		frame = win.requestAnimationFrame(place);
	};
	place();
	return {
		run,
		remove: () => {
			win.cancelAnimationFrame(frame);
			bar.remove();
		},
	};
}
