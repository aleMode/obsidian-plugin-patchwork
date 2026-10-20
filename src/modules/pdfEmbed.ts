import { type App, TFile } from 'obsidian';
import { PDF_EMBED_CLASS, type PdfEmbed } from '../model/pdfEmbeds';
import { PX_PER_MM } from '../model/units';
import type { PdfDocCache } from '../sources/pdfSource';

// PDF embeds inside notes (Q9, model/pdfEmbeds.ts): the placeholders become a static picture of the
// page, sized to the width the note gives them, through the shared PDF documents and render queue.

/** Never allocate a canvas side beyond this (memory, spike S4). */
const MAX_CANVAS_SIDE = 4096;
const CSS_PX_PER_MM = 96 / 25.4;

export interface PdfEmbedDeps {
	app: App;
	pdfDocs: PdfDocCache;
	/** Canvas pixels per mm (zoom on the board, the DPI in an export); default: the screen at 100 %. */
	resolution?: () => number;
	/**
	 * Only size the boxes, draw nothing: an export that places these pages as vector in stage 2 (sharp,
	 * selectable text), and linked-frame measuring.
	 */
	sizeOnly?: boolean;
}

/**
 * Fill every placeholder under `root`. Each one records the PDF file and page it shows
 * (`data-pw-pdf-file`, `data-pw-pdf-page`), so an export can find and replace it.
 */
export async function renderPdfEmbeds(root: HTMLElement, embeds: readonly PdfEmbed[], d: PdfEmbedDeps, sourcePath: string, isCurrent: () => boolean): Promise<void> {
	const boxes = Array.from(root.querySelectorAll<HTMLElement>(`.${PDF_EMBED_CLASS}[data-pw-embed]`));
	await Promise.all(boxes.map((el) => drawEmbed(el, embeds[Number(el.dataset.pwEmbed)], d, sourcePath, isCurrent)));
}

async function drawEmbed(el: HTMLElement, embed: PdfEmbed | undefined, d: PdfEmbedDeps, sourcePath: string, isCurrent: () => boolean) {
	if (!embed) return;
	const file = d.app.metadataCache.getFirstLinkpathDest(embed.path, sourcePath);
	if (!(file instanceof TFile)) return missing(el, `PDF not found: ${embed.path}`);
	el.dataset.pwPdfFile = file.path;
	el.dataset.pwPdfPage = String(embed.page);
	try {
		const doc = await d.pdfDocs.acquire(file.path);
		try {
			if (embed.page > doc.numPages) return missing(el, `${file.path} has only ${doc.numPages} pages`);
			const page = await doc.getPage(embed.page);
			const vp1 = page.getViewport({ scale: 1 });
			// The box takes the page's shape at whatever width the note gives it.
			el.setCssProps({ '--pw-embed-ratio': `${vp1.width} / ${vp1.height}` });
			if (d.sizeOnly || !isCurrent()) return;
			const pxPerMm = d.resolution?.() ?? PX_PER_MM * window.devicePixelRatio;
			const w = Math.min(MAX_CANVAS_SIDE, Math.max(1, Math.round((el.clientWidth / CSS_PX_PER_MM) * pxPerMm)));
			const vp = page.getViewport({ scale: w / vp1.width });
			await d.pdfDocs.schedule(async () => {
				if (!isCurrent()) return;
				const canvas = createEl('canvas', { cls: 'pw-pdf-embed-canvas' });
				canvas.width = Math.ceil(vp.width);
				canvas.height = Math.ceil(vp.height);
				const c2d = canvas.getContext('2d');
				if (!c2d) return;
				c2d.fillStyle = '#fff';
				c2d.fillRect(0, 0, canvas.width, canvas.height);
				try {
					await page.render({ canvasContext: c2d, canvas, viewport: vp }).promise;
				} finally {
					page.cleanup();
				}
				if (!isCurrent()) {
					canvas.width = canvas.height = 0;
					return;
				}
				releasePdfEmbeds(el);
				el.empty();
				el.appendChild(canvas);
			});
		} finally {
			d.pdfDocs.release(file.path);
		}
	} catch (e) {
		missing(el, `Could not render ${file.path}: ${e instanceof Error ? e.message : String(e)}`);
	}
}

function missing(el: HTMLElement, text: string) {
	el.addClass('is-missing');
	el.setText(text);
}

/** Free the pixels of drawn embeds now rather than at garbage collection (hard rule 9). */
export function releasePdfEmbeds(root: HTMLElement) {
	root.querySelectorAll<HTMLCanvasElement>('canvas.pw-pdf-embed-canvas').forEach((c) => (c.width = c.height = 0));
}
