import { fitRect, intersects, type Rect } from './geometry';
import { displayedCropSize, FULL_PAGE } from './pdfGeometry';
import { type AnyModule, MAX_PAGE_SIDE_MM, type Page, type PdfModule } from './schema';
import { contentBox, moduleOpacity, outerRadius } from './style';
import { mmToPt } from './units';

// Pure decisions for export (SPEC 9.1).

/** Modules in draw order: by z, then array order. */
export function drawOrder(modules: readonly AnyModule[]): AnyModule[] {
	return modules.map((m, i) => ({ m, i })).sort((a, b) => (a.m.z ?? 0) - (b.m.z ?? 0) || a.i - b.i).map((x) => x.m);
}

/**
 * Which PDF modules are drawn as vector in stage 2. Vector content is drawn after the HTML layer,
 * so it lands on top of everything; a module with anything stacked above it falls back to raster.
 * Colour filters (a module's `invert`, the ink saver) only work on pixels, so they force raster too.
 */
export function vectorModules(page: Page, quality: 'best' | 'small', inkSaver = false): Set<string> {
	const out = new Set<string>();
	if (quality === 'small' || inkSaver) return out;
	const ordered = drawOrder(page.modules);
	ordered.forEach((m, i) => {
		if (m.type !== 'pdf') return;
		const mode = (m as PdfModule).render ?? 'auto';
		if (mode === 'raster' || (m as PdfModule).invert) return;
		const covered = ordered.slice(i + 1).some((above) => intersects(m, above));
		if (mode === 'vector' || !covered) out.add(m.id);
	});
	return out;
}

/**
 * Forced-vector PDF modules ("In exports: Vector") with something stacked above them. Vector content is
 * drawn last, so it covers those items in the export although the board shows them on top.
 */
export function coveringVectorModules(page: Page): PdfModule[] {
	const ordered = drawOrder(page.modules);
	const forced = (m: AnyModule): m is PdfModule => m.type === 'pdf' && (m as PdfModule).render === 'vector' && !(m as PdfModule).invert;
	return ordered.flatMap((m, i) => (forced(m) && ordered.slice(i + 1).some((above) => intersects(m, above)) ? [m] : []));
}

/** Pages that can't be a single PDF page (SPEC 9.2 guardrail). Tiling comes in M2. */
export function oversizedPages(pages: readonly Page[]): Page[] {
	return pages.filter((p) => p.w > MAX_PAGE_SIDE_MM || p.h > MAX_PAGE_SIDE_MM);
}

/**
 * Where a vector PDF module's content goes on its printed page, in PDF units (y up).
 * `pageHeightPt` is the printed page's real height: Chromium rounds page sizes slightly (spike S1),
 * and measuring from the real top edge keeps content aligned with the HTML layer.
 */
export function vectorTarget(m: PdfModule, sourcePage: { w: number; h: number; rotate: number }, pageHeightPt: number): { content: Rect; clip: Rect } {
	const crop = m.crop ?? FULL_PAGE;
	const shown = displayedCropSize({ w: sourcePage.w, h: sourcePage.h }, sourcePage.rotate, crop, m.rotation ?? 0);
	// Inside border and padding, exactly like the on-screen renderer.
	const cb = contentBox(m);
	const box = { x: m.x + cb.x, y: m.y + cb.y, w: cb.w, h: cb.h };
	const placed = fitRect(shown.w / shown.h, box, m.fit ?? 'contain');
	const toPdf = (r: Rect): Rect => ({ x: mmToPt(r.x), y: pageHeightPt - mmToPt(r.y + r.h), w: mmToPt(r.w), h: mmToPt(r.h) });
	return { content: toPdf(placed), clip: toPdf(box) };
}

/**
 * How the screen frames a module's content beyond its content box, for vector PDF content drawn in stage 2:
 * the module's opacity, and the rounded area inside its border that the browser clips children to (CSS
 * `overflow: hidden` with `border-radius` clips at the padding edge, with the radius less the border width).
 * PDF units (y up), like `vectorTarget`.
 */
export function vectorFrame(m: AnyModule, pageHeightPt: number): { opacity: number; clip: Rect; radius: number } {
	const bw = Math.max(0, Math.min(m.style?.border?.width ?? 0, m.w / 2, m.h / 2));
	const box = { x: m.x + bw, y: m.y + bw, w: m.w - 2 * bw, h: m.h - 2 * bw };
	const radius = Math.min(Math.max(0, outerRadius(m) - bw), box.w / 2, box.h / 2);
	return {
		opacity: moduleOpacity(m),
		clip: { x: mmToPt(box.x), y: pageHeightPt - mmToPt(box.y + box.h), w: mmToPt(box.w), h: mmToPt(box.h) },
		radius: mmToPt(radius),
	};
}

/** Split pages into print batches, so a large board is never all in the DOM at once (hard rule 9). */
export function batches<T>(items: readonly T[], size: number): T[][] {
	const out: T[][] = [];
	for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
	return out;
}
