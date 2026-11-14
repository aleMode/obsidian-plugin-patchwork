import type { NoteModule, PatchworkFile } from './schema';

// Section links for headings (SPEC 5.3). Pure.

export interface HeadingRef {
	heading: string;
	level: number;
}

/**
 * The subpath that finds each heading, in document order. A heading whose name is unique in the note gets
 * `#Name`; a repeated name (a bestiary with an "Actions" under every monster) gets its ancestors too,
 * `#Orc#Actions`, since `#Actions` would always find the first one.
 */
export function headingSubpaths(headings: readonly HeadingRef[]): string[] {
	const count = new Map<string, number>();
	for (const h of headings) count.set(key(h.heading), (count.get(key(h.heading)) ?? 0) + 1);
	const stack: HeadingRef[] = [];
	return headings.map((h) => {
		while (stack.length && stack[stack.length - 1]!.level >= h.level) stack.pop();
		const path = count.get(key(h.heading))! > 1 ? [...stack, h] : [h];
		stack.push(h);
		return path.map((x) => `#${x.heading}`).join('');
	});
}

/** Obsidian matches heading links without regard to letter case. */
const key = (heading: string) => heading.toLowerCase();

/**
 * `subpath` after the heading that `old` points at was retyped as `title`, or null if `subpath` doesn't
 * go through that heading. Both may be short (`#Actions`) or full (`#Orc#Actions`): a segment of `subpath`
 * is that heading when it and the segments before it agree with the end of `old`, as far as both go. So
 * `#Orc#Actions#Melee` and `#Actions` both follow a retyped `#Orc#Actions`, and `#Goblin#Actions` doesn't.
 * Block links (`#^id`) never do.
 */
export function retitledSubpath(subpath: string, old: string, title: string): string | null {
	if (subpath.startsWith('#^') || old.startsWith('#^')) return null;
	const segs = (s: string) => s.split('#').filter(Boolean);
	const o = segs(old);
	const s = segs(subpath);
	if (!o.length) return null;
	for (let j = 0; j < s.length; j++) {
		const k = Math.min(o.length, j + 1);
		const tail = o.slice(o.length - k);
		if (s.slice(j + 1 - k, j + 1).every((x, i) => key(x) === key(tail[i]!))) {
			s[j] = title;
			return s.map((x) => `#${x}`).join('');
		}
	}
	return null;
}

/**
 * Every note module of `notePath` on the board that goes through the heading `old`, pointed at the heading
 * now titled `title` (a heading retyped in place, review B14). Returns the same file if nothing changed.
 */
export function retitleSection(file: PatchworkFile, notePath: string, old: string, title: string): PatchworkFile {
	let changed = false;
	const pages = file.pages.map((page) => {
		let touched = false;
		const modules = page.modules.map((m) => {
			const note = m as NoteModule;
			if (m.type !== 'note' || note.file !== notePath || !note.subpath) return m;
			const next = retitledSubpath(note.subpath, old, title);
			if (next === null || next === note.subpath) return m;
			touched = true;
			return { ...note, subpath: next };
		});
		if (!touched) return page;
		changed = true;
		return { ...page, modules };
	});
	return changed ? { ...file, pages } : file;
}
