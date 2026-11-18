import { type App, Component, MarkdownRenderer } from 'obsidian';
import { type Block, chainSignature, type FlowCursor, type FlowInfo, type FlowMeasurer, type FlowMember, fitFrame, splitBlocks } from '../model/flow';
import type { NoteModule, TextModule } from '../model/schema';
import { contentBox, textScale } from '../model/style';
import { loadNoteContent } from '../sources/markdownSource';
import type { PdfDocCache } from '../sources/pdfSource';
import { extractPdfEmbeds } from '../model/pdfEmbeds';
import { renderPdfEmbeds } from './pdfEmbed';

// Measures how a linked-frame chain's text splits across its frames (SPEC 4 M5): each block is
// rendered offscreen at the frame's width, exactly as the frame will show it, until one overflows;
// that one is then cut at the last line start that fits (model/flow fitFrame).

export interface FlowResult {
	/** The head's markdown that `blocks` were cut from. */
	markdown: string;
	blocks: Block[];
	/** Per chain member: the stretch [from, to) of `markdown` it shows (see model/flow segments). */
	ranges: [number, number][];
	/** Text left over after the last frame. */
	leftover: boolean;
	sourcePath: string;
}

export type FlowOutcome = FlowResult | { error: string };

/** What renderers need for linked frames: chain membership and the shared layout. */
export interface FlowContext {
	info(moduleId: string): FlowInfo | undefined;
	layout: FlowLayout;
}

const PX_PER_MM_CSS = 96 / 25.4;
/** Layouts kept; a board rarely has more chains than this on screen. */
const CACHE_SIZE = 32;
/**
 * Wait this long before measuring a changed chain: resizing a frame changes it on every pointer
 * move, and each measurement renders the whole text offscreen (hard rule 9).
 */
const QUIET_MS = 120;

export class FlowLayout {
	private cache = new Map<string, Promise<FlowOutcome>>();
	/** The newest layout key asked for, per chain head. */
	private latest = new Map<string, string>();

	constructor(
		private app: App,
		private boardPath: () => string,
		/** Board font, which changes how much text fits. */
		private font: () => string | undefined = () => undefined,
		/** For PDF embeds in the text, measured at the page's real shape. */
		private pdfDocs?: PdfDocCache,
		/** Pages in the app theme aren't paper: text is measured in the same theme it shows in. */
		private appTheme: () => boolean = () => false,
	) {}

	async layout(chain: readonly FlowMember[]): Promise<FlowOutcome> {
		const content = await this.content(chain[0]!);
		if ('error' in content) return content;
		const font = this.font();
		const appTheme = this.appTheme();
		const key = chainSignature(chain) + '\n' + (font ?? '') + '\n' + String(appTheme) + '\n' + content.markdown;
		const head = chain[0]!.module.id;
		this.latest.set(head, key);
		let result = this.cache.get(key);
		if (!result) {
			result = this.afterQuiet(key, head, () => this.measure(content.markdown, chain, content.sourcePath, font, appTheme));
			this.cache.set(key, result);
			if (this.cache.size > CACHE_SIZE) this.cache.delete(this.cache.keys().next().value!);
		}
		return result;
	}

	/** Forget every layout: the theme, a snippet or the app's text font changed how text wraps, and none of that is in the keys. */
	clear() {
		this.cache.clear();
	}

	/** The stretch of the head's markdown that chain member `index` shows, for editing just that frame's text; null when the chain can't be laid out. */
	async part(chain: readonly FlowMember[], index: number): Promise<{ from: number; to: number; source: string } | null> {
		const r = await this.layout(chain);
		if ('error' in r) return null;
		const [from, to] = r.ranges[index]!;
		return { from, to, source: r.markdown };
	}

	/** Measure unless a newer layout of the same chain was asked for meanwhile; then that one answers. */
	private async afterQuiet(key: string, head: string, measure: () => Promise<FlowOutcome>): Promise<FlowOutcome> {
		await new Promise((r) => window.setTimeout(r, QUIET_MS));
		const newest = this.latest.get(head);
		if (newest === key) return measure();
		this.cache.delete(key);
		return (newest && this.cache.get(newest)) || measure();
	}

	private async content(head: FlowMember): Promise<{ markdown: string; sourcePath: string } | { error: string }> {
		const m = head.module;
		if (m.type === 'text') return { markdown: (m as TextModule).markdown, sourcePath: this.boardPath() };
		const note = m as NoteModule;
		if (note.frozen) return { markdown: note.frozen.markdown, sourcePath: note.file };
		const c = await loadNoteContent(this.app, note);
		return c.ok ? { markdown: c.markdown, sourcePath: c.file.path } : { error: c.reason };
	}

	private async measure(markdown: string, chain: readonly FlowMember[], sourcePath: string, font: string | undefined, appTheme: boolean): Promise<FlowResult> {
		const blocks = splitBlocks(markdown);
		// The frames' own scope: paper is the light theme re-declared (view/paperScope), the app theme is body's.
		const root = activeDocument.body.createDiv({ cls: appTheme ? 'pw-flow-measure' : 'pw-flow-measure pw-paper theme-light' });
		if (font) {
			root.addClass('has-board-font');
			root.setCssProps({ '--pw-font': font });
		}
		const component = new Component();
		component.load();
		const ranges: [number, number][] = [];
		try {
			let cur: FlowCursor = { block: 0, at: blocks[0]?.from ?? markdown.length };
			for (const member of chain) {
				if (cur.block >= blocks.length) {
					ranges.push([markdown.length, markdown.length]);
					continue;
				}
				const box = contentBox(member.module);
				const body = root.createDiv({ cls: 'pw-flow-measure-body' });
				const family = member.module.style?.fontFamily;
				body.toggleClass('has-font-family', !!family);
				body.setCssProps({ '--pw-w': `${box.w}mm`, '--pw-text-scale': String(textScale(member.module)), '--pw-font-family': family ?? '' });
				const md = body.createDiv({ cls: 'markdown-rendered markdown-preview-view pw-markdown' });
				const fit = await fitFrame(markdown, blocks, cur, box.h, this.measurer(md, sourcePath, component));
				ranges.push([cur.at, fit.to]);
				cur = fit.next;
				body.remove();
			}
			return { markdown, blocks, ranges, leftover: cur.block < blocks.length, sourcePath };
		} finally {
			component.unload();
			root.remove();
		}
	}

	/** Renders blocks into `md` as a frame would, one wrapper each, and reports their bottom edge in mm. */
	private measurer(md: HTMLElement, sourcePath: string, component: Component): FlowMeasurer {
		const top = md.getBoundingClientRect().top;
		let last: HTMLElement | null = null;
		const render = async (wrap: HTMLElement, text: string) => {
			// Same markup the frame will show: PDF embeds as Patchwork's own boxes, sized to their page.
			const { markdown, embeds } = extractPdfEmbeds(text);
			await MarkdownRenderer.render(this.app, markdown, wrap, sourcePath, component);
			if (embeds.length && this.pdfDocs) await renderPdfEmbeds(wrap, embeds, { app: this.app, pdfDocs: this.pdfDocs, sizeOnly: true }, sourcePath, () => true);
			return (wrap.getBoundingClientRect().bottom - top) / PX_PER_MM_CSS;
		};
		return {
			push: (text) => render((last = md.createDiv({ cls: 'pw-flow-block' })), text),
			replaceLast: (text) => {
				last ??= md.createDiv({ cls: 'pw-flow-block' });
				last.empty();
				return render(last, text);
			},
		};
	}
}
