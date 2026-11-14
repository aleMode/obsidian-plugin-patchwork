import { describe, expect, it } from 'vitest';
import { conflictCopyName, decideSave } from '../../src/store/saveGuard';

describe('decideSave', () => {
	it('writes local edits when the disk is unchanged', () => {
		expect(decideSave('A', 'A', true, 'B')).toBe('write');
	});

	it('reloads an outside change when there are no local edits', () => {
		expect(decideSave('A', 'C', false, 'A')).toBe('reload');
	});

	it('reports a conflict when both sides changed', () => {
		expect(decideSave('A', 'C', true, 'B')).toBe('conflict');
	});

	it('does nothing when both sides made the same change', () => {
		expect(decideSave('A', 'B', true, 'B')).toBe('none');
	});

	it('does nothing when nothing changed', () => {
		expect(decideSave('A', 'A', false, 'A')).toBe('none');
	});

	it('does not treat re-serialization of a hand-formatted file as an edit', () => {
		// Disk has non-canonical formatting; our serialization differs but we have no edits.
		expect(decideSave('{ "version":1 }', '{ "version":1 }', false, '{\n  "version": 1\n}\n')).toBe('none');
	});
});

describe('conflictCopyName', () => {
	it('stamps the local date and time', () => {
		expect(conflictCopyName('Spells', 'patchwork', new Date(2026, 9, 19, 23, 5))).toBe('Spells (conflict 2026-10-19 2305).patchwork');
	});

	it('numbers further copies made in the same minute', () => {
		expect(conflictCopyName('Spells', 'patchwork', new Date(2026, 9, 19, 23, 5), 2)).toBe('Spells (conflict 2026-10-19 2305 2).patchwork');
	});
});
