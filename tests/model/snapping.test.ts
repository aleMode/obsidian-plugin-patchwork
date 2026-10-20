import { describe, expect, it } from 'vitest';
import { gridDrawStep } from '../../src/model/snapping';

describe('gridDrawStep', () => {
	it('draws the real grid when it is not too dense', () => {
		expect(gridDrawStep(12.6, 8)).toBe(12.6);
		expect(gridDrawStep(8, 8)).toBe(8);
	});
	it('draws every 2nd, 5th, 10th line… of a dense grid, the smallest multiple that fits', () => {
		expect(gridDrawStep(5, 8)).toBe(10);
		expect(gridDrawStep(2.5, 8)).toBe(12.5);
		expect(gridDrawStep(7.6, 8)).toBeCloseTo(15.2);
		expect(gridDrawStep(0.5, 8)).toBe(10);
		expect(gridDrawStep(0.1, 8)).toBe(10);
	});
	it('never returns less than the minimum', () => {
		for (const s of [0.01, 0.3, 1, 3.3, 7.9]) expect(gridDrawStep(s, 8)).toBeGreaterThanOrEqual(8);
	});
	it('passes through a degenerate step', () => {
		expect(gridDrawStep(0, 8)).toBe(0);
	});
});
