import { describe, expect, it } from 'vitest';
import { newBoardFile } from '../../src/model/defaults';
import { rewritePaths } from '../../src/model/links';
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
