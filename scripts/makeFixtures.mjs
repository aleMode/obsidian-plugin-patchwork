// Generates binary fixtures for the test vault without any dependency:
//   test-vault/PDFs/Sample rulebook.pdf  (4 pages, mixed sizes, /Rotate, outline, extractable text)
//   test-vault/Images/Map.png            (small PNG with a grid, for image modules)
// Run with `npm run fixtures`. Output is deterministic so it diffs cleanly.
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const MM = 72 / 25.4; // PDF points per mm
const A4 = [210 * MM, 297 * MM];
const LETTER = [612, 792];

// ---------- PDF ----------

const esc = (s) => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
const n = (v) => Number(v.toFixed(2));

/** Content stream builder in PDF points with a top-left origin, to match how the spec stores crops. */
function page(w, h) {
	const ops = [];
	const y = (top) => n(h - top);
	return {
		w, h, ops,
		text(xmm, ymm, size, str, bold = false) {
			ops.push(`BT /${bold ? 'F2' : 'F1'} ${size} Tf ${n(xmm * MM)} ${y(ymm * MM)} Td (${esc(str)}) Tj ET`);
		},
		rect(xmm, ymm, wmm, hmm, { fill, stroke } = {}) {
			const args = `${n(xmm * MM)} ${y((ymm + hmm) * MM)} ${n(wmm * MM)} ${n(hmm * MM)} re`;
			if (fill) ops.push(`${fill} rg ${args} f`);
			if (stroke) ops.push(`${stroke} RG 0.6 w ${args} S`);
		},
		line(x0, y0, x1, y1, gray = 0.6) {
			ops.push(`${gray} G 0.3 w ${n(x0 * MM)} ${y(y0 * MM)} m ${n(x1 * MM)} ${y(y1 * MM)} l S`);
		},
		/** Millimetre ticks on all edges so crops can be checked by eye. */
		rulers() {
			const wmm = w / MM, hmm = h / MM;
			for (let mm = 0; mm <= wmm; mm += 10) {
				const len = mm % 50 === 0 ? 5 : 2.5;
				this.line(mm, 0, mm, len);
				this.line(mm, hmm - len, mm, hmm);
				if (mm % 50 === 0 && mm > 0) this.text(mm + 0.8, 7.5, 6, `${mm}`);
			}
			for (let mm = 0; mm <= hmm; mm += 10) {
				const len = mm % 50 === 0 ? 5 : 2.5;
				this.line(0, mm, len, mm);
				this.line(wmm - len, mm, wmm, mm);
				if (mm % 50 === 0 && mm > 0) this.text(6, mm - 0.8, 6, `${mm}`);
			}
		},
		paragraph(xmm, ymm, size, lines) {
			lines.forEach((l, i) => this.text(xmm, ymm + i * size * 0.45, size, l));
			return ymm + lines.length * size * 0.45;
		},
	};
}

const lorem = [
	'Every creature acts in initiative order. On its turn it may move and take one action.',
	'Movement can be split before and after the action. Difficult terrain costs double.',
	'A creature that leaves a hostile reach provokes a reaction from that enemy.',
	'Cover grants a bonus to defence: half cover +2, three-quarters cover +5.',
];

function buildPages() {
	const p1 = page(...A4);
	p1.rulers();
	p1.text(20, 25, 20, 'Sample Rulebook', true);
	p1.text(20, 38, 14, 'Chapter 1: Combat', true);
	let y = p1.paragraph(20, 48, 10, lorem);
	p1.text(20, y + 8, 12, 'Opportunity Attacks', true);
	p1.paragraph(20, y + 15, 10, lorem.slice(2));
	// Stat block at a known position (x 20-110 mm, y 150-230 mm) for crop tests.
	p1.rect(20, 150, 90, 80, { fill: '0.96 0.92 0.82', stroke: '0.5 0.1 0.1' });
	p1.text(24, 158, 13, 'Goblin Skirmisher', true);
	p1.text(24, 164, 9, 'Small humanoid, neutral evil');
	p1.line(24, 167, 106, 167, 0.3);
	['Armor Class 15', 'Hit Points 7 (2d6)', 'Speed 30 ft.', '', 'STR 8  DEX 14  CON 10', 'INT 10  WIS 8  CHA 8', '',
		'Nimble Escape. Disengage or Hide', 'as a bonus action.', '', 'Scimitar. +4 to hit, 1d6+2 slashing.']
		.forEach((l, i) => p1.text(24, 173 + i * 4.8, 9, l));
	p1.text(120, 160, 9, 'Stat block box: x 20-110 mm,');
	p1.text(120, 165, 9, 'y 150-230 mm from top-left.');

	const p2 = page(...A4);
	p2.rulers();
	p2.text(20, 25, 14, 'Chapter 2: Spells', true);
	const spells = [
		['Fireball', '3rd-level evocation', 'A bright streak blooms into a', 'roaring blast. 8d6 fire damage', 'in a 20-foot radius.'],
		['Shield', '1st-level abjuration', 'An invisible barrier grants +5', 'AC until your next turn.'],
		['Misty Step', '2nd-level conjuration', 'Teleport up to 30 feet to a', 'space you can see.'],
		['Counterspell', '3rd-level abjuration', 'Interrupt a creature casting', 'a spell of 3rd level or lower.'],
	];
	spells.forEach((s, i) => {
		const col = i % 2, row = Math.floor(i / 2);
		const x = 20 + col * 90, top = 40 + row * 60;
		p2.text(x, top, 12, s[0], true);
		p2.text(x, top + 5, 9, s[1]);
		s.slice(2).forEach((l, j) => p2.text(x, top + 12 + j * 4.5, 10, l));
	});

	// Portrait content shown landscape by the viewer: tests crop-after-intrinsic-rotation.
	const p3 = page(...A4);
	p3.rulers();
	p3.text(20, 25, 14, 'Appendix A: Rotated page', true);
	p3.text(20, 35, 10, 'This page has /Rotate 90; viewers show it landscape.');
	p3.rect(20, 50, 50, 30, { fill: '0.8 0.9 1', stroke: '0 0 0.6' });
	p3.text(24, 67, 10, 'Blue box 20,50 50x30mm');

	const p4 = page(...LETTER);
	p4.rulers();
	p4.text(20, 25, 14, 'Appendix B: Letter-size page', true);
	p4.text(20, 35, 10, 'A US Letter page (215.9 x 279.4 mm) mixed into an A4 document.');

	return [
		{ pg: p1, rotate: 0 },
		{ pg: p2, rotate: 0 },
		{ pg: p3, rotate: 90 },
		{ pg: p4, rotate: 0 },
	];
}

