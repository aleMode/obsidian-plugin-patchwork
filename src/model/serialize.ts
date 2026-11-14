import type { PatchworkFile } from './schema';

// Pretty JSON with a stable key order so boards diff well in git (SPEC 6). Known keys come first in
// a fixed order; unknown keys follow in their original order and are written back untouched.

type Json = Record<string, unknown>;
type Shape = { keys: readonly string[]; children?: Record<string, Shape> };

const INSETS: Shape = { keys: ['top', 'right', 'bottom', 'left'] };
const FROZEN: Shape = { keys: ['at', 'markdown'] };
const ITEM: Shape = { keys: ['text', 'done'] };
const STYLE: Shape = {
	keys: ['padding', 'border', 'background', 'tint', 'opacity', 'fontScale', 'color', 'align', 'fontFamily', 'cssClass'],
	children: { border: { keys: ['width', 'color', 'radius'] } },
};

const MODULE_KEYS: Record<string, readonly string[]> = {
	pdf: ['file', 'page', 'crop', 'fit', 'rotation', 'invert', 'sourceId', 'renderDpi', 'render'],
	note: ['file', 'subpath', 'lines', 'includeHeading', 'overflow', 'scrollY', 'scale', 'frozen'],
	text: ['markdown'],
	image: ['file', 'fit'],
	toc: ['heading'],
	frame: ['from'],
	tracker: ['kind', 'label', 'value', 'min', 'max', 'step', 'items', 'printBlank'],
	shape: ['shape', 'fill', 'stroke', 'radius', 'p1', 'p2', 'startHead', 'endHead'],
};
const STROKE: Shape = { keys: ['color', 'width', 'dash'] };
const MODULE_BASE = ['id', 'type', 'x', 'y', 'w', 'h', 'z', 'locked', 'label'];

// `order` and `pageOrder` (manual page order, dropped in SPEC v0.19) and `renderDpi` are no longer
// read, but keep their place so older files don't reorder on their next save.
const BOARD: Shape = {
	keys: ['grid', 'displayUnit', 'order', 'pageOrder', 'numbering', 'defaultSafeArea', 'header', 'footer', 'useAppTheme', 'pdfDarkMode', 'fontFamily', 'mode', 'export'],
	children: {
		grid: { keys: ['size', 'snap', 'visible'] },
		numbering: { keys: ['enabled', 'start', 'format', 'position', 'skipFirst'] },
		defaultSafeArea: INSETS,
		export: {
			keys: ['format', 'sheet', 'orientation', 'tileOverlap', 'cropMarks', 'dpi', 'quality', 'fitSmallPages', 'tileLabels', 'inkSaver', 'layout', 'bleed'],
			children: { sheet: { keys: ['w', 'h'] } },
		},
	},
};

const PAGE_KEYS = ['id', 'name', 'x', 'y', 'w', 'h', 'safeArea', 'background', 'numberLabel', 'header', 'footer', 'isMaster', 'master', 'modules'];
const FILE_KEYS = ['version', 'unit', 'meta', 'board', 'pages', 'views'];
const VIEW: Shape = { keys: ['id', 'name', 'x', 'y', 'zoom'] };

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
	return ordered(m, [...MODULE_BASE, ...typeKeys, 'style'], (k, v) => {
		if (k === 'style') return shaped(v, STYLE);
		if (k === 'frozen') return shaped(v, FROZEN);
		if (k === 'stroke') return shaped(v, STROKE);
		if (k === 'items' && Array.isArray(v)) return v.map((it: Json) => shaped(it, ITEM));
		return tidy(v);
	});
}

function pageOut(p: Json): Json {
	return ordered(p, PAGE_KEYS, (k, v) => {
		if (k === 'safeArea') return shaped(v, INSETS);
		if (k === 'modules') return (v as Json[]).map(moduleOut);
		return tidy(v);
	});
}

export function serializeBoard(file: PatchworkFile): string {
	const out = ordered(file, FILE_KEYS, (k, v) => {
		if (k === 'meta') return shaped(v, { keys: ['title', 'created'] });
		if (k === 'board') return shaped(v, BOARD);
		if (k === 'pages') return (v as Json[]).map(pageOut);
		if (k === 'views') return (v as Json[]).map((view) => shaped(view, VIEW));
		return v;
	});
	return JSON.stringify(out, null, 2) + '\n';
}
