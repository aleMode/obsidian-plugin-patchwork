import { type App, Notice, setIcon, TFile } from 'obsidian';
import { flowChains, splicePart } from '../model/flow';
import { insertLink, type LineStyle, type Replace, toggleLines, toggleWrap } from '../model/mdFormat';
import type { AnyModule, NoteModule, TextModule } from '../model/schema';
import type { ModuleHost } from '../modules/ModuleHost';
import { noteSection } from '../sources/markdownSource';
import { sliceBounds } from '../sources/noteSlice';
import { retitleSection } from '../model/subpaths';
import type { BoardStore } from '../store/BoardStore';
import { findModule, mapModule } from '../store/pageOps';
import { BOARD_EVENTS, shieldFromBoard } from './shield';

export interface InlineEditDeps {
	app: App;
	store: BoardStore;
	modules: ModuleHost;
	/** Called when editing ends (to give the keyboard back to the board). */
	done: () => void;
	/** The board host the formatting toolbar floats in, and the lowest y it may use (below the rulers and toolbar). */
	host: HTMLElement;
	topInset: () => number;
	/** Subscribe to camera moves (pan, zoom, board resize); returns an unsubscribe. */
	onCameraMove: (fn: () => void) => () => void;
}

/** Modules whose text can be edited where they sit: a text box (its markdown lives in the patchwork), a note, or a frame continuing one. */
export function canEditInline(m: AnyModule | undefined): boolean {
	return m?.type === 'text' || m?.type === 'note' || m?.type === 'frame';
}

/** The box the editor opens in, and the stretch of the source text it shows (all of it when unset). */
interface Target {
	id: string;
	part?: { from: number; to: number; source: string };
}

/**
 * Edit a text, note or frame module in place, as raw markdown in a text area over the module (it scales
 * with the page). A text box saves into the patchwork as one undo step; a note is written back to its
 * file, only the part the module shows. A module in a chain of linked frames edits just the part of the
 * text it shows, and the rest of the chain's text is left as it was. Escape or clicking away finishes.
 */
export async function editInline(d: InlineEditDeps, pageId: string, moduleId: string): Promise<boolean> {
	const m = findModule(d.store.file, pageId, moduleId);
	if (!m || d.store.readOnly) return false;
	const info = flowChains(d.store.file).get(moduleId);
	if (info && !info.ok) {
		new Notice(info.reason);
		return false;
	}
	if (!info) return m.type === 'frame' ? false : editSource(d, pageId, m, { id: moduleId });
	const part = await d.modules.flowPart(moduleId);
	if (!part) {
		new Notice('Zoom in on the item to edit it.');
		return false;
	}
	const head = info.chain[0]!;
	return editSource(d, head.pageId, head.module, { id: moduleId, part });
}

/** Edit the text that `source` (a text box or a note) holds, in the box of `target`. */
function editSource(d: InlineEditDeps, pageId: string, source: AnyModule, target: Target): Promise<boolean> | boolean {
	if (source.type === 'note') return editNote(d, pageId, source as NoteModule, target);
	if (source.type !== 'text') return false;
	const markdown = (source as TextModule).markdown;
	if (target.part && target.part.source !== markdown) return changedNotice();
	const save = (value: string) => {
		let stale = false;
		d.store.update((f) =>
			mapModule(f, pageId, source.id, (x) => {
				const current = (x as TextModule).markdown;
				// The part's offsets only fit the text they were measured on.
				if (target.part && current !== markdown) {
					stale = true;
					return x;
				}
				return { ...x, markdown: target.part ? splicePart(current, target.part, value) : value };
			}),
		);
		if (stale) new Notice('The text changed while you were editing, so nothing was saved.');
	};
	return open(d, target.id, target.part ? markdown.slice(target.part.from, target.part.to) : markdown, save);
}

function changedNotice(): false {
	new Notice('The text changed while it was being laid out. Try again.');
	return false;
}

async function editNote(d: InlineEditDeps, pageId: string, note: NoteModule, target: Target): Promise<boolean> {
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
	const range = noteSection(d.app, file, note.subpath);
	if (range === undefined) {
		new Notice(`Section not found: ${note.file}${note.subpath}`);
		return false;
	}
	const { start, end } = sliceBounds(text, range, { ...(note.includeHeading === undefined ? {} : { includeHeading: note.includeHeading }), ...(note.lines ? { lines: note.lines } : {}) });
	const initial = text.slice(start, end);
	const { part } = target;
	if (part && part.source !== initial) return changedNotice();

	const save = async (edited: string) => {
		// A frame edited only its part of the section; the rest of the section stays as it was.
		const value = part ? splicePart(initial, part, edited) : edited;
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
		followRenamedHeading(d, note, initial, value);
		await metadataUpdated(d.app, file.path);
	};
	return open(d, target.id, part ? initial.slice(part.from, part.to) : initial, save);
}

/** The module points at its section by heading; if that heading was retyped, point at the new one. */
function followRenamedHeading(d: InlineEditDeps, note: NoteModule, before: string, after: string) {
	if (!note.subpath || note.subpath.startsWith('#^') || note.includeHeading === false) return;
	const title = (s: string) => /^#{1,6}[ \t]+(.*?)[ \t]*#*[ \t]*$/.exec(s.split('\n')[0] ?? '')?.[1];
	const was = title(before);
	const now = title(after);
	if (!was || !now || was === now) return;
	// Every module in this patchwork showing that section (or one under it) follows, in one undo step.
	// Other patchworks aren't open to rewrite; they show "Section not found" until re-picked.
	d.store.update((f) => retitleSection(f, note.file, note.subpath!, now));
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

	// Typing here must not delete or move anything; wheel and keydown are handled below.
	shieldFromBoard(ta, ['pointerdown', 'click', 'dblclick', 'contextmenu', 'keyup']);
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
	shieldFromBoard(bar, [...BOARD_EVENTS, 'click']);
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

	// Above the module (below it when there is no room). It moves only when the camera moves or the
	// module changes size, so it is placed then rather than on every frame (typing forces a layout, and
	// measuring each frame would make the browser redo it).
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
	};
	place();
	const offCamera = d.onCameraMove(place);
	const resized = new ResizeObserver(place);
	resized.observe(moduleEl);
	return {
		run,
		remove: () => {
			offCamera();
			resized.disconnect();
			bar.remove();
		},
	};
}
