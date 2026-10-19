import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { frontmatterEnd, sliceNote } from '../../src/sources/noteSlice';

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
