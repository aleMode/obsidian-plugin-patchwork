// Size-budgeted LRU with pinning. Pure; the bitmap cache supplies sizes and disposal.

interface Entry<V> {
	value: V;
	size: number;
	/** Pinned entries are in use (e.g. on screen) and never evicted. */
	pins: number;
}

export class PinnedLru<V> {
	private entries = new Map<string, Entry<V>>();
	private total = 0;

	constructor(
		private budget: number,
		private dispose: (value: V, key: string) => void = () => {},
	) {}

	get size(): number {
		return this.total;
	}

	get count(): number {
		return this.entries.size;
	}

	setBudget(budget: number) {
		this.budget = budget;
		this.evict();
	}

	/** Take an unpinned entry for use (pins it and marks it most recently used). */
	acquire(key: string): V | undefined {
		const e = this.entries.get(key);
		if (!e) return undefined;
		this.touch(key, e);
		e.pins++;
		return e.value;
	}

	/** Is there an entry nobody is using right now? (One value can't be shown in two places.) */
	available(key: string): boolean {
		const e = this.entries.get(key);
		return !!e && e.pins === 0;
	}

	/** Add a value, pinned once. Replaces (and disposes) an unpinned value under the same key. */
	put(key: string, value: V, size: number) {
		const old = this.entries.get(key);
		if (old) {
			if (old.pins > 0) return false;
			this.remove(key, old);
		}
		this.entries.set(key, { value, size, pins: 1 });
		this.total += size;
		this.evict();
		return true;
	}

	release(key: string) {
		const e = this.entries.get(key);
		if (!e) return;
		e.pins = Math.max(0, e.pins - 1);
		this.evict();
	}

	/** Drop every unpinned entry whose key matches (e.g. a modified file); pinned ones go on release. */
	invalidate(match: (key: string) => boolean) {
		for (const [k, e] of [...this.entries]) if (match(k) && e.pins === 0) this.remove(k, e);
	}

	clear() {
		for (const [k, e] of [...this.entries]) this.remove(k, e);
	}

	private touch(key: string, e: Entry<V>) {
		this.entries.delete(key);
		this.entries.set(key, e);
	}

	private remove(key: string, e: Entry<V>) {
		this.entries.delete(key);
		this.total -= e.size;
		this.dispose(e.value, key);
	}

	/** Oldest unpinned first; pinned entries can push the total over budget until released. */
	private evict() {
		if (this.total <= this.budget) return;
		for (const [k, e] of [...this.entries]) {
			if (this.total <= this.budget) break;
			if (e.pins === 0) this.remove(k, e);
		}
	}
}
