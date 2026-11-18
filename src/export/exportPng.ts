import { loadPdfJs } from 'obsidian';
import { filterRows, pngFinish, pngStart, stripRows } from '../model/png';
import { PDF_DOC_PARAMS, type PdfJs, type PdfPage, type PdfViewport } from '../sources/pdfSource';

/** Largest canvas side we allocate (spike S4: Chromium fails silently beyond its limits). */
const MAX_TILE_PX = 8192;
/** Pixels drawn at a time: a strip of rows this big (about 64 MB as RGBA) is rendered, then compressed. */
const STRIP_AREA_PX = 4096 * 4096;

export interface PngFile {
	/** Suffix for the file name: "" (single image), "-01", "-02", … */
	suffix: string;
	bytes: Uint8Array;
}

/**
 * PNG export (SPEC 9.1, Q5): rasterize the final PDF with PDF.js, so PNGs match PDFs exactly. Each
 * sheet is one image whatever its size (Q11 option b): it is drawn in strips of rows, each under the
 * canvas cap, and streamed into one PNG, so no canvas ever holds the whole sheet.
 *
 * Images are yielded one at a time, so each can be written and dropped before the next is drawn: a
 * 100-page export at 300 dpi is hundreds of MB of PNGs. PDF.js may take over `pdf`'s buffer (it moves
 * it to its worker), so the caller must not use `pdf` afterwards.
 */
export async function* pdfToPngs(pdf: Uint8Array, dpi: number, progress: (msg: string) => void): AsyncGenerator<PngFile> {
	const lib = (await loadPdfJs()) as PdfJs;
	const doc = await lib.getDocument({ data: pdf, ...PDF_DOC_PARAMS }).promise;
	const pad = (n: number) => String(n).padStart(String(doc.numPages).length < 2 ? 2 : String(doc.numPages).length, '0');
	try {
		for (let i = 1; i <= doc.numPages; i++) {
			progress(`Rendering image ${i} of ${doc.numPages}…`);
			const page = await doc.getPage(i);
			const bytes = await pageToPng(page, dpi);
			page.cleanup();
			yield { suffix: doc.numPages > 1 ? `-${pad(i)}` : '', bytes };
		}
	} finally {
		await doc.destroy();
	}
}

async function pageToPng(page: PdfPage, dpi: number): Promise<Uint8Array> {
	const vp = page.getViewport({ scale: dpi / 72 });
	const W = Math.ceil(vp.width), H = Math.ceil(vp.height);
	const zlib = new CompressionStream('deflate');
	const writer = zlib.writable.getWriter();
	// Read while writing, or the stream's backpressure would stall the writes.
	const compressed = new Response(zlib.readable).arrayBuffer();
	const above = new Uint8Array(W * 3);
	const rows = stripRows(W, H, STRIP_AREA_PX);
	try {
		for (let y = 0; y < H; y += rows) {
			const h = Math.min(rows, H - y);
			await writer.write(filterRows(await renderStrip(page, vp, W, y, h), W, h, above));
		}
		await writer.close();
	} catch (e) {
		await writer.abort(e).catch(() => undefined);
		throw e;
	}
	return concatPng(pngStart(W, H, dpi), pngFinish(new Uint8Array(await compressed)));
}

/** Rows [y, y + h) of the page as RGBA on white, drawn in tiles no wider than the canvas cap. */
async function renderStrip(page: PdfPage, vp: PdfViewport, W: number, y: number, h: number): Promise<Uint8ClampedArray> {
	const strip = W <= MAX_TILE_PX ? null : new Uint8ClampedArray(W * h * 4);
	for (let x = 0; x < W; x += MAX_TILE_PX) {
		const canvas = createEl('canvas');
		canvas.width = Math.min(MAX_TILE_PX, W - x);
		canvas.height = h;
		const c2d = canvas.getContext('2d', { willReadFrequently: true });
		if (!c2d) throw new Error('No 2D canvas context');
		c2d.fillStyle = '#fff';
		c2d.fillRect(0, 0, canvas.width, canvas.height);
		await page.render({ canvasContext: c2d, canvas, viewport: vp, transform: [1, 0, 0, 1, -x, -y] }).promise;
		const tw = canvas.width;
		const data = c2d.getImageData(0, 0, tw, h).data;
		canvas.width = canvas.height = 0;
		if (!strip) return data;
		for (let r = 0; r < h; r++) strip.set(data.subarray(r * tw * 4, (r + 1) * tw * 4), (r * W + x) * 4);
	}
	return strip!;
}

function concatPng(head: Uint8Array, tail: Uint8Array): Uint8Array {
	const out = new Uint8Array(head.length + tail.length);
	out.set(head);
	out.set(tail, head.length);
	return out;
}
