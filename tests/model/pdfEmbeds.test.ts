import { describe, expect, it } from 'vitest';
import { extractPdfEmbeds } from '../../src/model/pdfEmbeds';

describe('extractPdfEmbeds', () => {
	it('replaces wiki and markdown PDF embeds with indexed placeholders', () => {
		const r = extractPdfEmbeds('Intro\n\n![[Sample rulebook.pdf#page=2]]\n\n![map](PDFs/My%20Book.pdf#page=7) and ![[a.PDF|300]]');
		expect(r.embeds).toEqual([
			{ path: 'Sample rulebook.pdf', page: 2 },
			{ path: 'PDFs/My Book.pdf', page: 7 },
			{ path: 'a.PDF', page: 1 },
		]);
		expect(r.markdown).toBe(
			'Intro\n\n<span class="pw-pdf-embed" data-pw-embed="0"></span>\n\n<span class="pw-pdf-embed" data-pw-embed="1"></span> and <span class="pw-pdf-embed" data-pw-embed="2"></span>',
		);
	});

	it('reads the page among other hash options', () => {
		expect(extractPdfEmbeds('![[b.pdf#height=400&page=12]]').embeds[0]!.page).toBe(12);
	});

	it('leaves code, plain links, other embeds and non-PDF files alone', () => {
		const md = '```\n![[x.pdf]]\n```\n`![[y.pdf]]`\n[[z.pdf]]\n![[note]]\n![[image.png]]\n![[report.pdf.md]]';
		expect(extractPdfEmbeds(md)).toEqual({ markdown: md, embeds: [] });
	});
});
