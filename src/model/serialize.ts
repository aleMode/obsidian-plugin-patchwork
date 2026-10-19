import { cleanPageOrder } from './ordering';
import type { PatchworkFile } from './schema';

// Pretty JSON with a stable key order so boards diff well in git (SPEC 6). Known keys come first in
// a fixed order; unknown keys follow in their original order and are written back untouched.

type Json = Record<string, unknown>;
type Shape = { keys: readonly string[]; children?: Record<string, Shape> };

const INSETS: Shape = { keys: ['top', 'right', 'bottom', 'left'] };
const STYLE: Shape = {
	keys: ['padding', 'border', 'background', 'opacity', 'fontScale', 'cssClass'],
	children: { border: { keys: ['width', 'color', 'radius'] } },
};

const MODULE_KEYS: Record<string, readonly string[]> = {
	pdf: ['file', 'page', 'crop', 'fit', 'rotation', 'invert', 'renderDpi', 'render'],
	note: ['file', 'subpath', 'lines', 'includeHeading', 'overflow', 'scale'],
	text: ['markdown'],
	image: ['file', 'fit'],
};
const MODULE_BASE = ['id', 'type', 'x', 'y', 'w', 'h', 'z', 'locked', 'label'];

const BOARD: Shape = {
	keys: ['grid', 'displayUnit', 'order', 'pageOrder', 'numbering', 'defaultSafeArea', 'header', 'footer', 'useAppTheme', 'fontFamily', 'export'],
	children: {
		grid: { keys: ['size', 'snap', 'visible'] },
		numbering: { keys: ['enabled', 'start', 'format', 'position', 'skipFirst'] },
		defaultSafeArea: INSETS,
		export: {
			keys: ['format', 'sheet', 'orientation', 'tileOverlap', 'cropMarks', 'dpi', 'quality'],
			children: { sheet: { keys: ['w', 'h'] } },
		},
	},
};

const PAGE_KEYS = ['id', 'name', 'x', 'y', 'w', 'h', 'safeArea', 'background', 'numberLabel', 'header', 'footer', 'modules'];
const FILE_KEYS = ['version', 'unit', 'meta', 'board', 'pages'];

const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Float noise like 12.300000000000001 would churn diffs; 6 decimals is far below a micrometre. */
function tidy(v: unknown): unknown {
	if (typeof v === 'number' && !Number.isInteger(v)) return Number(v.toFixed(6));
	if (Array.isArray(v) && v.every((n) => typeof n === 'number')) return v.map(tidy);
	return v;
}

function ordered(o: Json, keys: readonly string[], child: (key: string, value: unknown) => unknown = (_k, v) => tidy(v)): Json {
	const out: Json = {};
	for (const k of keys) if (o[k] !== undefined) out[k] = child(k, o[k]);
	for (const k of Object.keys(o)) if (!(k in out) && o[k] !== undefined) out[k] = o[k];
	return out;
}

function shaped(o: unknown, shape: Shape): unknown {
	if (!isObj(o)) return o;
	return ordered(o, shape.keys, (k, v) => {
		const c = shape.children?.[k];
		return c ? shaped(v, c) : tidy(v);
	});
}

function moduleOut(m: Json): Json {
	const typeKeys = MODULE_KEYS[m.type as string];
	// Modules of unknown type are written verbatim (key order included).
	if (!typeKeys) return m;
	return ordered(m, [...MODULE_BASE, ...typeKeys, 'style'], (k, v) => (k === 'style' ? shaped(v, STYLE) : tidy(v)));
}

function pageOut(p: Json): Json {
	return ordered(p, PAGE_KEYS, (k, v) => {
		if (k === 'safeArea') return shaped(v, INSETS);
		if (k === 'modules') return (v as Json[]).map(moduleOut);
		return tidy(v);
	});
}

export function serializeBoard(file: PatchworkFile): string {
	const cleaned = cleanPageOrder(file);
	const out = ordered(cleaned, FILE_KEYS, (k, v) => {
		if (k === 'meta') return shaped(v, { keys: ['title', 'created'] });
		if (k === 'board') return shaped(v, BOARD);
		if (k === 'pages') return (v as Json[]).map(pageOut);
		return v;
	});
	return JSON.stringify(out, null, 2) + '\n';
}
