import { describe, expect, it } from 'vitest';
import { newBoardFile, newPage } from '../../src/model/defaults';
import type { ShapeModule } from '../../src/model/schema';
import { serializeBoard } from '../../src/model/serialize';
import {
	boxBetween,
	constrainAngle,
	convertShape,
	isArrow,
	LINE_MIN_BOX,
	lineFromEnds,
	linePoints,
	shapeAtClick,
	shapeDrawing,
	shapeFromDrag,
	squareUp,
	strokeOf,
} from '../../src/model/shapes';
import { parseBoard } from '../../src/model/validate';

const shape = (extra: Partial<ShapeModule> = {}): ShapeModule => ({ id: 's', type: 'shape', shape: 'rect', x: 0, y: 0, w: 40, h: 20, ...extra });

describe('stroke', () => {
	it('falls back to the defaults', () => {
		expect(strokeOf(shape())).toEqual({ color: 'currentColor', width: 0.5, dash: 'solid' });
	});

	it('keeps a stroke width of zero (no outline) and ignores junk', () => {
		expect(strokeOf(shape({ stroke: { width: 0 } })).width).toBe(0);
		expect(strokeOf(shape({ stroke: { width: -1, dash: 'wavy' as 'solid' } }))).toMatchObject({ width: 0.5, dash: 'solid' });
	});
});

describe('boxes', () => {
	it('draws a rectangle inside its box, the outline centred on the path', () => {
		const d = shapeDrawing(shape({ stroke: { width: 2 }, radius: 3 }));
		expect(d.body).toEqual({ t: 'rect', x: 1, y: 1, w: 38, h: 18, rx: 3 });
	});

	it('limits the corner radius to half the shorter side', () => {
		expect(shapeDrawing(shape({ radius: 50 })).body).toMatchObject({ t: 'rect', rx: 9.75 });
	});

	it('draws an ellipse filling the box', () => {
		expect(shapeDrawing(shape({ shape: 'ellipse', stroke: { width: 1 } })).body).toEqual({ t: 'ellipse', cx: 20, cy: 10, rx: 19.5, ry: 9.5 });
	});

	it('survives a box smaller than its outline', () => {
		const d = shapeDrawing(shape({ w: 1, h: 1, stroke: { width: 4 } }));
		expect(d.body).toMatchObject({ w: 0.01, h: 0.01 });
	});

	it('dashes scale with the stroke and dots are zero-length dashes', () => {
		expect(shapeDrawing(shape({ stroke: { width: 1, dash: 'dashed' } })).dashArray).toBe('5 3');
		expect(shapeDrawing(shape({ stroke: { width: 1, dash: 'dotted' } })).dashArray).toBe('0 2.2');
		expect(shapeDrawing(shape()).dashArray).toBeUndefined();
	});
});

