import { describe, expect, it } from 'vitest';
import { type Block, chainSignature, type FlowCursor, type FlowMeasurer, fitFrame, flowChains, linkedModules, placeNextFrame, segments, splicePart, splitBlocks } from '../../src/model/flow';
import type { AnyModule } from '../../src/model/schema';

describe('splitBlocks', () => {
	it('splits on blank lines and puts headings on their own', () => {
		const b = splitBlocks('# Title\nIntro line one\nline two\n\n- a\n- b\n\n> [!note]\n> callout\n>\n> more');
		expect(b.map((x) => x.text)).toEqual(['# Title', 'Intro line one\nline two', '- a\n- b', '> [!note]\n> callout\n>\n> more']);
		expect(b.map((x) => x.heading)).toEqual([true, false, false, false]);
	});

	it('keeps fenced code and math whole across blank lines', () => {
		const b = splitBlocks('Before\n```js\na\n\nb\n```\n$$\nx\n\ny\n$$\nAfter');
		expect(b.map((x) => x.text)).toEqual(['Before', '```js\na\n\nb\n```', '$$\nx\n\ny\n$$', 'After']);
	});

	it('ignores extra blank lines', () => {
		expect(splitBlocks('\n\nA\n\n\n\nB\n\n').map((x) => x.text)).toEqual(['A', 'B']);
	});

	it('records where each block sits in the source, line ends included or not', () => {
		for (const eol of ['\n', '\r\n']) {
			const src = ['# T', 'one', 'two', '', '```', 'a', '', 'b', '```', 'end'].join(eol);
			for (const b of splitBlocks(src)) expect(src.slice(b.from, b.to).replace(/\r\n/g, '\n')).toBe(b.text);
		}
	});
});

describe('cuts inside a block', () => {
	const cutLines = (src: string) => splitBlocks(src).map((b) => b.cuts.map((c) => src.slice(c, src.indexOf('\n', c) < 0 ? undefined : src.indexOf('\n', c))));

	it('cuts a paragraph before each of its lines', () => {
		expect(cutLines('one\ntwo\nthree')).toEqual([['two', 'three']]);
	});

	it('cuts a list between top-level items, keeping nested items and an item’s own lines with it', () => {
		expect(cutLines('1. a\n   more a\n2. b\n   - b1\n   - b2\n3. c')).toEqual([['2. b', '3. c']]);
		expect(cutLines('Items:\n- a\n- b')).toEqual([['- a', '- b']]);
	});

	it('never cuts a setext heading from its underline', () => {
		expect(cutLines('intro\nTitle\n===\nafter')).toEqual([['Title', 'after']]);
	});

	it('cuts a table between rows and repeats its header in the continuation', () => {
		const src = '| a | b |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |\n| 5 | 6 |';
		const [b] = splitBlocks(src);
		expect(cutLines(src)).toEqual([['| 3 | 4 |', '| 5 | 6 |']]);
		expect(b!.prefix).toBe('| a | b |\n|---|---|');
	});

	it('cuts quotes and callouts between quoted lines; a callout repeats its title', () => {
		const callout = '> [!note] Title\n> one\n> two\nlazy\n> three';
		expect(cutLines(callout)).toEqual([['> two', '> three']]);
		expect(splitBlocks(callout)[0]!.prefix).toBe('> [!note] Title');
		expect(cutLines('> a\n> b')).toEqual([['> b']]);
		expect(cutLines('> a\n> ```\n> code\n> ```')).toEqual([[]]);
	});

	it('keeps code, math, headings and HTML whole', () => {
		expect(cutLines('```\na\nb\n```\n\n$$\nx\ny\n$$\n\n# H\n\n<div>\nx\n</div>')).toEqual([[], [], [], []]);
	});
});

describe('segments and splicePart', () => {
	const src = 'one\n\ntwo\nlines\n\nthree';
	const blocks = splitBlocks(src);

	it('gives the text of each block a frame shows, cut where the frame starts or stops', () => {
		expect(segments(src, blocks, [blocks[1]!.from, src.length])).toEqual(['two\nlines', 'three']);
		expect(segments(src, blocks, [0, src.indexOf('\nlines')])).toEqual(['one', 'two']);
		expect(segments(src, blocks, [src.indexOf('lines'), src.length])).toEqual(['lines', 'three']);
		expect(segments(src, blocks, [src.length, src.length])).toEqual([]);
	});

	it('repeats a table’s header in a continuation, with Windows line ends too', () => {
		const t = '| a |\r\n|---|\r\n| 1 |\r\n| 2 |';
		const b = splitBlocks(t);
		expect(segments(t, b, [b[0]!.cuts[0]!, t.length])).toEqual(['| a |\n|---|\n| 2 |']);
	});

	it('puts an edited part back without touching the rest', () => {
		const from = src.indexOf('lines');
		expect(splicePart(src, { from, to: from + 5 }, 'LINES')).toBe('one\n\ntwo\nLINES\n\nthree');
	});

	it('leaves the text alone when an empty frame stays empty', () => {
		expect(splicePart(src, { from: src.length, to: src.length }, '  ')).toBe(src);
	});

	it('adds text typed into an empty frame as a block of its own', () => {
		expect(splicePart(`${src}\n`, { from: src.length + 1, to: src.length + 1 }, 'more')).toBe(`${src}\n\nmore`);
		expect(splicePart(src, { from: src.length, to: src.length }, 'more')).toBe(`${src}\n\nmore`);
		expect(splicePart('', { from: 0, to: 0 }, 'first')).toBe('first');
	});
});

