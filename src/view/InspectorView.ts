import { ItemView, WorkspaceLeaf } from 'obsidian';
import type { ActiveBoard } from './activeBoard';
import type { BoardViewport } from './BoardViewport';
import { PropertiesForm } from './PropertiesForm';

export const VIEW_TYPE_INSPECTOR = 'patchwork-inspector';

export class InspectorView extends ItemView {
	private off: (() => void) | null = null;
	private shownKey = '';

	constructor(leaf: WorkspaceLeaf, private active: ActiveBoard) {
		super(leaf);
	}

	getViewType() {
		return VIEW_TYPE_INSPECTOR;
	}

	getDisplayText() {
		return 'Inspector';
	}

	getIcon() {
		return 'sliders-horizontal';
	}

	async onOpen() {
		this.off = this.active.on(() => this.refresh());
		this.render();
	}

	async onClose() {
		this.off?.();
	}

	/** Re-render unless the user is typing in this panel about the same target (keeps focus and caret). */
	private refresh() {
		const board = this.active.get();
		const key = this.keyOf(board);
		if (key === this.shownKey && this.contentEl.contains(this.contentEl.doc.activeElement)) return;
		this.render();
	}

	private render() {
		const el = this.contentEl;
		el.empty();
		el.addClass('pw-inspector');
		const board = this.active.get();
		this.shownKey = this.keyOf(board);
		if (!board) {
			el.createDiv({ cls: 'pw-panel-empty', text: 'Open a patchwork to edit it here.' });
			return;
		}
		new PropertiesForm(this.app, el, () => this.render(), () => this.shownKey).renderSelection(board);
	}

	private keyOf(board: BoardViewport | null): string {
		return board ? board.selectedItems.map((it) => `${it.pageId}/${it.moduleId ?? ''}`).join('|') : '';
	}
}
