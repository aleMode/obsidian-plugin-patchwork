import { newBoardFile, PAGE_GAP_MM } from './defaults';
import { newId } from './ids';
import type { AnyModule, Page, PatchworkFile } from './schema';

// Stress boards for profiling (SPEC 8.9). Deterministic for a given seed, so runs are comparable.

export interface StressSources {
	notes: string[];
	pdfs: { path: string; pages: number }[];
	images: string[];
}

export interface StressOptions {
	pages: number;
	modulesPerPage: number;
	/** Pages per row on the board. */
	columns?: number;
	seed?: number;
}

/** Small seeded PRNG (mulberry32); Math.random can't be seeded. */
export function seededRandom(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

const A4 = { w: 210, h: 297 };

function stressModule(rand: () => number, src: StressSources, id: string, slot: { x: number; y: number; w: number; h: number }): AnyModule {
	const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)]!;
	const kinds = [...(src.notes.length ? ['note'] : []), ...(src.pdfs.length ? ['pdf'] : []), ...(src.images.length ? ['image'] : []), 'text'];
	const kind = pick(kinds);
	if (kind === 'note') return { id, type: 'note', ...slot, file: pick(src.notes) };
	if (kind === 'image') return { id, type: 'image', ...slot, file: pick(src.images) };
	if (kind === 'pdf') {
		const pdf = pick(src.pdfs);
		const x0 = Math.round(rand() * 50) / 100;
		const y0 = Math.round(rand() * 50) / 100;
		return { id, type: 'pdf', ...slot, file: pdf.path, page: 1 + Math.floor(rand() * pdf.pages), crop: [x0, y0, x0 + 0.5, y0 + 0.5] };
	}
	return { id, type: 'text', ...slot, markdown: `**Stress ${id}**\n\nLorem ipsum dolor sit amet, consectetur adipiscing elit.` };
}

/** Modules tile the page in a 2-column grid of equal slots. */
function slots(count: number, page: { w: number; h: number }) {
	const margin = 10, gap = 5, cols = 2;
	const rows = Math.max(1, Math.ceil(count / cols));
	const w = (page.w - 2 * margin - (cols - 1) * gap) / cols;
	const h = (page.h - 2 * margin - (rows - 1) * gap) / rows;
	return Array.from({ length: count }, (_, i) => ({
		x: margin + (i % cols) * (w + gap),
		y: margin + Math.floor(i / cols) * (h + gap),
		w,
		h,
	}));
}

export function generateStressBoard(src: StressSources, opts: StressOptions): PatchworkFile {
	const rand = seededRandom(opts.seed ?? 1);
	const file = newBoardFile({ title: `Stress ${opts.pages}×${opts.modulesPerPage}` });
	const columns = opts.columns ?? 10;
	const taken = new Set<string>();
	const idFor = () => {
		const id = newId(taken, rand);
		taken.add(id);
		return id;
	};
	const layout = slots(opts.modulesPerPage, A4);
	for (let i = 0; i < opts.pages; i++) {
		const page: Page = {
			id: idFor(),
			name: `Page ${i + 1}`,
			x: (i % columns) * (A4.w + PAGE_GAP_MM),
			y: Math.floor(i / columns) * (A4.h + PAGE_GAP_MM),
			...A4,
			modules: layout.map((slot) => stressModule(rand, src, idFor(), slot)),
		};
		file.pages.push(page);
	}
	return file;
}
