import { type App, type HoverParent, Keymap, Notice, parseLinktext, TFile, type WorkspaceLeaf } from 'obsidian';
import { flowChains } from '../model/flow';
import type { AnyModule, NoteModule, TextModule } from '../model/schema';
import { taskMarks, toggleTaskAt } from '../model/tasks';
import type { ModuleHost } from '../modules/ModuleHost';
import { toggleNoteTask } from '../sources/markdownSource';
import type { BoardStore } from '../store/BoardStore';
import { findModule, mapModule } from '../store/pageOps';

// Use mode (docs/use-mode-plan.md): what rendered content does when clicked. Obsidian's markdown
// renderer draws links and task checkboxes but wires neither (the reading view does that itself),
// so links are opened and checkboxes written back here.

/** The id Patchwork registers with Page preview, so Ctrl/Cmd-hovering a link shows the note. */
export const HOVER_SOURCE = 'patchwork';

/** Internal links: <a> from Obsidian's renderer and Dataview, <span> in Bases tables. */
const LINK = '.internal-link[data-href], a.internal-link';

/** Checkboxes in here belong to someone else: an embedded note, or a plugin's block (Dataview, Tasks…). */
const FOREIGN = '.internal-embed, .markdown-embed, [class*="block-language-"]';

export interface LiveDeps {
	app: App;
	store: BoardStore;
	modules: ModuleHost;
	/** The patchwork's path: links in text boxes resolve from it. */
	boardPath: () => string;
	hoverParent: HoverParent;
}

export class LiveContent {
	/** The pane links open in, reused while it stays open. */
	private sideLeaf: WorkspaceLeaf | null = null;

	constructor(private d: LiveDeps) {}

	/**
	 * Before anything else sees the click (capture phase): plugins open their links in the dashboard's
	 * own pane (Bases does), which would replace the dashboard. All internal links go to the side.
	 */
	linkClick(e: MouseEvent) {
		const link = (e.target as HTMLElement).closest<HTMLElement>(LINK);
		if (!link) return;
		e.preventDefault();
		e.stopPropagation();
		void this.openLink(link, e);
	}

	/** After plugins had their turn (bubble phase): checkboxes nobody else handles are written back here. */
	click(e: MouseEvent) {
		const box = (e.target as HTMLElement).closest<HTMLInputElement>('input.task-list-item-checkbox');
		if (box && !box.closest(FOREIGN)) void this.tick(box, e);
	}

	hover(e: MouseEvent) {
		const link = (e.target as HTMLElement).closest<HTMLElement>(LINK);
		if (!link) return;
		this.d.app.workspace.trigger('hover-link', { event: e, source: HOVER_SOURCE, hoverParent: this.d.hoverParent, targetEl: link, linktext: linkText(link), sourcePath: this.sourcePath(link) });
	}

	/** To the side, in the same pane each time; Ctrl/Cmd (and the other modifiers) as anywhere in Obsidian. */
	private async openLink(link: HTMLElement, e: MouseEvent) {
		const { app } = this.d;
		const text = linkText(link);
		const source = this.sourcePath(link);
		const mod = Keymap.isModEvent(e);
		if (mod) return app.workspace.openLinkText(text, source, mod);
		const { path, subpath } = parseLinktext(text);
		const target = path ? app.metadataCache.getFirstLinkpathDest(path, source) : app.vault.getAbstractFileByPath(source);
		// Unresolved: Obsidian's own handling (it offers to create the note).
		if (!(target instanceof TFile)) return app.workspace.openLinkText(text, source, 'split');
		await this.side().openFile(target, subpath ? { eState: { subpath } } : {});
	}

	private side(): WorkspaceLeaf {
		const ws = this.d.app.workspace;
		let open = false;
		if (this.sideLeaf) ws.iterateAllLeaves((l) => (open ||= l === this.sideLeaf));
		if (!open) this.sideLeaf = ws.getLeaf('split', 'vertical');
		return this.sideLeaf!;
	}

	/** The note a link is written in (links resolve relative to it); the patchwork for text boxes. */
	private sourcePath(el: HTMLElement): string {
		const m = this.moduleOf(el)?.module;
		if (m?.type === 'note') return (m as NoteModule).file;
		if (m?.type === 'frame') {
			const info = flowChains(this.d.store.file).get(m.id);
			const head = info?.ok ? info.chain[0]!.module : undefined;
			if (head?.type === 'note') return (head as NoteModule).file;
		}
		return this.d.boardPath();
	}

	private moduleOf(el: HTMLElement): { pageId: string; module: AnyModule; el: HTMLElement } | undefined {
		const modEl = el.closest<HTMLElement>('.pw-module');
		const { pageId, moduleId } = modEl?.dataset ?? {};
		const module = pageId && moduleId ? findModule(this.d.store.file, pageId, moduleId) : undefined;
		return modEl && pageId && module ? { pageId, module, el: modEl } : undefined;
	}

	/**
	 * Write a ticked checkbox back: to the note file for a note module, to the patchwork for a text box.
	 * The browser has already flipped the box; when the tick can't be written it is flipped back, and the
	 * re-render after a write shows what the file says.
	 */
	private async tick(box: HTMLInputElement, e: MouseEvent) {
		const at = this.moduleOf(box);
		const shown = at ? this.d.modules.shownMarkdown(at.module.id) : undefined;
		const own = at ? Array.from(at.el.querySelectorAll<HTMLInputElement>('input.task-list-item-checkbox')).filter((b) => !b.closest(FOREIGN)) : [];
		const index = own.indexOf(box);
		const why = cannotTick(at?.module, shown, own.length, this.d.store.readOnly);
		if (why || !at || shown === undefined) {
			e.preventDefault();
			new Notice(why ?? 'This checkbox can’t be ticked here.');
			return;
		}
		if (at.module.type === 'text') {
			const mark = taskMarks(shown)[index]!;
			this.d.store.update((f) => mapModule(f, at.pageId, at.module.id, (x) => ({ ...x, markdown: toggleTaskAt((x as TextModule).markdown, mark) })));
			return;
		}
		const problem = await toggleNoteTask(this.d.app, at.module as NoteModule, index, shown).catch((err: unknown) => (err instanceof Error ? err.message : String(err)));
		if (problem) {
			box.checked = !box.checked;
			new Notice(problem);
		}
	}
}

/** Why a checkbox in this module can't be ticked, or null when it can. */
export function cannotTick(m: AnyModule | undefined, shown: string | undefined, rendered: number, readOnly: boolean): string | null {
	if (!m || shown === undefined) return 'Checkboxes in linked text frames and master pages can’t be ticked here yet: tick them in the note.';
	if (m.type === 'note' && (m as NoteModule).frozen) return 'This note is frozen (a snapshot). Unfreeze it to tick its checkboxes.';
	if (m.type === 'text' && (readOnly || (m as TextModule).markdown !== shown)) return 'This patchwork is read-only.';
	// Matching is by order; if the counts differ (unusual markup), a tick could land on the wrong line.
	if (taskMarks(shown).length !== rendered) return 'Couldn’t match this checkbox to its line. Open the note to tick it.';
	return null;
}

function linkText(a: HTMLElement): string {
	return a.dataset.href ?? a.getAttribute('href') ?? '';
}
