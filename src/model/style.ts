import type { Rect } from './geometry';
import type { AnyModule } from './schema';

/** Space between a module's edge and its content: border width plus padding (mm). */
export function moduleInset(m: AnyModule): number {
	const s = m.style;
	return Math.max(0, (s?.border?.width ?? 0) + (s?.padding ?? 0));
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
