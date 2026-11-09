import type { Rect } from './geometry';
import type { AnyModule } from './schema';
import { tintColor } from './tint';

/**
 * A card colour (style.tint) draws a coloured edge inside the box; content keeps at least this much room
 * from it (mm), or text sat on the edge. Also the card's smallest corner radius (mm).
 */
export const TINT_PADDING = 1.5;
export const TINT_RADIUS = 1.5;

/** Padding inside the border (mm): the module's own, or at least TINT_PADDING on a card. */
export function effectivePadding(m: AnyModule): number {
	const p = Math.max(0, m.style?.padding ?? 0);
	return tintColor(m.style?.tint) ? Math.max(p, TINT_PADDING) : p;
}

/** Space between a module's edge and its content: border width plus padding (mm). */
export function moduleInset(m: AnyModule): number {
	return Math.max(0, m.style?.border?.width ?? 0) + effectivePadding(m);
}

/** Corner radius of the module's outer edge (mm), as CSS draws it: cards are always a little rounded. */
export function outerRadius(m: AnyModule): number {
	const r = Math.max(0, m.style?.border?.radius ?? 0);
	return tintColor(m.style?.tint) ? Math.max(r, TINT_RADIUS) : r;
}

/** Module opacity, 0–1 (1 when unset or invalid). */
export function moduleOpacity(m: AnyModule): number {
	const o = m.style?.opacity;
	return typeof o === 'number' && Number.isFinite(o) ? Math.min(1, Math.max(0, o)) : 1;
}

/**
 * Where a module's content goes, relative to the module's top-left (mm). Shared by screen
 * rendering and export, so both place content identically. Never collapses below 1 mm.
 */
export function contentBox(m: AnyModule): Rect {
	const i = Math.min(moduleInset(m), (Math.min(m.w, m.h) - 1) / 2);
	return { x: i, y: i, w: m.w - 2 * i, h: m.h - 2 * i };
}

/** A scroll offset (mm) kept inside what the content allows: 0 up to the part of it that doesn't fit. */
export function clampScroll(scroll: number, contentH: number, boxH: number): number {
	const max = Math.max(0, contentH - boxH);
	return Math.min(max, Math.max(0, Number.isFinite(scroll) ? scroll : 0));
}

/** Effective text scale of a module: style.fontScale times a note's own `scale`. */
export function textScale(m: AnyModule): number {
	const fontScale = m.style?.fontScale ?? 1;
	const noteScale = m.type === 'note' && typeof m.scale === 'number' ? m.scale : 1;
	return fontScale > 0 && noteScale > 0 ? fontScale * noteScale : 1;
}
