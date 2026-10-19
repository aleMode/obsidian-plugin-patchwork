import { Spike } from './context';

const SIZES: [number, number][] = [
	[4096, 4096],
	[8192, 8192],
	[16384, 8192],
	[16384, 16384],
	[32767, 2048],
	[32768, 2048],
	[65535, 512],
	[65536, 512],
	[11811, 8268], // 1000x700 mm at 300 dpi
];

/** Can we draw and read back the bottom-right pixel? That catches canvases that silently fail to allocate. */
function probe(make: (w: number, h: number) => HTMLCanvasElement | OffscreenCanvas, w: number, h: number) {
	const t0 = performance.now();
	let canvas: HTMLCanvasElement | OffscreenCanvas | null = null;
	try {
		canvas = make(w, h);
		const c = canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
		if (!c) return { ok: false, why: 'no 2d context' };
		c.fillStyle = '#ff0000';
		c.fillRect(w - 2, h - 2, 2, 2);
		const d = c.getImageData(w - 1, h - 1, 1, 1).data;
		const ok = d[0] === 255 && d[3] === 255;
		return { ok, ms: Math.round(performance.now() - t0), ...(ok ? {} : { why: `pixel ${Array.from(d)}` }) };
	} catch (e) {
		return { ok: false, why: String(e) };
	} finally {
		if (canvas) canvas.width = canvas.height = 0;
	}
}

async function encode(w: number, h: number) {
	const canvas = new OffscreenCanvas(w, h);
	const c = canvas.getContext('2d')!;
	c.fillStyle = '#fff';
	c.fillRect(0, 0, w, h);
	c.fillStyle = '#36c';
	for (let i = 0; i < 200; i++) c.fillRect((i * 97) % w, (i * 53) % h, 200, 120);
	const t0 = performance.now();
	try {
		const blob = await canvas.convertToBlob({ type: 'image/png' });
		return { ok: true, ms: Math.round(performance.now() - t0), MB: +(blob.size / 2 ** 20).toFixed(1) };
	} catch (e) {
		return { ok: false, why: String(e) };
	} finally {
		canvas.width = canvas.height = 0;
	}
}

/** S4: safe canvas sizes in Obsidian's Chromium, for tiled raster export. */
export const s4Canvas: Spike = async () => {
	const out: Record<string, unknown> = {};
	for (const [w, h] of SIZES) {
		out[`${w}x${h}`] = {
			megapixels: +((w * h) / 1e6).toFixed(1),
			html: probe((cw, ch) => Object.assign(document.createElement('canvas'), { width: cw, height: ch }), w, h),
			offscreen: probe((cw, ch) => new OffscreenCanvas(cw, ch), w, h),
		};
		await new Promise((r) => setTimeout(r, 50));
	}
	out.pngEncode = {
		'4096x4096': await encode(4096, 4096),
		'8192x8192': await encode(8192, 8192),
	};
	return out;
};
