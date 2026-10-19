import { Component, MarkdownRenderer, TFile } from 'obsidian';
import { sleep, Spike, SpikeContext } from './context';

const FILES = [
	'Rules/Combat.md',
	'Spells/Spell list.md',
	'Spells/Spell index.md',
	'Monsters/Goblin.md',
	'Embeds/Cycle A.md',
	'Embeds/Deep 1.md',
];

/** Text that only appears if a given embed was actually expanded. */
const EMBED_PROBES: Record<string, string> = {
	'note embed (Fireball)': '8d6 fire damage',
	'section embed (Combat#Prone)': 'You can only crawl',
	'section embed leaks next section': 'Your speed becomes 0',
	'block embed (^opportunity)': 'leaves your reach',
	'cycle B content': 'Note B embeds note A',
	'deep 2': 'Deep 2',
	'deep 3': 'Deep 3',
	'deep 4 (beyond limit 3)': 'The bottom of the chain',
	'dataview table row': 'evocation',
};

/** Wait until the subtree stops mutating for `quietMs`, or `timeoutMs` passes. */
async function settle(el: HTMLElement, quietMs = 400, timeoutMs = 8000) {
	const start = performance.now();
	let last = performance.now();
	const mo = new MutationObserver(() => (last = performance.now()));
	mo.observe(el, { subtree: true, childList: true, attributes: true, characterData: true });
	while (performance.now() - last < quietMs && performance.now() - start < timeoutMs) await sleep(50);
	mo.disconnect();
	return Math.round(performance.now() - start);
}

function features(el: HTMLElement) {
	const q = (s: string) => el.querySelectorAll(s).length;
	const text = el.innerText;
	return {
		textLength: text.length,
		internalEmbeds: q('.internal-embed'),
		loadedEmbeds: q('.internal-embed.is-loaded'),
		markdownEmbedsWithContent: Array.from(el.querySelectorAll('.markdown-embed-content')).filter((n) => n.textContent!.trim().length > 0).length,
		images: q('img'),
		imagesLoaded: Array.from(el.querySelectorAll('img')).filter((i) => (i as HTMLImageElement).naturalWidth > 0).length,
		pdfEmbeds: q('.pdf-embed, .internal-embed[src$=".pdf"], iframe, .pdf-container'),
		callouts: q('.callout'),
		codeBlocks: q('pre > code'),
		highlightedTokens: q('pre code .token, pre code span[class]'),
		mermaidSvg: q('.mermaid svg'),
		math: q('mjx-container, .math'),
		tables: q('table'),
		dataview: q('.dataview, .block-language-dataview'),
		probes: Object.fromEntries(Object.entries(EMBED_PROBES).filter(([, p]) => text.includes(p)).map(([k]) => [k, true])),
	};
}

async function renderOne(ctx: SpikeContext, path: string, attached: boolean, component: Component) {
	const file = ctx.app.vault.getAbstractFileByPath(path) as TFile | null;
	if (!file) return { error: 'missing file' };
	const el = createDiv({ cls: 'markdown-rendered' });
	el.style.cssText = 'position:fixed;left:-20000px;top:0;width:700px';
	if (attached) document.body.appendChild(el);
	const t0 = performance.now();
	await MarkdownRenderer.render(ctx.app, await ctx.app.vault.cachedRead(file), el, file.path, component);
	const renderMs = Math.round(performance.now() - t0);
	const settleMs = attached ? await settle(el) : (await sleep(2000), 2000);
	const f = features(el);
	return { el, report: { renderMs, settleMs, ...f } };
}

/** S2: what does MarkdownRenderer.render handle (embeds, images, callouts, code, Dataview...)? */
export const s2Markdown: Spike = async (ctx, opts) => {
	const component = new Component();
	component.load();
	const out: Record<string, unknown> = {};
	const keep: HTMLElement[] = [];
	try {
		for (const path of FILES) {
			const attached = await renderOne(ctx, path, true, component);
			const detached = await renderOne(ctx, path, false, component);
			out[path] = { attached: attached.report ?? attached, detached: detached.report ?? detached };
			if (attached.el) keep.push(attached.el);
			detached.el?.remove();
		}
		// Section metadata available for markdownSource slicing.
		const combat = ctx.app.vault.getAbstractFileByPath('Rules/Combat.md') as TFile;
		const cache = ctx.app.metadataCache.getFileCache(combat);
		out.metadataCache = {
			headings: cache?.headings?.map((h) => `${'#'.repeat(h.level)} ${h.heading} @${h.position.start.line}`),
			blocks: cache?.blocks ? Object.fromEntries(Object.entries(cache.blocks).map(([k, b]) => [k, `${b.position.start.line}-${b.position.end.line}`])) : null,
			sections: cache?.sections?.map((s) => `${s.type}@${s.position.start.line}-${s.position.end.line}`),
			frontmatterEnd: cache?.frontmatterPosition?.end.line ?? null,
		};
		out.plugins = Object.keys((ctx.app as unknown as { plugins: { plugins: object } }).plugins.plugins);
	} finally {
		// Leave the Spell list render on screen for a screenshot when asked.
		if (opts?.show) {
			const el = keep[1]!;
			el.style.cssText = 'position:fixed;left:20px;top:20px;width:700px;max-height:95vh;overflow:auto;z-index:9999;background:var(--background-primary);padding:12px;border:2px solid red';
			el.id = 'pw-spike-show';
			keep.splice(1, 1);
		}
		keep.forEach((e) => e.remove());
		if (!opts?.show) component.unload();
	}
	return out;
};
