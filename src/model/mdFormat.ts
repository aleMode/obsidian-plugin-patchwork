// Markdown formatting commands for the in-place editor (bold, lists, headings…). Pure: each takes the
// text and the selection and returns a replacement of one range plus the selection to leave behind,
// so the editor can apply it as an ordinary edit (and keep its undo history).

export interface Replace {
	/** Replace text[from, to) with `insert`. */
	from: number;
	to: number;
	insert: string;
	/** Selection after the replacement, in the new text. */
	selStart: number;
	selEnd: number;
}

/** Wrap the selection in `mark` (**, *, ~~, `), or take it off again when it is already wrapped. */
export function toggleWrap(text: string, start: number, end: number, mark: string): Replace {
	const n = mark.length;
	// Marks just outside the selection: unwrap them.
	if (text.slice(start - n, start) === mark && text.slice(end, end + n) === mark && start - n >= 0) {
		return { from: start - n, to: end + n, insert: text.slice(start, end), selStart: start - n, selEnd: end - n };
	}
	const sel = text.slice(start, end);
	// Marks inside the selection: unwrap them.
	if (sel.length >= 2 * n && sel.startsWith(mark) && sel.endsWith(mark)) {
		const inner = sel.slice(n, sel.length - n);
		return { from: start, to: end, insert: inner, selStart: start, selEnd: start + inner.length };
	}
	return { from: start, to: end, insert: `${mark}${sel}${mark}`, selStart: start + n, selEnd: start + n + sel.length };
}

const HEADING = /^#{1,6}[ \t]+/;
const BULLET = /^[-*+][ \t]+/;
const ORDERED = /^\d+\.[ \t]+/;
const QUOTE = /^>[ \t]?/;

export type LineStyle = 'h1' | 'h2' | 'h3' | 'bullet' | 'ordered' | 'quote';

const PREFIX: Record<Exclude<LineStyle, 'ordered'>, string> = { h1: '# ', h2: '## ', h3: '### ', bullet: '- ', quote: '> ' };

/** The pattern that recognises a line already in `style`. */
const present = (style: LineStyle): RegExp => (style === 'bullet' ? BULLET : style === 'ordered' ? ORDERED : style === 'quote' ? QUOTE : new RegExp(`^${PREFIX[style].trim()}[ \\t]+(?!#)`));

/** Any existing marker a line could carry, to be replaced when switching between styles. */
const ANY = [HEADING, BULLET, ORDERED, QUOTE];

/**
 * Give the lines the selection touches a heading, list or quote marker, or take it off when every
 * non-empty line already has it. Switching between styles replaces the old marker.
 */
export function toggleLines(text: string, start: number, end: number, style: LineStyle): Replace {
	const from = text.lastIndexOf('\n', Math.max(0, start - 1)) + 1;
	const nl = text.indexOf('\n', end > start && text[end - 1] === '\n' ? end - 1 : end);
	const to = nl < 0 ? text.length : nl;
	const lines = text.slice(from, to).split('\n');
	const content = lines.filter((l) => l.trim() !== '');
	const remove = content.length > 0 && content.every((l) => present(style).test(l));
	let n = 0;
	const out = lines.map((l) => {
		if (l.trim() === '') return l;
		const bare = ANY.reduce((s, re) => s.replace(re, ''), l);
		if (remove) return bare;
		n += 1;
		return `${style === 'ordered' ? `${n}. ` : PREFIX[style]}${bare}`;
	});
	const insert = out.join('\n');
	return { from, to, insert, selStart: from, selEnd: from + insert.length };
}

/** `[selection](url)` with the url selected, ready to type over. */
export function insertLink(text: string, start: number, end: number): Replace {
	const label = text.slice(start, end) || 'link';
	const insert = `[${label}](url)`;
	const urlStart = start + label.length + 3;
	return { from: start, to: end, insert, selStart: urlStart, selEnd: urlStart + 3 };
}

/** Markdown as plain text for one-line titles: link and image targets, marks and table pipes go; lines join. */
export function plainText(md: string): string {
	return md
		.replace(/!?\[\[([^\]|]*)(?:\|([^\]]*))?\]\]/g, (_m, target: string, alias?: string) => alias ?? target)
		.replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
		.replace(/^\s*(?:[-*+]|\d+\.|>|#{1,6})\s+/gm, '')
		.replace(/(\*\*|__|==|~~|\*|_|`)/g, '')
		.replace(/\|/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}
