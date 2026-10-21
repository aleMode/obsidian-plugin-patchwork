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

const MIN_ZOOM = 0.02;
export const MAX_ZOOM = 8;

/** What the zoom buttons step through: 25-point steps through the useful range, coarser above, finer below. */
export const ZOOM_STOPS = [0.05, 0.1, 0.15, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4, 6, 8];

/** The next stop above (`dir` 1) or below (-1) `zoom`; the zoom limits when there is none. */
export function nextZoomStop(zoom: number, dir: 1 | -1): number {
	// A zoom that only looks like a stop (99.96 % after a wheel zoom) still steps away from it.
	if (dir === 1) return ZOOM_STOPS.find((s) => s > zoom * 1.005) ?? MAX_ZOOM;
	return [...ZOOM_STOPS].reverse().find((s) => s < zoom / 1.005) ?? MIN_ZOOM;
}

/** One wheel event stays within +-10 %: a mouse notch (deltas of 100 and up) is that big, a trackpad pinch sends small deltas and is not capped. */
const MAX_WHEEL_STEP = Math.log(1.1);

/** Zoom factor of a wheel event with the given vertical delta (px): proportional, capped per event. */
export function wheelZoomFactor(delta: number): number {
	return Math.exp(clamp(-delta * 0.002, -MAX_WHEEL_STEP, MAX_WHEEL_STEP));
}

export function boardToScreen(c: Camera, p: Point): Point {
	return { x: p.x * PX_PER_MM * c.zoom + c.tx, y: p.y * PX_PER_MM * c.zoom + c.ty };
}

export function screenToBoard(c: Camera, p: Point): Point {
	return { x: (p.x - c.tx) / (PX_PER_MM * c.zoom), y: (p.y - c.ty) / (PX_PER_MM * c.zoom) };
}

/** Zoom to the level `zoom` (exactly, within the limits), keeping the board point under `anchor` (screen px) fixed. */
export function zoomTo(c: Camera, zoom: number, anchor: Point): Camera {
	const z = clamp(zoom, MIN_ZOOM, MAX_ZOOM);
	const k = z / c.zoom;
	return { zoom: z, tx: anchor.x - (anchor.x - c.tx) * k, ty: anchor.y - (anchor.y - c.ty) * k };
}

/** Zoom by `factor`, keeping the board point under `anchor` (screen px) fixed. */
export function zoomAt(c: Camera, factor: number, anchor: Point): Camera {
	return zoomTo(c, c.zoom * factor, anchor);
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

/** The camera showing board point (x, y) at the centre of the viewport, at `zoom`. */
export function cameraCentredOn(p: Point, zoom: number, viewport: { w: number; h: number }): Camera {
	const z = clamp(zoom, MIN_ZOOM, MAX_ZOOM);
	return { zoom: z, tx: viewport.w / 2 - p.x * PX_PER_MM * z, ty: viewport.h / 2 - p.y * PX_PER_MM * z };
}

/** The board point at the centre of the viewport. */
export function cameraCentre(c: Camera, viewport: { w: number; h: number }): Point {
	return screenToBoard(c, { x: viewport.w / 2, y: viewport.h / 2 });
}
