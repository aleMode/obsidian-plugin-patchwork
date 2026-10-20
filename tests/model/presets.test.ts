import { describe, expect, it } from 'vitest';
import { presetFor } from '../../src/model/presets';

describe('presetFor', () => {
	it('matches a preset in portrait and in landscape', () => {
		expect(presetFor({ w: 210, h: 297 })?.id).toBe('A4');
		expect(presetFor({ w: 297, h: 210 })?.id).toBe('A4');
	});

	it('matches square and inherently landscape presets as they are', () => {
		expect(presetFor({ w: 210, h: 210 })?.id).toBe('square');
		expect(presetFor({ w: 338.67, h: 190.5 })?.id).toBe('slide-16-9');
	});

	it('finds nothing for a custom size', () => {
		expect(presetFor({ w: 200, h: 297 })).toBeUndefined();
	});
});