function buildPdf() {
	const pages = buildPages();
	const objs = []; // index i holds object number i+1
	const add = (body) => (objs.push(body), objs.length);
	const reserve = () => (objs.push(null), objs.length);

	const catalog = reserve();
	const pagesObj = reserve();
	const outlines = reserve();
	const f1 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
	const f2 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');

	const pageIds = pages.map(({ pg, rotate }) => {
		const stream = pg.ops.join('\n');
		const content = add(`<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`);
		return add(`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 ${n(pg.w)} ${n(pg.h)}]` +
			(rotate ? ` /Rotate ${rotate}` : '') +
			` /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >> >> /Contents ${content} 0 R >>`);
	});

	// Outline: Ch1, Ch2 (> Fireball), Appendix A, Appendix B.
	const titles = [
		['Chapter 1: Combat', 0, null],
		['Chapter 2: Spells', 1, [['Fireball', 1]]],
		['Appendix A: Rotated page', 2, null],
		['Appendix B: Letter page', 3, null],
	];
	const top = titles.map(() => reserve());
	titles.forEach(([title, pi, kids], i) => {
		const dest = `/Dest [${pageIds[pi]} 0 R /XYZ null null null]`;
		const links = (i > 0 ? ` /Prev ${top[i - 1]} 0 R` : '') + (i < top.length - 1 ? ` /Next ${top[i + 1]} 0 R` : '');
		let kidRefs = '';
		if (kids) {
			const kidIds = kids.map(([kt, kp]) => add(`<< /Title (${esc(kt)}) /Parent ${top[i]} 0 R /Dest [${pageIds[kp]} 0 R /XYZ 0 ${n(A4[1] - 40 * MM)} null] >>`));
			kidRefs = ` /First ${kidIds[0]} 0 R /Last ${kidIds[kidIds.length - 1]} 0 R /Count ${kidIds.length}`;
		}
		objs[top[i] - 1] = `<< /Title (${esc(title)}) /Parent ${outlines} 0 R ${dest}${links}${kidRefs} >>`;
	});
	objs[outlines - 1] = `<< /Type /Outlines /First ${top[0]} 0 R /Last ${top[top.length - 1]} 0 R /Count ${top.length} >>`;
	objs[pagesObj - 1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;
	objs[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R /Outlines ${outlines} 0 R /PageMode /UseOutlines >>`;

	let out = '%PDF-1.4\n%\xe2\xe3\xcf\xd3\n';
	const offsets = [];
	objs.forEach((body, i) => {
		offsets.push(Buffer.byteLength(out, 'latin1'));
		out += `${i + 1} 0 obj\n${body}\nendobj\n`;
	});
	const xref = Buffer.byteLength(out, 'latin1');
	out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
	out += offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
	out += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
	return Buffer.from(out, 'latin1');
}

// ---------- PNG ----------

const crcTable = Array.from({ length: 256 }, (_, k) => {
	let c = k;
	for (let i = 0; i < 8; i++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
	return c >>> 0;
});
const crc32 = (buf) => {
	let c = 0xffffffff;
	for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
	return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
	const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
	const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
	const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
	return Buffer.concat([len, td, crc]);
};

/** 400x300 parchment "map" with a grid and a red marker. */
function buildPng() {
	const W = 400, H = 300;
	const raw = Buffer.alloc((W * 3 + 1) * H);
	for (let y = 0; y < H; y++) {
		raw[y * (W * 3 + 1)] = 0;
		for (let x = 0; x < W; x++) {
			let rgb = [238, 226, 196];
			if (x % 40 === 0 || y % 40 === 0) rgb = [170, 150, 120];
			if ((x - 260) ** 2 + (y - 120) ** 2 < 144) rgb = [190, 30, 30];
			raw.set(rgb, y * (W * 3 + 1) + 1 + x * 3);
		}
	}
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4);
	ihdr[8] = 8; ihdr[9] = 2; // 8-bit RGB
	return Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		chunk('IHDR', ihdr),
		chunk('IDAT', deflateSync(raw, { level: 9 })),
		chunk('IEND', Buffer.alloc(0)),
	]);
}

mkdirSync('test-vault/PDFs', { recursive: true });
mkdirSync('test-vault/Images', { recursive: true });
writeFileSync('test-vault/PDFs/Sample rulebook.pdf', buildPdf());
writeFileSync('test-vault/Images/Map.png', buildPng());
console.log('Wrote test-vault/PDFs/Sample rulebook.pdf and test-vault/Images/Map.png');
