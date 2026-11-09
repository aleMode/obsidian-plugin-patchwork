import { plainText } from '../model/mdFormat';
import { type App, setIcon } from 'obsidian';
import { orderedPages } from '../model/ordering';
import type { AnyModule, ShapeModule } from '../model/schema';
import { isArrow } from '../model/shapes';
import { TextPromptModal } from '../ui/prompts';
import type { BoardViewport } from './BoardViewport';

const ICONS: Record<string, string> = { note: 'file-text', pdf: 'book-open', text: 'type', image: 'image', toc: 'list-ordered', frame: 'link', tracker: 'list-checks', shape: 'shapes' };

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
			return plainText(typeof m.markdown === 'string' ? m.markdown : '').slice(0, 40) || 'Text';
		case 'image':
			return file;
		case 'toc':
			return 'Table of contents';
		case 'frame':
			return 'Text frame';
		case 'shape':
			return m.shape === 'ellipse' ? 'Ellipse' : m.shape === 'line' ? (isArrow(m as ShapeModule) ? 'Arrow' : 'Line') : 'Rectangle';
		case 'tracker':
			return typeof m.label === 'string' && m.label ? m.label : `${String(m.kind)} tracker`;
		default:
			return m.type;
	}
}

/**
 * The list of saved views and of pages with their modules (SPEC 5.6), drawn into any container: the
 * sidebar outline and the floating panel on the board share it.
 */
export class OutlineRenderer {
	constructor(private app: App, private el: HTMLElement, private board: () => BoardViewport | null) {}

	render() {
		const el = this.el;
		el.empty();
		el.addClass('pw-outline');
		const board = this.board();
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
	private renderViews(el: HTMLElement, board: BoardViewport) {
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
		const board = this.board();
		if (!board) return;
		const item = moduleId ? { pageId, moduleId } : { pageId };
		if (e.shiftKey) return board.toggle(item);
		// In Use mode nothing is selected; the item is only brought into view.
		board.select(item);
		board.revealSelection(item);
	}
}
