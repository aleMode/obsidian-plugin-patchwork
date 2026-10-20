import type { Insets, NumberPosition } from '../model/schema';

/** A bare number, comma or point as decimal separator; unit text is not accepted in length fields. */
export const PLAIN_NUMBER = /^\s*-?\d+(?:[.,]\d+)?\s*$/;

export const POSITIONS: Record<NumberPosition, string> = {
	'bottom-center': 'Bottom centre',
	'bottom-left': 'Bottom left',
	'bottom-right': 'Bottom right',
	'top-center': 'Top centre',
	'top-left': 'Top left',
	'top-right': 'Top right',
};

export const insets = (mm: number): Insets => ({ top: mm, right: mm, bottom: mm, left: mm });

/** The UI edits one inset for all sides; uneven insets (from the file) show their smallest side. */
export const uniformInset = (i: Insets | undefined) => (i ? Math.min(i.top, i.right, i.bottom, i.left) : 0);

/** Copy of `o` with `key` set, or removed when `value` is undefined (absent keys stay absent in the file). */
export function withField<T extends object>(o: T, key: string, value: unknown): T {
	const next = { ...o } as Record<string, unknown>;
	if (value === undefined) delete next[key];
	else next[key] = value;
	return next as T;
}

/** Set or remove (when undefined) an optional field of `o` in place, so every handler keeps seeing the same draft. */
export function setOpt(o: object, key: string, value: unknown): void {
	const target = o as Record<string, unknown>;
	if (value === undefined) delete target[key];
	else target[key] = value;
}
