import type { BoardStore } from '../store/BoardStore';
import type { BoardSurface, PatchworkView } from './PatchworkView';

/** Placeholder surface until the board viewport lands: lists pages so file I/O can be verified. */
export function createBoardSurface(container: HTMLElement, store: BoardStore, _view: PatchworkView): BoardSurface {
	const render = () => {
		container.empty();
		container.createEl('p', { text: `${store.file.pages.length} page(s)` });
	};
	render();
	const off = store.subscribe(render);
	return { destroy: () => off() };
}
