import { describe, expect, it } from 'vitest';
import { newBoardFile } from '../../src/model/defaults';
import { drawOrder } from '../../src/model/exportPlan';
import { isInheritedId, masterOf, outputPages, pagesUsing, resolvePage } from '../../src/model/masters';
import { masterPreview, pageFurniture, pdfPageLabels } from '../../src/model/numbering';
import type { Page, PatchworkFile } from '../../src/model/schema';

const text = (id: string, z?: number) => ({ id, type: 'text' as const, markdown: id, x: 0, y: 0, w: 10, h: 10, ...(z === undefined ? {} : { z }) });
const page = (id: string, x: number, extra: Partial<Page> = {}): Page => ({ id, x, y: 0, w: 100, h: 100, modules: [], ...extra });

function board(): PatchworkFile {
	const f = newBoardFile();
	f.board.numbering.enabled = true;
	f.board.footer = 'board {page}/{pages}';
	f.pages = [
		page('m', 0, { isMaster: true, name: 'Master', header: 'Chapter {page}', background: '#eee', modules: [text('logo'), text('frame', -5)] }),
		page('a', 200, { master: 'm', modules: [text('own', -10)] }),
		page('b', 400, { master: 'm', header: 'Own header', background: '#fff' }),
		page('c', 600),
	];
	return f;
}

describe('master pages', () => {
	it('are left out of output order', () => {
		expect(outputPages(board()).map((p) => p.id)).toEqual(['a', 'b', 'c']);
	});

	it('resolve: master modules below the page’s own, with per-page IDs, locked', () => {
		const f = board();
		const r = resolvePage(f, f.pages[1]!);
		expect(drawOrder(r.modules).map((m) => m.id)).toEqual(['a~frame', 'a~logo', 'own']);
		expect(r.modules.filter((m) => isInheritedId(m.id)).every((m) => m.locked)).toBe(true);
		expect(isInheritedId('own')).toBe(false);
	});

	it('resolve: page furniture wins over the master’s', () => {
		const f = board();
		expect(resolvePage(f, f.pages[1]!)).toMatchObject({ header: 'Chapter {page}', background: '#eee' });
		expect(resolvePage(f, f.pages[2]!)).toMatchObject({ header: 'Own header', background: '#fff' });
	});

	it('pages without a valid master resolve to themselves', () => {
		const f = board();
		expect(resolvePage(f, f.pages[3]!)).toBe(f.pages[3]);
		const dangling = page('d', 0, { master: 'gone' });
		expect(resolvePage(f, dangling)).toBe(dangling);
		// Pointing at a normal page, or a master pointing at a master, does nothing.
		expect(masterOf(f, page('e', 0, { master: 'c' }))).toBeUndefined();
		expect(masterOf(f, page('f', 0, { isMaster: true, master: 'm' }))).toBeUndefined();
	});

	it('numbering skips masters; headers come from page, then master, then board', () => {
		const f = board();
		const fur = pageFurniture(f, { title: 'T', date: 'D' });
		expect(fur.has('m')).toBe(false);
		expect(fur.get('a')).toMatchObject({ number: '1', header: 'Chapter 1', footer: 'board 1/3' });
		expect(fur.get('b')).toMatchObject({ number: '2', header: 'Own header' });
		expect(fur.get('c')).toMatchObject({ number: '3', header: null });
		expect(pdfPageLabels(f)).toHaveLength(3);
	});

	it('master preview shows templates unexpanded', () => {
		const f = board();
		expect(masterPreview(f, f.pages[0]!)).toEqual({ number: '#', pageToken: '#', header: 'Chapter {page}', footer: 'board {page}/{pages}' });
	});

	it('pagesUsing lists the pages that use a master', () => {
		expect(pagesUsing(board(), 'm').map((p) => p.id)).toEqual(['a', 'b']);
	});
});
