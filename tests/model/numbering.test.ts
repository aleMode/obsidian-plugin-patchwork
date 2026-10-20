import { describe, expect, it } from 'vitest';
import { newBoardFile } from '../../src/model/defaults';
import { expandTokens, formatNumber, pageFurniture } from '../../src/model/numbering';
import type { Page } from '../../src/model/schema';

describe('formatNumber', () => {
	it('arabic, roman and alpha', () => {
		expect([1, 4, 9, 14, 40, 1999].map((n) => formatNumber(n, 'roman'))).toEqual(['i', 'iv', 'ix', 'xiv', 'xl', 'mcmxcix']);
		expect([1, 26, 27, 52, 703].map((n) => formatNumber(n, 'alpha'))).toEqual(['a', 'z', 'aa', 'az', 'aaa']);
		expect(formatNumber(0, 'roman')).toBe('0');
		expect(formatNumber(12, 'arabic')).toBe('12');
	});
});

describe('expandTokens', () => {
	it('replaces known tokens and leaves others', () => {
		expect(expandTokens('{title} — {page}/{pages} {date} {x}', { page: '2', pages: '9', title: 'Spells', date: '2026-10-20' })).toBe('Spells — 2/9 2026-10-20 {x}');
	});
});

describe('pageFurniture', () => {
	const page = (id: string, x: number, extra: Partial<Page> = {}): Page => ({ id, x, y: 0, w: 210, h: 297, modules: [], ...extra });
	const file = () => {
		const f = newBoardFile();
		f.pages = [page('c', 460), page('a', 0), page('b', 230)];
		return f;
	};
	const ctx = { title: 'T', date: 'D' };

	it('numbers pages in reading order; off by default', () => {
		const f = file();
		expect(pageFurniture(f, ctx).get('a')!.number).toBeNull();
		f.board.numbering.enabled = true;
		const r = pageFurniture(f, ctx);
		expect(['a', 'b', 'c'].map((id) => r.get(id)!.number)).toEqual(['1', '2', '3']);
	});

	it('start offset, format, and {pages} as the last number', () => {
		const f = file();
		f.board.numbering = { ...f.board.numbering, enabled: true, start: 3, format: 'roman' };
		f.board.footer = 'p. {page} of {pages}';
		const r = pageFurniture(f, ctx);
		expect(r.get('a')!.footer).toBe('p. iii of v');
		expect(r.get('c')!.number).toBe('v');
	});

	it('custom and hidden labels still count; skipFirst hides only the first', () => {
		const f = file();
		f.board.numbering = { ...f.board.numbering, enabled: true, skipFirst: true };
		f.pages[2] = { ...f.pages[2]!, numberLabel: 'Cover B' }; // page b
		const r = pageFurniture(f, ctx);
		expect(['a', 'b', 'c'].map((id) => r.get(id)!.number)).toEqual([null, 'Cover B', '3']);
		expect(r.get('a')!.pageToken).toBe('1');
	});

	it('page header overrides the board header; empty string removes it', () => {
		const f = file();
		f.board.header = '{title}';
		f.pages[1] = { ...f.pages[1]!, header: '' }; // page a
		f.pages[0] = { ...f.pages[0]!, header: 'Own {page}' }; // page c
		const r = pageFurniture(f, ctx);
		expect([r.get('a')!.header, r.get('b')!.header, r.get('c')!.header]).toEqual([null, 'T', 'Own 3']);
	});
});

describe('pdfPageLabels', () => {
	it('maps numbering to PDF label entries; null when off', async () => {
		const { pdfPageLabels } = await import('../../src/model/numbering');
		const f = newBoardFile();
		f.pages = [
			{ id: 'a', x: 0, y: 0, w: 1, h: 1, modules: [], numberLabel: 'Cover' },
			{ id: 'b', x: 10, y: 0, w: 1, h: 1, modules: [] },
		];
		expect(pdfPageLabels(f)).toBeNull();
		f.board.numbering = { ...f.board.numbering, enabled: true, format: 'roman', start: 1 };
		expect(pdfPageLabels(f)).toEqual([{ prefix: 'Cover' }, { style: 'r', start: 2 }]);
	});
});
