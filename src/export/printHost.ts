import { Component } from 'obsidian';
import { drawOrder } from '../model/exportPlan';
import type { PageFurniture } from '../model/numbering';
import type { NumberPosition } from '../model/schema';
import { renderFurniture } from '../view/furniture';
import { type AnyModule, isKnownModule, type NoteModule, type Page } from '../model/schema';
import { ImageModuleRenderer } from '../modules/imageModule';
import { FlowRenderer, NoteModuleRenderer, TextModuleRenderer } from '../modules/noteModule';
import type { FlowContext } from '../modules/flowLayout';
import { applyOverflow } from '../modules/overflow';
import { PdfModuleRenderer } from '../modules/pdfModule';
import { TocModuleRenderer } from '../modules/tocModule';
import { ShapeRenderer } from '../modules/shapeModule';
import { TrackerRenderer } from '../modules/trackerModule';
import type { Rect } from '../model/geometry';
import type { TocEntry } from '../model/toc';
import { applyModuleStyle } from '../modules/style';
import { type ModuleContext, type ModuleRenderer, placeholder } from '../modules/types';
import { printWindowToPdf } from './printAdapter';

// Stage 1 of export (SPEC 9.1): an offscreen host in the main window, one sheet per board page at its
// native size, printed by Chromium. Vector PDF modules are left empty for stage 2.

export interface PrintOptions {
	ctx: Omit<ModuleContext, 'component'>;
	parent: Component;
	/** IDs of PDF modules drawn as vector in stage 2. */
	vector: ReadonlySet<string>;
	dpi: number;
	appTheme: boolean;
	boardPath: string;
	furniture: Map<string, PageFurniture>;
	numberPosition: NumberPosition;
	inkSaver?: boolean;
	/** Bleed (mm): each sheet is printed this much larger on every side. */
	bleed?: number;
	/** Table of contents entries for a page. */
	tocEntries: (pageId: string) => TocEntry[];
	/** Linked text frames; shared by all batches so each chain is measured once. */
	flow: FlowContext;
	/** Board font for notes and text (CSS font-family), if set. */
	font?: string;
	/** PDF embeds in notes become vector in stage 2 (their boxes print empty); otherwise pictures at `dpi`. */
	vectorEmbeds?: boolean;
}

/** A PDF embed inside a note, as laid out on a printed page, for stage 2 to draw as vector. */
export interface PrintedEmbed {
	/** Index of the page within this batch. */
	page: number;
	/** The part of the embedded page that is visible (mm, page coordinates), and which part of the page that is (0–1). */
	rect: Rect;
	crop: [number, number, number, number];
	file: string;
	pdfPage: number;
}

/** A clickable area on a printed page (mm, page coordinates) leading to another page. */
export interface PrintedLink {
	/** Index of the page within this batch. */
	page: number;
	rect: Rect;
	targetPageId: string;
}

export interface PrintResult {
	bytes: Uint8Array;
	problems: string[];
	links: PrintedLink[];
	embeds: PrintedEmbed[];
}

/** Quiet period with no DOM changes before printing; async plugins (Dataview, Mermaid) render late. */
const QUIET_MS = 300;
const SETTLE_TIMEOUT_MS = 10_000;

/** @page sizes differ per sheet, so the rules are generated: one named page per sheet (spike S5). */
function pageRules(pages: readonly Page[], bleed: number): string {
	return pages
		.map((p, i) => `@page pw-sheet-${i} { size: ${p.w + 2 * bleed}mm ${p.h + 2 * bleed}mm; margin: 0; } .pw-sheet[data-sheet="${i}"] { page: pw-sheet-${i}; }`)
		.join('\n');
}

