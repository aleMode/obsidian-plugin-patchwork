import { describe, expect, it } from 'vitest';
import { rulerTicks } from '../../src/model/rulers';

describe('rulerTicks', () => {
	it('picks a step that keeps labels at least 60 px apart', () => {
		// 1 px per mm: 50 mm is the first step ≥ 60 px? No: 50 px < 60, so 100 mm.
		const t = rulerTicks(0, 300, 0, 1, 'mm');
		expect(t.major.map((m) => m.label)).toEqual(['0', '100', '200', '300']);
		expect(t.minor).toHaveLength(12);
	});

	it('labels relative to the origin, including negatives', () => {
		const t = rulerTicks(-20, 30, 10, 4, 'mm'); // 4 px/mm → 20 mm steps
		expect(t.major.map((m) => [m.mm, m.label])).toEqual([[-10, '-20'], [10, '0'], [30, '20']]);
	});

	it('works in inches with quarter subdivisions', () => {
		const t = rulerTicks(0, 50.8, 0, 96 / 25.4, 'in'); // 96 px per inch
		expect(t.major.map((m) => m.label)).toEqual(['0', '1', '2']);
		expect(t.minor).toHaveLength(6);
	});

	it('stays bounded when zoomed far out', () => {
		const t = rulerTicks(0, 1e6, 0, 0.0001, 'mm');
		expect(t.major.length + t.minor.length).toBeLessThanOrEqual(5001);
	});
});
