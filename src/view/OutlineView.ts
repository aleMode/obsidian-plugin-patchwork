import { ItemView, setIcon, WorkspaceLeaf } from 'obsidian';
import { orderedPages } from '../model/ordering';
import type { AnyModule } from '../model/schema';
import { TextPromptModal } from '../ui/prompts';
import type { ActiveBoard } from './activeBoard';

export const VIEW_TYPE_OUTLINE = 'patchwork-outline';

const ICONS: Record<string, string> = { note: 'file-text', pdf: 'book-open', text: 'type', image: 'image', toc: 'list-ordered', frame: 'link', tracker: 'list-checks' };

/** A short name for a module: its label, else what it shows. */
export function moduleTitle(m: AnyModule): string {
	if (m.label) return m.label;
	const file = typeof m.file === 'string' ? m.file.replace(/^.*\//, '').replace(/\.md$/, '') : '';
	switch (m.type) {
		case 'note':
			return `${file}${typeof m.subpath === 'string' ? m.subpath : ''}`;
		case 'pdf':
			return `${file} p. ${String(m.page)}`;
		case 'text':
			return (typeof m.markdown === 'string' ? m.markdown : '').replace(/[#*_`>]/g, '').trim().slice(0, 40) || 'Text';
		case 'image':
			return file;
		case 'toc':
			return 'Table of contents';
		case 'frame':
			return 'Linked frame';
		case 'tracker':
			return typeof m.label === 'string' && m.label ? m.label : `${String(m.kind)} tracker`;
		default:
			return m.type;
	}
}

/** Pages (in output order) and their modules; click to select and reveal (SPEC 5.6). */
export class OutlineView extends ItemView {
	private off: (() => void) | null = null;

	constructor(leaf: WorkspaceLeaf, private active: ActiveBoard) {
		super(leaf);
	}

	getViewType() {
		return VIEW_TYPE_OUTLINE;
	}

	getDisplayText() {
		return 'Outline';
	}

	getIcon() {
		return 'list-tree';
	}

	async onOpen() {
		this.off = this.active.on(() => this.render());
		this.render();
	}

	async onClose() {
		this.off?.();
	}

	private render() {
		const el = this.contentEl;
		el.empty();
		el.addClass('pw-outline');
		const board = this.active.get();
		if (!board) {
			el.createDiv({ cls: 'pw-panel-empty', text: 'Open a patchwork to see its pages here.' });
			return;
		}
		const file = board.boardStore.file;
		this.renderViews(el, board);
		const isSel = (pageId: string, moduleId?: string) => board.selectedItems.some((it) => it.pageId === pageId && it.moduleId === moduleId);
		let n = 0;
		orderedPages(file).forEach((page) => {
			const row = el.createDiv({ cls: 'pw-outline-row pw-outline-page' });
			row.toggleClass('is-selected', isSel(page.id));
			setIcon(row.createSpan({ cls: 'pw-outline-icon' }), page.isMaster ? 'layout-template' : 'file');
			// Masters aren't exported, so they take no place in the numbering.
			row.createSpan({ text: page.isMaster ? `Master: ${page.name ?? 'untitled'}` : `${++n}. ${page.name ?? 'Untitled page'}` });
			row.addEventListener('click', (e) => this.reveal(e, page.id));
			for (const m of page.modules) {
				const mrow = el.createDiv({ cls: 'pw-outline-row pw-outline-module' });
				mrow.toggleClass('is-selected', isSel(page.id, m.id));
				setIcon(mrow.createSpan({ cls: 'pw-outline-icon' }), ICONS[m.type] ?? 'help-circle');
				mrow.createSpan({ text: moduleTitle(m) });
				if (m.locked) setIcon(mrow.createSpan({ cls: 'pw-outline-lock' }), 'lock');
				mrow.addEventListener('click', (e) => this.reveal(e, page.id, m.id));
			}
		});
	}

	/** Saved views: click to go there; rename or delete with the small buttons. */
	private renderViews(el: HTMLElement, board: NonNullable<ReturnType<ActiveBoard['get']>>) {
		const head = el.createDiv({ cls: 'pw-outline-section' });
		head.createSpan({ text: 'Views' });
		if (!board.boardStore.readOnly) {
			const add = head.createSpan({ cls: 'clickable-icon', attr: { 'aria-label': 'Save current view' } });
			setIcon(add, 'plus');
			add.addEventListener('click', () => board.promptSaveView());
		}
		if (!board.views.length) el.createDiv({ cls: 'pw-panel-hint', text: 'Save a camera position to come back to it.' });
		for (const v of board.views) {
			const row = el.createDiv({ cls: 'pw-outline-row pw-outline-view' });
			setIcon(row.createSpan({ cls: 'pw-outline-icon' }), 'bookmark');
			row.createSpan({ text: v.name, cls: 'pw-outline-view-name' });
			row.addEventListener('click', () => board.goToView(v.id));
			if (board.boardStore.readOnly) continue;
			const rename = row.createSpan({ cls: 'clickable-icon pw-outline-action', attr: { 'aria-label': 'Rename' } });
			setIcon(rename, 'pencil');
			rename.addEventListener('click', (e) => {
				e.stopPropagation();
				new TextPromptModal(this.app, 'Rename view', v.name, (name) => board.renameView(v.id, name)).open();
			});
			const del = row.createSpan({ cls: 'clickable-icon pw-outline-action', attr: { 'aria-label': 'Delete' } });
			setIcon(del, 'trash-2');
			del.addEventListener('click', (e) => {
				e.stopPropagation();
				board.deleteView(v.id);
			});
		}
		el.createDiv({ cls: 'pw-outline-section', text: 'Pages' });
	}

	/** Click selects and centres the item; Shift-click adds or removes it from the selection. */
	private reveal(e: MouseEvent, pageId: string, moduleId?: string) {
		const board = this.active.get();
		if (!board) return;
		const item = moduleId ? { pageId, moduleId } : { pageId };
		if (e.shiftKey) return board.toggle(item);
		board.select(item);
		board.revealSelection();
	}
}
