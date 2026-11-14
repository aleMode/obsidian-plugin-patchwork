import { describe, expect, it } from 'vitest';
import { blockAround, cropAroundBlock, type TextBox } from '../../src/model/textBlocks';

// A page with a heading, a two-line paragraph, a blank line, another paragraph, and a second column.
const line = (x0: number, x1: number, y: number): TextBox => ({ x0, x1, y0: y, y1: y + 0.02 });
const page: TextBox[] = [
	line(0.1, 0.4, 0.1), // heading
	line(0.1, 0.25, 0.15), line(0.27, 0.45, 0.15), // paragraph 1, line 1 (two words)
	line(0.1, 0.42, 0.175), // paragraph 1, line 2
	line(0.1, 0.44, 0.24), // paragraph 2 (after a blank line)
	line(0.6, 0.9, 0.15), line(0.6, 0.88, 0.175), // second column
];

describe('blockAround', () => {
	it('grows from the clicked word to its paragraph, not across blank lines or into the next column', () => {
		const close = (b: TextBox | null, want: TextBox) => (['x0', 'y0', 'x1', 'y1'] as const).forEach((k) => expect(b?.[k]).toBeCloseTo(want[k]));
		close(blockAround(page, { x: 0.3, y: 0.16 }), { x0: 0.1, y0: 0.15, x1: 0.45, y1: 0.195 });
		close(blockAround(page, { x: 0.7, y: 0.18 }), { x0: 0.6, y0: 0.15, x1: 0.9, y1: 0.195 });
	});

	it('is null away from any text', () => {
		expect(blockAround(page, { x: 0.5, y: 0.6 })).toBeNull();
	});

	it('crops around the block with a margin, inside the page', () => {
		expect(cropAroundBlock({ x0: 0, y0: 0.5, x1: 0.3, y1: 0.6 })).toEqual([0, 0.49, 0.31, 0.61]);
	});
});
