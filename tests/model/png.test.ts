import { deflateSync, inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { crc32, filterRows, pngChunk, pngFinish, pngStart, stripRows } from '../../src/model/png';

const bytes = (s: string) => new Uint8Array([...s].map((c) => c.charCodeAt(0)));

/** Chunks of a PNG file, each checked against its CRC. */
function chunks(png: Uint8Array): { type: string; data: Uint8Array }[] {
	const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
	const out = [];
	for (let at = 8; at < png.length; ) {
		const len = view.getUint32(at);
		const type = String.fromCharCode(...png.subarray(at + 4, at + 8));
		const data = png.subarray(at + 8, at + 8 + len);
		expect(view.getUint32(at + 8 + len)).toBe(crc32([png.subarray(at + 4, at + 8), data]));
		out.push({ type, data });
		at += 12 + len;
	}
	return out;
}

/** Undo the Up filter: RGB rows back from scanlines. */
function unfilter(scan: Uint8Array, width: number): number[][] {
	const stride = 1 + width * 3;
	const rows: number[][] = [];
	let prev = new Array<number>(width * 3).fill(0);
	for (let o = 0; o < scan.length; o += stride) {
		expect(scan[o]).toBe(2);
		const row = Array.from(scan.subarray(o + 1, o + stride), (v, i) => (v + prev[i]!) & 0xff);
		rows.push(row);
		prev = row;
	}
	return rows;
}

// 3 × 2 RGBA pixels: red, green, blue / white, black, grey (alpha varies and is dropped).
const RGBA = new Uint8Array([255, 0, 0, 255, 0, 255, 0, 128, 0, 0, 255, 0, 255, 255, 255, 255, 0, 0, 0, 255, 128, 128, 128, 255]);
const RGB = [
	[255, 0, 0, 0, 255, 0, 0, 0, 255],
	[255, 255, 255, 0, 0, 0, 128, 128, 128],
];

describe('png', () => {
	it('computes the standard CRC-32', () => {
		expect(crc32([bytes('IEND')])).toBe(0xae426082);
		expect(crc32([bytes('IE'), bytes('ND')])).toBe(0xae426082);
	});

	it('starts with the signature, an RGB header and the resolution', () => {
		const start = pngStart(3000, 2000, 300);
		expect(Array.from(start.subarray(0, 8))).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
		const [ihdr, phys] = chunks(start);
		expect(ihdr!.type).toBe('IHDR');
		const h = new DataView(ihdr!.data.buffer, ihdr!.data.byteOffset);
		expect([h.getUint32(0), h.getUint32(4), ...ihdr!.data.subarray(8)]).toEqual([3000, 2000, 8, 2, 0, 0, 0]);
		expect(phys!.type).toBe('pHYs');
		const p = new DataView(phys!.data.buffer, phys!.data.byteOffset);
		// 300 dpi = 11 811 px per metre, both ways, unit metre.
		expect([p.getUint32(0), p.getUint32(4), phys!.data[8]]).toEqual([11811, 11811, 1]);
	});

	it('filters rows so they decode back to the RGB pixels', () => {
		expect(unfilter(filterRows(RGBA, 3, 2, new Uint8Array(9)), 3)).toEqual(RGB);
	});

	it('filters strip by strip exactly as all at once', () => {
		const whole = filterRows(RGBA, 3, 2, new Uint8Array(9));
		const above = new Uint8Array(9);
		const first = filterRows(RGBA.subarray(0, 12), 3, 1, above);
		const second = filterRows(RGBA.subarray(12), 3, 1, above);
		expect([...first, ...second]).toEqual([...whole]);
		expect(Array.from(above)).toEqual(RGB[1]);
	});

	it('makes a complete file: header, image data, end', () => {
		const png = new Uint8Array([...pngStart(3, 2, 72), ...pngFinish(new Uint8Array(deflateSync(filterRows(RGBA, 3, 2, new Uint8Array(9)))))]);
		const all = chunks(png);
		expect(all.map((c) => c.type)).toEqual(['IHDR', 'pHYs', 'IDAT', 'IEND']);
		expect(unfilter(new Uint8Array(inflateSync(all[2]!.data)), 3)).toEqual(RGB);
		expect(pngChunk('IEND', new Uint8Array(0))).toEqual(png.subarray(png.length - 12));
	});

	it('sizes strips to stay under the area, at least one row', () => {
		expect(stripRows(1000, 5000, 1_000_000)).toBe(1000);
		expect(stripRows(1000, 300, 1_000_000)).toBe(300);
		expect(stripRows(2_000_000, 300, 1_000_000)).toBe(1);
	});
});
