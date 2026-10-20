import { type App, TFile } from 'obsidian';
import type { AnyModule } from '../model/schema';

/** Longest side of a preview (px); at < 25 % zoom a module is rarely bigger than this on screen. */
const THUMB_PX = 96;
/** Compressed previews are a few KB each; 32 MB holds thousands. */
const BUDGET_BYTES = 32 * 2 ** 20;

interface Thumb {
	url: string;
	bytes: number;
}

/**
 * Small previews of PDF crops and images, kept from on-screen renders and shown instead of plain
 * outline boxes when zoomed far out (SPEC 4 M3, level of detail). Nothing is decoded just for them.
 * Previews are PNG blob URLs shown as <img>: hundreds of <canvas> elements on a zoomed-out board
 * get composited layers and slowed panning from 60 to 40 fps (docs/perf.md).
 */
export class ThumbnailCache {
	private entries = new Map<string, Thumb>();
	private pending = new Set<string>();
	private bytes = 0;
	private listeners = new Set<() => void>();

	/** Called when a preview becomes available (encoding is async). Returns an unsubscribe. */
	onStored(fn: () => void): () => void {
		this.listeners.add(fn);
		return () => this.listeners.delete(fn);
	}

	/** Key for what a module shows; undefined for modules without previews. */
	static key(app: App, m: AnyModule): string | undefined {
		if ((m.type !== 'pdf' && m.type !== 'image') || typeof m.file !== 'string') return undefined;
		const f = app.vault.getAbstractFileByPath(m.file);
		const mtime = f instanceof TFile ? f.stat.mtime : 0;
		return m.type === 'pdf' ? `${m.file}|${mtime}|${String(m.page)}|${JSON.stringify(m.crop ?? null)}` : `${m.file}|${mtime}`;
	}

	has(key: string): boolean {
		return this.entries.has(key);
	}

	/** Keep a downscaled copy of `source` (a rendered crop or a decoded image). */
	store(key: string, source: CanvasImageSource, w: number, h: number) {
		if (this.entries.has(key) || this.pending.has(key) || w <= 0 || h <= 0) return;
		const k = Math.min(1, THUMB_PX / Math.max(w, h));
		const canvas = createEl('canvas');
		canvas.width = Math.max(1, Math.round(w * k));
		canvas.height = Math.max(1, Math.round(h * k));
		canvas.getContext('2d')?.drawImage(source, 0, 0, canvas.width, canvas.height);
		this.pending.add(key);
		const done = (blob: Blob | null) => {
			this.pending.delete(key);
			canvas.width = canvas.height = 0;
			if (!blob || this.entries.has(key)) return;
			this.entries.set(key, { url: URL.createObjectURL(blob), bytes: blob.size });
			this.bytes += blob.size;
			for (const [old, t] of this.entries) {
				if (this.bytes <= BUDGET_BYTES) break;
				this.drop(old, t);
			}
			this.listeners.forEach((fn) => fn());
		};
		try {
			canvas.toBlob(done, 'image/png');
		} catch {
			// A canvas tainted by a cross-origin source can't be encoded; go without a preview.
			done(null);
		}
	}

	/** Preview of an image file, decoded from its bytes (drawing the shown <img> would taint the canvas). */
	async storeFile(key: string, app: App, file: TFile) {
		if (this.entries.has(key) || this.pending.has(key)) return;
		try {
			const bitmap = await createImageBitmap(new Blob([await app.vault.readBinary(file)]));
			this.store(key, bitmap, bitmap.width, bitmap.height);
			bitmap.close();
		} catch {
			// Formats createImageBitmap can't read (e.g. SVG) just have no preview.
		}
	}

	/** The preview's URL, for an <img>. */
	url(key: string): string | undefined {
		const t = this.entries.get(key);
		if (!t) return undefined;
		// Recently used previews are evicted last.
		this.entries.delete(key);
		this.entries.set(key, t);
		return t.url;
	}

	invalidateFile(path: string) {
		for (const [k, t] of this.entries) if (k.startsWith(`${path}|`)) this.drop(k, t);
	}

	clear() {
		for (const [k, t] of this.entries) this.drop(k, t);
	}

	private drop(key: string, t: Thumb) {
		this.bytes -= t.bytes;
		URL.revokeObjectURL(t.url);
		this.entries.delete(key);
	}
}