function createRenderer(m: AnyModule, body: HTMLElement, ctx: ModuleContext, o: PrintOptions, pageId: string): ModuleRenderer | null {
	if (isFlow(m, o)) return new FlowRenderer(body, ctx);
	if (!isKnownModule(m)) {
		placeholder(body, `Unknown module type "${m.type}"`, 'info');
		return null;
	}
	switch (m.type) {
		case 'note':
			return new NoteModuleRenderer(body, ctx);
		case 'text':
			return new TextModuleRenderer(body, ctx, () => o.boardPath);
		case 'image':
			return new ImageModuleRenderer(body, ctx);
		case 'pdf':
			return o.vector.has(m.id) ? null : new PdfModuleRenderer(body, ctx, o.dpi / 25.4);
		case 'toc':
			return new TocModuleRenderer(body, () => o.tocEntries(pageId));
		case 'frame':
			return new FlowRenderer(body, ctx);
		case 'tracker':
			return new TrackerRenderer(body);
		case 'shape':
			return new ShapeRenderer(body);
	}
}

const isFlow = (m: AnyModule, o: PrintOptions) => m.type === 'frame' || !!o.flow.info(m.id);

async function settle(el: HTMLElement, renderers: ModuleRenderer[]): Promise<boolean> {
	const deadline = Date.now() + SETTLE_TIMEOUT_MS;
	await Promise.race([Promise.allSettled(renderers.map((r) => r.rendered())), sleep(SETTLE_TIMEOUT_MS)]);
	await el.doc.fonts.ready;
	await Promise.allSettled(Array.from(el.querySelectorAll('img')).map((img) => img.decode()));
	let last = Date.now();
	const mo = new MutationObserver(() => (last = Date.now()));
	mo.observe(el, { subtree: true, childList: true, attributes: true, characterData: true });
	while (Date.now() - last < QUIET_MS && Date.now() < deadline) await sleep(50);
	mo.disconnect();
	return Date.now() < deadline;
}

const sleep = (ms: number) => new Promise((r) => window.setTimeout(r, ms));

const PX_PER_MM_CSS = 96 / 25.4;

/** Table of contents rows, measured on the final layout, so stage 2 can make them links. */
function findLinks(host: HTMLElement): PrintedLink[] {
	const links: PrintedLink[] = [];
	host.querySelectorAll<HTMLElement>('.pw-sheet-page').forEach((pageEl, page) => {
		const origin = pageEl.getBoundingClientRect();
		pageEl.querySelectorAll<HTMLElement>('[data-target-page]').forEach((row) => {
			const r = row.getBoundingClientRect();
			if (!r.width || !r.height) return;
			const rect = { x: (r.left - origin.left) / PX_PER_MM_CSS, y: (r.top - origin.top) / PX_PER_MM_CSS, w: r.width / PX_PER_MM_CSS, h: r.height / PX_PER_MM_CSS };
			links.push({ page, rect, targetPageId: row.dataset.targetPage! });
		});
	});
	return links;
}

/**
 * Drawn PDF embeds, measured on the final layout: the visible part of each (a note clips at its box) and
 * which part of the PDF page that is.
 */
function findEmbeds(host: HTMLElement): PrintedEmbed[] {
	const out: PrintedEmbed[] = [];
	host.querySelectorAll<HTMLElement>('.pw-sheet-page').forEach((pageEl, page) => {
		const origin = pageEl.getBoundingClientRect();
		pageEl.querySelectorAll<HTMLElement>('.pw-pdf-embed[data-pw-pdf-file]').forEach((el) => {
			const e = el.getBoundingClientRect();
			const box = el.closest('.pw-module-body')?.getBoundingClientRect();
			if (!box || !e.width || !e.height) return;
			const x0 = Math.max(e.left, box.left), y0 = Math.max(e.top, box.top);
			const x1 = Math.min(e.right, box.right), y1 = Math.min(e.bottom, box.bottom);
			if (x1 <= x0 || y1 <= y0) return;
			const mm = (px: number) => px / PX_PER_MM_CSS;
			out.push({
				page,
				rect: { x: mm(x0 - origin.left), y: mm(y0 - origin.top), w: mm(x1 - x0), h: mm(y1 - y0) },
				crop: [(x0 - e.left) / e.width, (y0 - e.top) / e.height, (x1 - e.left) / e.width, (y1 - e.top) / e.height],
				file: el.dataset.pwPdfFile!,
				pdfPage: Number(el.dataset.pwPdfPage),
			});
		});
	});
	return out;
}

