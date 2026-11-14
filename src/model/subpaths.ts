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
