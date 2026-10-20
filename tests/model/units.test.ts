import { describe, expect, it } from 'vitest';
import { formatLength, formatLengthValue, fromUnit, mmToPt, mmToPx, parseLength, ptToMm, pxToMm, toUnit } from '../../src/model/units';

describe('units', () => {
	it('converts mm to CSS px and PDF pt using 96 and 72 per inch', () => {
		expect(mmToPx(25.4)).toBeCloseTo(96);
		expect(mmToPt(25.4)).toBeCloseTo(72);
		expect(pxToMm(mmToPx(210))).toBeCloseTo(210);
		expect(ptToMm(mmToPt(297))).toBeCloseTo(297);
	});

	it('converts display units both ways', () => {
		expect(toUnit(210, 'cm')).toBe(21);
		expect(toUnit(25.4, 'in')).toBe(1);
		expect(fromUnit(8.5, 'in')).toBeCloseTo(215.9);
		expect(fromUnit(21, 'mm')).toBe(21);
	});

	it('formats lengths without trailing zeros', () => {
		expect(formatLength(210, 'mm')).toBe('210 mm');
		expect(formatLength(210, 'cm')).toBe('21 cm');
		expect(formatLength(215.9, 'in')).toBe('8.5 in');
		expect(formatLengthValue(210, 'cm')).toBe('21');
		expect(formatLengthValue(215.9, 'in')).toBe('8.5');
		expect(formatLength(12.345, 'mm')).toBe('12.3 mm');
	});

	it('parses lengths with or without a unit', () => {
		expect(parseLength('21cm', 'mm')).toBe(210);
		expect(parseLength(' 8.5 in ', 'mm')).toBeCloseTo(215.9);
		expect(parseLength('8,5"', 'mm')).toBeCloseTo(215.9);
		expect(parseLength('210', 'mm')).toBe(210);
		expect(parseLength('2', 'cm')).toBe(20);
		expect(parseLength('12 px', 'mm')).toBeNull();
		expect(parseLength('', 'mm')).toBeNull();
	});
});
