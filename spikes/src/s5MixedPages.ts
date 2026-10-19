import { inspectPdf, Spike } from './context';
import { printSheets, Sheet } from './printHost';

/** S5: can one printToPDF call produce pages of different sizes via CSS named pages? */
export const s5MixedPages: Spike = async (ctx) => {
	const sizes: [string, number, number][] = [
		['A4 portrait', 210, 297],
		['A4 landscape', 297, 210],
		['Letter', 215.9, 279.4],
		['Custom 1000x700', 1000, 700],
		['A5', 148, 210],
	];
	const sheets: Sheet[] = sizes.map(([label, w, h]) => ({
		wMm: w,
		hMm: h,
		build: (el) => {
			el.style.border = '1mm solid #c33';
			el.createDiv({ text: `${label} (${w} x ${h} mm)` }).style.cssText = 'font-size:20pt;padding:10mm';
		},
	}));

	const out: Record<string, unknown> = { expected: sizes.map(([l, w, h]) => `${l}: ${w}x${h}`) };
	for (const named of [true, false]) {
		const key = named ? 'namedPages' : 'singlePageRule';
		try {
			const bytes = await printSheets(ctx, sheets, { named });
			ctx.save(`s5-${key}.pdf`, bytes);
			out[key] = await inspectPdf(ctx, bytes, { pngPrefix: `s5-${key}`, pngScale: 0.15 });
		} catch (e) {
			out[key] = { error: String(e) };
		}
	}
	return out;
};
