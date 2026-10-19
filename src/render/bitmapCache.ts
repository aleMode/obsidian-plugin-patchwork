import { PinnedLru } from './lru';

/**
 * Rendered PDF crops, kept after their module scrolls away so revisiting a page or switching level
 * of detail never re-decodes (SPEC 8.4). Canvases on screen are pinned; the rest are evicted
 * least-recently-used beyond the memory budget.
 */
export class BitmapCache {
	private lru: PinnedLru<HTMLCanvasElement>;

	constructor(budgetMB: number) {
		// Zeroing the size frees the backing store now rather than at garbage collection.
		this.lru = new PinnedLru(budgetMB * 2 ** 20, (canvas) => {
			canvas.width = canvas.height = 0;
		});
	}

	static key(parts: { file: string; mtime: number; page: number; crop: readonly number[]; w: number; h: number }): string {
		return `${parts.file}|${parts.mtime}|${parts.page}|${parts.crop.map((n) => n.toFixed(5)).join(',')}|${parts.w}x${parts.h}`;
	}

	/** A cached canvas nobody is showing, now pinned for the caller; or undefined. */
	take(key: string): HTMLCanvasElement | undefined {
		return this.lru.available(key) ? this.lru.acquire(key) : undefined;
	}

	/** Store a freshly rendered canvas, pinned for the caller. Returns false if the key is busy. */
	put(key: string, canvas: HTMLCanvasElement): boolean {
		return this.lru.put(key, canvas, canvas.width * canvas.height * 4);
	}

	/** The caller stopped showing it; it stays cached until evicted. */
	release(key: string) {
		this.lru.release(key);
	}

	invalidateFile(path: string) {
		this.lru.invalidate((k) => k.startsWith(`${path}|`));
	}

	setBudgetMB(mb: number) {
		this.lru.setBudget(mb * 2 ** 20);
	}

	stats() {
		return { entries: this.lru.count, mb: Math.round(this.lru.size / 2 ** 20) };
	}

	clear() {
		this.lru.clear();
	}
}

/**
 * Snap a resolution to half-octave steps, so small zoom changes reuse cached renders instead of
 * producing near-identical ones.
 */
export function bucketResolution(pxPerMm: number, base: number): number {
	const steps = Math.round(Math.log2(pxPerMm / base) * 2) / 2;
	return base * 2 ** steps;
}