describe('lines', () => {
	it('defaults to the box diagonal', () => {
		const [a, b] = linePoints(shape({ shape: 'line', w: 30, h: 10 }));
		expect(a).toEqual({ x: 0, y: 0 });
		expect(b).toEqual({ x: 30, y: 10 });
	});

	it('stores any angle as fractions of the box', () => {
		const g = lineFromEnds({ x: 50, y: 40 }, { x: 10, y: 20 });
		expect(g).toMatchObject({ x: 10, y: 20, w: 40, h: 20, p1: [1, 1], p2: [0, 0] });
	});

	it('gives a horizontal line a thin box with the line through its middle', () => {
		const g = lineFromEnds({ x: 10, y: 30 }, { x: 60, y: 30 });
		expect(g).toMatchObject({ x: 10, y: 29.5, w: 50, h: LINE_MIN_BOX, p1: [0, 0.5], p2: [1, 0.5] });
		const [a, b] = linePoints(shape({ shape: 'line', ...g }));
		expect(a.y).toBeCloseTo(0.5);
		expect(b.y).toBeCloseTo(0.5);
	});

	it('survives a round trip through the box', () => {
		const a = { x: 12.3, y: 45.6 }, b = { x: 78.9, y: 10.1 };
		const m = shape({ shape: 'line', ...lineFromEnds(a, b) });
		const [pa, pb] = linePoints(m);
		expect(m.x + pa.x).toBeCloseTo(a.x, 3);
		expect(m.y + pa.y).toBeCloseTo(a.y, 3);
		expect(m.x + pb.x).toBeCloseTo(b.x, 3);
		expect(m.y + pb.y).toBeCloseTo(b.y, 3);
	});

	it('ignores malformed points', () => {
		const [a] = linePoints(shape({ shape: 'line', p1: [Number.NaN, 0] as unknown as [number, number] }));
		expect(a).toEqual({ x: 0, y: 0 });
	});

	it('an arrow is a line with a head', () => {
		expect(isArrow(shape({ shape: 'line' }))).toBe(false);
		expect(isArrow(shape({ shape: 'line', endHead: 'arrow' }))).toBe(true);
		expect(isArrow(shape({ shape: 'line', startHead: 'none', endHead: 'none' }))).toBe(false);
		expect(isArrow(shape({ shape: 'rect', endHead: 'arrow' }))).toBe(false);
		expect(isArrow(shape({ shape: 'line', startHead: 'dot', endHead: 'dot' }))).toBe(false);
		expect(isArrow(shape({ shape: 'line', startHead: 'open' }))).toBe(true);
	});

	it('a filled head pulls the line back from its tip', () => {
		const m = shape({ shape: 'line', w: 50, h: 10, p1: [0, 0.5], p2: [1, 0.5], endHead: 'arrow' });
		const d = shapeDrawing(m);
		expect(d.heads).toHaveLength(1);
		expect(d.heads[0]!.filled).toBe(true);
		const body = d.body as { x2: number; y2: number };
		expect(body.x2).toBeLessThan(50);
		expect(body.y2).toBeCloseTo(5);
		const tip = (d.heads[0]!.prim as { points: [number, number][] }).points[0]!;
		expect(tip[0]).toBeCloseTo(50);
	});

	it('an open head and a dot keep the line to the end', () => {
		const open = shapeDrawing(shape({ shape: 'line', w: 50, h: 10, p1: [0, 0.5], p2: [1, 0.5], endHead: 'open' }));
		expect((open.body as { x2: number }).x2).toBe(50);
		expect(open.heads[0]!.filled).toBe(false);
		const dot = shapeDrawing(shape({ shape: 'line', w: 50, h: 10, p1: [0, 0.5], p2: [1, 0.5], startHead: 'dot' }));
		expect(dot.heads[0]!.prim.t).toBe('circle');
	});

	it('heads shrink on a short line', () => {
		const d = shapeDrawing(shape({ shape: 'line', w: 6, h: 1, p1: [0, 0.5], p2: [1, 0.5], endHead: 'arrow', startHead: 'arrow' }));
		const poly = d.heads[0]!.prim as { points: [number, number][] };
		expect(Math.abs(poly.points[0]![0] - poly.points[1]![0])).toBeLessThanOrEqual(2.01);
	});

	it('a zero-length line has no heads', () => {
		const d = shapeDrawing(shape({ shape: 'line', w: 1, h: 1, p1: [0.5, 0.5], p2: [0.5, 0.5], endHead: 'arrow' }));
		expect(d.heads).toEqual([]);
	});
});

