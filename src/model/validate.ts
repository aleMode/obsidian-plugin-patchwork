import { defaultBoardSettings, newBoardFile } from './defaults';
import { newId } from './ids';
import { migrate } from './migrate';
import type { PatchworkFile } from './schema';
import { SCHEMA_VERSION } from './schema';

// Parsing is strict about known fields with wrong types (the file is shown in the error view and
// never overwritten, hard rule 2) and lenient about missing optional ones (filled from defaults).
// Unknown keys are left in place on the same objects, so serializing writes them back (hard rule 3).

export type ParseResult =
	| { ok: true; file: PatchworkFile; readOnly: boolean; warnings: string[] }
	| { ok: false; errors: string[] };

type Json = Record<string, unknown>;

const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

class Issues {
	errors: string[] = [];
	warnings: string[] = [];

	/** Check an optional field: absent is fine, present must pass `ok`. */
	optional(o: Json, key: string, path: string, ok: (v: unknown) => boolean, expected: string) {
		if (o[key] !== undefined && !ok(o[key])) this.errors.push(`${path}.${key}: expected ${expected}, got ${JSON.stringify(o[key])}`);
	}

	required(o: Json, key: string, path: string, ok: (v: unknown) => boolean, expected: string) {
		if (o[key] === undefined) this.errors.push(`${path}.${key}: missing (expected ${expected})`);
		else this.optional(o, key, path, ok, expected);
	}
}

const oneOf = (...allowed: unknown[]) => (v: unknown) => allowed.includes(v);
const positive = (v: unknown) => isNum(v) && v > 0;
const nonNegative = (v: unknown) => isNum(v) && v >= 0;
const isStr = (v: unknown) => typeof v === 'string';
const isBool = (v: unknown) => typeof v === 'boolean';
const isInsets = (v: unknown) => isObj(v) && ['top', 'right', 'bottom', 'left'].every((k) => nonNegative(v[k]));

/** Fill keys missing from `target` with `defaults`, recursing into nested plain objects. */
function fillDefaults(target: Json, defaults: Json) {
	for (const [k, d] of Object.entries(defaults)) {
		if (target[k] === undefined) target[k] = structuredClone(d);
		else if (isObj(target[k]) && isObj(d)) fillDefaults(target[k], d);
	}
}

function checkBoard(board: Json, is: Issues) {
	const p = 'board';
	fillDefaults(board, defaultBoardSettings());
	const grid = board.grid as Json;
	if (!isObj(grid)) is.errors.push(`${p}.grid: expected an object`);
	else {
		is.optional(grid, 'size', `${p}.grid`, positive, 'a positive number');
		is.optional(grid, 'snap', `${p}.grid`, isBool, 'true/false');
		is.optional(grid, 'visible', `${p}.grid`, isBool, 'true/false');
	}
	is.optional(board, 'displayUnit', p, oneOf('mm', 'cm', 'in'), '"mm", "cm" or "in"');
	is.optional(board, 'order', p, oneOf('reading', 'manual'), '"reading" or "manual"');
	is.optional(board, 'pageOrder', p, (v) => Array.isArray(v) && v.every(isStr), 'a list of page IDs');
	is.optional(board, 'useAppTheme', p, isBool, 'true/false');
	is.optional(board, 'pdfDarkMode', p, isBool, 'true/false');
	is.optional(board, 'defaultSafeArea', p, isInsets, 'insets {top,right,bottom,left} ≥ 0');
	for (const k of ['header', 'footer', 'fontFamily']) is.optional(board, k, p, isStr, 'text');

	const n = board.numbering as Json;
	if (!isObj(n)) is.errors.push(`${p}.numbering: expected an object`);
	else {
		is.optional(n, 'enabled', `${p}.numbering`, isBool, 'true/false');
		is.optional(n, 'start', `${p}.numbering`, (v) => Number.isInteger(v), 'a whole number');
		is.optional(n, 'format', `${p}.numbering`, oneOf('arabic', 'roman', 'alpha'), '"arabic", "roman" or "alpha"');
		is.optional(n, 'position', `${p}.numbering`, oneOf('bottom-center', 'bottom-left', 'bottom-right', 'top-center', 'top-left', 'top-right'), 'a position preset');
		is.optional(n, 'skipFirst', `${p}.numbering`, isBool, 'true/false');
	}

	const e = board.export as Json;
	if (!isObj(e)) is.errors.push(`${p}.export: expected an object`);
	else {
		const ep = `${p}.export`;
		is.optional(e, 'format', ep, oneOf('pdf', 'png'), '"pdf" or "png"');
		is.optional(e, 'sheet', ep, (v) => oneOf('native', 'A4', 'A3', 'A5', 'Letter', 'Legal', 'Tabloid')(v) || (isObj(v) && positive(v.w) && positive(v.h)), 'a sheet preset or {w, h}');
		is.optional(e, 'orientation', ep, oneOf('auto', 'portrait', 'landscape'), '"auto", "portrait" or "landscape"');
		is.optional(e, 'tileOverlap', ep, nonNegative, 'a number ≥ 0');
		is.optional(e, 'cropMarks', ep, isBool, 'true/false');
		is.optional(e, 'dpi', ep, positive, 'a positive number');
		is.optional(e, 'quality', ep, oneOf('best', 'small'), '"best" or "small"');
		is.optional(e, 'fitSmallPages', ep, isBool, 'true/false');
		is.optional(e, 'tileLabels', ep, isBool, 'true/false');
		is.optional(e, 'inkSaver', ep, isBool, 'true/false');
		is.optional(e, 'layout', ep, oneOf('single', 'booklet'), '"single" or "booklet"');
		is.optional(e, 'bleed', ep, nonNegative, 'a number ≥ 0');
	}
}

