// Page size presets in mm, portrait (w ≤ h) except where the format is inherently landscape.

export interface PagePreset {
	id: string;
	name: string;
	w: number;
	h: number;
}

export const PAGE_PRESETS: readonly PagePreset[] = [
	{ id: 'A3', name: 'A3', w: 297, h: 420 },
	{ id: 'A4', name: 'A4', w: 210, h: 297 },
	{ id: 'A5', name: 'A5', w: 148, h: 210 },
	{ id: 'A6', name: 'A6', w: 105, h: 148 },
	{ id: 'Letter', name: 'US Letter', w: 215.9, h: 279.4 },
	{ id: 'Legal', name: 'US Legal', w: 215.9, h: 355.6 },
	{ id: 'Tabloid', name: 'Tabloid', w: 279.4, h: 431.8 },
	// 13.333 × 7.5 in, the common widescreen slide size.
	{ id: 'slide-16-9', name: '16:9 slide', w: 338.67, h: 190.5 },
	{ id: 'square', name: 'Square', w: 210, h: 210 },
];

export function presetById(id: string): PagePreset | undefined {
	return PAGE_PRESETS.find((p) => p.id === id);
}

/** The preset a page's size is, in either orientation. */
export function presetFor(size: { w: number; h: number }): PagePreset | undefined {
	return PAGE_PRESETS.find((pr) => (pr.w === size.w && pr.h === size.h) || (pr.w === size.h && pr.h === size.w));
}

export function swapOrientation<T extends { w: number; h: number }>(size: T): T {
	return { ...size, w: size.h, h: size.w };
}
