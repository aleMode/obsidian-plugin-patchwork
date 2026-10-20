import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { frontmatterEnd, type SectionRange, type SliceOptions, sliceBounds, sliceNote } from '../../src/sources/noteSlice';

const combat = readFileSync('test-vault/Rules/Combat.md', 'utf8');
/** Offsets as resolveSubpath would give them: heading line start → next same-or-higher heading start. */
const section = (heading: string, next: string | null) => ({
	kind: 'heading' as const,
	start: combat.indexOf(heading),
	end: next ? combat.indexOf(next) : null,
});

describe('frontmatterEnd', () => {
	it('finds the end of YAML frontmatter', () => {
		expect(combat.slice(frontmatterEnd(combat)).trimStart().startsWith('# Combat')).toBe(true);
		expect(frontmatterEnd('# No frontmatter\n---\n')).toBe(0);
		expect(frontmatterEnd('---\na: 1\n---')).toBe(12);
	});
});

describe('sliceNote', () => {
	it('whole note: strips frontmatter and leading blank lines', () => {
		const out = sliceNote(combat, null);
		expect(out.startsWith('# Combat')).toBe(true);
		expect(out).not.toContain('tags:');
	});

	it('heading section stops before the next heading of the same level', () => {
		const out = sliceNote(combat, section('### Prone', '### Grappled'));
		expect(out.startsWith('### Prone')).toBe(true);
		expect(out).toContain('You can only crawl');
		expect(out).not.toContain('Grappled');
	});

	it('can drop the heading line', () => {
		const out = sliceNote(combat, section('### Prone', '### Grappled'), { includeHeading: false });
		expect(out.startsWith('- You can only crawl')).toBe(true);
	});

	it('takes a line range relative to the section', () => {
		const out = sliceNote(combat, section('### Prone', '### Grappled'), { includeHeading: false, lines: [2, 3] });
		expect(out.split('\n')).toEqual(['- You can only crawl, or spend half your movement to stand.', '- Attacks against you from within 5 feet have advantage.']);
	});

	it('a section running to the end of the file', () => {
		const out = sliceNote(combat, section('## Cover', null));
		expect(out.endsWith("| Total | Can't be targeted |")).toBe(true);
	});

	it('a block range is taken as is', () => {
		const start = combat.indexOf('When a hostile creature');
		const end = combat.indexOf('^opportunity') + '^opportunity'.length;
		expect(sliceNote(combat, { kind: 'block', start, end }, { includeHeading: false })).toMatch(/^When a hostile.*\^opportunity$/);
	});
});

describe('sliceBounds', () => {
	const text = '---\ntitle: x\n---\n\n# One\nfirst line\n\nsecond line\n\n## Two\ninner\nmore\n\n# Three\nlast\n';
	const heading = (name: string): SectionRange => {
		const start = text.indexOf(`# ${name}`);
		const level = /^#+/.exec(text.slice(start))![0].length;
		const next = [...text.matchAll(/^#+ /gm)].map((m) => m.index!).find((i) => i > start && /^#+/.exec(text.slice(i))![0].length <= level);
		return { kind: 'heading', start, end: next ?? null };
	};
	const cases: [string, SectionRange | null, SliceOptions][] = [
		['whole note', null, {}],
		['whole note, lines 2-3', null, { lines: [2, 3] }],
		['section', heading('One'), {}],
		['section without heading', heading('One'), { includeHeading: false }],
		['nested section', heading('Two'), {}],
		['last section (to end of file)', heading('Three'), {}],
		['section, lines', heading('One'), { lines: [2, 4] }],
		['section without heading, lines', heading('One'), { includeHeading: false, lines: [1, 2] }],
		['lines past the end', heading('Two'), { lines: [2, 99] }],
		['lines before the start', heading('Two'), { lines: [50, 60] }],
	];
	for (const [name, range, opts] of cases) {
		it(`${name}: the range is exactly what sliceNote shows`, () => {
			const { start, end } = sliceBounds(text, range, opts);
			expect(text.slice(start, end)).toBe(sliceNote(text, range, opts));
		});
	}

	it('works with Windows line endings', () => {
		const crlf = text.replace(/\n/g, '\r\n');
		const range: SectionRange = { kind: 'heading', start: crlf.indexOf('# One'), end: crlf.indexOf('# Three') };
		const { start, end } = sliceBounds(crlf, range, { lines: [2, 3] });
		expect(crlf.slice(start, end)).toBe(sliceNote(crlf, range, { lines: [2, 3] }));
	});

	it('replacing the range edits only that part of the file', () => {
		const range = heading('Two');
		const { start, end } = sliceBounds(text, range, { includeHeading: false });
		const next = text.slice(0, start) + 'replaced' + text.slice(end);
		expect(next).toContain('## Two\nreplaced\n\n# Three');
		expect(next.startsWith('---\ntitle: x\n---')).toBe(true);
		expect(next.endsWith('last\n')).toBe(true);
	});
});
