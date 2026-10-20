import { describe, expect, it } from 'vitest';
import { newBoardFile } from '../../src/model/defaults';
import { renamedLinkTarget, rewriteMarkdownLinks, rewritePaths } from '../../src/model/links';
import type { AnyModule } from '../../src/model/schema';

function board(modules: AnyModule[]) {
	const f = newBoardFile({ firstPage: { w: 210, h: 297 } });
	f.pages[0]!.modules = modules;
	return f;
}
const at = { x: 0, y: 0, w: 1, h: 1 };

describe('rewritePaths', () => {
	it('renames file references of note, pdf and image modules', () => {
		const f = board([
			{ id: 'a', type: 'note', file: 'Rules/Combat.md', subpath: '#Prone', ...at },
			{ id: 'b', type: 'pdf', file: 'Rules/Combat.md', page: 1, ...at },
			{ id: 'c', type: 'note', file: 'Rules/Combat.md.bak', ...at },
		]);
		const out = rewritePaths(f, 'Rules/Combat.md', 'Rules/Fighting.md');
		expect(out.pages[0]!.modules.map((m) => m.file)).toEqual(['Rules/Fighting.md', 'Rules/Fighting.md', 'Rules/Combat.md.bak']);
		expect(out.pages[0]!.modules[0]).toMatchObject({ subpath: '#Prone' });
	});

	it('renames everything inside a renamed folder, but not look-alike folders', () => {
		const f = board([
			{ id: 'a', type: 'note', file: 'Rules/Combat.md', ...at },
			{ id: 'b', type: 'image', file: 'Rules2/x.png', ...at },
		]);
		expect(rewritePaths(f, 'Rules', 'Lore/Rules').pages[0]!.modules.map((m) => m.file)).toEqual(['Lore/Rules/Combat.md', 'Rules2/x.png']);
	});

	it('leaves unknown module types and unaffected boards untouched', () => {
		const f = board([{ id: 'a', type: 'hologram', file: 'Rules/Combat.md', ...at }]);
		expect(rewritePaths(f, 'Rules/Combat.md', 'X.md')).toBe(f);
	});
});

describe('rewriteMarkdownLinks', () => {
	const to = (map: Record<string, string>) => (p: string) => map[p] ?? null;

	it('rewrites wikilinks and embeds, keeping subpaths and aliases', () => {
		const md = 'See [[Source]], [[n/Source#Heading|the rules]] and ![[map.png|200]]; [[#Local]] stays.';
		expect(rewriteMarkdownLinks(md, to({ Source: 'Spells', 'n/Source': 'Spells', 'map.png': 'carte.png' }))).toBe(
			'See [[Spells]], [[Spells#Heading|the rules]] and ![[carte.png|200]]; [[#Local]] stays.',
		);
	});

	it('rewrites markdown links, decoding and re-encoding the path, and skips external ones', () => {
		const md = '[a](My%20note.md#Part) ![b](<img dir/x.png>) [c](https://example.com/My%20note.md) [d](obsidian://open?file=x)';
		expect(rewriteMarkdownLinks(md, to({ 'My note.md': 'Lore/New note.md', 'img dir/x.png': 'img/y z.png' }))).toBe(
			'[a](Lore/New%20note.md#Part) ![b](<img/y z.png>) [c](https://example.com/My%20note.md) [d](obsidian://open?file=x)',
		);
	});

	it('returns the same text when nothing matches', () => {
		const md = 'Plain [[Other]] text';
		expect(rewriteMarkdownLinks(md, () => null)).toBe(md);
	});
});

describe('renamedLinkTarget', () => {
	it('matches full paths, trailing parts and bare names, with or without .md, in any case', () => {
		const moved = ['Lore/Spells.md'];
		for (const link of ['Rules/Combat', 'Rules/Combat.md', 'Combat', 'combat', '/Rules/Combat']) {
			expect(renamedLinkTarget(link, 'Rules/Combat.md', 'Lore/Spells.md', moved)).toBe('Lore/Spells.md');
		}
		expect(renamedLinkTarget('Combat2', 'Rules/Combat.md', 'Lore/Spells.md', moved)).toBeNull();
		expect(renamedLinkTarget('les/Combat', 'Rules/Combat.md', 'Lore/Spells.md', moved)).toBeNull();
	});

	it('follows files inside a renamed folder', () => {
		const moved = ['Lore/Combat.md', 'Lore/img/map.png'];
		expect(renamedLinkTarget('Rules/img/map.png', 'Rules', 'Lore', moved)).toBe('Lore/img/map.png');
		expect(renamedLinkTarget('Rules/Combat', 'Rules', 'Lore', moved)).toBe('Lore/Combat.md');
		expect(renamedLinkTarget('Other/Combat', 'Rules', 'Lore', moved)).toBeNull();
	});
});

describe('rewritePaths with links', () => {
	it('updates text modules and frozen snapshots, leaving the rest', () => {
		const f = board([
			{ id: 't', type: 'text', markdown: 'See [[Combat]]', ...at },
			{ id: 'n', type: 'note', file: 'Other.md', frozen: { at: '2026-10-20', markdown: 'Frozen [[Combat]]' }, ...at },
			{ id: 'u', type: 'note', file: 'Other.md', ...at },
		]);
		const out = rewritePaths(f, 'Combat.md', 'Fighting.md', (p) => (p === 'Combat' ? 'Fighting' : null));
		expect(out.pages[0]!.modules[0]).toMatchObject({ markdown: 'See [[Fighting]]' });
		expect(out.pages[0]!.modules[1]).toMatchObject({ frozen: { at: '2026-10-20', markdown: 'Frozen [[Fighting]]' } });
		expect(out.pages[0]!.modules[2]).toBe(f.pages[0]!.modules[2]);
		expect(rewritePaths(f, 'X.md', 'Y.md', () => null)).toBe(f);
	});
});
