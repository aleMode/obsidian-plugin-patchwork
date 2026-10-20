import { describe, expect, it } from 'vitest';
import { tintColor } from '../../src/model/tint';

describe('tintColor', () => {
	it('maps the six presets to theme colours, like Canvas', () => {
		expect(tintColor('1')).toBe('rgb(var(--color-red-rgb))');
		expect(tintColor('6')).toBe('rgb(var(--color-purple-rgb))');
	});

	it('passes custom hex colours through', () => {
		expect(tintColor('#3366CC')).toBe('#3366CC');
	});

	it('ignores anything else (no CSS injection from a hand-edited file)', () => {
		for (const v of [undefined, '', '7', 'red', '#123', 'url(x)', 4]) expect(tintColor(v)).toBeUndefined();
	});
});
