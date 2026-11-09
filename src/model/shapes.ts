import type { Point, Rect } from './geometry';
import type { HeadKind, ShapeKind, ShapeModule } from './schema';

// Simple shapes (rectangle, ellipse, line, arrow). Everything here is millimetres relative to the
// module's top-left; the renderer turns the primitives into SVG, so screen, print and PNG agree.
//
// A line is stored as its box plus two endpoints given as fractions of that box (`p1`, `p2`). A box
// can't be empty (it must stay selectable), so a horizontal line sits in a thin box and its points
// at half height. The same fields serve every angle, and box handles, align and snapping all work.

export const SHAPE_KINDS: readonly ShapeKind[] = ['rect', 'ellipse', 'line'];
export const HEAD_KINDS: readonly HeadKind[] = ['none', 'arrow', 'open', 'dot'];

/** An outline with no colour of its own takes the text ink, so it shows on dark pages too (model/contrast). */
export const DEFAULT_STROKE_COLOR = 'currentColor';
export const DEFAULT_STROKE_WIDTH = 0.5;
/** Thinnest box a line may have along an axis (mm), so a horizontal line still has something to select. */
export const LINE_MIN_BOX = 1;
/** Colours offered in menus; any CSS colour is accepted in the file. */
export const SHAPE_COLORS: readonly (readonly [string, string])[] = [
	['Black', '#222222'],
	['Grey', '#868e96'],
	['White', '#ffffff'],
	['Red', '#e03131'],
	['Orange', '#f08c00'],
	['Yellow', '#fcc419'],
	['Green', '#2f9e44'],
	['Blue', '#1971c2'],
	['Purple', '#9c36b5'],
];
export const STROKE_WIDTHS: readonly (readonly [string, number])[] = [
	['Hairline', 0.25],
	['Thin', 0.5],
	['Medium', 1],
	['Thick', 2],
	['Heavy', 4],
];
export const DASH_LABELS = { solid: 'Solid', dashed: 'Dashed', dotted: 'Dotted' } as const;
export const HEAD_LABELS: Record<HeadKind, string> = { none: 'None', arrow: 'Arrow', open: 'Open arrow', dot: 'Dot' };

export interface ResolvedStroke {
	color: string;
	/** 0 means no outline. */
	width: number;
	dash: 'solid' | 'dashed' | 'dotted';
}

export function strokeOf(m: ShapeModule): ResolvedStroke {
	const s = m.stroke;
	return {
		color: typeof s?.color === 'string' && s.color ? s.color : DEFAULT_STROKE_COLOR,
		width: typeof s?.width === 'number' && s.width >= 0 ? s.width : DEFAULT_STROKE_WIDTH,
		dash: s?.dash === 'dashed' || s?.dash === 'dotted' ? s.dash : 'solid',
	};
}

export type Prim =
	| { t: 'rect'; x: number; y: number; w: number; h: number; rx: number }
	| { t: 'ellipse'; cx: number; cy: number; rx: number; ry: number }
	| { t: 'line'; x1: number; y1: number; x2: number; y2: number }
	| { t: 'poly'; points: [number, number][]; close: boolean }
	| { t: 'circle'; cx: number; cy: number; r: number };

export interface ShapeDrawing {
	/** The outline-and-fill shape (a rect or ellipse), or the line itself. */
	body: Prim;
	/** Arrowheads; filled ones are painted with the stroke colour. */
	heads: { prim: Prim; filled: boolean }[];
	stroke: ResolvedStroke;
	fill: string | undefined;
	/** SVG dash pattern in mm, absent for a solid stroke. */
	dashArray: string | undefined;
}

const round = (n: number) => Math.round(n * 10_000) / 10_000;

export function isLine(m: { type: string; shape?: unknown }): boolean {
	return m.type === 'shape' && m.shape === 'line';
}

/** A line with an arrowhead (filled or open) at either end: named as an arrow. A dot is just a decorated line. */
export function isArrow(m: ShapeModule): boolean {
	const pointed = (h: HeadKind | undefined) => h === 'arrow' || h === 'open';
	return m.shape === 'line' && (pointed(m.startHead) || pointed(m.endHead));
}

/** The line's endpoints in module millimetres. Absent points mean the box's diagonal. */
export function linePoints(m: ShapeModule): [Point, Point] {
	const [ax, ay] = validPoint(m.p1) ?? [0, 0];
	const [bx, by] = validPoint(m.p2) ?? [1, 1];
	return [
		{ x: ax * m.w, y: ay * m.h },
		{ x: bx * m.w, y: by * m.h },
	];
}

