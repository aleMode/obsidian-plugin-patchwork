// PDF embeds inside notes (open question Q9). `![[book.pdf#page=2]]` makes Obsidian's renderer mount
// its whole PDF viewer: heavy, and inside a fixed-size module it collapses to zero height and spreads
// over the module, hiding the note (and exports it as a blurry picture with a misplaced text layer).
// Patchwork draws these pages itself, so they are swapped for a placeholder before rendering.

export interface PdfEmbed {
	/** Link path as written (resolved against the note by the renderer). */
	path: string;
	/** 1-based page (`#page=N`), 1 when absent. */
	page: number;
}

/** The element a PDF embed becomes; `data-pw-embed` indexes the `embeds` list. */
export const PDF_EMBED_CLASS = 'pw-pdf-embed';

/** `![[file.pdf#page=2|w]]` (groups 1–2) or `![alt](file.pdf#page=2)` (groups 3–4), in one pass so numbering follows the text. */
const EMBED = /!\[\[([^\]|#]+?\.pdf)(#[^\]|]*)?(?:\|[^\]]*)?\]\]|!\[[^\]]*\]\(<?([^)>#]+?\.pdf)(#[^)>]*)?>?\)/gi;
const FENCE = /^(?:[ \t]*>)*[ \t]*(`{3,}|~{3,})/;

function pageOf(hash: string | undefined): number {
	const n = Number(/(?:^#|&)page=(\d+)/.exec(hash ?? '')?.[1]);
	return Number.isInteger(n) && n > 0 ? n : 1;
}

function decode(path: string): string {
	try {
		return decodeURIComponent(path);
	} catch {
		return path;
	}
}

/** Replace PDF embeds outside code with placeholders; returns the new markdown and what each placeholder shows. */
export function extractPdfEmbeds(markdown: string): { markdown: string; embeds: PdfEmbed[] } {
	const embeds: PdfEmbed[] = [];
	const place = (path: string, hash: string | undefined) => {
		embeds.push({ path, page: pageOf(hash) });
		return `<span class="${PDF_EMBED_CLASS}" data-pw-embed="${embeds.length - 1}"></span>`;
	};
	let fence: string | null = null;
	const lines = markdown.split('\n').map((line) => {
		const f = FENCE.exec(line)?.[1];
		if (f && (!fence || (f[0] === fence[0] && f.length >= fence.length))) {
			fence = fence ? null : f;
			return line;
		}
		if (fence || !line.toLowerCase().includes('.pdf')) return line;
		// Inline code spans (odd segments between backticks) stay as they are.
		return line
			.split('`')
			.map((part, i) => (i % 2 ? part : part.replace(EMBED, (_m, wp?: string, wh?: string, mp?: string, mh?: string) => (wp ? place(wp.trim(), wh) : place(decode(mp!.trim()), mh)))))
			.join('`');
	});
	return embeds.length ? { markdown: lines.join('\n'), embeds } : { markdown, embeds };
}
