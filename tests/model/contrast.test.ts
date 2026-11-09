import { describe, expect, it } from 'vitest';
import { contrast, inkOn, moduleInk, over, pageInk, parseColor, unreadableText } from '../../src/model/contrast';
import type { AnyModule } from '../../src/model/schema';

const text = (style: AnyModule['style'] = {}): AnyModule => ({ id: 't', type: 'text', markdown: '', x: 0, y: 0, w: 10, h: 10, style });

describe('parseColor', () => {
	it('reads hex, rgb() and a few names', () => {
		expect(parseColor('#fff')).toEqual({ r: 255, g: 255, b: 255, a: 1 });
		expect(parseColor('#26282c')).toEqual({ r: 38, g: 40, b: 44, a: 1 });
		expect(parseColor('#00aa0055')!.a).toBeCloseTo(0x55 / 255);
		expect(parseColor('rgba(10, 20, 30, 0.5)')).toEqual({ r: 10, g: 20, b: 30, a: 0.5 });
		expect(parseColor('rgb(10 20 30 / 50%)')).toEqual({ r: 10, g: 20, b: 30, a: 0.5 });
		expect(parseColor('White')).toEqual({ r: 255, g: 255, b: 255, a: 1 });
	});

	it('gives up on anything else', () => {
		expect(parseColor('var(--x)')).toBeNull();
		expect(parseColor(undefined)).toBeNull();
		expect(parseColor('#12')).toBeNull();
	});
});

describe('ink', () => {
	it('picks light ink on dark backgrounds and dark ink on light ones', () => {
		expect(inkOn(parseColor('#26282c')!)).toBe('light');
		expect(inkOn(parseColor('#224466')!)).toBe('light');
		expect(inkOn(parseColor('#fff3c4')!)).toBe('dark');
		expect(inkOn(parseColor('#d8f0d8')!)).toBe('dark');
	});

	it('composites see-through colours over what is below', () => {
		expect(over({ r: 0, g: 0, b: 0, a: 0.5 }, { r: 255, g: 255, b: 255, a: 1 }).r).toBeCloseTo(127.5);
		expect(contrast({ r: 0, g: 0, b: 0, a: 1 }, { r: 255, g: 255, b: 255, a: 1 })).toBeCloseTo(21);
	});

	it('a page with no background keeps the theme ink', () => {
		expect(pageInk({}, 'dark').ink).toBe('dark');
		expect(pageInk({}, 'light').ink).toBe('light');
		expect(pageInk({ background: '#26282c' }, 'dark').ink).toBe('light');
		// Mostly see-through: still the theme's.
		expect(pageInk({ background: '#00000020' }, 'dark').ink).toBe('dark');
	});

	it('a module follows its own opaque background, else its page', () => {
		const dark = pageInk({ background: '#26282c' }, 'dark');
		expect(moduleInk(text(), dark).ink).toBe('light');
		expect(moduleInk(text({ background: '#fff3c4' }), dark).ink).toBe('dark');
		expect(moduleInk(text({ background: '#fff3c410' }), dark).ink).toBe('light');
	});

	it('flags a hand-set text colour that vanishes into its background', () => {
		const paper = pageInk({}, 'dark');
		expect(unreadableText(text({ color: '#ffffff' }), paper)).toBe(true);
		expect(unreadableText(text({ color: '#ffffff', background: '#224466' }), paper)).toBe(false);
		expect(unreadableText(text({ color: '#c00000' }), paper)).toBe(false);
		expect(unreadableText(text(), paper)).toBe(false);
	});
});
