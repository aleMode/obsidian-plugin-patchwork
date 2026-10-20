import { ItemView, WorkspaceLeaf } from 'obsidian';
import type { ActiveBoard } from './activeBoard';
import { OutlineRenderer } from './OutlineRenderer';

export { moduleTitle } from './OutlineRenderer';

export const VIEW_TYPE_OUTLINE = 'patchwork-outline';

/** The sidebar dock for the outline of whichever patchwork was used last. */
export class OutlineView extends ItemView {
	private off: (() => void) | null = null;
	private outline: OutlineRenderer;

	constructor(leaf: WorkspaceLeaf, private active: ActiveBoard) {
		super(leaf);
		this.outline = new OutlineRenderer(this.app, this.contentEl, () => this.active.get());
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
		this.off = this.active.on(() => this.outline.render());
		this.outline.render();
	}

	async onClose() {
		this.off?.();
	}
}
