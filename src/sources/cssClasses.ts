// A note's `cssclasses` frontmatter, as Obsidian reads it: a list, or one string with commas or spaces.
// Only plain class names are kept, so a note cannot inject anything but a class.

const CLASS_NAME = /^[A-Za-z_-][\w-]*$/;

export function parseCssClasses(value: unknown): string[] {
	const parts: unknown[] = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/[\s,]+/) : [];
	const seen = new Set<string>();
	for (const p of parts) if (typeof p === 'string' && CLASS_NAME.test(p.trim())) seen.add(p.trim());
	return [...seen];
}
