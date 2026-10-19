import { describe, expect, it, vi } from 'vitest';
import { newBoardFile } from '../../src/model/defaults';
import { BoardStore } from '../../src/store/BoardStore';
import { addPage, movePage, removePage } from '../../src/store/pageOps';

const A4 = { w: 210, h: 297 };

function storeWithPage() {
	const { file, page } = addPage(newBoardFile(), A4);
	return { store: new BoardStore(file), id: page.id };
}

describe('BoardStore', () => {
	it('notifies subscribers and supports undo/redo', () => {
		const { store, id } = storeWithPage();
		const seen = vi.fn();
		store.subscribe(seen);
		store.update((f) => movePage(f, id, 50, 60));
		expect(store.file.pages[0]).toMatchObject({ x: 50, y: 60 });
		store.undo();
		expect(store.file.pages[0]).toMatchObject({ x: 0, y: 0 });
		store.redo();
		expect(store.file.pages[0]).toMatchObject({ x: 50, y: 60 });
		expect(seen).toHaveBeenCalledTimes(3);
	});

	it('does not record no-op changes', () => {
		const { store, id } = storeWithPage();
		store.update((f) => movePage(f, id, 0, 0));
		expect(store.canUndo).toBe(false);
	});

	it('coalesces a drag into one undo step', () => {
		const { store, id } = storeWithPage();
		for (let i = 1; i <= 20; i++) store.update((f) => movePage(f, id, i, i), { coalesce: `drag:${id}` });
		store.endCoalesce();
		store.update((f) => movePage(f, id, 100, 100), { coalesce: `drag:${id}` });
		store.undo();
		expect(store.file.pages[0]).toMatchObject({ x: 20, y: 20 });
		store.undo();
		expect(store.file.pages[0]).toMatchObject({ x: 0, y: 0 });
		expect(store.canUndo).toBe(false);
	});

	it('clears redo after a new change', () => {
		const { store, id } = storeWithPage();
		store.update((f) => movePage(f, id, 1, 1));
		store.undo();
		store.update((f) => removePage(f, id));
		expect(store.canRedo).toBe(false);
	});

	it('ignores changes when read-only', () => {
		const { file, page } = addPage(newBoardFile(), A4);
		const store = new BoardStore(file, { readOnly: true });
		store.update((f) => movePage(f, page.id, 9, 9));
		expect(store.file).toBe(file);
	});

	it('keeps untouched pages shared between snapshots', () => {
		const first = addPage(newBoardFile(), A4);
		const second = addPage(first.file, A4);
		const store = new BoardStore(second.file);
		const before = store.file.pages[0];
		store.update((f) => movePage(f, second.page.id, 500, 0));
		expect(store.file.pages[0]).toBe(before);
	});
});

describe('module ops', () => {
	it('restack puts a module on top even when others use z', async () => {
		const { restack } = await import('../../src/store/pageOps');
		const { file, page } = addPage(newBoardFile(), A4);
		const mod = (id: string, z?: number) => ({ id, type: 'text', x: 0, y: 0, w: 1, h: 1, markdown: '', ...(z === undefined ? {} : { z }) });
		const withMods = { ...file, pages: [{ ...page, modules: [mod('a', 5), mod('b'), mod('c', 2)] }] };
		const top = restack(withMods, page.id, 'b', 'front').pages[0]!.modules;
		expect(top.map((m) => m.id)).toEqual(['a', 'c', 'b']);
		expect(top[2]!.z).toBe(5);
		const bottom = restack(withMods, page.id, 'a', 'back').pages[0]!.modules;
		expect(bottom.map((m) => [m.id, m.z ?? 0])).toEqual([['a', 0], ['b', 0], ['c', 2]]);
	});
});
