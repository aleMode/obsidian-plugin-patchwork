const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

/**
 * Short random ID, unique against `taken`. 8 base-36 chars gives ~2.8e12 values, so collisions
 * are practically impossible within one file; the loop is only a guarantee.
 */
export function newId(taken: ReadonlySet<string>, random: () => number = Math.random): string {
	for (;;) {
		let id = '';
		for (let i = 0; i < 8; i++) id += ALPHABET[Math.floor(random() * ALPHABET.length)];
		if (!taken.has(id)) return id;
	}
}
