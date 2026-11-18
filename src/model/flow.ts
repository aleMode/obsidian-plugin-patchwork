import { bottom, clamp, intersects, right, type Rect } from './geometry';
import type { AnyModule, Page, PatchworkFile } from './schema';
import { contentBox, textScale } from './style';

// Linked text frames (SPEC 4 M5). Not a reflow engine (hard rule 7): markdown is cut into blocks,
// and a block may be cut again only where its source starts a new line (paragraph lines, list items,
// table rows, quote lines). Lines that wrap on screen are never split. Pure.

export interface Block {
	text: string;
	heading: boolean;
	/** Where the block sits in the markdown it was cut from: `markdown.slice(from, to)`. */
	from: number;
	to: number;
	/** Offsets (line starts) where a frame may stop inside the block and the next one carry on. */
	cuts: number[];
	/** Repeated at the top of a continuation so it still renders as the same thing (a table's header, a callout's title). */
	prefix?: string;
}

const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const HEADING = /^ {0,3}#{1,6}(\s|$)/;
const QUOTE = /^ {0,3}>/;
const CALLOUT = /^ {0,3}>\s*\[![^\]]+\]/;
const TABLE_DELIMITER = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;
const SETEXT = /^ {0,3}(=+|-+)\s*$/;

interface Line {
	text: string;
	from: number;
}

/** Lines without their line ends, each with the offset it starts at. */
function splitLines(markdown: string): Line[] {
	const lines: Line[] = [];
	for (let at = 0; ; ) {
		const nl = markdown.indexOf('\n', at);
		lines.push({ text: markdown.slice(at, nl < 0 ? markdown.length : nl).replace(/\r$/, ''), from: at });
		if (nl < 0) return lines;
		at = nl + 1;
	}
}

const indent = (text: string) => /^[ \t]*/.exec(text)![0].replace(/\t/g, '    ').length;
const starts = (lines: readonly Line[]) => lines.map((l) => l.from);

/**
 * Where a block may be cut. Anything whose pieces wouldn't render as the same thing (code, math,
 * HTML, a table not at the top, a quote holding code) stays whole.
 */
function cutsOf(lines: readonly Line[]): Pick<Block, 'cuts' | 'prefix'> {
	const first = lines[0]!.text;
	if (lines.length < 2 || HEADING.test(first) || FENCE.test(first) || first.trim() === '$$' || first.trimStart().startsWith('<')) return { cuts: [] };
	if (first.includes('|') && TABLE_DELIMITER.test(lines[1]!.text) && lines[1]!.text.includes('-')) {
		// The first part keeps the header and at least one row.
		return { cuts: starts(lines.slice(3)), prefix: `${first}\n${lines[1]!.text}` };
	}
	if (QUOTE.test(first)) {
		if (lines.some((l) => FENCE.test(l.text.replace(/^(\s*>)+\s?/, '')))) return { cuts: [] };
		// Lines without `>` continue the quote lazily; cut before one and it would leave the quote.
		const quoted = (from: number) => starts(lines.slice(from).filter((l) => QUOTE.test(l.text)));
		return CALLOUT.test(first) ? { cuts: quoted(2), prefix: first } : { cuts: quoted(1) };
	}
	if (lines.some((l) => TABLE_DELIMITER.test(l.text) && l.text.includes('|'))) return { cuts: [] };
	// Paragraphs and lists: before any line not indented past the first (nested items and an item's
	// own lines stay with it), and not before a setext underline, which belongs to the line above.
	const base = indent(first);
	return { cuts: starts(lines.slice(1).filter((l) => indent(l.text) <= base && !SETEXT.test(l.text))) };
}

/**
 * Top-level markdown blocks: runs of lines separated by blank lines, with headings on their own and
 * fenced code and $$ math kept whole (blank lines inside them don't split).
 */
export function splitBlocks(markdown: string): Block[] {
	const blocks: Block[] = [];
	let cur: Line[] = [];
	const flush = () => {
		if (cur.length) {
			const last = cur[cur.length - 1]!;
			blocks.push({ text: cur.map((l) => l.text).join('\n'), heading: cur.length === 1 && HEADING.test(cur[0]!.text), from: cur[0]!.from, to: last.from + last.text.length, ...cutsOf(cur) });
		}
		cur = [];
	};
	const lines = splitLines(markdown);
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i]!;
		const fence = FENCE.exec(line.text)?.[1];
		const math = line.text.trim() === '$$';
		if (fence || math) {
			// Everything up to the closing fence is one block.
			const close = (l: string) => (fence ? l.trim().startsWith(fence[0]!.repeat(fence.length)) : l.trim() === '$$');
			const body = [line];
			while (++i < lines.length) {
				body.push(lines[i]!);
				if (close(lines[i]!.text)) break;
			}
			flush();
			cur = body;
			flush();
		} else if (line.text.trim() === '') flush();
		else if (HEADING.test(line.text)) {
			flush();
			cur = [line];
			flush();
		} else cur.push(line);
	}
	flush();
	return blocks;
}