function checkRect(o: Json, path: string, is: Issues) {
	for (const k of ['x', 'y']) is.required(o, k, path, isNum, 'a number');
	for (const k of ['w', 'h']) is.required(o, k, path, positive, 'a positive number');
}

const isCrop = (v: unknown) =>
	Array.isArray(v) && v.length === 4 && v.every((n) => isNum(n) && n >= 0 && n <= 1) && v[0] < v[2] && v[1] < v[3];
const isFit = oneOf('contain', 'cover', 'stretch');

function checkModule(m: Json, path: string, is: Issues) {
	is.required(m, 'type', path, isStr, 'a module type');
	checkRect(m, path, is);
	is.optional(m, 'z', path, isNum, 'a number');
	is.optional(m, 'locked', path, isBool, 'true/false');
	is.optional(m, 'label', path, isStr, 'text');
	is.optional(m, 'style', path, isObj, 'an object');
	switch (m.type) {
		case 'pdf':
			is.required(m, 'file', path, isStr, 'a vault path');
			is.required(m, 'page', path, (v) => Number.isInteger(v) && (v as number) >= 1, 'a page number ≥ 1');
			is.optional(m, 'crop', path, isCrop, '[x0, y0, x1, y1] between 0 and 1 with x0 < x1, y0 < y1');
			is.optional(m, 'fit', path, isFit, '"contain", "cover" or "stretch"');
			is.optional(m, 'rotation', path, oneOf(0, 90, 180, 270), '0, 90, 180 or 270');
			is.optional(m, 'renderDpi', path, positive, 'a positive number');
			is.optional(m, 'render', path, oneOf('auto', 'vector', 'raster'), '"auto", "vector" or "raster"');
			is.optional(m, 'invert', path, isBool, 'true/false');
			is.optional(m, 'sourceId', path, isStr, 'text');
			break;
		case 'note':
			is.required(m, 'file', path, isStr, 'a vault path');
			is.optional(m, 'subpath', path, (v) => isStr(v) && (v).startsWith('#'), 'a subpath starting with #');
			is.optional(m, 'lines', path, (v) => Array.isArray(v) && v.length === 2 && v.every((n) => Number.isInteger(n) && n >= 1) && v[0] <= v[1], '[first, last] line numbers ≥ 1');
			is.optional(m, 'includeHeading', path, isBool, 'true/false');
			is.optional(m, 'overflow', path, oneOf('clip', 'fit', 'grow'), '"clip", "fit" or "grow"');
			is.optional(m, 'scale', path, positive, 'a positive number');
			is.optional(m, 'frozen', path, (v) => isObj(v) && isStr(v.markdown) && isStr(v.at), '{at, markdown}');
			break;
		case 'text':
			if (m.markdown === undefined) m.markdown = '';
			is.optional(m, 'markdown', path, isStr, 'text');
			break;
		case 'image':
			is.required(m, 'file', path, isStr, 'a vault path');
			is.optional(m, 'fit', path, isFit, '"contain", "cover" or "stretch"');
			break;
		case 'toc':
			is.optional(m, 'heading', path, isStr, 'text');
			break;
		default:
			if (isStr(m.type)) is.warnings.push(`${path}: unknown module type "${m.type}" kept as is`);
	}
}

