import { bounds, type Point, type Rect } from '../model/geometry';
import { rulerTicks } from '../model/rulers';
import type { DisplayUnit } from '../model/schema';
import { PX_PER_MM } from '../model/units';
import { type Camera, visibleRect } from './camera';

// The rulers and the minimap around the board: canvases redrawn on every camera frame.

interface Colors {
	bg: string;
	fg: string;
	accent: string;
	/** Pages on the minimap in Use mode, where they are faint panels rather than paper. */
	faint: string;
	font: string;
}

/**
 * Theme values for canvas drawing, which takes no CSS variables. Reading styles on every camera
 * frame would restyle the board each frame (perf probe: 7 → 33 ms frames), so they are cached and
 * re-read when the theme changes.
 */
export class ThemeColors {
	private cached: Colors | null = null;

	constructor(private root: HTMLElement) {}

	get(): Colors {
		if (this.cached) return this.cached;
		const style = this.root.win.getComputedStyle(this.root);
		const font = style.getPropertyValue('--font-interface').trim() || 'sans-serif';
		this.cached = { bg: style.getPropertyValue('--background-secondary'), fg: style.getPropertyValue('--text-muted'), accent: style.getPropertyValue('--interactive-accent'), faint: style.getPropertyValue('--background-modifier-border'), font: `9px ${font}` };
		return this.cached;
	}

	reset() {
		this.cached = null;
	}
}

/** Ruler thickness (px); the rulers start this far into the board, past the corner square. */
const THICK = 20;

/** Rulers along the top and left, in the display unit, measured from an origin on the board. */
export class Rulers {
	private top: HTMLCanvasElement;
	private left: HTMLCanvasElement;
	private corner: HTMLElement;

	constructor(container: HTMLElement, private root: HTMLElement, private colors: ThemeColors) {
		this.top = container.createEl('canvas', { cls: 'pw-ruler pw-ruler-top' });
		this.left = container.createEl('canvas', { cls: 'pw-ruler pw-ruler-left' });
		this.corner = container.createDiv({ cls: 'pw-ruler-corner' });
	}

	draw(camera: Camera, origin: Point, unit: DisplayUnit) {
		this.drawOne(this.top, true, camera, origin.x, unit);
		this.drawOne(this.left, false, camera, origin.y, unit);
	}

	private drawOne(canvas: HTMLCanvasElement, horizontal: boolean, camera: Camera, origin: number, unit: DisplayUnit) {
		const colors = this.colors.get();
		const k = PX_PER_MM * camera.zoom;
		const dpr = this.root.win.devicePixelRatio || 1;
		const len = (horizontal ? this.root.clientWidth : this.root.clientHeight) - THICK;
		const w = Math.max(1, Math.round((horizontal ? len : THICK) * dpr));
		const h = Math.max(1, Math.round((horizontal ? THICK : len) * dpr));
		// Resizing reallocates the canvas; only do it when the size really changed.
		if (canvas.width !== w || canvas.height !== h) {
			canvas.width = w;
			canvas.height = h;
		}
		const c = canvas.getContext('2d');
		if (!c) return;
		c.setTransform(dpr, 0, 0, dpr, 0, 0);
		c.fillStyle = colors.bg;
		c.fillRect(0, 0, horizontal ? len : THICK, horizontal ? THICK : len);
		const t = horizontal ? camera.tx : camera.ty;
		const ticks = rulerTicks((THICK - t) / k, (THICK + len - t) / k, origin, k, unit);
		const at = (mm: number) => Math.round(mm * k + t - THICK) + 0.5;
		c.strokeStyle = colors.fg;
		c.fillStyle = colors.fg;
		c.lineWidth = 1;
		c.font = colors.font;
		const tick = (p: number, size: number) => {
			if (horizontal) {
				c.moveTo(p, THICK - size);
				c.lineTo(p, THICK);
			} else {
				c.moveTo(THICK - size, p);
				c.lineTo(THICK, p);
			}
		};
		c.beginPath();
		for (const mm of ticks.minor) tick(at(mm), 4);
		for (const { mm } of ticks.major) tick(at(mm), 10);
		c.stroke();
		for (const { mm, label } of ticks.major) {
			const p = at(mm);
			if (horizontal) c.fillText(label, p + 2, 9);
			else {
				c.save();
				c.translate(9, p + 2);
				c.rotate(Math.PI / 2);
				c.fillText(label, 0, 0);
				c.restore();
			}
		}
	}