/** Where a frame starts: a block, at its start or at one of its cuts. */
export interface FlowCursor {
	block: number;
	at: number;
}

/** The end of the line before line start `cut` (its line end not included). */
function lineEnd(markdown: string, cut: number): number {
	return markdown[cut - 2] === '\r' ? cut - 2 : cut - 1;
}

/** Markdown for the stretch [from, to) of a block, with its prefix when it starts mid-way. */
function textOf(markdown: string, block: Block, from: number, to: number): string {
	const body = markdown.slice(from, to).replace(/\r\n/g, '\n');
	return from > block.from && block.prefix ? `${block.prefix}\n${body}` : body;
}

/** The markdown a frame showing [from, to) renders, one string per block it touches. */
export function segments(markdown: string, blocks: readonly Block[], range: readonly [number, number]): string[] {
	const [from, to] = range;
	return blocks.filter((b) => b.to > from && b.from < to).map((b) => textOf(markdown, b, Math.max(from, b.from), Math.min(to, b.to)));
}

/**
 * Put an edited part back into the markdown it was cut from. Text typed into a frame that showed
 * nothing becomes a block of its own after the existing text, so it never runs into the last paragraph.
 */
export function splicePart(source: string, part: { from: number; to: number }, value: string): string {
	if (part.from < part.to) return source.slice(0, part.from) + value + source.slice(part.to);
	if (!value.trim()) return source;
	const before = source.slice(0, part.from).trimEnd();
	return (before ? `${before}\n\n` : '') + value + source.slice(part.to);
}

/** Renders text the way a frame will and reports its bottom edge, in mm from the frame's top. */
export interface FlowMeasurer {
	/** Add a block below the ones already there. */
	push(text: string): Promise<number>;
	/** Render the last block again with other text. */
	replaceLast(text: string): Promise<number>;
}

/** What a frame shows: up to `to`, with the next frame starting at `next`. */
export interface FrameFit {
	to: number;
	next: FlowCursor;
}

/**
 * Fill one frame of `height` mm from `start`: whole blocks while they fit, then as much of the next
 * block as fits, cut at a line start. The first thing in a frame is taken even when too tall (clipped),
 * so the text always moves on. A heading isn't left last in a frame when none of its section fits.
 */
export async function fitFrame(markdown: string, blocks: readonly Block[], start: FlowCursor, height: number, measure: FlowMeasurer): Promise<FrameFit> {
	const fits = (bottom: number) => bottom <= height + 0.01;
	const cursor = (block: number): FlowCursor => ({ block, at: blocks[block]?.from ?? markdown.length });
	let to = start.at;
	for (let i = start.block, at = start.at, taken = 0; i < blocks.length; i++, at = blocks[i]?.from ?? 0, taken++) {
		const b = blocks[i]!;
		if (fits(await measure.push(textOf(markdown, b, at, b.to)))) {
			to = b.to;
			continue;
		}
		// The most pieces that fit; each piece ends just before the cut that starts the next one.
		const cuts = b.cuts.filter((c) => c > at);
		let lo = 0, hi = cuts.length;
		while (lo < hi) {
			const mid = Math.ceil((lo + hi) / 2);
			if (fits(await measure.replaceLast(textOf(markdown, b, at, lineEnd(markdown, cuts[mid - 1]!))))) lo = mid;
			else hi = mid - 1;
		}
		if (lo > 0) return { to: lineEnd(markdown, cuts[lo - 1]!), next: { block: i, at: cuts[lo - 1]! } };
		if (taken === 0) return cuts.length ? { to: lineEnd(markdown, cuts[0]!), next: { block: i, at: cuts[0]! } } : { to: b.to, next: cursor(i + 1) };
		if (taken > 1 && blocks[i - 1]!.heading) return { to: blocks[i - 2]!.to, next: cursor(i - 1) };
		return { to, next: cursor(i) };
	}
	return { to, next: cursor(blocks.length) };
}

export interface FlowMember {
	pageId: string;
	module: AnyModule;
}

export type FlowInfo =
	| { ok: true; chain: FlowMember[]; index: number }
	/** `conflict`: another frame continues the same text, so this one can be attached to the chain's end instead. */
	| { ok: false; reason: string; conflict?: true };

/**
 * Chains of linked frames, keyed by module ID: a note or text module followed by the frames that
 * continue it. Only modules in a chain of two or more, and broken frames, are in the map.
 */
