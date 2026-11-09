import type { AnyModule, Page } from './schema';

// Automatic ink (text colour) for pages and modules: light on dark backgrounds, dark on light ones.
// Text with no colour of its own follows the background it sits on, so a dark page or card never
// shows dark-on-dark text, on screen or in exports.

export type Ink = 'light' | 'dark';

export interface Rgba {
	r: number;
	g: number;
	b: number;
	/** 0–1 */
	a: number;
}

const NAMED: Record<string, Rgba> = {
	white: { r: 255, g: 255, b: 255, a: 1 },
	black: { r: 0, g: 0, b: 0, a: 1 },
	transparent: { r: 0, g: 0, b: 0, a: 0 },
};

/** Paper and an Obsidian-like dark background, for when only the ink of a background is known. */
const WHITE: Rgba = NAMED.white!;
const DARK_THEME_BG: Rgba = { r: 30, g: 30, b: 30, a: 1 };

/** Parse the colours the UI writes (#rgb, #rrggbb, #rrggbbaa, rgb()/rgba(), a few names); null for anything else. */
export function parseColor(css: unknown): Rgba | null {
	if (typeof css !== 'string') return null;
	const s = css.trim().toLowerCase();
	if (NAMED[s]) return NAMED[s];
	const hex = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(s);
	if (hex) {
		let h = hex[1]!;
		if (h.length <= 4) h = [...h].map((c) => c + c).join('');
		const n = (i: number) => parseInt(h.slice(i, i + 2), 16);
		return { r: n(0), g: n(2), b: n(4), a: h.length === 8 ? n(6) / 255 : 1 };
	}
	const fn = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/.exec(s);
	if (fn) {
		const alpha = fn[4] === undefined ? 1 : fn[4].endsWith('%') ? parseFloat(fn[4]) / 100 : parseFloat(fn[4]);
		return { r: +fn[1]!, g: +fn[2]!, b: +fn[3]!, a: Math.min(1, Math.max(0, alpha)) };
	}
	return null;
}

/** `top` painted over an opaque `bottom`. */
export function over(top: Rgba, bottom: Rgba): Rgba {
	const mix = (t: number, b: number) => t * top.a + b * (1 - top.a);
	return { r: mix(top.r, bottom.r), g: mix(top.g, bottom.g), b: mix(top.b, bottom.b), a: 1 };
}

/** WCAG relative luminance, 0 (black) – 1 (white). */
export function luminance(c: Rgba): number {
	const ch = (v: number) => {
		const x = v / 255;
		return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
	};
	return 0.2126 * ch(c.r) + 0.7152 * ch(c.g) + 0.0722 * ch(c.b);
}

/** WCAG contrast ratio, 1–21. */
export function contrast(a: Rgba, b: Rgba): number {
	const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
	return (hi + 0.05) / (lo + 0.05);
}

/** The ink that reads best on an opaque background: whichever of black and white contrasts more. */
export function inkOn(bg: Rgba): Ink {
	return contrast(bg, WHITE) > contrast(bg, NAMED.black!) ? 'light' : 'dark';
}

/** The ink and (where known) the colour of a background. */
export interface InkContext {
	ink: Ink;
	bg: Rgba;
}

/** Below this alpha a background is mostly what's under it, so it keeps the ink of its context. */
const SEE_THROUGH = 0.5;

/**
 * A page's background and ink. `themeInk` is the ink of a page with no background of its own: dark on
 * paper, the app theme's otherwise.
 */
export function pageInk(page: Pick<Page, 'background'>, themeInk: Ink): InkContext {
	const base = themeInk === 'dark' ? WHITE : DARK_THEME_BG;
	const own = parseColor(page.background);
	if (!own || own.a < SEE_THROUGH) return { ink: themeInk, bg: own ? over(own, base) : base };
	const bg = over(own, base);
	return { ink: inkOn(bg), bg };
}

/** A module's background and ink on its page: its own background wins when it is mostly opaque. */
export function moduleInk(m: AnyModule, page: InkContext): InkContext {
	const own = parseColor(m.style?.background);
	if (!own || own.a < SEE_THROUGH) return page;
	const bg = over(own, page.bg);
	return { ink: inkOn(bg), bg };
}

/** Contrast below this is hard to read at body text sizes (WCAG asks 4.5 for text; 2 is clearly too faint). */
const UNREADABLE = 2;

/** True when a module's own text colour almost disappears into the background it sits on. */
export function unreadableText(m: AnyModule, page: InkContext): boolean {
	const color = parseColor(m.style?.color);
	if (!color) return false;
	const bg = moduleInk(m, page).bg;
	return contrast(over(color, bg), bg) < UNREADABLE;
}
