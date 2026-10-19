import type { Rect } from './geometry';
import type { Crop } from './schema';

// Geometry for PDF modules, shared by on-screen rendering and vector export. Pure.
//
// A crop is normalized to the page *as displayed* (the PDF's own /Rotate applied, SPEC 5.3).
// Vector export embeds the page in its unrotated user space, so crops must be mapped back.

export type QuarterTurn = 0 | 90 | 180 | 270;

export const FULL_PAGE: Crop = [0, 0, 1, 1];

export function normalizeRotation(deg: number): QuarterTurn {
	const r = (((Math.round(deg / 90) * 90) % 360) + 360) % 360;
	return r as QuarterTurn;
}

/** Size of the cropped region after the page's own rotation and then the module's rotation. */
export function displayedCropSize(pageBox: { w: number; h: number }, pageRotate: number, crop: Crop, moduleRotation: number) {
	const swapPage = normalizeRotation(pageRotate) % 180 !== 0;
	const dw = swapPage ? pageBox.h : pageBox.w;
	const dh = swapPage ? pageBox.w : pageBox.h;
	const w = (crop[2] - crop[0]) * dw;
	const h = (crop[3] - crop[1]) * dh;
	return normalizeRotation(moduleRotation) % 180 !== 0 ? { w: h, h: w } : { w, h };
}

export interface UserBox {
	left: number;
	bottom: number;
	right: number;
	top: number;
}

/**
 * Map a displayed-page crop to a box in the page's unrotated user space (PDF units, y up).
 * `box` is the page's crop box (x, y = bottom-left). /Rotate turns the page clockwise for display.
 */
export function cropToUserBox(box: { x: number; y: number; w: number; h: number }, pageRotate: number, crop: Crop): UserBox {
	const [u0, v0, u1, v1] = crop;
	const { x, y, w, h } = box;
	switch (normalizeRotation(pageRotate)) {
		case 0:
			return { left: x + u0 * w, right: x + u1 * w, bottom: y + h - v1 * h, top: y + h - v0 * h };
		case 90:
			return { left: x + v0 * w, right: x + v1 * w, bottom: y + u0 * h, top: y + u1 * h };
		case 180:
			return { left: x + w - u1 * w, right: x + w - u0 * w, bottom: y + v0 * h, top: y + v1 * h };
		case 270:
			return { left: x + w - v1 * w, right: x + w - v0 * w, bottom: y + h - u1 * h, top: y + h - u0 * h };
	}
}

export interface DrawPlacement {
	x: number;
	y: number;
	xScale: number;
	yScale: number;
	/** Counter-clockwise degrees, as pdf-lib's drawPage expects. */
	rotate: number;
}

/**
 * Where to draw an embedded (unrotated) region of size `src` so that, turned clockwise by
 * `rotation`, it exactly fills `target` (PDF units, y up). pdf-lib rotates around the draw origin,
 * so the origin moves to whichever target corner the region's bottom-left lands on.
 */
export function drawPlacement(src: { w: number; h: number }, rotation: number, target: Rect): DrawPlacement {
	const r = normalizeRotation(rotation);
	const swap = r % 180 !== 0;
	const xScale = target.w / (swap ? src.h : src.w);
	const yScale = target.h / (swap ? src.w : src.h);
	const { x, y, w, h } = target;
	// For a clockwise quarter turn, scales apply to the region's own axes, so swap them back.
	const [sx, sy] = swap ? [yScale, xScale] : [xScale, yScale];
	switch (r) {
		case 0:
			return { x, y, xScale: sx, yScale: sy, rotate: 0 };
		case 90:
			return { x, y: y + h, xScale: sx, yScale: sy, rotate: -90 };
		case 180:
			return { x: x + w, y: y + h, xScale: sx, yScale: sy, rotate: -180 };
		case 270:
			return { x: x + w, y, xScale: sx, yScale: sy, rotate: -270 };
	}
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** Crop spanning two points (normalized, any order), clamped to the page; null if too small. */
export function cropFromPoints(a: { x: number; y: number }, b: { x: number; y: number }, min = 0.01): Crop | null {
	const x0 = clamp01(Math.min(a.x, b.x)), x1 = clamp01(Math.max(a.x, b.x));
	const y0 = clamp01(Math.min(a.y, b.y)), y1 = clamp01(Math.max(a.y, b.y));
	return x1 - x0 < min || y1 - y0 < min ? null : [x0, y0, x1, y1];
}

/** Move a crop by (dx, dy), keeping its size and staying inside the page. */
export function moveCrop(c: Crop, dx: number, dy: number): Crop {
	const w = c[2] - c[0], h = c[3] - c[1];
	const x0 = Math.min(1 - w, Math.max(0, c[0] + dx));
	const y0 = Math.min(1 - h, Math.max(0, c[1] + dy));
	return [x0, y0, x0 + w, y0 + h];
}

/** Round to 5 decimals: far below a pixel on any real page, and keeps the JSON readable. */
export function tidyCrop(c: Crop): Crop {
	return c.map((v) => Number(v.toFixed(5))) as Crop;
}