/** Things that would print wrongly, reported to the user instead of silently exported. */
function findProblems(host: HTMLElement): string[] {
	const problems: string[] = [];
	host.querySelectorAll('.pw-module-placeholder').forEach((p) => problems.push((p as HTMLElement).innerText.trim()));
	if (host.querySelector('.mermaid-wrapper.is-guarded')) {
		problems.push('A Mermaid diagram was left blank: Obsidian asks once per vault before it draws diagrams. Open a note that has one in a normal tab, choose "Allow" on the diagram, then export again.');
	}
	return problems;
}

export async function printPages(pages: readonly Page[], o: PrintOptions): Promise<PrintResult> {
	const doc = activeDocument;
	const component = new Component();
	o.parent.addChild(component);
	// Renderers that follow the zoom on screen (PDF embeds in notes) draw at the export's DPI here.
	const ctx: ModuleContext = { ...o.ctx, component, flow: o.flow, resolution: () => o.dpi / 25.4, pdfEmbedsAsVector: !!o.vectorEmbeds };
	const sheet = new (doc.defaultView ?? window).CSSStyleSheet();
	const bleed = o.bleed ?? 0;
	sheet.replaceSync(pageRules(pages, bleed));
	doc.adoptedStyleSheets = [...doc.adoptedStyleSheets, sheet];
	// Obsidian's print CSS hides `body > :not(.print)`; its own PDF export uses the same class.
	const host = doc.body.createDiv({ cls: o.inkSaver ? 'pw-print-host print pw-ink-saver' : 'pw-print-host print' });
	if (o.font) {
		host.addClass('has-board-font');
		host.setCssProps({ '--pw-font': o.font });
	}
	doc.body.addClass('pw-printing');
	const renderers: ModuleRenderer[] = [];
	const notes: { el: HTMLElement; body: HTMLElement; m: NoteModule }[] = [];
	try {
		pages.forEach((page, i) => {
			const sheetEl = host.createDiv({ cls: o.appTheme ? 'pw-sheet' : 'pw-sheet pw-paper theme-light', attr: { 'data-sheet': String(i) } });
			sheetEl.setCssProps({ '--pw-w': `${page.w + 2 * bleed}mm`, '--pw-h': `${page.h + 2 * bleed}mm`, '--pw-page-bg': page.background ?? '' });
			sheetEl.toggleClass('has-background', !!page.background);
			// The page sits inside the bleed; its background and modules crossing its edge extend into it.
			const el = sheetEl.createDiv({ cls: 'pw-sheet-page' });
			el.setCssProps({ '--pw-w': `${page.w}mm`, '--pw-h': `${page.h}mm`, '--pw-bleed': `${bleed}mm` });
			renderFurniture(el, o.furniture.get(page.id), o.numberPosition);
			drawOrder(page.modules).forEach((m, rank) => {
				const mod = el.createDiv({ cls: 'pw-module' });
				mod.setCssProps({ '--pw-x': `${m.x}mm`, '--pw-y': `${m.y}mm`, '--pw-w': `${m.w}mm`, '--pw-h': `${m.h}mm`, '--pw-z': String(rank + 1) });
				applyModuleStyle(mod, m);
				const body = mod.createDiv({ cls: `pw-module-body pw-module-${m.type}` });
				const r = createRenderer(m, body, ctx, o, page.id);
				if (!r) return;
				if (m.type === 'note' && !isFlow(m, o)) notes.push({ el: mod, body, m: m as NoteModule });
				r.render(m);
				renderers.push(r);
			});
		});
		const settled = await settle(host, renderers);
		// Same overflow policy as on screen, applied to the final layout (no indicator in print).
		for (const n of notes) applyOverflow(n.el, n.body, n.m.overflow ?? 'clip', n.m.scrollY);
		const problems = findProblems(host);
		if (!settled) problems.push('Some content was still changing after 10 s and may be incomplete.');
		const links = findLinks(host);
		const embeds = o.vectorEmbeds ? findEmbeds(host) : [];
		return { bytes: await printWindowToPdf(), problems, links, embeds };
	} finally {
		renderers.forEach((r) => r.destroy());
		host.remove();
		doc.body.removeClass('pw-printing');
		doc.adoptedStyleSheets = doc.adoptedStyleSheets.filter((s) => s !== sheet);
		o.parent.removeChild(component);
	}
}
