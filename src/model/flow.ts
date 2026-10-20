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
