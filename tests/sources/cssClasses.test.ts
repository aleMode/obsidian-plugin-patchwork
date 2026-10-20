import { describe, expect, it } from 'vitest';
import { parseCssClasses } from '../../src/sources/cssClasses';

describe('parseCssClasses', () => {
	it('reads a list', () => {
		expect(parseCssClasses(['wide', 'fancy'])).toEqual(['wide', 'fancy']);
	});
	it('reads one string with commas or spaces', () => {
		expect(parseCssClasses('wide fancy')).toEqual(['wide', 'fancy']);
		expect(parseCssClasses('wide, fancy')).toEqual(['wide', 'fancy']);
	});
	it('keeps only plain class names', () => {
		expect(parseCssClasses(['ok', 'a b', '1bad', 'x"onclick', '', 42, null, 'also-ok_2'])).toEqual(['ok', 'also-ok_2']);
	});
	it('drops duplicates and ignores other values', () => {
		expect(parseCssClasses(['a', 'a'])).toEqual(['a']);
		expect(parseCssClasses(undefined)).toEqual([]);
		expect(parseCssClasses({ a: 1 })).toEqual([]);
	});
});
