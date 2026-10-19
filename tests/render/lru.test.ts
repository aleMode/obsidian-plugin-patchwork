import { describe, expect, it } from 'vitest';
import { PinnedLru } from '../../src/render/lru';

function make(budget = 10) {
	const disposed: string[] = [];
	const lru = new PinnedLru<string>(budget, (_v, k) => disposed.push(k));
	return { lru, disposed };
}

describe('PinnedLru', () => {
	it('evicts the least recently used unpinned entries over budget', () => {
		const { lru, disposed } = make(10);
		lru.put('a', 'A', 4);
		lru.put('b', 'B', 4);
		lru.release('a');
		lru.release('b');
		lru.acquire('a');
		lru.release('a'); // a is now more recent than b
		lru.put('c', 'C', 4);
		expect(disposed).toEqual(['b']);
		expect(lru.size).toBe(8);
	});

	it('never evicts pinned entries, even over budget', () => {
		const { lru, disposed } = make(5);
		lru.put('a', 'A', 4);
		lru.put('b', 'B', 4);
		expect(disposed).toEqual([]);
		expect(lru.size).toBe(8);
		lru.release('a');
		expect(disposed).toEqual(['a']);
	});

	it('acquire pins and returns the value; available reflects pins', () => {
		const { lru } = make();
		lru.put('a', 'A', 1);
		expect(lru.available('a')).toBe(false);
		lru.release('a');
		expect(lru.available('a')).toBe(true);
		expect(lru.acquire('a')).toBe('A');
		expect(lru.available('a')).toBe(false);
		expect(lru.acquire('missing')).toBeUndefined();
	});

	it('put replaces an unpinned value but not a pinned one', () => {
		const { lru, disposed } = make();
		lru.put('a', 'A1', 1);
		expect(lru.put('a', 'A2', 1)).toBe(false);
		lru.release('a');
		expect(lru.put('a', 'A3', 2)).toBe(true);
		expect(disposed).toEqual(['a']);
		expect(lru.size).toBe(2);
	});

	it('invalidate drops matching unpinned entries only', () => {
		const { lru, disposed } = make(100);
		lru.put('f1|1', 'x', 1);
		lru.put('f1|2', 'y', 1);
		lru.put('f2|1', 'z', 1);
		lru.release('f1|1');
		lru.release('f2|1');
		lru.invalidate((k) => k.startsWith('f1|'));
		expect(disposed).toEqual(['f1|1']);
		expect(lru.count).toBe(2);
	});

	it('shrinking the budget evicts immediately', () => {
		const { lru, disposed } = make(100);
		for (const k of ['a', 'b', 'c']) {
			lru.put(k, k, 10);
			lru.release(k);
		}
		lru.setBudget(15);
		expect(disposed).toEqual(['a', 'b']);
	});
});

describe('bucketResolution', () => {
	it('snaps to half-octave steps of the base', async () => {
		const { bucketResolution } = await import('../../src/render/bitmapCache');
		expect(bucketResolution(4, 4)).toBe(4);
		expect(bucketResolution(4.3, 4)).toBe(4);
		expect(bucketResolution(5.5, 4)).toBeCloseTo(4 * Math.SQRT2);
		expect(bucketResolution(8.2, 4)).toBe(8);
		expect(bucketResolution(1, 4)).toBe(1);
	});
});
