import type { PatchworkFile } from '../model/schema';

export interface ChangeOptions {
	/**
	 * Consecutive changes with the same key merge into one undo step, so a drag that fires
	 * dozens of moves undoes in one go. Any other change (or `endCoalesce`) closes the group.
	 */
	coalesce?: string;
}

type Listener = (file: PatchworkFile) => void;

const HISTORY_LIMIT = 200;

/**
 * Holds the board as immutable snapshots. Every change produces a new PatchworkFile (sharing
 * untouched parts), which makes undo/redo a matter of keeping previous snapshots.
 * No Obsidian or DOM imports, so it is unit-testable.
 */
export class BoardStore {
	private current: PatchworkFile;
	private past: PatchworkFile[] = [];
	private future: PatchworkFile[] = [];
	private openGroup: string | null = null;
	private listeners = new Set<Listener>();
	readonly readOnly: boolean;

	constructor(file: PatchworkFile, opts: { readOnly?: boolean } = {}) {
		this.current = file;
		this.readOnly = opts.readOnly ?? false;
	}

	get file(): PatchworkFile {
		return this.current;
	}

	update(recipe: (file: PatchworkFile) => PatchworkFile, opts: ChangeOptions = {}) {
		if (this.readOnly) return;
		const next = recipe(this.current);
		if (next === this.current) return;
		const merging = opts.coalesce !== undefined && opts.coalesce === this.openGroup;
		if (!merging) {
			this.past.push(this.current);
			if (this.past.length > HISTORY_LIMIT) this.past.shift();
		}
		this.openGroup = opts.coalesce ?? null;
		this.future = [];
		this.set(next);
	}

	/**
	 * A change that is not an undo step (a viewing choice such as the mode). It is applied to the undo
	 * history as well, so undoing an earlier edit never flips it back.
	 */
	updateOutsideHistory(recipe: (file: PatchworkFile) => PatchworkFile) {
		if (this.readOnly) return;
		const next = recipe(this.current);
		if (next === this.current) return;
		this.past = this.past.map(recipe);
		this.future = this.future.map(recipe);
		this.set(next);
	}

	endCoalesce() {
		this.openGroup = null;
	}

	get canUndo() {
		return this.past.length > 0;
	}

	get canRedo() {
		return this.future.length > 0;
	}

	undo() {
		const prev = this.past.pop();
		if (!prev) return;
		this.future.push(this.current);
		this.openGroup = null;
		this.set(prev);
	}

	redo() {
		const next = this.future.pop();
		if (!next) return;
		this.past.push(this.current);
		this.openGroup = null;
		this.set(next);
	}

	subscribe(listener: Listener): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	private set(file: PatchworkFile) {
		this.current = file;
		for (const l of this.listeners) l(file);
	}
}
