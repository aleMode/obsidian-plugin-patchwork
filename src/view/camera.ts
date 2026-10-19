import type { Point, Rect } from '../model/geometry';
import { clamp } from '../model/geometry';
import { PX_PER_MM } from '../model/units';

// Board camera, pure math (no DOM). Board coordinates are mm; screen coordinates are CSS px
// relative to the viewport's top-left. screen = board * PX_PER_MM * zoom + (tx, ty).

export interface Camera {
	tx: number;
	ty: number;
	zoom: number;
}

export const MIN_ZOOM = 0.02;
export const MAX_ZOOM = 8;

export function boardToScreen(c: Camera, p: Point): Point {
	return { x: p.x * PX_PER_MM * c.zoom + c.tx, y: p.y * PX_PER_MM * c.zoom + c.ty };
}

export function screenToBoard(c: Camera, p: Point): Point {
	return { x: (p.x - c.tx) / (PX_PER_MM * c.zoom), y: (p.y - c.ty) / (PX_PER_MM * c.zoom) };
}

/** Zoom by `factor`, keeping the board point under `anchor` (screen px) fixed. */
export function zoomAt(c: Camera, factor: number, anchor: Point): Camera {
	const zoom = clamp(c.zoom * factor, MIN_ZOOM, MAX_ZOOM);
	const k = zoom / c.zoom;
	return { zoom, tx: anchor.x - (anchor.x - c.tx) * k, ty: anchor.y - (anchor.y - c.ty) * k };
}

export function panBy(c: Camera, dx: number, dy: number): Camera {
	return { ...c, tx: c.tx + dx, ty: c.ty + dy };
}

/** Camera that shows `rect` (mm) centred in a viewport of the given size, with a margin in px. */
export function fitCamera(rect: Rect, viewport: { w: number; h: number }, margin = 40): Camera {
	const availW = Math.max(1, viewport.w - 2 * margin);
	const availH = Math.max(1, viewport.h - 2 * margin);
	const zoom = clamp(Math.min(availW / (rect.w * PX_PER_MM), availH / (rect.h * PX_PER_MM)), MIN_ZOOM, MAX_ZOOM);
	const scale = PX_PER_MM * zoom;
	return { zoom, tx: (viewport.w - rect.w * scale) / 2 - rect.x * scale, ty: (viewport.h - rect.h * scale) / 2 - rect.y * scale };
}

/** The part of the board (mm) visible in a viewport of the given size. */
export function visibleRect(c: Camera, viewport: { w: number; h: number }): Rect {
	const tl = screenToBoard(c, { x: 0, y: 0 });
	const br = screenToBoard(c, { x: viewport.w, y: viewport.h });
	return { x: tl.x, y: tl.y, w: br.x - tl.x, h: br.y - tl.y };
}
