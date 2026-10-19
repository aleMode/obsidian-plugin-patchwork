import { App, loadPdfJs } from 'obsidian';
import * as fs from 'fs';
import * as path from 'path';

export interface SpikeContext {
	app: App;
	outDir: string;
	save(name: string, data: Uint8Array | string): string;
	log(...args: unknown[]): void;
	logs: string[];
}

export type Spike = (ctx: SpikeContext, opts?: Record<string, unknown>) => Promise<unknown>;

export function makeContext(app: App, outDir: string): SpikeContext {
	const logs: string[] = [];
	return {
		app,
		outDir,
		logs,
		save(name, data) {
			const p = path.join(outDir, name);
			fs.mkdirSync(path.dirname(p), { recursive: true });
			fs.writeFileSync(p, data);
			return p;
		},
		log(...args) {
			logs.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
		},
	};
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const MM_PER_PT = 25.4 / 72;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type PdfJs = any;

/**
 * Mirrors what Obsidian's own PDF viewer passes (assets bundled with the app). Standard fonts render
 * without them via system fonts, but CJK CMaps, JPEG 2000 (wasm) and ICC profiles need these URLs.
 */
export const PDF_DOC_PARAMS = {
	cMapUrl: '/lib/pdfjs/cmaps/',
	cMapPacked: true,
	standardFontDataUrl: '/lib/pdfjs/standard_fonts/',
	wasmUrl: '/lib/pdfjs/wasm/',
	iccUrl: '/lib/pdfjs/iccs/',
	isEvalSupported: false,
};

let pdfjsPromise: Promise<PdfJs> | null = null;
export function pdfjs(): Promise<PdfJs> {
	return (pdfjsPromise ??= loadPdfJs());
}

export async function canvasToPng(canvas: HTMLCanvasElement): Promise<Uint8Array> {
	const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
	if (!blob) throw new Error(`toBlob returned null for ${canvas.width}x${canvas.height}`);
	return new Uint8Array(await blob.arrayBuffer());
}

/** Summarize a PDF (page sizes in mm, text per page) and optionally rasterize pages for visual checks. */
export async function inspectPdf(
	ctx: SpikeContext,
	bytes: Uint8Array,
	opts: { pngPrefix?: string; pngScale?: number; maxTextChars?: number } = {},
) {
	const lib = await pdfjs();
	const doc = await lib.getDocument({ data: bytes.slice(), ...PDF_DOC_PARAMS }).promise;
	const pages = [];
	for (let i = 1; i <= doc.numPages; i++) {
		const page = await doc.getPage(i);
		const vp = page.getViewport({ scale: 1 });
		const text = await page.getTextContent();
		const str = text.items.map((it: { str: string }) => it.str).join(' ');
		const info: Record<string, unknown> = {
			page: i,
			widthMm: +(vp.width * MM_PER_PT).toFixed(2),
			heightMm: +(vp.height * MM_PER_PT).toFixed(2),
			textItems: text.items.length,
			text: str.slice(0, opts.maxTextChars ?? 200),
		};
		if (opts.pngPrefix) {
			const scale = opts.pngScale ?? 0.5;
			const v = page.getViewport({ scale });
			const canvas = document.createElement('canvas');
			canvas.width = Math.ceil(v.width);
			canvas.height = Math.ceil(v.height);
			const c2d = canvas.getContext('2d')!;
			c2d.fillStyle = '#fff';
			c2d.fillRect(0, 0, canvas.width, canvas.height);
			await page.render({ canvasContext: c2d, canvas, viewport: v }).promise;
			info.png = ctx.save(`${opts.pngPrefix}-p${i}.png`, await canvasToPng(canvas));
			canvas.width = canvas.height = 0;
		}
		pages.push(info);
		page.cleanup();
	}
	const outline = await doc.getOutline();
	await doc.destroy();
	return { numPages: pages.length, pages, outline: outline?.map((o: { title: string }) => o.title) ?? null };
}
