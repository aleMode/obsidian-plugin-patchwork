import type { BoardViewport } from './BoardViewport';

/**
 * The board the side panels (inspector, outline) follow: the most recently active board view.
 * Clicking into a panel doesn't change it, so editing in the inspector keeps its target.
 */
export class ActiveBoard {
	private current: BoardViewport | null = null;
	private listeners = new Set<() => void>();
	private unsubscribe: (() => void)[] = [];

	get(): BoardViewport | null {
		return this.current;
	}

	set(board: BoardViewport | null) {
		if (board === this.current) return;
		this.unsubscribe.forEach((u) => u());
		this.unsubscribe = [];
		this.current = board;
		if (board) {
			this.unsubscribe.push(board.boardStore.subscribe(() => this.notify()));
			this.unsubscribe.push(board.onSelectionChange(() => this.notify()));
		}
		this.notify();
	}

	/** A board view closed: forget it if it was the one being followed. */
	closed(board: BoardViewport) {
		if (this.current === board) this.set(null);
	}

	on(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	private notify() {
		for (const l of this.listeners) l();
	}
}
