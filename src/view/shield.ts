/** What the board listens for on its root: selecting, dragging, zooming and its keyboard shortcuts. */
export const BOARD_EVENTS = ['pointerdown', 'dblclick', 'contextmenu', 'wheel', 'keydown', 'keyup'] as const;

/**
 * Keep events on a control floating over the board (a bar, a panel, an editor) from reaching the
 * board, so clicking or typing there never selects, drags or deletes anything underneath.
 */
export function shieldFromBoard(el: HTMLElement, types: readonly string[] = BOARD_EVENTS) {
	for (const type of types) el.addEventListener(type, (e) => e.stopPropagation());
}
