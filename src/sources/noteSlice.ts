// Pure slicing of a note's text for note modules (SPEC 5.3). Section boundaries come from
// Obsidian's resolveSubpath (character offsets); this turns them into the markdown to render.

export interface SectionRange {
	kind: 'heading' | 'block';
	/** Character offset where the section starts (the heading line, or the block). */
	start: number;
	/** Character offset where it ends (next heading of the same or higher level), or null for end of file. */
	end: number | null;
}

export interface SliceOptions {
	/** Keep the heading line itself (heading sections only). Default true, like Obsidian embeds. */
	includeHeading?: boolean;
	/** 1-based inclusive line range, relative to the section (or the note body without frontmatter). */
	lines?: [number, number];
}

const FRONTMATTER = /^---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/;

/** Offset where the body starts, after YAML frontmatter if there is any. */
export function frontmatterEnd(text: string): number {
	return FRONTMATTER.exec(text)?.[0].length ?? 0;
}

function dropFirstLine(s: string): string {
	const nl = s.indexOf('\n');
	return nl < 0 ? '' : s.slice(nl + 1);
}

export function sliceNote(text: string, range: SectionRange | null, opts: SliceOptions = {}): string {
	let body = range ? text.slice(range.start, range.end ?? text.length) : text.slice(frontmatterEnd(text));
	if (range?.kind === 'heading' && opts.includeHeading === false) body = dropFirstLine(body);
	if (opts.lines) {
		const [first, last] = opts.lines;
		body = body.split('\n').slice(first - 1, last).join('\n');
	}
	// Leading blank lines would push content down inside a fixed-size module.
	return body.replace(/^(?:[ \t]*\r?\n)+/, '').trimEnd();
}

/**
 * Where in `text` the markdown that `sliceNote` returns comes from: `text.slice(start, end)` is that
 * markdown. Saving an edit of a note module replaces exactly this range, so everything around it
 * (frontmatter, other sections, trailing blank lines) stays as it was.
 */
export function sliceBounds(text: string, range: SectionRange | null, opts: SliceOptions = {}): { start: number; end: number } {
	let start = range ? range.start : frontmatterEnd(text);
	let end = range ? Math.min(range.end ?? text.length, text.length) : text.length;
	if (range?.kind === 'heading' && opts.includeHeading === false) {
		const nl = text.indexOf('\n', start);
		start = nl < 0 || nl >= end ? end : nl + 1;
	}
	if (opts.lines) {
		const [first, last] = opts.lines;
		const lines = text.slice(start, end).split('\n');
		let at = start;
		const starts = lines.map((l) => {
			const s = at;
			at += l.length + 1;
			return s;
		});
		const lastIdx = Math.min(last, lines.length) - 1;
		const s = starts[first - 1] ?? end;
		const e = lastIdx >= first - 1 ? starts[lastIdx]! + lines[lastIdx]!.length : s;
		start = Math.min(s, end);
		end = Math.max(start, Math.min(e, end));
	}
	const lead = /^(?:[ \t]*\r?\n)+/.exec(text.slice(start, end));
	if (lead) start += lead[0].length;
	while (end > start && /\s/.test(text[end - 1]!)) end--;
	return { start, end };
}
