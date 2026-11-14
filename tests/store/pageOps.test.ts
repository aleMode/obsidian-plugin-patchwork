import { describe, expect, it } from 'vitest';
import { newBoardFile } from '../../src/model/defaults';
import type { AnyModule } from '../../src/model/schema';
import { flowChains } from '../../src/model/flow';
import { duplicateModules, duplicatePage, moveModuleToPage, pasteModules, removeModule, removePage } from '../../src/store/pageOps';

describe('removeModule and linked frames', () => {
	const mod = (id: string, type: string, extra: Record<string, unknown> = {}) => ({ id, type, x: 0, y: 0, w: 10, h: 10, ...extra }) as AnyModule;
	const board = () => {
		const f = newBoardFile();
		f.pages = [
			{ id: 'p', x: 0, y: 0, w: 100, h: 100, modules: [mod('t', 'text', { markdown: '' }), mod('f1', 'frame', { from: 't' })] },
			{ id: 'q', x: 200, y: 0, w: 100, h: 100, modules: [mod('f2', 'frame', { from: 'f1' })] },
		];
		return f;
	};

	it('deleting a middle frame links the next one to the previous', () => {
		const f = removeModule(board(), 'p', 'f1');
		expect(f.pages[1]!.modules[0]!.from).toBe('t');
	});

	it('deleting the head leaves the frames as they are (they show a placeholder)', () => {
		const f = removeModule(board(), 'p', 't');
		expect(f.pages[0]!.modules[0]!.from).toBe('t');
	});

	it('deleting the page of a middle frame closes the chain too', () => {
		const f = removePage(board(), 'p');
		expect(f.pages.map((p) => p.id)).toEqual(['q']);
		expect(f.pages[0]!.modules[0]!.from).toBe('t');
	});

	it('deleting a page with consecutive frames joins what is left', () => {
		const f = board();
		f.pages[0]!.modules.push(mod('f1b', 'frame', { from: 'f1' }));
		f.pages[1]!.modules[0]!.from = 'f1b';
		const next = removePage(f, 'p');
		expect(next.pages[0]!.modules[0]!.from).toBe('t');
	});
});

describe('moving and copying linked frames', () => {
	const mod = (id: string, type: string, extra: Record<string, unknown> = {}) => ({ id, type, x: 0, y: 0, w: 10, h: 10, ...extra }) as AnyModule;
	const board = () => {
		const f = newBoardFile();
		f.pages = [
			{ id: 'p', x: 0, y: 0, w: 100, h: 100, modules: [mod('n', 'note', { file: 'a.md' }), mod('f1', 'frame', { from: 'n' }), mod('f2', 'frame', { from: 'f1' })] },
			{ id: 'q', x: 200, y: 0, w: 100, h: 100, modules: [] },
		];
		return f;
	};
	const counter = () => {
		let n = 0;
		return () => `c${n++}`;
	};
	/** Each chain as its member IDs, and every module that is not in a working chain. */
	const chains = (f: ReturnType<typeof board>) => {
		const info = flowChains(f);
		const ok = new Set<string>();
		const broken: string[] = [];
		for (const [id, i] of info) {
			if (i.ok) ok.add(i.chain.map((c) => c.module.id).join('>'));
			else broken.push(id);
		}
		return { chains: [...ok].sort(), broken };
	};

	it('a middle frame dragged to another page stays in its chain', () => {
		const f = moveModuleToPage(board(), 'p', 'f1', 'q', 5, 5);
		expect(chains(f)).toEqual({ chains: ['n>f1>f2'], broken: [] });
		expect(f.pages[1]!.modules.map((m) => m.id)).toEqual(['f1']);
	});

	it('a copied frame joins the end of its chain', () => {
		const { file, copies } = duplicateModules(board(), [{ pageId: 'p', moduleId: 'f1' }], counter());
		expect(copies).toEqual([{ pageId: 'p', moduleId: 'c0' }]);
		expect(chains(file)).toEqual({ chains: ['n>f1>f2>c0'], broken: [] });
	});

	it('copied neighbour frames keep their order at the end of the chain', () => {
		const { file } = duplicateModules(board(), [{ pageId: 'p', moduleId: 'f2' }, { pageId: 'p', moduleId: 'f1' }], counter());
		// c0 copies f2 and continues c1 (the copy of f1), which joins the end of the original chain.
		expect(chains(file)).toEqual({ chains: ['n>f1>f2>c1>c0'], broken: [] });
	});

	it('copying a whole chain makes a new chain', () => {
		const picks = ['n', 'f1', 'f2'].map((moduleId) => ({ pageId: 'p', moduleId }));
		const { file } = duplicateModules(board(), picks, counter());
		expect(chains(file)).toEqual({ chains: ['c0>c1>c2', 'n>f1>f2'], broken: [] });
	});

	it('a duplicated page gets its own chain', () => {
		const f = duplicatePage(board(), 'p', counter());
		expect(chains(f)).toEqual({ chains: ['c1>c2>c3', 'n>f1>f2'], broken: [] });
	});

	it('a duplicated page holding the end of a chain extends that chain', () => {
		const f = moveModuleToPage(board(), 'p', 'f2', 'q', 0, 0);
		const next = duplicatePage(f, 'q', counter());
		expect(chains(next)).toEqual({ chains: ['n>f1>f2>c1'], broken: [] });
	});
});

describe('pasteModules', () => {
	const mod = (id: string, type: string, extra: Record<string, unknown> = {}) => ({ id, type, x: 10, y: 10, w: 20, h: 20, ...extra }) as AnyModule;
	const board = () => {
		const f = newBoardFile();
		f.pages = [
			{ id: 'p', x: 0, y: 0, w: 100, h: 100, modules: [mod('t', 'text', { markdown: 'x' }), mod('f1', 'frame', { from: 't' })] },
			{ id: 'q', x: 200, y: 0, w: 50, h: 50, modules: [] },
		];
		return f;
	};
	const counter = () => {
		let n = 0;
		return () => `n${++n}`;
	};

	it('pastes copies with new IDs: nudged where the originals are, in place on another page, kept on the page', () => {
		const f = board();
		const here = pasteModules(f, 'p', [mod('t', 'text', { markdown: 'x' })], counter());
		expect(here.file.pages[0]!.modules[2]).toMatchObject({ id: 'n1', x: 15, y: 15 });
		const there = pasteModules(f, 'q', [mod('big', 'text', { x: 40, y: 40, w: 30, h: 80 })], counter());
		expect(there.file.pages[1]!.modules[0]).toMatchObject({ x: 20, y: 0, w: 30, h: 50 });
		expect(there.pasted).toEqual(['n1']);
	});

	it('a pasted chain is a new chain; a lone frame from this file joins the end of its chain', () => {
		const f = board();
		const chain = pasteModules(f, 'q', [mod('t', 'text', { markdown: 'x' }), mod('f1', 'frame', { from: 't' })], counter());
		expect(chain.file.pages[1]!.modules.map((m) => m.from)).toEqual([undefined, 'n1']);
		const lone = pasteModules(f, 'q', [mod('f1', 'frame', { from: 't' })], counter());
		expect(lone.file.pages[1]!.modules[0]!.from).toBe('f1');
		expect(flowChains(lone.file).get('n1')?.ok).toBe(true);
	});

	it('a frame from another patchwork, without its text, stays unlinked', () => {
		const out = pasteModules(board(), 'q', [mod('zz', 'frame', { from: 'elsewhere' })], counter());
		expect(flowChains(out.file).get('n1')?.ok).toBe(false);
	});
});
