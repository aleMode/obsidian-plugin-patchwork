import { describe, expect, it } from 'vitest';
import { chainSignature, fitCount, flowChains, placeNextFrame, splitBlocks } from '../../src/model/flow';
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
});

describe('fitCount', () => {
	const plain = (n: number) => Array.from({ length: n }, () => ({ heading: false }));
	it('takes the blocks whose bottom fits', () => {
		expect(fitCount([10, 20, 30], 25, plain(3))).toBe(2);
		expect(fitCount([10, 20, 30], 30, plain(3))).toBe(3);
	});

	it('always takes at least one block', () => {
		expect(fitCount([50, 60], 25, plain(2))).toBe(1);
	});

	it('keeps a heading with the block after it', () => {
		const blocks = [{ heading: false }, { heading: true }, { heading: false }];
		expect(fitCount([10, 15, 40], 20, blocks)).toBe(1);
		// The heading is last in the text: nothing to keep it with.
		expect(fitCount([10, 15], 20, blocks.slice(0, 2))).toBe(2);
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
