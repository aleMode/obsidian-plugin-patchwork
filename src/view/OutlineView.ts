import { ItemView, setIcon, WorkspaceLeaf } from 'obsidian';
import { orderedPages } from '../model/ordering';
import type { AnyModule } from '../model/schema';
import type { ActiveBoard } from './activeBoard';

export const VIEW_TYPE_OUTLINE = 'patchwork-outline';

const ICONS: Record<string, string> = { note: 'file-text', pdf: 'book-open', text: 'type', image: 'image' };

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
		return 'Board outline';
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
			el.createDiv({ cls: 'pw-panel-empty', text: 'Open a Patchwork board to see its pages here.' });
			return;
		}
		const file = board.boardStore.file;
		const sel = board.selected;
		orderedPages(file).forEach((page, i) => {
			const row = el.createDiv({ cls: 'pw-outline-row pw-outline-page' });
			row.toggleClass('is-selected', sel?.pageId === page.id && !sel.moduleId);
			setIcon(row.createSpan({ cls: 'pw-outline-icon' }), 'file');
			row.createSpan({ text: `${i + 1}. ${page.name ?? 'Untitled page'}` });
			row.addEventListener('click', () => this.reveal(page.id));
			for (const m of page.modules) {
				const mrow = el.createDiv({ cls: 'pw-outline-row pw-outline-module' });
				mrow.toggleClass('is-selected', sel?.moduleId === m.id);
				setIcon(mrow.createSpan({ cls: 'pw-outline-icon' }), ICONS[m.type] ?? 'help-circle');
				mrow.createSpan({ text: moduleTitle(m) });
				if (m.locked) setIcon(mrow.createSpan({ cls: 'pw-outline-lock' }), 'lock');
				mrow.addEventListener('click', () => this.reveal(page.id, m.id));
			}
		});
	}

	private reveal(pageId: string, moduleId?: string) {
		const board = this.active.get();
		if (!board) return;
		board.select({ pageId, moduleId });
		board.revealSelection();
	}
}