describe('fitFrame', () => {
	/** Every rendered source line is 10 mm tall, headings too; blocks stack with no gaps. */
	const fake = (): FlowMeasurer => {
		const heights: number[] = [];
		const h = (text: string) => text.split('\n').length * 10;
		const sum = () => heights.reduce((a, b) => a + b, 0);
		return {
			push: (t) => (heights.push(h(t)), Promise.resolve(sum())),
			replaceLast: (t) => ((heights[heights.length - 1] = h(t)), Promise.resolve(sum())),
		};
	};
	const fill = async (src: string, height: number, start?: FlowCursor) => {
		const blocks: Block[] = splitBlocks(src);
		const r = await fitFrame(src, blocks, start ?? { block: 0, at: blocks[0]!.from }, height, fake());
		return { shown: segments(src, blocks, [start?.at ?? 0, r.to]), next: r.next, rest: src.slice(r.next.at) };
	};

	it('takes whole blocks while they fit', async () => {
		const r = await fill('a\n\nb\n\nc', 20);
		expect(r.shown).toEqual(['a', 'b']);
		expect(r.rest).toBe('c');
	});

	it('takes as many lines of the next block as fit', async () => {
		const r = await fill('a\n\nb1\nb2\nb3\nb4', 30);
		expect(r.shown).toEqual(['a', 'b1\nb2']);
		expect(r.next.block).toBe(1);
		expect(r.rest).toBe('b3\nb4');
	});

	it('carries on from a cut, with the table header repeated', async () => {
		const src = '| a |\n|---|\n| 1 |\n| 2 |\n| 3 |';
		const first = await fill(src, 30);
		expect(first.shown).toEqual(['| a |\n|---|\n| 1 |']);
		const second = await fill(src, 100, first.next);
		expect(second.shown).toEqual(['| a |\n|---|\n| 2 |\n| 3 |']);
		expect(second.next.block).toBe(1);
	});

	it('keeps a heading with part of its section', async () => {
		const r = await fill('a\n\n## H\n\nb1\nb2\nb3', 35);
		expect(r.shown).toEqual(['a', '## H', 'b1']);
	});

	it('moves a heading on when none of its section fits', async () => {
		const r = await fill('a\n\n## H\n\n```\nx\ny\n```', 35);
		expect(r.shown).toEqual(['a']);
		expect(r.rest.startsWith('## H')).toBe(true);
	});

	it('splits a block too tall for the frame instead of clipping it', async () => {
		const r = await fill('l1\nl2\nl3\nl4\nl5', 25);
		expect(r.shown).toEqual(['l1\nl2']);
	});

	it('takes something even when nothing fits, so the text moves on', async () => {
		expect((await fill('l1\nl2', 5)).shown).toEqual(['l1']);
		const code = await fill('```\nx\n```\n\nafter', 5);
		expect(code.shown).toEqual(['```\nx\n```']);
		expect(code.rest).toBe('after');
	});

	it('moves a block that can’t be cut whole to the next frame', async () => {
		const r = await fill('a\n\n```\nx\ny\n```', 30);
		expect(r.shown).toEqual(['a']);
		expect(r.next).toEqual({ block: 1, at: 3 });
	});
});

