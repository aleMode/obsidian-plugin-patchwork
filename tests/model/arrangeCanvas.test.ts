import { describe, expect, it } from 'vitest';
import { arrangePages } from '../../src/model/arrange';
import { toJsonCanvas } from '../../src/model/canvasExport';
import { newBoardFile } from '../../src/model/defaults';
import type { Page } from '../../src/model/schema';

const page = (id: string, x: number, y: number, w = 210, h = 297, extra: Partial<Page> = {}): Page => ({ id, x, y, w, h, modules: [], ...extra });

describe('arrangePages', () => {
	const file = () => {
		const f = newBoardFile();
		f.pages = [page('a', 0, 0), page('b', 500, 500, 297, 210), page('c', 900, 40), page('d', 0, 900, 148, 210)];
		return f;
	};

	it('row: left to right in output order with the gap, first page fixed', () => {
		const pos = arrangePages(file(), 'row', 20);
		expect([...pos.entries()]).toEqual([
			['a', { x: 0, y: 0 }],
			['c', { x: 230, y: 0 }],
			['b', { x: 460, y: 0 }],
			['d', { x: 777, y: 0 }],
		]);
	});

	it('grid: wraps after the column count, rows below the tallest page', () => {
		const pos = arrangePages(file(), 'grid', 10, 2);
		expect(pos.get('a')).toEqual({ x: 0, y: 0 });
		expect(pos.get('c')).toEqual({ x: 220, y: 0 });
		expect(pos.get('b')).toEqual({ x: 0, y: 307 });
		expect(pos.get('d')).toEqual({ x: 307, y: 307 });
	});
});

describe('toJsonCanvas', () => {
	it('maps pages to groups and modules to file/text nodes at absolute pixel positions', () => {
		const f = newBoardFile();
		f.pages = [page('p', 10, 20, 210, 297, { name: 'Front', modules: [
			{ id: 'n', type: 'note', file: 'Rules/Combat.md', subpath: '#Prone', x: 5, y: 5, w: 50, h: 40 },
			{ id: 'd', type: 'pdf', file: 'PDFs/Book.pdf', page: 3, crop: [0, 0, 0.5, 0.5], x: 60, y: 5, w: 50, h: 40 },
			{ id: 't', type: 'text', markdown: '**hi**', x: 5, y: 50, w: 50, h: 10 },
			{ id: 'i', type: 'image', file: 'Images/Map.png', x: 60, y: 50, w: 50, h: 40, style: { padding: 2 } },
		] })];
		const { canvas, dropped } = toJsonCanvas(f);
		expect(canvas.nodes[0]).toEqual({ id: 'page-p', type: 'group', x: 38, y: 76, width: 794, height: 1123, label: 'Front' });
		expect(canvas.nodes[1]).toMatchObject({ type: 'file', file: 'Rules/Combat.md', subpath: '#Prone', x: 57, y: 95 });
		expect(canvas.nodes[2]).toMatchObject({ type: 'file', file: 'PDFs/Book.pdf', subpath: '#page=3' });
		expect(canvas.nodes[3]).toMatchObject({ type: 'text', text: '**hi**' });
		expect(canvas.nodes.every((n) => Number.isInteger(n.x) && Number.isInteger(n.width))).toBe(true);
		expect(dropped.sort()).toEqual(['PDF crops', 'module styles']);
	});
});

describe('master pages in arrange and canvas export', () => {
	const file = () => {
		const f = newBoardFile();
		f.pages = [page('a', 0, 0), page('m', 230, 0, 210, 297, { isMaster: true, modules: [{ id: 't', type: 'text', markdown: 'Header', x: 0, y: 0, w: 10, h: 10 }] }), page('b', 460, 0)];
		return f;
	};

	it('arrange lays out output pages only, then masters in a row below', () => {
		const pos = arrangePages(file(), 'row', 20);
		expect(pos.get('a')).toEqual({ x: 0, y: 0 });
		expect(pos.get('b')).toEqual({ x: 230, y: 0 });
		expect(pos.get('m')).toEqual({ x: 0, y: 317 });
	});

	it('canvas export leaves masters out and says so', () => {
		const { canvas, dropped } = toJsonCanvas(file());
		expect(canvas.nodes.map((n) => n.id)).toEqual(['page-a', 'page-b']);
		expect(dropped).toContain('master pages');
	});
});
