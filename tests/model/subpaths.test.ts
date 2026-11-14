import { describe, expect, it } from 'vitest';
import { headingSubpaths } from '../../src/model/subpaths';

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
