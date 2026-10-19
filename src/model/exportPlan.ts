import { fitRect, intersects, type Rect } from './geometry';
import { displayedCropSize, FULL_PAGE } from './pdfGeometry';
import { type AnyModule, MAX_PAGE_SIDE_MM, type Page, type PdfModule } from './schema';
import { mmToPt } from './units';

// Pure decisions for export (SPEC 9.1).

/** Modules in draw order: by z, then array order. */
export function drawOrder(modules: readonly AnyModule[]): AnyModule[] {
	return modules.map((m, i) => ({ m, i })).sort((a, b) => (a.m.z ?? 0) - (b.m.z ?? 0) || a.i - b.i).map((x) => x.m);
}

/**
 * Which PDF modules are drawn as vector in stage 2. Vector content is drawn after the HTML layer,
 * so it lands on top of everything; a module with anything stacked above it falls back to raster.
 */
export function vectorModules(page: Page, quality: 'best' | 'small'): Set<string> {
	const out = new Set<string>();
	if (quality === 'small') return out;
	const ordered = drawOrder(page.modules);
	ordered.forEach((m, i) => {
		if (m.type !== 'pdf') return;
		const mode = (m as PdfModule).render ?? 'auto';
		if (mode === 'raster') return;
		const covered = ordered.slice(i + 1).some((above) => intersects(m, above));
		if (mode === 'vector' || !covered) out.add(m.id);
	});
	return out;
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
	const placed = fitRect(shown.w / shown.h, { x: m.x, y: m.y, w: m.w, h: m.h }, m.fit ?? 'contain');
	const toPdf = (r: Rect): Rect => ({ x: mmToPt(r.x), y: pageHeightPt - mmToPt(r.y + r.h), w: mmToPt(r.w), h: mmToPt(r.h) });
	return { content: toPdf(placed), clip: toPdf({ x: m.x, y: m.y, w: m.w, h: m.h }) };
}

/** Split pages into print batches, so a large board is never all in the DOM at once (hard rule 9). */
export function batches<T>(items: readonly T[], size: number): T[][] {
	const out: T[][] = [];
	for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
	return out;
}
