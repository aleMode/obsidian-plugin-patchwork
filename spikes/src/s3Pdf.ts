import { TFile } from 'obsidian';
import { canvasToPng, MM_PER_PT, PDF_DOC_PARAMS, pdfjs, Spike, SpikeContext } from './context';

type Crop = [number, number, number, number];

/** Normalized crop (top-left origin) of a box given in mm on the page as displayed. */
const cropFromMm = (x0: number, y0: number, x1: number, y1: number, wMm: number, hMm: number): Crop => [x0 / wMm, y0 / hMm, x1 / wMm, y1 / hMm];

// Renderer RSS includes canvas backing stores, unlike the JS heap. (Electron's getProcessMemoryInfo()
// was tried first: it stalled for ~15 s after doc.destroy(), so avoid it.)
async function processMemMB(): Promise<number | null> {
	return Math.round(process.memoryUsage().rss / 2 ** 20);
}

/**
 * Render only the cropped region into a canvas the size of the crop.
 * The viewport already includes the page's own /Rotate, so the crop is on the page as displayed.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function renderCrop(page: any, crop: Crop, scale: number) {
	const vp = page.getViewport({ scale });
	const x = crop[0] * vp.width;
	const y = crop[1] * vp.height;
	const w = Math.ceil((crop[2] - crop[0]) * vp.width);
	const h = Math.ceil((crop[3] - crop[1]) * vp.height);
	const canvas = document.createElement('canvas');
	canvas.width = w;
	canvas.height = h;
	const c2d = canvas.getContext('2d')!;
	c2d.fillStyle = '#fff';
	c2d.fillRect(0, 0, w, h);
	const t0 = performance.now();
	await page.render({ canvasContext: c2d, canvas, viewport: vp, transform: [1, 0, 0, 1, -x, -y] }).promise;
	return { canvas, ms: Math.round(performance.now() - t0) };
}

function pixel(canvas: HTMLCanvasElement, fx: number, fy: number) {
	const d = canvas.getContext('2d')!.getImageData(Math.floor(canvas.width * fx), Math.floor(canvas.height * fy), 1, 1).data;
	return [d[0], d[1], d[2]];
}

/** S3: crop rendering, memory, cancellation, outline and text extraction with Obsidian's PDF.js. */
export const s3Pdf: Spike = async (ctx: SpikeContext, opts) => {
	const lib = await pdfjs();
	const file = ctx.app.vault.getAbstractFileByPath('PDFs/Sample rulebook.pdf') as TFile;
	const data = new Uint8Array(await ctx.app.vault.readBinary(file));
	const out: Record<string, unknown> = { pdfjsVersion: lib.version, apiKeys: Object.keys(lib).slice(0, 40) };

	const t00 = performance.now();
	const marks: Record<string, number> = {};
	out.marks = marks;
	const mark = (k: string) => (marks[k] = Math.round(performance.now() - t00));
	const memBefore = await processMemMB();
	mark('memBefore');
	const params = opts?.noFontParams ? {} : PDF_DOC_PARAMS;
	out.docParams = params;
	const tLoad = performance.now();
	const doc = await lib.getDocument({ data, ...params }).promise;
	out.loadMs = Math.round(performance.now() - tLoad);
	out.numPages = doc.numPages;

	// 1. Crop the stat block on page 1 (x 20-110 mm, y 150-230 mm) at 2x.
	const tPage = performance.now();
	const p1 = await doc.getPage(1);
	out.getPageMs = Math.round(performance.now() - tPage);
	const statCrop = cropFromMm(20, 150, 110, 230, 210, 297);
	const crop2x = await renderCrop(p1, statCrop, 2);
	out.statBlock2x = {
		canvas: `${crop2x.canvas.width}x${crop2x.canvas.height}`,
		fullPageAt2x: `${Math.ceil(p1.getViewport({ scale: 2 }).width)}x${Math.ceil(p1.getViewport({ scale: 2 }).height)}`,
		ms: crop2x.ms,
		// Expect the beige fill (245,235,209) away from the text.
		pixelNearRightEdge: pixel(crop2x.canvas, 0.97, 0.5),
		png: ctx.save('s3-statblock-2x.png', await canvasToPng(crop2x.canvas)),
	};

	mark('statBlockDone');
	// 2. A deep zoom on a small crop: full page at this scale would be huge, the crop is not.
	const zoomScale = 12; // ~864 dpi
	const zoom = await renderCrop(p1, cropFromMm(20, 150, 60, 170, 210, 297), zoomScale);
	const memAfterZoom = await processMemMB();
	const fullVp = p1.getViewport({ scale: zoomScale });
	out.deepZoom = {
		scale: zoomScale,
		canvas: `${zoom.canvas.width}x${zoom.canvas.height}`,
		fullPageWouldBe: `${Math.ceil(fullVp.width)}x${Math.ceil(fullVp.height)} (${Math.round((fullVp.width * fullVp.height * 4) / 2 ** 20)} MB)`,
		cropMB: Math.round((zoom.canvas.width * zoom.canvas.height * 4) / 2 ** 20),
		ms: zoom.ms,
		processPrivateMB: { before: memBefore, after: memAfterZoom },
		png: ctx.save('s3-deepzoom.png', await canvasToPng(zoom.canvas)),
	};
	zoom.canvas.width = zoom.canvas.height = 0;

	mark('deepZoomDone');
	// 3. Page 3 has /Rotate 90. Its blue box is at x 20-70, y 50-80 mm in unrotated content,
	//    which on the displayed (landscape, 297x210) page is x 217-247, y 20-70 mm.
	const p3 = await doc.getPage(3);
	const vp3 = p3.getViewport({ scale: 1 });
	const rotCrop = await renderCrop(p3, cropFromMm(217, 20, 247, 70, 297, 210), 3);
	out.rotatedPage = {
		pageRotate: p3.rotate,
		displayedMm: `${(vp3.width * MM_PER_PT).toFixed(1)}x${(vp3.height * MM_PER_PT).toFixed(1)}`,
		canvas: `${rotCrop.canvas.width}x${rotCrop.canvas.height}`,
		// Expect light blue (204,230,255) in the middle.
		centerPixel: pixel(rotCrop.canvas, 0.5, 0.5),
		png: ctx.save('s3-rotated-crop.png', await canvasToPng(rotCrop.canvas)),
	};

	mark('rotatedDone');
	// 4. Cancellation of a big render.
	const p2 = await doc.getPage(2);
	const big = document.createElement('canvas');
	const bigVp = p2.getViewport({ scale: 8 });
	big.width = bigVp.width;
	big.height = bigVp.height;
	const task = p2.render({ canvasContext: big.getContext('2d')!, canvas: big, viewport: bigVp });
	// Cancel before the first animation frame, as a viewport change would.
	task.cancel();
	try {
		await task.promise;
		out.cancel = { cancelled: false, note: 'render finished before cancel' };
	} catch (e) {
		out.cancel = { cancelled: true, errorName: (e as Error).name, message: (e as Error).message };
	}
	big.width = big.height = 0;

	mark('cancelDone');
	// 5. Outline with resolved page numbers.
	const outline = await doc.getOutline();
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const resolve = async (item: any): Promise<unknown> => {
		const dest = typeof item.dest === 'string' ? await doc.getDestination(item.dest) : item.dest;
		const pageIndex = dest ? await doc.getPageIndex(dest[0]) : null;
		return { title: item.title, page: pageIndex === null ? null : pageIndex + 1, children: await Promise.all(item.items.map(resolve)) };
	};
	out.outline = outline ? await Promise.all(outline.map(resolve)) : null;

	mark('outlineDone');
	// 6. Text search to region: find "Goblin Skirmisher" and convert to a normalized crop.
	const text = await p1.getTextContent();
	const vp1 = p1.getViewport({ scale: 1 });
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const hit = text.items.find((i: any) => i.str.includes('Goblin Skirmisher'));
	if (hit) {
		const [x, y] = vp1.convertToViewportPoint(hit.transform[4], hit.transform[5]);
		out.textSearch = {
			found: hit.str,
			normalizedBaseline: [+(x / vp1.width).toFixed(4), +(y / vp1.height).toFixed(4)],
			expectedApprox: [+(24 / 210).toFixed(4), +(158 / 297).toFixed(4)],
			widthMm: +(hit.width * MM_PER_PT).toFixed(1),
		};
	}

	mark('textDone');
	p1.cleanup();
	p2.cleanup();
	p3.cleanup();
	await doc.destroy();
	mark('destroyed');
	out.processPrivateMBAfterDestroy = await processMemMB();
	mark('memAfter');
	return out;
};
