import type { AnyModule, ShapeModule } from '../model/schema';
import { type Prim, shapeDrawing } from '../model/shapes';
import type { ModuleRenderer } from './types';

/** Draws the shape's SVG into `host`. Shared by the module renderer and the zoomed-out outline. */
export function drawShape(host: HTMLElement, m: ShapeModule) {
	host.empty();
	const d = shapeDrawing(m);
	// User units are millimetres, so storage and drawing agree (hard rule 4).
	const svg = host.createSvg('svg', { cls: 'pw-shape-svg', attr: { viewBox: `0 0 ${m.w} ${m.h}`, preserveAspectRatio: 'none' } });
	svg.setCssProps({ '--pw-sw': String(d.stroke.width) });
	const round = d.body.t === 'line' || d.stroke.dash === 'dotted';
	const outline = d.stroke.width > 0;
	const paint = (prim: Prim, fill: string | undefined, stroke: boolean, cls: string) => {
		const el = primElement(svg, prim, cls);
		el.setAttribute('fill', fill ?? 'none');
		if (!stroke) return el;
		el.setAttribute('stroke', d.stroke.color);
		el.setAttribute('stroke-width', String(d.stroke.width));
		el.setAttribute('stroke-linejoin', d.body.t === 'rect' ? 'miter' : 'round');
		if (round) el.setAttribute('stroke-linecap', 'round');
		if (d.dashArray) el.setAttribute('stroke-dasharray', d.dashArray);
		return el;
	};
	// Invisible, wider copy of the outline: only painted pixels take clicks, and a thin line needs a fat target.
	primElement(svg, d.body, 'pw-shape-hit');
	paint(d.body, d.body.t === 'line' ? undefined : d.fill, outline, 'pw-shape-paint');
	for (const h of d.heads) {
		const el = paint(h.prim, h.filled ? d.stroke.color : undefined, true, 'pw-shape-paint');
		el.removeAttribute('stroke-dasharray');
		el.setAttribute('stroke-linecap', 'round');
		el.setAttribute('stroke-linejoin', 'round');
	}
}

function primElement(svg: SVGElement, p: Prim, cls: string): SVGElement {
	switch (p.t) {
		case 'rect':
			return svg.createSvg('rect', { cls, attr: { x: p.x, y: p.y, width: p.w, height: p.h, rx: p.rx } });
		case 'ellipse':
			return svg.createSvg('ellipse', { cls, attr: { cx: p.cx, cy: p.cy, rx: p.rx, ry: p.ry } });
		case 'line':
			return svg.createSvg('line', { cls, attr: { x1: p.x1, y1: p.y1, x2: p.x2, y2: p.y2 } });
		case 'circle':
			return svg.createSvg('circle', { cls, attr: { cx: p.cx, cy: p.cy, r: p.r } });
		case 'poly': {
			const points = p.points.map(([x, y]) => `${x},${y}`).join(' ');
			return svg.createSvg(p.close ? 'polygon' : 'polyline', { cls, attr: { points } });
		}
	}
}

/** A shape is a few SVG nodes: no source files, no async work, nothing to cancel. */
export class ShapeRenderer implements ModuleRenderer {
	constructor(private el: HTMLElement) {}

	dependencies(): ReadonlySet<string> {
		return new Set();
	}

	rendered(): Promise<void> {
		return Promise.resolve();
	}

	render(m: AnyModule) {
		drawShape(this.el, m as ShapeModule);
	}

	destroy() {
		this.el.empty();
	}
}