describe('drawing by dragging', () => {
	it('boxes follow the drag in any direction', () => {
		expect(shapeFromDrag('rect', { x: 50, y: 40 }, { x: 10, y: 20 }, false)).toEqual({ x: 10, y: 20, w: 40, h: 20 });
	});

	it('Shift squares a box on the side the pointer is on', () => {
		expect(shapeFromDrag('ellipse', { x: 50, y: 40 }, { x: 10, y: 35 }, true)).toEqual({ x: 10, y: 0, w: 40, h: 40 });
		expect(squareUp({ x: 0, y: 0 }, { x: 10, y: 3 })).toEqual({ x: 10, y: 10 });
	});

	it('never makes an empty box', () => {
		expect(shapeFromDrag('rect', { x: 5, y: 5 }, { x: 5, y: 5 }, false)).toMatchObject({ w: 1, h: 1 });
	});

	it('Shift snaps a line to 45° steps and keeps its length', () => {
		const p = constrainAngle({ x: 0, y: 0 }, { x: 30, y: 4 });
		expect(p.y).toBeCloseTo(0);
		expect(p.x).toBeCloseTo(Math.hypot(30, 4));
		const d = constrainAngle({ x: 0, y: 0 }, { x: 10, y: 12 });
		expect(d.x).toBeCloseTo(d.y);
		expect(constrainAngle({ x: 1, y: 1 }, { x: 1, y: 1 })).toEqual({ x: 1, y: 1 });
	});

	it('boxBetween normalises corners', () => {
		expect(boxBetween({ x: 3, y: 9 }, { x: 1, y: 2 })).toEqual({ x: 1, y: 2, w: 2, h: 7 });
	});

	it('a click places the default size centred, kept on the page', () => {
		expect(shapeAtClick('rect', { x: 100, y: 100 }, { w: 210, h: 297 })).toEqual({ x: 80, y: 85, w: 40, h: 30 });
		expect(shapeAtClick('rect', { x: 2, y: 295 }, { w: 210, h: 297 })).toEqual({ x: 0, y: 267, w: 40, h: 30 });
		const line = shapeAtClick('line', { x: 100, y: 100 }, { w: 210, h: 297 });
		expect(line).toMatchObject({ x: 80, w: 40, p1: [0, 0.5], p2: [1, 0.5] });
	});

	it('a click on a tiny page fits the page', () => {
		expect(shapeAtClick('ellipse', { x: 5, y: 5 }, { w: 20, h: 10 })).toEqual({ x: 0, y: 0, w: 20, h: 10 });
	});
});

describe('changing kind', () => {
	it('a box becomes a diagonal line without its corner radius', () => {
		const line = convertShape(shape({ radius: 4, fill: '#fff' }), 'line');
		expect(line).toMatchObject({ shape: 'line', p1: [0, 0], p2: [1, 1], fill: '#fff' });
		expect(line.radius).toBeUndefined();
	});

	it('a line becomes a box without line fields', () => {
		const box = convertShape(shape({ shape: 'line', p1: [0, 0], p2: [1, 1], endHead: 'arrow' }), 'ellipse');
		expect(box.shape).toBe('ellipse');
		expect('p1' in box || 'endHead' in box).toBe(false);
	});

	it('is a no-op for the same kind', () => {
		const m = shape();
		expect(convertShape(m, 'rect')).toBe(m);
	});
});

describe('file format', () => {
	const board = () => {
		const f = newBoardFile();
		const page = newPage(f, { w: 210, h: 297 });
		f.pages.push(page);
		return { f, page };
	};

	it('keeps shapes, including unknown keys, through save and load', () => {
		const { f, page } = board();
		page.modules.push({ ...shape({ shape: 'line', endHead: 'arrow', stroke: { color: '#e03131', width: 1, dash: 'dashed', future: 1 }, ...lineFromEnds({ x: 1, y: 2 }, { x: 30, y: 9 }) }), extra: { a: 1 } });
		const text = serializeBoard(f);
		const parsed = parseBoard(text);
		expect(parsed.ok).toBe(true);
		if (!parsed.ok) return;
		expect(parsed.warnings).toEqual([]);
		expect(serializeBoard(parsed.file)).toBe(text);
		expect(JSON.stringify(parsed.file.pages[0]!.modules[0])).toContain('"future":1');
	});

	it('rejects a shape of an unknown kind, rather than drop it', () => {
		const { f, page } = board();
		page.modules.push(shape({ shape: 'star' as 'rect' }));
		const parsed = parseBoard(serializeBoard(f));
		expect(parsed.ok).toBe(false);
	});

	it('rejects a malformed stroke or head', () => {
		const { f, page } = board();
		page.modules.push(shape({ stroke: { width: 'thick' as unknown as number } }), shape({ id: 't', shape: 'line', endHead: 'spear' as 'arrow' }));
		const parsed = parseBoard(serializeBoard(f));
		expect(parsed.ok).toBe(false);
		if (!parsed.ok) expect(parsed.errors.join('\n')).toMatch(/stroke.*thick[\s\S]*endHead/);
	});
});
