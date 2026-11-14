import { describe, expect, it } from 'vitest';
import { newBoardFile } from '../../src/model/defaults';
import type { AnyModule } from '../../src/model/schema';
import { headingSubpaths, retitledSubpath, retitleSection } from '../../src/model/subpaths';

describe('headingSubpaths', () => {
	it('uses the bare name when it is unique', () => {
		expect(headingSubpaths([{ heading: 'Combat', level: 1 }, { heading: 'Actions', level: 2 }])).toEqual(['#Combat', '#Actions']);
	});

	it('adds the ancestors of a repeated name', () => {
		const h = [
			{ heading: 'Monsters', level: 1 },
			{ heading: 'Goblin', level: 2 },
			{ heading: 'Actions', level: 3 },
			{ heading: 'Orc', level: 2 },
			{ heading: 'actions', level: 3 },
		];
		expect(headingSubpaths(h)).toEqual(['#Monsters', '#Goblin', '#Monsters#Goblin#Actions', '#Orc', '#Monsters#Orc#actions']);
	});

	it('skips levels and closes sections at the same or a higher level', () => {
		const h = [
			{ heading: 'A', level: 1 },
			{ heading: 'Notes', level: 4 },
			{ heading: 'B', level: 1 },
			{ heading: 'Notes', level: 2 },
		];
		expect(headingSubpaths(h)).toEqual(['#A', '#A#Notes', '#B', '#B#Notes']);
	});
});

describe('retitledSubpath', () => {
	it('follows the heading, its children, and its short and full forms', () => {
		expect(retitledSubpath('#Orc#Actions', '#Orc#Actions', 'Moves')).toBe('#Orc#Moves');
		expect(retitledSubpath('#actions', '#Orc#Actions', 'Moves')).toBe('#Moves');
		expect(retitledSubpath('#Orc#Actions#Melee', '#Actions', 'Moves')).toBe('#Orc#Moves#Melee');
		expect(retitledSubpath('#Actions#Melee', '#Orc#Actions', 'Moves')).toBe('#Moves#Melee');
	});

	it('leaves other sections and block links alone', () => {
		expect(retitledSubpath('#Goblin#Actions', '#Orc#Actions', 'Moves')).toBeNull();
		expect(retitledSubpath('#Orc', '#Orc#Actions', 'Moves')).toBeNull();
		expect(retitledSubpath('#^abc', '#Orc', 'Moves')).toBeNull();
	});
});

describe('retitleSection', () => {
	it('repoints every note module of that file through the heading, and nothing else', () => {
		const note = (id: string, file: string, subpath?: string) => ({ id, type: 'note', file, x: 0, y: 0, w: 10, h: 10, ...(subpath ? { subpath } : {}) }) as AnyModule;
		const file = newBoardFile();
		file.pages = [
			{ id: 'p', x: 0, y: 0, w: 210, h: 297, modules: [note('a', 'M.md', '#Orc'), note('b', 'M.md', '#Orc#Actions'), note('c', 'X.md', '#Orc'), note('d', 'M.md')] },
			{ id: 'q', x: 0, y: 0, w: 210, h: 297, modules: [note('e', 'M.md', '#Goblin')] },
		];
		const out = retitleSection(file, 'M.md', '#Orc', 'Ogre');
		expect(out.pages[0]!.modules.map((m) => (m as { subpath?: string }).subpath)).toEqual(['#Ogre', '#Ogre#Actions', '#Orc', undefined]);
		expect(out.pages[1]).toBe(file.pages[1]);
		expect(retitleSection(file, 'M.md', '#Elf', 'Ogre')).toBe(file);
	});
});