describe('flowChains', () => {
	const mod = (id: string, type: string, extra: Record<string, unknown> = {}) => ({ id, type, x: 0, y: 0, w: 50, h: 50, ...extra }) as AnyModule;
	const file = (mods: AnyModule[][]) => ({ pages: mods.map((modules, i) => ({ id: `p${i}`, x: 0, y: 0, w: 1, h: 1, modules })) });

	it('follows frames across pages from the head', () => {
		const chains = flowChains(file([[mod('t', 'text', { markdown: 'x' })], [mod('f2', 'frame', { from: 'f1' })], [mod('f1', 'frame', { from: 't' })]]));
		const info = chains.get('f2');
		expect(info?.ok && info.chain.map((c) => c.module.id)).toEqual(['t', 'f1', 'f2']);
		expect(info?.ok && info.index).toBe(2);
		expect(info?.ok && info.chain[1]!.pageId).toBe('p2');
	});

	it('reports broken, doubled and wrong-source frames', () => {
		const chains = flowChains(file([[mod('t', 'text'), mod('a', 'frame', { from: 't' }), mod('b', 'frame', { from: 't' }), mod('c', 'frame', { from: 'gone' }), mod('i', 'image'), mod('d', 'frame', { from: 'i' }), mod('e', 'frame', { from: 'c' })]]));
		expect(chains.get('a')?.ok).toBe(true);
		expect(chains.get('b')).toMatchObject({ ok: false, reason: expect.stringMatching(/already/) });
		expect(chains.get('c')).toMatchObject({ ok: false, reason: expect.stringMatching(/deleted/) });
		expect(chains.get('d')).toMatchObject({ ok: false, reason: expect.stringMatching(/not image/) });
		expect(chains.get('e')).toMatchObject({ ok: false, reason: expect.stringMatching(/isn’t linked/) });
		expect(chains.has('i')).toBe(false);
	});

	it('lists the chain heads and frames on a page, which then can’t become a master', () => {
		const f = file([[mod('t', 'text'), mod('n', 'note'), mod('s', 'shape')], [mod('f', 'frame', { from: 't' }), mod('b', 'frame', { from: 'gone' })]]);
		expect(linkedModules(f, f.pages[0]!).map((m) => m.id)).toEqual(['t']);
		expect(linkedModules(f, f.pages[1]!).map((m) => m.id)).toEqual(['f', 'b']);
	});

	it('a loop of frames is not a chain', () => {
		const chains = flowChains(file([[mod('x', 'frame', { from: 'y' }), mod('y', 'frame', { from: 'x' })]]));
		expect(chains.get('x')?.ok).toBe(false);
	});

	it('modules without frames are not in the map', () => {
		expect(flowChains(file([[mod('t', 'text')]])).size).toBe(0);
	});
});

describe('chainSignature', () => {
	it('changes with content and frame sizes, not with position', () => {
		const head = { pageId: 'p', module: { id: 't', type: 'text', markdown: 'a', x: 0, y: 0, w: 50, h: 50 } as AnyModule };
		const frame = { pageId: 'p', module: { id: 'f', type: 'frame', from: 't', x: 0, y: 0, w: 50, h: 50 } as AnyModule };
		const base = chainSignature([head, frame]);
		expect(chainSignature([head, { ...frame, module: { ...frame.module, x: 99 } }])).toBe(base);
		expect(chainSignature([head, { ...frame, module: { ...frame.module, h: 60 } }])).not.toBe(base);
		expect(chainSignature([{ ...head, module: { ...head.module, markdown: 'b' } }, frame])).not.toBe(base);
	});
});

describe('placeNextFrame', () => {
	const page = { w: 210, h: 297 };

	it('goes under the source, same size, when there is room', () => {
		expect(placeNextFrame({ x: 10, y: 10, w: 90, h: 60 }, [], page)).toEqual({ x: 10, y: 75, w: 90, h: 60 });
	});

	it('goes beside the source when under it is taken or off the page', () => {
		const source = { x: 10, y: 200, w: 90, h: 80 };
		expect(placeNextFrame(source, [source], page)).toEqual({ x: 105, y: 200, w: 90, h: 80 });
	});

	it('skips spots that overlap other modules', () => {
		const source = { x: 10, y: 10, w: 90, h: 60 };
		const blocker = { x: 0, y: 70, w: 210, h: 40 };
		expect(placeNextFrame(source, [source, blocker], page)).toEqual({ x: 105, y: 10, w: 90, h: 60 });
	});

	it('shrinks to the space left when the full size does not fit', () => {
		const source = { x: 10, y: 10, w: 190, h: 200 };
		expect(placeNextFrame(source, [source], page)).toEqual({ x: 10, y: 215, w: 190, h: 82 });
	});

	it('stays on the page, offset from the source, when nothing is free', () => {
		const source = { x: 0, y: 0, w: 210, h: 297 };
		expect(placeNextFrame(source, [source], page)).toEqual({ x: 0, y: 0, w: 210, h: 297 });
		const wide = { x: 0, y: 0, w: 210, h: 280 };
		expect(placeNextFrame(wide, [wide], page)).toEqual({ x: 0, y: 10, w: 210, h: 280 });
	});
});
