import { TFile } from 'obsidian';
import { canvasToPng, PDF_DOC_PARAMS, pdfjs, sleep, Spike, SpikeContext } from './context';

// S3 follow-up: the same measurements on a real, heavy rulebook instead of the tiny fixture.

const rssMB = () => Math.round(process.memoryUsage().rss / 2 ** 20);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function render(page: any, scale: number, crop: [number, number, number, number] = [0, 0, 1, 1]) {
	const vp = page.getViewport({ scale });
	const x = crop[0] * vp.width;
	const y = crop[1] * vp.height;
	const canvas = document.createElement('canvas');
	canvas.width = Math.ceil((crop[2] - crop[0]) * vp.width);
	canvas.height = Math.ceil((crop[3] - crop[1]) * vp.height);
	const t0 = performance.now();
	await page.render({ canvasContext: canvas.getContext('2d')!, canvas, viewport: vp, transform: [1, 0, 0, 1, -x, -y] }).promise;
	return { canvas, ms: Math.round(performance.now() - t0) };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function loadDoc(ctx: SpikeContext, file: TFile, mode: 'data' | 'url'): Promise<{ doc: any; ms: number }> {
	const lib = await pdfjs();
	const t0 = performance.now();
	const src =
		mode === 'data'
			? { data: new Uint8Array(await ctx.app.vault.readBinary(file)) }
			: // Lets PDF.js fetch byte ranges on demand instead of holding the whole file in memory.
				{ url: ctx.app.vault.getResourcePath(file), disableAutoFetch: true, disableStream: false };
	const doc = await lib.getDocument({ ...src, ...PDF_DOC_PARAMS }).promise;
	return { doc, ms: Math.round(performance.now() - t0) };
}

export const s3Real: Spike = async (ctx, opts) => {
	const path = String(opts?.path ?? '');
	const file = ctx.app.vault.getAbstractFileByPath(path);
	if (!(file instanceof TFile)) throw new Error(`No such PDF: ${path}`);
	const out: Record<string, unknown> = { file: path, sizeMB: +(file.stat.size / 2 ** 20).toFixed(1) };

	// 1. Load cost per mode, measured in isolation.
	for (const mode of ['url', 'data'] as const) {
		const before = rssMB();
		const { doc, ms } = await loadDoc(ctx, file, mode);
		const p = await doc.getPage(1);
		await render(p, 0.25);
		out[`load_${mode}`] = { openMs: ms, pages: doc.numPages, rssBeforeMB: before, rssAfterOpenAndThumbMB: rssMB() };
		await doc.destroy();
		await sleep(300);
	}

	const { doc } = await loadDoc(ctx, file, 'url');
	const n = doc.numPages;
	const pages = [1, Math.round(n * 0.25), Math.round(n * 0.5), Math.round(n * 0.75)];

	// 2. Full page vs a crop of the same page at 2x and 4x.
	const perPage = [];
	for (const pn of pages) {
		const page = await doc.getPage(pn);
		const full2 = await render(page, 2);
		const crop: [number, number, number, number] = [0.08, 0.1, 0.55, 0.45];
		const crop2 = await render(page, 2, crop);
		const crop4 = await render(page, 4, crop);
		const text0 = performance.now();
		const text = await page.getTextContent();
		perPage.push({
			page: pn,
			full2x: { px: `${full2.canvas.width}x${full2.canvas.height}`, ms: full2.ms },
			crop2x: { px: `${crop2.canvas.width}x${crop2.canvas.height}`, ms: crop2.ms },
			crop4x: { px: `${crop4.canvas.width}x${crop4.canvas.height}`, ms: crop4.ms },
			textItems: text.items.length,
			textMs: Math.round(performance.now() - text0),
			png: ctx.save(`s3real-p${pn}-crop4x.png`, await canvasToPng(crop4.canvas)),
			fullPng: ctx.save(`s3real-p${pn}-full.png`, await canvasToPng((await render(page, 0.6)).canvas)),
		});
		for (const c of [full2, crop2, crop4]) c.canvas.width = c.canvas.height = 0;
		page.cleanup();
	}
	out.perPage = perPage;
	out.rssAfterRendersMB = rssMB();

	// 3. Thumbnail throughput: what scrolling a page picker would cost.
	const t0 = performance.now();
	const thumbs = Math.min(20, n);
	for (let i = 1; i <= thumbs; i++) {
		const page = await doc.getPage(i);
		const r = await render(page, 0.2);
		r.canvas.width = r.canvas.height = 0;
		page.cleanup();
	}
	out.thumbnails = { count: thumbs, totalMs: Math.round(performance.now() - t0), rssMB: rssMB() };

	// 4. Cancellation on a heavy page at high scale.
	const heavy = await doc.getPage(pages[1]!);
	const big = document.createElement('canvas');
	const vp = heavy.getViewport({ scale: 4 });
	big.width = vp.width;
	big.height = vp.height;
	const task = heavy.render({ canvasContext: big.getContext('2d')!, canvas: big, viewport: vp });
	const tc = performance.now();
	setTimeout(() => task.cancel(), 30);
	try {
		await task.promise;
		out.cancel = { cancelled: false, ms: Math.round(performance.now() - tc) };
	} catch (e) {
		out.cancel = { cancelled: true, afterMs: Math.round(performance.now() - tc), name: (e as Error).name };
	}
	big.width = big.height = 0;

	// 6. Cold pages, crop rendered first, with main-thread blocking (long tasks) measured.
	const cold = [];
	for (const pn of [Math.round(n * 0.3), Math.round(n * 0.6), Math.round(n * 0.9)]) {
		const page = await doc.getPage(pn);
		const longTasks: number[] = [];
		const po = new PerformanceObserver((list) => list.getEntries().forEach((e) => longTasks.push(Math.round(e.duration))));
		po.observe({ type: 'longtask', buffered: false });
		const crop2 = await render(page, 2, [0.08, 0.1, 0.55, 0.45]);
		await sleep(50);
		const cropTasks = [...longTasks];
		longTasks.length = 0;
		const full2 = await render(page, 2);
		await sleep(50);
		po.disconnect();
		cold.push({
			page: pn,
			cropFirst2x: { ms: crop2.ms, longTasksMs: cropTasks },
			thenFull2x: { ms: full2.ms, longTasksMs: [...longTasks] },
		});
		for (const c of [crop2, full2]) c.canvas.width = c.canvas.height = 0;
		page.cleanup();
	}
	out.coldCropFirst = cold;

	// 5. Outline size.
	const outline = await doc.getOutline();
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const count = (items: any[]): number => items.reduce((s, i) => s + 1 + count(i.items ?? []), 0);
	out.outline = { top: outline?.length ?? 0, total: outline ? count(outline) : 0 };

	await doc.destroy();
	await sleep(500);
	out.rssAfterDestroyMB = rssMB();
	return out;
};
