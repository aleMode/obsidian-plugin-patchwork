import { describe, expect, it } from 'vitest';
import type { AnyModule } from '../../src/model/schema';
import { contentBox, moduleInset, textScale } from '../../src/model/style';

const m = (extra: Partial<AnyModule> = {}): AnyModule => ({ id: 'a', type: 'text', markdown: '', x: 0, y: 0, w: 50, h: 30, ...extra });

describe('module style geometry', () => {
	it('inset is border plus padding', () => {
		expect(moduleInset(m())).toBe(0);
		expect(moduleInset(m({ style: { padding: 3, border: { width: 0.5, color: '#000' } } }))).toBe(3.5);
	});

	it('content box is inset on all sides', () => {
		expect(contentBox(m({ style: { padding: 2 } }))).toEqual({ x: 2, y: 2, w: 46, h: 26 });
	});

	it('content box never collapses', () => {
		const box = contentBox(m({ h: 4, style: { padding: 10 } }));
		expect(box.h).toBe(1);
		expect(box.y).toBe(1.5);
	});

	it('text scale combines fontScale and a note scale', () => {
		expect(textScale(m({ style: { fontScale: 0.8 } }))).toBeCloseTo(0.8);
		expect(textScale({ id: 'n', type: 'note', file: 'a.md', x: 0, y: 0, w: 1, h: 1, scale: 0.5, style: { fontScale: 1.2 } })).toBeCloseTo(0.6);
		expect(textScale(m({ style: { fontScale: -1 } }))).toBe(1);
	});
});
