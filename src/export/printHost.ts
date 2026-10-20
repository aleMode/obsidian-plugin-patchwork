import { Component } from 'obsidian';
import { drawOrder } from '../model/exportPlan';
import type { PageFurniture } from '../model/numbering';
import type { NumberPosition } from '../model/schema';
import { renderFurniture } from '../view/furniture';
import { type AnyModule, isKnownModule, type NoteModule, type Page } from '../model/schema';
import { ImageModuleRenderer } from '../modules/imageModule';
import { NoteModuleRenderer, TextModuleRenderer } from '../modules/noteModule';
import { applyOverflow } from '../modules/overflow';
import { PdfModuleRenderer } from '../modules/pdfModule';
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
}

export interface PrintResult {
	bytes: Uint8Array;
	problems: string[];
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

function createRenderer(m: AnyModule, body: HTMLElement, ctx: ModuleContext, o: PrintOptions): ModuleRenderer | null {
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
	}
}

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

/** Things that would print wrongly, reported to the user instead of silently exported. */
function findProblems(host: HTMLElement): string[] {
	const problems: string[] = [];
	host.querySelectorAll('.pw-module-placeholder').forEach((p) => problems.push((p as HTMLElement).innerText.trim()));
	if (host.querySelector('.mermaid-wrapper.is-guarded')) {
		problems.push('Mermaid diagrams are not allowed in this vault yet; open a note with a diagram and choose "Allow" first.');
	}
	return problems;
}

export async function printPages(pages: readonly Page[], o: PrintOptions): Promise<PrintResult> {
	const doc = activeDocument;
	const component = new Component();
	o.parent.addChild(component);
	const ctx: ModuleContext = { ...o.ctx, component };
	const sheet = new (doc.defaultView ?? window).CSSStyleSheet();
	const bleed = o.bleed ?? 0;
	sheet.replaceSync(pageRules(pages, bleed));
	doc.adoptedStyleSheets = [...doc.adoptedStyleSheets, sheet];
	// Obsidian's print CSS hides `body > :not(.print)`; its own PDF export uses the same class.
	const host = doc.body.createDiv({ cls: o.inkSaver ? 'pw-print-host print pw-ink-saver' : 'pw-print-host print' });
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
				const r = createRenderer(m, body, ctx, o);
				if (!r) return;
				if (m.type === 'note') notes.push({ el: mod, body, m: m as NoteModule });
				r.render(m);
				renderers.push(r);
			});
		});
		const settled = await settle(host, renderers);
		// Same overflow policy as on screen, applied to the final layout (no indicator in print).
		for (const n of notes) applyOverflow(n.el, n.body, n.m.overflow ?? 'clip');
		const problems = findProblems(host);
		if (!settled) problems.push('Some content was still changing after 10 s and may be incomplete.');
		return { bytes: await printWindowToPdf(), problems };
	} finally {
		renderers.forEach((r) => r.destroy());
		host.remove();
		doc.body.removeClass('pw-printing');
		doc.adoptedStyleSheets = doc.adoptedStyleSheets.filter((s) => s !== sheet);
		o.parent.removeChild(component);
	}
}
