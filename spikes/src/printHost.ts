import { SpikeContext, sleep } from './context';

// Shared by S1 and S5: build an offscreen host of fixed-size sheets in the main window and print it.

export interface Sheet {
	wMm: number;
	hMm: number;
	build?: (el: HTMLElement) => void | Promise<void>;
}

export interface PrintOptions {
	/** Use CSS named pages so each sheet can have its own size (S5). */
	named?: boolean;
	preferCSSPageSize?: boolean;
	/** Electron pageSize in inches, used when preferCSSPageSize is false. */
	pageSizeIn?: { width: number; height: number };
	generateDocumentOutline?: boolean;
	settleMs?: number;
	noPrintClass?: boolean;
	noPaperScope?: boolean;
}

/**
 * Light "paper" scope inside a dark app. Obsidian declares ~900 derived variables on `body`
 * (e.g. --background-primary: var(--color-base-00)), which resolve once at body, so a nested
 * `.theme-light` alone changes nothing. Re-declaring them on `.pw-paper` makes them resolve
 * against the light base colours of the subtree.
 */
export function installPaperScope(): HTMLStyleElement {
	const decls: string[] = [];
	for (const sheet of Array.from(document.styleSheets)) {
		let rules: CSSRuleList;
		try {
			rules = sheet.cssRules;
		} catch {
			continue;
		}
		for (const r of Array.from(rules)) {
			if (!(r instanceof CSSStyleRule) || r.selectorText !== 'body') continue;
			for (const prop of Array.from(r.style)) {
				if (prop.startsWith('--')) decls.push(`${prop}: ${r.style.getPropertyValue(prop)};`);
			}
		}
	}
	const style = document.head.createEl('style', { attr: { id: 'pw-paper-scope' } });
	style.textContent = `.pw-paper { ${decls.join(' ')} color: var(--text-normal); background-color: var(--background-primary); }`;
	return style;
}

const STYLE_ID = 'pw-spike-print-style';

function css(sheets: Sheet[], named: boolean): string {
	const first = sheets[0]!;
	const pageRules = named
		? sheets.map((s, i) => `@page pw-s${i} { size: ${s.wMm}mm ${s.hMm}mm; margin: 0; }\n.pw-sheet[data-i="${i}"] { page: pw-s${i}; }`).join('\n')
		: `@page { size: ${first.wMm}mm ${first.hMm}mm; margin: 0; }`;
	return `
.pw-print-host { position: fixed; left: -200000px; top: 0; }
.pw-sheet { position: relative; overflow: hidden; box-sizing: border-box; background: #fff; color: #000; break-after: page; }
.pw-sheet:last-child { break-after: auto; }
@media print {
  html, body { position: static !important; height: auto !important; overflow: visible !important; background: #fff !important; }
  body { display: block !important; }
  body > :not(.pw-print-host) { display: none !important; }
  .pw-print-host { position: static !important; }
}
${pageRules}
`;
}

export async function printSheets(ctx: SpikeContext, sheets: Sheet[], opts: PrintOptions = {}) {
	const style = document.createElement('style');
	style.id = STYLE_ID;
	style.textContent = css(sheets, !!opts.named);
	document.head.appendChild(style);

	// Obsidian's own print CSS hides `body > :not(.print)`; its PDF export uses the same class.
	const host = document.body.createDiv({ cls: opts.noPrintClass ? 'pw-print-host' : 'pw-print-host print' });
	const paperStyle = opts.noPaperScope ? null : installPaperScope();
	try {
		for (const [i, s] of sheets.entries()) {
			const el = host.createDiv({ cls: opts.noPaperScope ? 'pw-sheet' : 'pw-sheet pw-paper theme-light', attr: { 'data-i': String(i) } });
			el.style.width = `${s.wMm}mm`;
			el.style.height = `${s.hMm}mm`;
			await s.build?.(el);
		}
		await document.fonts.ready;
		await sleep(opts.settleMs ?? 500);

		// eslint-disable-next-line @typescript-eslint/no-var-requires
		const remote = require('@electron/remote');
		const wc = remote.getCurrentWebContents();
		const t0 = performance.now();
		const preferCSS = opts.preferCSSPageSize ?? true;
		const buf: Uint8Array = await wc.printToPDF({
			printBackground: true,
			preferCSSPageSize: preferCSS,
			...(preferCSS ? {} : { pageSize: opts.pageSizeIn }),
			margins: { top: 0, bottom: 0, left: 0, right: 0 },
			generateDocumentOutline: opts.generateDocumentOutline ?? false,
			generateTaggedPDF: false,
		});
		ctx.log(`printToPDF ${sheets.length} sheet(s) in ${Math.round(performance.now() - t0)} ms, ${buf.length} bytes`);
		return new Uint8Array(buf);
	} finally {
		host.remove();
		style.remove();
		paperStyle?.remove();
	}
}
