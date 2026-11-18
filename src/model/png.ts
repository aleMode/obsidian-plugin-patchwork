// A minimal PNG writer for raster export (SPEC 9.1, Q11 option b): an image of any size is written
// as one file from strips of rows, so no canvas ever has to hold the whole sheet (spike S4: canvases
// over Chromium's limits fail silently). Pure: the caller compresses the scanlines (zlib) and renders.

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const CRC_TABLE = (() => {
	const t = new Uint32Array(256);
	for (let n = 0; n < 256; n++) {
		let c = n;
		for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		t[n] = c >>> 0;
	}
	return t;
})();

export function crc32(parts: readonly Uint8Array[]): number {
	let c = 0xffffffff;
	for (const p of parts) for (let i = 0; i < p.length; i++) c = CRC_TABLE[(c ^ p[i]!) & 0xff]! ^ (c >>> 8);
	return (c ^ 0xffffffff) >>> 0;
}

/** One chunk: length, type, data, CRC of type and data. */
export function pngChunk(type: string, data: Uint8Array): Uint8Array {
	const out = new Uint8Array(12 + data.length);
	const view = new DataView(out.buffer);
	view.setUint32(0, data.length);
	const name = new Uint8Array([...type].map((ch) => ch.charCodeAt(0)));
	out.set(name, 4);
	out.set(data, 8);
	view.setUint32(8 + data.length, crc32([name, data]));
	return out;
}

/**
 * Signature, header (8-bit RGB) and the physical size: `dpi` is stored (pHYs), so viewers and
 * layout tools show the image at the page's real size.
 */
export function pngStart(width: number, height: number, dpi: number): Uint8Array {
	const ihdr = new Uint8Array(13);
	const h = new DataView(ihdr.buffer);
	h.setUint32(0, width);
	h.setUint32(4, height);
	ihdr.set([8, 2, 0, 0, 0], 8); // bit depth 8, colour type RGB, deflate, adaptive filtering, no interlace
	const phys = new Uint8Array(9);
	const p = new DataView(phys.buffer);
	const perMetre = Math.round(dpi / 0.0254);
	p.setUint32(0, perMetre);
	p.setUint32(4, perMetre);
	phys[8] = 1; // unit: metre
	return concat([new Uint8Array(SIGNATURE), pngChunk('IHDR', ihdr), pngChunk('pHYs', phys)]);
}

/** The image data (the zlib stream of all scanlines), then the end marker. */
export function pngFinish(zlib: Uint8Array): Uint8Array {
	return concat([pngChunk('IDAT', zlib), pngChunk('IEND', new Uint8Array(0))]);
}

/**
 * Scanlines for `rows` rows of RGBA pixels (alpha dropped: export sheets are opaque), each with the
 * "Up" filter, which turns the long runs of a printed page into zeros that compress well. `prev` is
 * the RGB row above the first one (zeros at the image's top) and is updated to the last row, so
 * strips can be filtered one after another.
 */
export function filterRows(rgba: Uint8Array | Uint8ClampedArray, width: number, rows: number, prev: Uint8Array): Uint8Array<ArrayBuffer> {
	const stride = 1 + width * 3;
	const out = new Uint8Array(stride * rows);
	for (let y = 0; y < rows; y++) {
		const o = y * stride;
		out[o] = 2;
		for (let x = 0, s = y * width * 4, d = 0; x < width; x++, s += 4) {
			for (let k = 0; k < 3; k++, d++) {
				const v = rgba[s + k]!;
				out[o + 1 + d] = (v - prev[d]!) & 0xff;
				prev[d] = v;
			}
		}
	}
	return out;
}

/** Rows per strip, so a strip's pixels stay under `maxArea` (at least one row). */
export function stripRows(width: number, height: number, maxArea: number): number {
	return Math.max(1, Math.min(height, Math.floor(maxArea / Math.max(1, width))));
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
	const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
	let at = 0;
	for (const p of parts) {
		out.set(p, at);
		at += p.length;
	}
	return out;
}