/** Missing or duplicate IDs get a fresh one (with a warning) instead of failing the whole file. */
function ensureId(o: Json, path: string, seen: Set<string>, is: Issues) {
	if (typeof o.id !== 'string' || o.id === '' || seen.has(o.id)) {
		const old = o.id;
		o.id = newId(seen);
		is.warnings.push(`${path}: ${old === undefined ? 'missing' : `duplicate or invalid (${JSON.stringify(old)})`} id replaced with "${o.id as string}"`);
	}
	seen.add(o.id as string);
}

function checkPages(pages: unknown[], is: Issues) {
	const seen = new Set<string>();
	for (const [i, page] of pages.entries()) {
		const pp = `pages[${i}]`;
		if (!isObj(page)) {
			is.errors.push(`${pp}: expected an object`);
			continue;
		}
		ensureId(page, pp, seen, is);
		checkRect(page, pp, is);
		for (const k of ['name', 'background', 'header', 'footer']) is.optional(page, k, pp, isStr, 'text');
		is.optional(page, 'numberLabel', pp, (v) => isStr(v) || v === false, 'text or false');
		is.optional(page, 'safeArea', pp, isInsets, 'insets {top,right,bottom,left} ≥ 0');
		is.optional(page, 'isMaster', pp, isBool, 'true/false');
		is.optional(page, 'master', pp, isStr, 'a page ID');
		if (page.modules === undefined) page.modules = [];
		if (!Array.isArray(page.modules)) {
			is.errors.push(`${pp}.modules: expected a list`);
			continue;
		}
		for (const [j, m] of (page.modules as unknown[]).entries()) {
			const mp = `${pp}.modules[${j}]`;
			if (!isObj(m)) {
				is.errors.push(`${mp}: expected an object`);
				continue;
			}
			ensureId(m, mp, seen, is);
			checkModule(m, mp, is);
		}
	}
}

export function validateBoard(raw: unknown): ParseResult {
	if (!isObj(raw)) return { ok: false, errors: ['The file is not a JSON object.'] };
	if (!Number.isInteger(raw.version) || (raw.version as number) < 1) {
		return { ok: false, errors: [`version: expected a whole number ≥ 1, got ${JSON.stringify(raw.version)}`] };
	}
	const readOnly = (raw.version as number) > SCHEMA_VERSION;
	let file: Json;
	try {
		file = readOnly ? raw : migrate(raw);
	} catch (e) {
		return { ok: false, errors: [String(e instanceof Error ? e.message : e)] };
	}

	const is = new Issues();
	if (readOnly) is.warnings.push(`This board was saved by a newer version of Patchwork (format ${raw.version as number}); it is open read-only.`);
	if (file.unit === undefined) file.unit = 'mm';
	is.optional(file, 'unit', 'file', oneOf('mm'), '"mm"');
	is.optional(file, 'meta', 'file', isObj, 'an object');
	if (file.board === undefined) file.board = {};
	if (!isObj(file.board)) is.errors.push('board: expected an object');
	else checkBoard(file.board, is);
	if (!Array.isArray(file.pages)) is.errors.push('pages: expected a list');
	else checkPages(file.pages, is);
	if (file.views !== undefined) {
		if (!Array.isArray(file.views)) is.errors.push('views: expected a list');
		else
			file.views.forEach((v, i) => {
				const vp = `views[${i}]`;
				if (!isObj(v)) return void is.errors.push(`${vp}: expected an object`);
				is.required(v, 'name', vp, isStr, 'text');
				for (const k of ['x', 'y']) is.required(v, k, vp, isNum, 'a number');
				is.required(v, 'zoom', vp, positive, 'a positive number');
				if (!isStr(v.id)) v.id = `view-${i}`;
			});
	}

	if (is.errors.length) return { ok: false, errors: is.errors };
	return { ok: true, file: file as unknown as PatchworkFile, readOnly, warnings: is.warnings };
}

/** Parse the raw text of a .patchwork file. An empty file starts a new board. */
export function parseBoard(text: string): ParseResult {
	if (text.trim() === '') return { ok: true, file: newBoardFile(), readOnly: false, warnings: ['The file was empty; started a new board.'] };
	let raw: unknown;
	try {
		raw = JSON.parse(text);
	} catch (e) {
		return { ok: false, errors: [`Not valid JSON: ${e instanceof Error ? e.message : String(e)}`] };
	}
	return validateBoard(raw);
}

