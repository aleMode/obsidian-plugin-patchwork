import { describe, expect, it } from 'vitest';
import { newBoardFile } from '../../src/model/defaults';
import { cleanPageOrder, orderedPages, readingOrder } from '../../src/model/ordering';
import type { Page } from '../../src/model/schema';

const page = (id: string, x: number, y: number, h = 297): Page => ({ id, x, y, w: 210, h, modules: [] });
const ids = (pages: { id: string }[]) => pages.map((p) => p.id);

describe('readingOrder', () => {
	it('orders a grid row by row, left to right', () => {
		const pages = [page('d', 230, 320), page('a', 0, 0), page('c', 0, 320), page('b', 230, 0)];
		expect(ids(readingOrder(pages))).toEqual(['a', 'b', 'c', 'd']);
	});

	it('keeps slightly misaligned pages in the same row', () => {
		const pages = [page('b', 230, 40), page('a', 0, 0)];
		expect(ids(readingOrder(pages))).toEqual(['a', 'b']);
	});

	it('starts a new row once a page is below the row centre', () => {
		const pages = [page('b', 230, 150), page('a', 0, 0)];
		// b's top (150) is past a's centre (148.5): b reads after a, on its own row.
		expect(ids(readingOrder(pages))).toEqual(['a', 'b']);
		const left = [page('b', -300, 150), page('a', 0, 0)];
		expect(ids(readingOrder(left))).toEqual(['a', 'b']);
	});

	it('is deterministic for identical positions', () => {
		expect(ids(readingOrder([page('z', 0, 0), page('m', 0, 0)]))).toEqual(['m', 'z']);
	});
});

describe('orderedPages', () => {
	const file = newBoardFile();
	file.pages = [page('a', 0, 0), page('b', 230, 0), page('c', 460, 0)];

	it('uses reading order unless the board is manual', () => {
		expect(ids(orderedPages({ ...file, board: { ...file.board, pageOrder: ['c', 'a'] } }))).toEqual(['a', 'b', 'c']);
	});

	it('puts listed pages first, then the rest in reading order, skipping unknown IDs', () => {
		const manual = { ...file, board: { ...file.board, order: 'manual' as const, pageOrder: ['c', 'gone', 'a'] } };
		expect(ids(orderedPages(manual))).toEqual(['c', 'a', 'b']);
	});
});

describe('cleanPageOrder', () => {
	it('drops unknown and duplicate IDs, and leaves a clean file untouched', () => {
		const file = newBoardFile();
		file.pages = [page('a', 0, 0), page('b', 230, 0)];
		file.board.pageOrder = ['b', 'x', 'b', 'a'];
		expect(cleanPageOrder(file).board.pageOrder).toEqual(['b', 'a']);
		expect(file.board.pageOrder).toEqual(['b', 'x', 'b', 'a']);
		file.board.pageOrder = ['a'];
		expect(cleanPageOrder(file)).toBe(file);
	});
});