function validPoint(p: unknown): [number, number] | undefined {
	return Array.isArray(p) && p.length === 2 && p.every((n) => typeof n === 'number' && Number.isFinite(n)) ? (p as [number, number]) : undefined;
}

/**
 * The box and endpoint fractions for a line between two points (in the same space, page mm). Along an
 * axis where the points are closer than `LINE_MIN_BOX` the box is widened around them.
 */
export function lineFromEnds(a: Point, b: Point): Pick<ShapeModule, 'x' | 'y' | 'w' | 'h' | 'p1' | 'p2'> {
	const axis = (lo: number, hi: number): [number, number] => {
		const mid = (lo + hi) / 2;
		return hi - lo < LINE_MIN_BOX ? [mid - LINE_MIN_BOX / 2, LINE_MIN_BOX] : [lo, hi - lo];
	};
	const [x, w] = axis(Math.min(a.x, b.x), Math.max(a.x, b.x));
	const [y, h] = axis(Math.min(a.y, b.y), Math.max(a.y, b.y));
	const frac = (p: Point): [number, number] => [round((p.x - x) / w), round((p.y - y) / h)];
	return { x: round(x), y: round(y), w: round(w), h: round(h), p1: frac(a), p2: frac(b) };
}

/** `p` moved onto the nearest multiple of `stepDeg` around `anchor`, keeping its distance. */
export function constrainAngle(anchor: Point, p: Point, stepDeg = 45): Point {
	const dx = p.x - anchor.x, dy = p.y - anchor.y;
	const len = Math.hypot(dx, dy);
	if (len === 0) return p;
	const step = (stepDeg * Math.PI) / 180;
	const angle = Math.round(Math.atan2(dy, dx) / step) * step;
	return { x: anchor.x + len * Math.cos(angle), y: anchor.y + len * Math.sin(angle) };
}

/** The rectangle spanned by two corners, normalised so w and h are never negative. */
export function boxBetween(a: Point, b: Point): Rect {
	return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) };
}

/** `p` moved so the box from `anchor` is a square (the larger side wins), on the side `p` is on. */
export function squareUp(anchor: Point, p: Point): Point {
	const side = Math.max(Math.abs(p.x - anchor.x), Math.abs(p.y - anchor.y));
	return { x: anchor.x + (p.x < anchor.x ? -side : side), y: anchor.y + (p.y < anchor.y ? -side : side) };
}

/** Size of an arrowhead for a stroke width (mm). */
export function headLength(strokeWidth: number): number {
	return Math.max(3, strokeWidth * 5);
}

/** What the Shape menu offers: the fields a new shape starts with (before it gets its box). */
export interface ShapePreset {
	id: string;
	label: string;
	icon: string;
	fields: Pick<ShapeModule, 'shape'> & Partial<Pick<ShapeModule, 'radius' | 'endHead'>>;
}

export const SHAPE_PRESETS: readonly ShapePreset[] = [
	{ id: 'rect', label: 'Rectangle', icon: 'square', fields: { shape: 'rect' } },
	{ id: 'rounded', label: 'Rounded rectangle', icon: 'rectangle-horizontal', fields: { shape: 'rect', radius: 4 } },
	{ id: 'ellipse', label: 'Ellipse', icon: 'circle', fields: { shape: 'ellipse' } },
	{ id: 'line', label: 'Line', icon: 'minus', fields: { shape: 'line' } },
	{ id: 'arrow', label: 'Arrow', icon: 'arrow-up-right', fields: { shape: 'line', endHead: 'arrow' } },
];

/** Size of a shape placed by a plain click (mm). */
export const CLICK_SIZE = { w: 40, h: 30 } as const;
/** Smallest box a rectangle or ellipse drawn by dragging gets (mm). */
const MIN_DRAWN = 1;

type Geometry = Pick<ShapeModule, 'x' | 'y' | 'w' | 'h' | 'p1' | 'p2'>;

/**
 * The geometry of a shape dragged from `origin` to `end` (page mm). `constrain` (Shift) makes boxes
 * square and lines a multiple of 45°.
 */
export function shapeFromDrag(kind: ShapeKind, origin: Point, end: Point, constrain: boolean): Geometry {
	if (kind === 'line') return lineFromEnds(origin, constrain ? constrainAngle(origin, end) : end);
	const r = boxBetween(origin, constrain ? squareUp(origin, end) : end);
	return { x: round(r.x), y: round(r.y), w: round(Math.max(r.w, MIN_DRAWN)), h: round(Math.max(r.h, MIN_DRAWN)) };
}

