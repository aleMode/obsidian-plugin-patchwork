import { describe, expect, it } from 'vitest';
import { newBoardFile } from '../../src/model/defaults';
import { tocEntries } from '../../src/model/toc';

describe('tocEntries', () => {
	it('lists named output pages with their printed numbers, skipping masters and its own page', () => {
		const f = newBoardFile();
		f.board.numbering = { ...f.board.numbering, enabled: true, start: 1, format: 'roman' };
		const p = (id: string, x: number, extra = {}) => ({ id, x, y: 0, w: 100, h: 100, modules: [], ...extra });
		f.pages = [p('toc', 0, { name: 'Contents' }), p('m', 150, { name: 'Layout', isMaster: true }), p('a', 300, { name: 'Spells' }), p('b', 450), p('c', 600, { name: 'Monsters', numberLabel: 'M1' })];
		expect(tocEntries(f, 'toc')).toEqual([
			{ pageId: 'a', title: 'Spells', number: 'ii' },
			{ pageId: 'c', title: 'Monsters', number: 'M1' },
		]);
	});
});
