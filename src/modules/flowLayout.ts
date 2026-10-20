import { type App, Component, MarkdownRenderer } from 'obsidian';
import { type Block, chainSignature, fitCount, type FlowInfo, type FlowMember, splitBlocks } from '../model/flow';
import type { NoteModule, TextModule } from '../model/schema';
import { contentBox, textScale } from '../model/style';
import { loadNoteContent } from '../sources/markdownSource';

// Measures how a linked-frame chain's text splits across its frames (SPEC 4 M5): each block is
// rendered offscreen at the frame's width, exactly as the frame will show it, until one overflows.

export interface FlowResult {
	blocks: Block[];
	/** Per chain member: the blocks [start, end) it shows. */
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
	) {}

	async layout(chain: readonly FlowMember[]): Promise<FlowOutcome> {
		const content = await this.content(chain[0]!);
		if ('error' in content) return content;
		const font = this.font();
		const key = chainSignature(chain) + '\n' + (font ?? '') + '\n' + content.markdown;
		const head = chain[0]!.module.id;
		this.latest.set(head, key);
		let result = this.cache.get(key);
		if (!result) {
			result = this.afterQuiet(key, head, () => this.measure(splitBlocks(content.markdown), chain, content.sourcePath, font));
			this.cache.set(key, result);
			if (this.cache.size > CACHE_SIZE) this.cache.delete(this.cache.keys().next().value!);
		}
		return result;
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

	private async measure(blocks: Block[], chain: readonly FlowMember[], sourcePath: string, font: string | undefined): Promise<FlowResult> {
		const root = activeDocument.body.createDiv({ cls: 'pw-flow-measure pw-paper theme-light' });
		if (font) {
			root.addClass('has-board-font');
			root.setCssProps({ '--pw-font': font });
		}
		const component = new Component();
		component.load();
		const ranges: [number, number][] = [];
		try {
			let start = 0;
			for (const member of chain) {
				if (start >= blocks.length) {
					ranges.push([start, start]);
					continue;
				}
				const box = contentBox(member.module);
				const body = root.createDiv({ cls: 'pw-flow-measure-body' });
				body.setCssProps({ '--pw-w': `${box.w}mm`, '--pw-text-scale': String(textScale(member.module)) });
				const md = body.createDiv({ cls: 'markdown-rendered markdown-preview-view pw-markdown' });
				const top = md.getBoundingClientRect().top;
				const bottoms: number[] = [];
				for (let i = start; i < blocks.length; i++) {
					const wrap = md.createDiv({ cls: 'pw-flow-block' });
					await MarkdownRenderer.render(this.app, blocks[i]!.text, wrap, sourcePath, component);
					const bottom = (wrap.getBoundingClientRect().bottom - top) / PX_PER_MM_CSS;
					bottoms.push(bottom);
					// One block past the edge is all fitCount needs.
					if (bottom > box.h) break;
				}
				const n = fitCount(bottoms, box.h, blocks.slice(start));
				ranges.push([start, start + n]);
				start += n;
				body.remove();
			}
			return { blocks, ranges, leftover: start < blocks.length, sourcePath };
		} finally {
			component.unload();
			root.remove();
		}
	}
}
