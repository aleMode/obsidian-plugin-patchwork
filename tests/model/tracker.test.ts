import { describe, expect, it } from 'vitest';
import type { TrackerModule } from '../../src/model/schema';
import { boxCount, bump, clickBox, itemsFromText, printedState, stepByKey, toggleItem, trackerValue } from '../../src/model/tracker';

const t = (extra: Partial<TrackerModule>): TrackerModule => ({ id: 'x', type: 'tracker', kind: 'counter', x: 0, y: 0, w: 10, h: 10, ...extra });

describe('tracker', () => {
	it('counters step within their bounds, without float noise', () => {
		expect(bump(t({ value: 3 }), 1).value).toBe(4);
		expect(bump(t({ value: 10, max: 10 }), 1).value).toBe(10);
		expect(bump(t({ min: 0 }), -1).value).toBe(0);
		expect(bump(t({ value: 0.2, step: 0.1 }), 1).value).toBe(0.3);
		expect(trackerValue(t({ min: 5 }))).toBe(5);
	});

	it('boxes fill up to the clicked one; clicking the last filled empties it', () => {
		const b = t({ kind: 'boxes', max: 4, value: 2 });
		expect(clickBox(b, 3).value).toBe(4);
		expect(clickBox(b, 1).value).toBe(1);
		expect(clickBox(b, 0).value).toBe(1);
		expect(clickBox(t({ kind: 'boxes', value: 1 }), 0).value).toBe(0);
		expect(boxCount(t({ kind: 'boxes' }))).toBe(5);
		expect(trackerValue(t({ kind: 'boxes', max: 3, value: 9 }))).toBe(3);
	});

	it('checklist items toggle, and editing the text keeps ticks of unchanged lines', () => {
		const c = t({ kind: 'checklist', items: [{ text: 'a' }, { text: 'b', done: true }] });
		expect(toggleItem(c, 0).items).toEqual([{ text: 'a', done: true }, { text: 'b', done: true }]);
		expect(toggleItem(c, 1).items).toEqual([{ text: 'a' }, { text: 'b' }]);
		expect(itemsFromText('b\n\n c \na', c.items)).toEqual([{ text: 'b', done: true }, { text: 'c' }, { text: 'a' }]);
	});

	it('print blank clears state for exports only', () => {
		const c = t({ kind: 'checklist', printBlank: true, items: [{ text: 'a', done: true }] });
		expect(printedState(c).items).toEqual([{ text: 'a' }]);
		expect(printedState(t({ kind: 'boxes', value: 3, printBlank: true })).value).toBe(0);
		const kept = t({ value: 7 });
		expect(printedState(kept)).toBe(kept);
	});

	it('the + and - keys step a counter and fill or empty one box', () => {
		expect(stepByKey(t({ value: 3 }), 1)?.value).toBe(4);
		expect(stepByKey(t({ kind: 'boxes', max: 4, value: 2 }), 1)?.value).toBe(3);
		expect(stepByKey(t({ kind: 'boxes', max: 4, value: 4 }), 1)?.value).toBe(4);
		expect(stepByKey(t({ kind: 'boxes', max: 4, value: 0 }), -1)?.value).toBe(0);
		expect(stepByKey(t({ kind: 'checklist' }), 1)).toBeNull();
	});
});
