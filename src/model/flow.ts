import { bottom, clamp, intersects, right, type Rect } from './geometry';
import type { AnyModule, PatchworkFile } from './schema';
import { contentBox, textScale } from './style';

// Linked text frames (SPEC 4 M5). Not a reflow engine (hard rule 7): markdown is cut into whole
// blocks, and each frame takes as many blocks as fit; lines are never split. Pure.

export interface Block {
	text: string;
	heading: boolean;
}

const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const HEADING = /^ {0,3}#{1,6}(\s|$)/;

/**
 * Top-level markdown blocks: runs of lines separated by blank lines, with headings on their own and
 * fenced code and $$ math kept whole (blank lines inside them don't split).
 */
export function splitBlocks(markdown: string): Block[] {
	const blocks: Block[] = [];
	let cur: string[] = [];
	const flush = () => {
		if (cur.length) blocks.push({ text: cur.join('\n'), heading: cur.length === 1 && HEADING.test(cur[0]!) });
		cur = [];
	};
	const lines = markdown.split(/\r?\n/);
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i]!;
		const fence = FENCE.exec(line)?.[1];
		const math = line.trim() === '$$';
		if (fence || math) {
			// Everything up to the closing fence is one block.
			const close = (l: string) => (fence ? l.trim().startsWith(fence[0]!.repeat(fence.length)) : l.trim() === '$$');
			const body = [line];
			while (++i < lines.length) {
				body.push(lines[i]!);
				if (close(lines[i]!)) break;
			}
			flush();
			cur = body;
			flush();
		} else if (line.trim() === '') flush();
		else if (HEADING.test(line)) {
			flush();
			cur = [line];
			flush();
		} else cur.push(line);
	}
	flush();
	return blocks;
}

/**
 * How many blocks fit, given each block's bottom edge (mm from the frame's top). At least one, so
 * a block taller than every frame still moves on (clipped). A heading isn't left last in a frame
 * when its section follows.
 */
export function fitCount(bottoms: readonly number[], height: number, blocks: readonly Pick<Block, 'heading'>[]): number {
	let n = 0;
	while (n < bottoms.length && bottoms[n]! <= height + 0.01) n++;
	while (n > 1 && n < blocks.length && blocks[n - 1]!.heading) n--;
	return Math.max(1, Math.min(n, bottoms.length));
}

export interface FlowMember {
	pageId: string;
	module: AnyModule;
}

export type FlowInfo =
	| { ok: true; chain: FlowMember[]; index: number }
	| { ok: false; reason: string };

/**
 * Chains of linked frames, keyed by module ID: a note or text module followed by the frames that
 * continue it. Only modules in a chain of two or more, and broken frames, are in the map.
 */
export function flowChains(file: Pick<PatchworkFile, 'pages'>): Map<string, FlowInfo> {
	const byId = new Map<string, FlowMember>();
	for (const page of file.pages) for (const m of page.modules) byId.set(m.id, { pageId: page.id, module: m });
	const next = new Map<string, FlowMember>();
	const out = new Map<string, FlowInfo>();
	for (const member of byId.values()) {
		const m = member.module;
		if (m.type !== 'frame') continue;
		const from = typeof m.from === 'string' ? byId.get(m.from) : undefined;
		if (!from) out.set(m.id, { ok: false, reason: 'The text this frame continues was deleted.' });
		else if (!['note', 'text', 'frame'].includes(from.module.type)) out.set(m.id, { ok: false, reason: `A frame can only continue a note or text module, not ${from.module.type}.` });
		else if (next.has(from.module.id)) out.set(m.id, { ok: false, reason: 'Another frame already continues the same text.' });
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
