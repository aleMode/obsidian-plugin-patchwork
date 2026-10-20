import { loadPdfJs } from 'obsidian';
import { PDF_DOC_PARAMS, type PdfJs } from '../sources/pdfSource';

/** Largest canvas side we allocate (spike S4: Chromium fails silently beyond its limits). */
const MAX_TILE_PX = 8192;

export interface PngFile {
	/** Suffix for the file name: "" (single image), "-01", "-01-r1c2", … */
	suffix: string;
	bytes: Uint8Array;
}

/**
 * PNG export (SPEC 9.1, Q5): rasterize the final PDF with PDF.js, so PNGs match PDFs exactly.
 * Sheets larger than the tile cap are written as several files (Q11 option a).
 */
export async function pdfToPngs(pdf: Uint8Array, dpi: number, progress: (msg: string) => void): Promise<PngFile[]> {
	const lib = (await loadPdfJs()) as PdfJs;
	const doc = await lib.getDocument({ data: pdf.slice(), ...PDF_DOC_PARAMS }).promise;
	const out: PngFile[] = [];
	const pad = (n: number) => String(n).padStart(String(doc.numPages).length < 2 ? 2 : String(doc.numPages).length, '0');
	try {
		for (let i = 1; i <= doc.numPages; i++) {
			progress(`Rendering image ${i} of ${doc.numPages}…`);
			const page = await doc.getPage(i);
			const vp = page.getViewport({ scale: dpi / 72 });
			const W = Math.ceil(vp.width), H = Math.ceil(vp.height);
			const cols = Math.ceil(W / MAX_TILE_PX), rows = Math.ceil(H / MAX_TILE_PX);
			for (let r = 0; r < rows; r++) {
				for (let c = 0; c < cols; c++) {
					const x = c * MAX_TILE_PX, y = r * MAX_TILE_PX;
					const canvas = createEl('canvas');
					canvas.width = Math.min(MAX_TILE_PX, W - x);
					canvas.height = Math.min(MAX_TILE_PX, H - y);
					const c2d = canvas.getContext('2d');
					if (!c2d) throw new Error('No 2D canvas context');
					c2d.fillStyle = '#fff';
					c2d.fillRect(0, 0, canvas.width, canvas.height);
					await page.render({ canvasContext: c2d, canvas, viewport: vp, transform: [1, 0, 0, 1, -x, -y] }).promise;
					const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'));
					canvas.width = canvas.height = 0;
					if (!blob) throw new Error(`Could not encode image ${i}`);
					const tile = rows * cols > 1 ? `-r${r + 1}c${c + 1}` : '';
					out.push({ suffix: doc.numPages > 1 ? `-${pad(i)}${tile}` : tile, bytes: new Uint8Array(await blob.arrayBuffer()) });
				}
			}
			page.cleanup();
		}
	} finally {
		await doc.destroy();
	}
	return out;
}