/** The geometry of a shape placed by a click at `at`: default size, centred there, kept on the page. */
export function shapeAtClick(kind: ShapeKind, at: Point, page: { w: number; h: number }): Geometry {
	const w = Math.min(CLICK_SIZE.w, page.w), h = Math.min(CLICK_SIZE.h, page.h);
	const x = Math.min(Math.max(at.x - w / 2, 0), page.w - w);
	const y = Math.min(Math.max(at.y - h / 2, 0), page.h - h);
	if (kind === 'line') return lineFromEnds({ x, y: y + h / 2 }, { x: x + w, y: y + h / 2 });
	return { x: round(x), y: round(y), w: round(w), h: round(h) };
}

/** The same shape as another kind, keeping its look. Lines get their diagonal; boxes lose line-only fields. */
export function convertShape(m: ShapeModule, kind: ShapeKind): ShapeModule {
	if (m.shape === kind) return m;
	const next: ShapeModule = { ...m, shape: kind };
	if (kind === 'line') {
		next.p1 = [0, 0];
		next.p2 = [1, 1];
	} else {
		delete next.p1;
		delete next.p2;
		delete next.startHead;
		delete next.endHead;
	}
	if (kind !== 'rect') delete next.radius;
	return next;
}

function dashArray(stroke: ResolvedStroke): string | undefined {
	// Round caps turn a zero-length dash into a dot; the unit keeps hairlines readable.
	const u = Math.max(stroke.width, 0.5);
	if (stroke.dash === 'dashed') return `${round(u * 5)} ${round(u * 3)}`;
	if (stroke.dash === 'dotted') return `0 ${round(u * 2.2)}`;
	return undefined;
}

export function shapeDrawing(m: ShapeModule): ShapeDrawing {
	const stroke = strokeOf(m);
	const base = { stroke, fill: typeof m.fill === 'string' && m.fill ? m.fill : undefined, dashArray: dashArray(stroke) };
	if (m.shape === 'line') return { ...base, ...lineDrawing(m, stroke) };
	// The outline is centred on the path, so the path is pulled in by half the stroke to stay in the box.
	const half = stroke.width / 2;
	const w = Math.max(0.01, m.w - stroke.width), h = Math.max(0.01, m.h - stroke.width);
	if (m.shape === 'ellipse') return { ...base, body: { t: 'ellipse', cx: m.w / 2, cy: m.h / 2, rx: w / 2, ry: h / 2 }, heads: [] };
	const radius = typeof m.radius === 'number' && m.radius > 0 ? Math.min(m.radius, w / 2, h / 2) : 0;
	return { ...base, body: { t: 'rect', x: half, y: half, w, h, rx: radius }, heads: [] };
}

function lineDrawing(m: ShapeModule, stroke: ResolvedStroke): Pick<ShapeDrawing, 'body' | 'heads'> {
	let [a, b] = linePoints(m);
	const length = Math.hypot(b.x - a.x, b.y - a.y);
	const heads: ShapeDrawing['heads'] = [];
	// Heads never take more than a third of the line, so a short arrow still reads as an arrow.
	const size = Math.min(headLength(stroke.width), length / 3);
	const add = (at: Point, from: Point, kind: HeadKind | undefined): Point => {
		if (!kind || kind === 'none' || length === 0) return at;
		const ux = (at.x - from.x) / length, uy = (at.y - from.y) / length;
		return placeHead(heads, at, ux, uy, kind, size, stroke.width);
	};
	// A filled head replaces the end of the line, so the (round) stroke does not poke through its tip.
	const nextA = add(a, b, m.startHead);
	const nextB = add(b, a, m.endHead);
	a = nextA;
	b = nextB;
	return { body: { t: 'line', x1: a.x, y1: a.y, x2: b.x, y2: b.y }, heads };
}

/** Adds a head whose tip is at `tip`, pointing along (ux, uy); returns where the line should end. */
function placeHead(out: ShapeDrawing['heads'], tip: Point, ux: number, uy: number, kind: HeadKind, size: number, sw: number): Point {
	const baseX = tip.x - ux * size, baseY = tip.y - uy * size;
	const wing = size * 0.4;
	const left: [number, number] = [baseX - uy * wing, baseY + ux * wing];
	const right: [number, number] = [baseX + uy * wing, baseY - ux * wing];
	if (kind === 'arrow') {
		out.push({ prim: { t: 'poly', points: [[tip.x, tip.y], left, right], close: true }, filled: true });
		return { x: tip.x - ux * size * 0.8, y: tip.y - uy * size * 0.8 };
	}
	if (kind === 'open') {
		out.push({ prim: { t: 'poly', points: [left, [tip.x, tip.y], right], close: false }, filled: false });
		return tip;
	}
	const r = Math.max(1, sw * 1.6);
	out.push({ prim: { t: 'circle', cx: tip.x, cy: tip.y, r }, filled: true });
	return tip;
}