	destroy() {
		this.top.remove();
		this.left.remove();
		this.corner.remove();
	}
}

const MAP_W = 180;
const MAP_H = 120;
const MAP_PAD = 6;

/** All pages scaled to fit a small corner map, plus the visible area; click or drag on it to pan there. */
export class Minimap {
	private el: HTMLCanvasElement;
	/** Board area the map shows, and its scale, from the last draw (for click-to-pan). */
	private frame: { x: number; y: number; k: number } | null = null;

	constructor(container: HTMLElement, private root: HTMLElement, private colors: ThemeColors, shown: boolean, centreOn: (p: Point) => void) {
		this.el = container.createEl('canvas', { cls: 'pw-minimap' });
		this.el.toggleClass('is-hidden', !shown);
		const centreAt = (e: PointerEvent) => {
			const f = this.frame;
			if (!f) return;
			const r = this.el.getBoundingClientRect();
			centreOn({ x: (e.clientX - r.left - f.x) / f.k, y: (e.clientY - r.top - f.y) / f.k });
		};
		this.el.addEventListener('pointerdown', (e) => {
			this.el.setPointerCapture(e.pointerId);
			centreAt(e);
		});
		this.el.addEventListener('pointermove', (e) => {
			if (this.el.hasPointerCapture(e.pointerId)) centreAt(e);
		});
	}

	get shown(): boolean {
		return !this.el.hasClass('is-hidden');
	}

	set shown(show: boolean) {
		this.el.toggleClass('is-hidden', !show);
	}

	/** Cheap enough to redraw every camera frame. `faint`: pages as Use mode shows them. */
	draw(pages: readonly (Rect & { background?: string })[], camera: Camera, vp: { w: number; h: number }, faint = false) {
		if (!this.shown) return;
		const area = visibleRect(camera, vp);
		const all = bounds([...pages, area]);
		const dpr = this.root.win.devicePixelRatio || 1;
		if (this.el.width !== MAP_W * dpr) {
			this.el.width = MAP_W * dpr;
			this.el.height = MAP_H * dpr;
		}
		const c = this.el.getContext('2d');
		if (!c || !all) return;
		c.setTransform(dpr, 0, 0, dpr, 0, 0);
		const colors = this.colors.get();
		c.fillStyle = colors.bg;
		c.fillRect(0, 0, MAP_W, MAP_H);
		const k = Math.min((MAP_W - 2 * MAP_PAD) / all.w, (MAP_H - 2 * MAP_PAD) / all.h);
		const ox = MAP_PAD + (MAP_W - 2 * MAP_PAD - all.w * k) / 2 - all.x * k;
		const oy = MAP_PAD + (MAP_H - 2 * MAP_PAD - all.h * k) / 2 - all.y * k;
		this.frame = { x: ox, y: oy, k };
		for (const p of pages) {
			// Each page in its own background, so a dark page doesn't show as white paper.
			c.fillStyle = faint ? colors.faint : p.background ?? '#ffffff';
			c.fillRect(ox + p.x * k, oy + p.y * k, Math.max(1, p.w * k), Math.max(1, p.h * k));
		}
		// A faint edge keeps dark pages visible on the dark map.
		c.strokeStyle = colors.fg;
		c.globalAlpha = 0.5;
		c.lineWidth = 1;
		for (const p of pages) c.strokeRect(ox + p.x * k + 0.5, oy + p.y * k + 0.5, Math.max(1, p.w * k - 1), Math.max(1, p.h * k - 1));
		c.globalAlpha = 1;
		c.strokeStyle = colors.accent;
		c.lineWidth = 1.5;
		c.strokeRect(ox + area.x * k, oy + area.y * k, area.w * k, area.h * k);
	}

	destroy() {
		this.el.remove();
	}
}