export function flowChains(file: Pick<PatchworkFile, 'pages'>): Map<string, FlowInfo> {
	const byId = new Map<string, FlowMember>();
	for (const page of file.pages) for (const m of page.modules) byId.set(m.id, { pageId: page.id, module: m });
	const next = new Map<string, FlowMember>();
	const out = new Map<string, FlowInfo>();
	// In ID order, not file order: when two frames continue the same text, the same one keeps it
	// wherever either is moved (moving to another page changes file order).
	const frames = [...byId.values()].filter((f) => f.module.type === 'frame').sort((a, b) => (a.module.id < b.module.id ? -1 : a.module.id > b.module.id ? 1 : 0));
	for (const member of frames) {
		const m = member.module;
		const from = typeof m.from === 'string' ? byId.get(m.from) : undefined;
		if (!from) out.set(m.id, { ok: false, reason: 'The text this frame continues was deleted.' });
		else if (!['note', 'text', 'frame'].includes(from.module.type)) out.set(m.id, { ok: false, reason: `A frame can only continue a note or text module, not ${from.module.type}.` });
		else if (next.has(from.module.id)) out.set(m.id, { ok: false, reason: 'Another frame already continues the same text.', conflict: true });
		else next.set(from.module.id, member);
	}
	for (const member of byId.values()) {
		const m = member.module;
		if ((m.type !== 'note' && m.type !== 'text') || !next.has(m.id)) continue;
		const chain = [member];
		const seen = new Set([m.id]);
		for (let f = next.get(m.id); f && !seen.has(f.module.id); f = next.get(f.module.id)) {
			seen.add(f.module.id);
			chain.push(f);
		}
		chain.forEach((c, index) => out.set(c.module.id, { ok: true, chain, index }));
	}
	// Frames left over are in a loop or hang off a broken frame.
	for (const member of byId.values()) {
		if (member.module.type === 'frame' && !out.has(member.module.id)) out.set(member.module.id, { ok: false, reason: 'This frame isn’t linked to any text.' });
	}
	return out;
}

// Pages using a master show its modules but not its chains' state, so a chain on a master would
// restart on every page (review B8). Masters are for page furniture: frames are kept off them.
export const NO_FRAMES_ON_MASTERS = 'Linked frames don’t work on master pages. Put them on the pages themselves.';

/** Whether a module is part of a chain of linked frames (or is a frame at all, even a broken one). */
export function isLinked(chains: ReadonlyMap<string, FlowInfo>, m: Pick<AnyModule, 'id' | 'type'>): boolean {
	return m.type === 'frame' || chains.has(m.id);
}

/** A page's modules that are part of a chain; a page with any can't become a master. */
export function linkedModules(file: Pick<PatchworkFile, 'pages'>, page: Page): AnyModule[] {
	const chains = flowChains(file);
	return page.modules.filter((m) => isLinked(chains, m));
}

/** Everything that changes how a chain's text is cut up: the head's content and every frame's box. */
export function chainSignature(chain: readonly FlowMember[]): string {
	const [head, ...frames] = chain;
	const h = head!.module;
	const content = [h.type, h.file, h.subpath, h.lines, h.includeHeading, h.markdown, h.frozen];
	const box = (m: AnyModule) => {
		const c = contentBox(m);
		return [c.w, c.h, textScale(m)];
	};
	return JSON.stringify([content, box(h), ...frames.map((f) => box(f.module))]);
}

/** Smallest frame worth placing; below this the text would hardly fit a line. */
const MIN_FRAME_MM = 20;
const FRAME_GAP_MM = 5;

/**
 * Where a frame continuing `source` goes on the same page: beside or under it in free space, the same
 * size when it fits, else shrunk to the space left. With no room anywhere the frame sits just offset
 * from the source (overlapping, but findable), because it must stay on this page.
 */
export function placeNextFrame(source: Rect, others: readonly Rect[], page: { w: number; h: number }): Rect {
	const gap = FRAME_GAP_MM;
	const { w, h } = { w: Math.min(source.w, page.w), h: Math.min(source.h, page.h) };
	const free = (r: Rect) => r.x >= 0 && r.y >= 0 && right(r) <= page.w && bottom(r) <= page.h && !others.some((o) => intersects(r, o));
	const sameSize: Rect[] = [
		{ x: source.x, y: bottom(source) + gap, w, h },
		{ x: right(source) + gap, y: source.y, w, h },
		{ x: source.x - gap - w, y: source.y, w, h },
		{ x: source.x, y: source.y - gap - h, w, h },
	];
	const fit = sameSize.find(free);
	if (fit) return fit;
	// Shrunk to what is left under or beside the source (the page edge is the limit; others still must not overlap).
	const shrunk: Rect[] = [
		{ x: source.x, y: bottom(source) + gap, w, h: page.h - bottom(source) - gap },
		{ x: right(source) + gap, y: source.y, w: page.w - right(source) - gap, h },
	];
	const small = shrunk.find((r) => r.w >= MIN_FRAME_MM && r.h >= MIN_FRAME_MM && free(r));
	if (small) return small;
	const x = clamp(source.x + 2 * gap, 0, page.w - w);
	const y = clamp(source.y + 2 * gap, 0, page.h - h);
	return { x, y, w, h };
}
