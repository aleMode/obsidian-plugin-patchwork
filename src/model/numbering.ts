import { masterOf, outputPages } from './masters';
import type { NumberFormat, PatchworkFile } from './schema';

// Page numbers, headers and footers (SPEC 5.4). Pure.

const ROMAN: [number, string][] = [
	[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'],
	[50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i'],
];

/** 1 → "1" / "i" / "a"; 27 → "27" / "xxvii" / "aa". Numbers below 1 fall back to arabic. */
export function formatNumber(n: number, format: NumberFormat): string {
	if (format === 'arabic' || n < 1 || !Number.isInteger(n)) return String(n);
	if (format === 'roman') {
		let rest = n, out = '';
		for (const [v, s] of ROMAN) {
			while (rest >= v) {
				out += s;
				rest -= v;
			}
		}
		return out;
	}
	let s = '';
	for (let k = n; k > 0; k = Math.floor((k - 1) / 26)) s = String.fromCharCode(97 + ((k - 1) % 26)) + s;
	return s;
}

export interface TokenValues {
	page: string;
	pages: string;
	title: string;
	date: string;
}

/** Replace {page}, {pages}, {title}, {date}; unknown tokens stay as typed. */
export function expandTokens(template: string, v: TokenValues): string {
	return template.replace(/\{(page|pages|title|date)\}/g, (_m, k: keyof TokenValues) => v[k]);
}

export interface PageFurniture {
	/** Text printed at the number position, or null when hidden or numbering is off. */
	number: string | null;
	/** The page's number for {page}, even when it isn't printed. */
	pageToken: string;
	header: string | null;
	footer: string | null;
}

/**
 * Number, header and footer for every page, keyed by page ID. Pages count in output order;
 * hidden or custom-labelled pages (and the first page under skipFirst) still count (SPEC 5.4).
 * {pages} is the last page's number, so "page {page} of {pages}" stays right with a start offset.
 */
export function pageFurniture(file: PatchworkFile, ctx: { title: string; date: string }): Map<string, PageFurniture> {
	const pages = outputPages(file);
	const n = file.board.numbering;
	const pagesToken = formatNumber(n.start + pages.length - 1, n.format);
	const out = new Map<string, PageFurniture>();
	pages.forEach((p, i) => {
		const formatted = formatNumber(n.start + i, n.format);
		const pageToken = typeof p.numberLabel === 'string' ? p.numberLabel : formatted;
		// A page's own custom number is an explicit choice, so it prints even when board numbering is off.
		let number: string | null = n.enabled || typeof p.numberLabel === 'string' ? pageToken : null;
		if (p.numberLabel === false || (n.skipFirst && i === 0)) number = null;
		const tokens = { page: pageToken, pages: pagesToken, title: ctx.title, date: ctx.date };
		// A page's own header/footer replaces its master's, which replaces the board's; "" means none.
		const master = masterOf(file, p);
		const header = p.header ?? master?.header ?? file.board.header;
		const footer = p.footer ?? master?.footer ?? file.board.footer;
		out.set(p.id, {
			number,
			pageToken,
			header: header ? expandTokens(header, tokens) : null,
			footer: footer ? expandTokens(footer, tokens) : null,
		});
	});
	return out;
}

export interface PdfPageLabel {
	/** PDF /S numbering style: D arabic, r lower roman, a lower letters. Absent for custom labels. */
	style?: 'D' | 'r' | 'a';
	start?: number;
	prefix?: string;
}

const PDF_STYLE: Record<NumberFormat, 'D' | 'r' | 'a'> = { arabic: 'D', roman: 'r', alpha: 'a' };

/**
 * PDF page labels (shown by viewers in their page box) matching our numbering, one per page in
 * output order; null when numbering is off. Custom labels become a prefix-only label.
 */
export function pdfPageLabels(file: PatchworkFile): PdfPageLabel[] | null {
	const n = file.board.numbering;
	if (!n.enabled) return null;
	return outputPages(file).map((p, i) =>
		typeof p.numberLabel === 'string' ? { prefix: p.numberLabel } : { style: PDF_STYLE[n.format], start: Math.max(1, n.start + i) },
	);
}

/**
 * What a master page shows on the board: its header and footer as typed (tokens unexpanded) and
 * "#" where the number goes, since a master has no number of its own.
 */
export function masterPreview(file: PatchworkFile, master: { header?: string; footer?: string }): PageFurniture {
	const header = master.header ?? file.board.header;
	const footer = master.footer ?? file.board.footer;
	return { number: file.board.numbering.enabled ? '#' : null, pageToken: '#', header: header || null, footer: footer || null };
}
