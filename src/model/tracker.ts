import type { TrackerItem, TrackerModule } from './schema';

// Interactive trackers (SPEC 4 M5): counters, boxes and checklists. Every change returns a new
// module, so it goes through the store like any edit (undo, save). Pure.

export const DEFAULT_BOXES = 5;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** How many boxes a box tracker has (at least 1, at most 100). */
export function boxCount(m: TrackerModule): number {
	return clamp(Math.round(m.max ?? DEFAULT_BOXES), 1, 100);
}

/** Counter value within its bounds; filled boxes within 0…count. */
export function trackerValue(m: TrackerModule): number {
	const v = m.value ?? (m.kind === 'counter' ? (m.min ?? 0) : 0);
	if (m.kind === 'boxes') return clamp(Math.round(v), 0, boxCount(m));
	return clamp(v, m.min ?? -Infinity, m.max ?? Infinity);
}

/** +1 / −1 steps of a counter, kept within min and max. */
export function bump(m: TrackerModule, direction: 1 | -1): TrackerModule {
	const step = m.step && m.step > 0 ? m.step : 1;
	// Rounding keeps decimal steps (0.1) free of float noise.
	const next = Math.round((trackerValue(m) + direction * step) * 1e6) / 1e6;
	return { ...m, value: clamp(next, m.min ?? -Infinity, m.max ?? Infinity) };
}

/**
 * Clicking box `i` (0-based) fills boxes up to and including it; clicking the last filled box
 * empties it, so a row of slots works like the ones on paper.
 */
export function clickBox(m: TrackerModule, i: number): TrackerModule {
	const filled = trackerValue(m);
	return { ...m, value: i + 1 === filled ? i : i + 1 };
}

export function toggleItem(m: TrackerModule, i: number): TrackerModule {
	const items = (m.items ?? []).map((it, k) => (k === i ? withDone(it, !it.done) : it));
	return { ...m, items };
}

function withDone(it: TrackerItem, done: boolean): TrackerItem {
	const next = { ...it };
	if (done) next.done = true;
	else delete next.done;
	return next;
}

/** Items from text, one per line; lines that keep their text keep their tick. */
export function itemsFromText(text: string, old: readonly TrackerItem[] = []): TrackerItem[] {
	const pool = [...old];
	return text
		.split('\n')
		.map((l) => l.trim())
		.filter(Boolean)
		.map((t) => {
			const k = pool.findIndex((it) => it.text === t);
			return k >= 0 ? pool.splice(k, 1)[0]! : { text: t };
		});
}

/** The state an export prints: as on the board, or blank to fill in by hand. */
export function printedState(m: TrackerModule): TrackerModule {
	if (!m.printBlank) return m;
	return { ...m, value: m.kind === 'counter' ? undefined : 0, items: m.items?.map((it) => withDone(it, false)) };
}

/**
 * The + / − keys: a counter steps, boxes fill or empty one box. Checklists have nothing to step, so
 * they return null (the key is then left alone).
 */
export function stepByKey(m: TrackerModule, direction: 1 | -1): TrackerModule | null {
	if (m.kind === 'counter') return bump(m, direction);
	if (m.kind === 'boxes') return { ...m, value: clamp(trackerValue(m) + direction, 0, boxCount(m)) };
	return null;
}
