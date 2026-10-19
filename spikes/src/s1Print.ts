import { Component, MarkdownRenderer, TFile } from 'obsidian';
import { inspectPdf, sleep, Spike, SpikeContext } from './context';
import { installPaperScope, printSheets, Sheet } from './printHost';

const PROBE = 'PATCHWORK-VECTOR-TEXT-PROBE';

/** S1: can a plugin print an offscreen host to a vector PDF at custom sizes? */
export const s1Print: Spike = async (ctx) => {
	const results: Record<string, unknown> = {};
	const run = async (name: string, sheets: Sheet[], opts = {}) => {
		try {
			const bytes = await printSheets(ctx, sheets, opts);
			ctx.save(`s1-${name}.pdf`, bytes);
			results[name] = await inspectPdf(ctx, bytes, { pngPrefix: `s1-${name}`, pngScale: name.startsWith('huge') ? 0.05 : 0.5 });
		} catch (e) {
			results[name] = { error: String(e) };
		}
	};

	const component = new Component();
	component.load();
	try {
		await run('a4-mixed', [{ wMm: 210, hMm: 297, build: (el) => buildA4(ctx, el, component) }], { generateDocumentOutline: true, settleMs: 1500 });
		await run('custom-1000x700', [{ wMm: 1000, hMm: 700, build: corners }]);
		await run('huge-5080x300', [{ wMm: 5080, hMm: 300, build: corners }]);
		await run('over-limit-6000x300', [{ wMm: 6000, hMm: 300, build: corners }]);
		await run('pagesize-option-1000x700', [{ wMm: 1000, hMm: 700, build: corners }], {
			preferCSSPageSize: false,
			pageSizeIn: { width: 1000 / 25.4, height: 700 / 25.4 },
		});
		await run('a4-without-print-class', [{ wMm: 210, hMm: 297, build: corners }], { noPrintClass: true });
		results.lightScope = await lightScopeCheck(ctx, component);
	} finally {
		component.unload();
	}
	return results;
};

async function buildA4(ctx: SpikeContext, el: HTMLElement, component: Component) {
	el.style.padding = '15mm';
	el.createEl('h1', { text: 'S1 print test' });
	el.createEl('p', { text: `${PROBE} plain DOM paragraph in 11pt.` }).style.fontSize = '11pt';

	const md = el.createDiv({ cls: 'markdown-rendered' });
	const file = ctx.app.vault.getAbstractFileByPath('Spells/Spell list.md') as TFile;
	await MarkdownRenderer.render(ctx.app, await ctx.app.vault.cachedRead(file), md, file.path, component);

	// A raster element, like a PDF module would produce.
	const canvas = el.createEl('canvas');
	canvas.width = 400;
	canvas.height = 100;
	canvas.style.width = '80mm';
	canvas.style.height = '20mm';
	const c = canvas.getContext('2d')!;
	c.fillStyle = '#c33';
	c.fillRect(0, 0, 400, 100);
	c.fillStyle = '#fff';
	c.font = '40px sans-serif';
	c.fillText('raster canvas', 20, 65);

	const img = el.createEl('img');
	img.src = ctx.app.vault.getResourcePath(ctx.app.vault.getAbstractFileByPath('Images/Map.png') as TFile);
	img.style.width = '60mm';
	await img.decode().catch(() => ctx.log('image decode failed'));
}

function corners(el: HTMLElement) {
	const mk = (text: string, css: Partial<CSSStyleDeclaration>) => {
		const d = el.createDiv({ text });
		Object.assign(d.style, { position: 'absolute', fontSize: '24pt', ...css });
	};
	el.style.border = '2mm solid #36c';
	mk('TOP-LEFT', { left: '10mm', top: '10mm' });
	mk('BOTTOM-RIGHT', { right: '10mm', bottom: '10mm' });
	mk(PROBE, { left: '45%', top: '45%' });
}

/** Does adding `.theme-light` to a subtree inside a dark-mode app give dark-on-light text? */
async function lightScopeCheck(ctx: SpikeContext, component: Component) {
	const scope = installPaperScope();
	const wrap = document.body.createDiv();
	wrap.style.cssText = 'position:fixed;left:-20000px;top:0;width:600px';
	const sample = async (cls: string) => {
		const el = wrap.createDiv({ cls: `markdown-rendered ${cls}` });
		await MarkdownRenderer.render(ctx.app, '# H\n\nText [[Fireball]]\n\n> [!tip] Callout\n> body\n\n`code`', el, '', component);
		await sleep(200);
		const cs = (sel: string) => {
			const n = el.querySelector(sel);
			return n ? getComputedStyle(n).color : null;
		};
		return {
			p: cs('p'),
			h1: cs('h1'),
			link: cs('a'),
			code: cs('code'),
			calloutBg: el.querySelector('.callout') ? getComputedStyle(el.querySelector('.callout')!).backgroundColor : null,
			bgVar: getComputedStyle(el).getPropertyValue('--background-primary').trim(),
		};
	};
	try {
		return {
			bodyClass: document.body.hasClass('theme-dark') ? 'theme-dark' : 'theme-light',
			inherited: await sample(''),
			themeLightOnly: await sample('theme-light'),
			paperScope: await sample('pw-paper theme-light'),
		};
	} finally {
		wrap.remove();
		scope.remove();
	}
}
