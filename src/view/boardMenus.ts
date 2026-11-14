import { Menu } from 'obsidian';
import { PAGE_PRESETS, swapOrientation } from '../model/presets';
import type { NoteModule } from '../model/schema';
import { findModule, mapModule, mapPage, restack } from '../store/pageOps';
import { ShortcutsModal } from '../ui/ShortcutsModal';
import { ALIGN_ACTIONS, type BoardViewport, type Item } from './BoardViewport';

// The board's menus: right-click on an item, a page or a multi-selection, and the toolbar's Add,
// Page and View menus. Built from the board's public actions; BoardViewport only decides when.

/** Right-click on a multi-selection. */
export function showGroupMenu(board: BoardViewport, e: MouseEvent) {
	const n = board.selectedItems.length;
	const menu = new Menu();
	for (const [mode, title, icon] of ALIGN_ACTIONS) menu.addItem((i) => i.setTitle(title).setIcon(icon).onClick(() => board.align(mode)));
	menu.addSeparator();
	menu.addItem((i) => i.setTitle('Distribute horizontally').setIcon('align-horizontal-distribute-center').setDisabled(n < 3).onClick(() => board.distribute('h')));
	menu.addItem((i) => i.setTitle('Distribute vertically').setIcon('align-vertical-distribute-center').setDisabled(n < 3).onClick(() => board.distribute('v')));
	menu.addSeparator();
	if (board.selectedItems.some((it) => it.moduleId)) menu.addItem((i) => i.setTitle('Lock or unlock').setIcon('lock').onClick(() => board.toggleLock()));
	menu.addItem((i) => i.setTitle('Duplicate').setIcon('copy').onClick(() => board.duplicateSelection()));
	menu.addItem((i) => i.setTitle(`Delete ${n} items`).setIcon('trash-2').setWarning(true).onClick(() => board.deleteSelection()));
	menu.showAtMouseEvent(e);
}

/** Right-click on one item (already selected): a module's or a page's actions. */
export function showItemMenu(board: BoardViewport, e: MouseEvent, hit: Item) {
	const menu = new Menu();
	if (hit.moduleId) moduleItems(board, menu, hit.pageId, hit.moduleId);
	else pageItems(board, menu, hit.pageId);
	menu.showAtMouseEvent(e);
}

function moduleItems(board: BoardViewport, menu: Menu, pageId: string, moduleId: string) {
	const store = board.boardStore;
	const m = findModule(store.file, pageId, moduleId);
	menu.addItem((i) => i.setTitle('Item settings…').setIcon('sliders-horizontal').onClick(() => board.showProperties('content')));
	menu.addItem((i) => i.setTitle('Size and position…').setIcon('move-diagonal').onClick(() => board.showProperties('layout')));
	menu.addItem((i) => i.setTitle('Style…').setIcon('paintbrush').onClick(() => board.showProperties('style')));
	menu.addSeparator();
	if (m?.type === 'pdf') menu.addItem((i) => i.setTitle('Edit crop…').setIcon('crop').onClick(() => board.editCrop(pageId, moduleId)));
	if (m?.type === 'text' || m?.type === 'frame') {
		menu.addItem((i) => i.setTitle('Continue in a new frame').setIcon('link').onClick(() => board.continueInFrame(pageId, moduleId)));
		menu.addSeparator();
	}
	const marker = board.services.overflowMarker;
	if (marker && (m?.type === 'note' || m?.type === 'text' || m?.type === 'frame')) {
		menu.addItem((i) => i.setTitle('Show overflow marker').setIcon('alert-triangle').setChecked(marker.shown()).onClick(() => marker.set(!marker.shown())));
		menu.addSeparator();
	}
	if (m?.type === 'note') {
		const current = (m as NoteModule).overflow ?? 'clip';
		const policies = [['clip', 'Overflow: clip', 'scissors'], ['fit', 'Overflow: shrink to fit', 'shrink'], ['grow', 'Overflow: grow', 'unfold-vertical']] as const;
		for (const [policy, title, icon] of policies) {
			menu.addItem((i) =>
				i
					.setTitle(title)
					.setIcon(icon)
					.setChecked(current === policy)
					.onClick(() =>
						store.update((f) =>
							mapModule(f, pageId, moduleId, (x) => {
								const next = { ...x } as NoteModule;
								if (policy === 'clip') delete next.overflow;
								else next.overflow = policy;
								return next;
							}),
						),
					),
			);
		}
		const frozen = !!(m as NoteModule).frozen;
		menu.addItem((i) => i.setTitle('Continue in a new frame').setIcon('link').onClick(() => board.continueInFrame(pageId, moduleId)));
		menu.addItem((i) =>
			i
				.setTitle(frozen ? 'Unfreeze' : 'Freeze text (snapshot)')
				.setIcon(frozen ? 'flame' : 'snowflake')
				.onClick(() => (frozen ? board.unfreezeNote(pageId, moduleId) : void board.freezeNote(pageId, moduleId))),
		);
		menu.addSeparator();
	}
	menu.addItem((i) => i.setTitle('Duplicate').setIcon('copy').onClick(() => board.duplicateSelection()));
	menu.addItem((i) =>
		i
			.setTitle(m?.locked ? 'Unlock' : 'Lock')
			.setIcon(m?.locked ? 'unlock' : 'lock')
			.onClick(() => store.update((f) => mapModule(f, pageId, moduleId, (x) => ({ ...x, locked: x.locked ? undefined : true })))),
	);
	menu.addItem((i) => i.setTitle('Bring to front').setIcon('bring-to-front').onClick(() => store.update((f) => restack(f, pageId, moduleId, 'front'))));
	menu.addItem((i) => i.setTitle('Send to back').setIcon('send-to-back').onClick(() => store.update((f) => restack(f, pageId, moduleId, 'back'))));
	menu.addItem((i) => i.setTitle('Delete module').setIcon('trash-2').setWarning(true).onClick(() => board.deleteSelection()));
}

function pageItems(board: BoardViewport, menu: Menu, pageId: string) {
	menu.addItem((i) => i.setTitle('Page settings…').setIcon('sliders-horizontal').onClick(() => board.showProperties('content')));
	menu.addItem((i) => i.setTitle('Size and position…').setIcon('move-diagonal').onClick(() => board.showProperties('layout')));
	menu.addItem((i) => i.setTitle('Page numbers, header and footer…').setIcon('hash').onClick(() => board.showProperties('furniture')));
	menu.addSeparator();
	menu.addItem((i) => i.setTitle('Zoom to page').setIcon('scan').onClick(() => board.zoomToSelection()));
	menu.addItem((i) => i.setTitle('Duplicate page').setIcon('copy').onClick(() => board.duplicateSelection()));
	menu.addItem((i) => i.setTitle('Swap orientation').setIcon('rotate-cw').onClick(() => board.boardStore.update((f) => mapPage(f, pageId, (p) => swapOrientation(p)))));
	menu.addItem((i) => i.setTitle('Delete page').setIcon('trash-2').setWarning(true).onClick(() => board.deleteSelection()));
}

/** Everything that is not a page, a note or a PDF, so the toolbar keeps three add buttons. */
export function showAddMenu(board: BoardViewport, e?: MouseEvent) {
	const menu = new Menu();
	menu.addItem((i) => i.setTitle('Text box').setIcon('type').onClick(() => board.addText()));
	menu.addItem((i) => i.setTitle('Image').setIcon('image').onClick(() => board.pickImage()));
	menu.addItem((i) => i.setTitle('Table of contents').setIcon('list').onClick(() => board.addToc()));
	menu.addSeparator();
	trackerItems(board, menu);
	board.showMenuAt(menu, e);
}

export function showTrackerMenu(board: BoardViewport, e?: MouseEvent) {
	const menu = new Menu();
	trackerItems(board, menu);
	board.showMenuAt(menu, e);
}

function trackerItems(board: BoardViewport, menu: Menu) {
	menu.addItem((i) => i.setTitle('Counter').setIcon('plus-minus').onClick(() => board.addTracker('counter')));
	menu.addItem((i) => i.setTitle('Boxes').setIcon('square').onClick(() => board.addTracker('boxes')));
	menu.addItem((i) => i.setTitle('Checklist').setIcon('list-checks').onClick(() => board.addTracker('checklist')));
}

export function showViewMenu(board: BoardViewport, e?: MouseEvent) {
	const menu = new Menu();
	const openPanels = board.services.openPanels;
	menu.addItem((i) => i.setTitle('Outline and views').setIcon('list-tree').setChecked(board.outlineOpen).onClick(() => board.toggleOutline()));
	if (openPanels) menu.addItem((i) => i.setTitle('Inspector and outline in the sidebar').setIcon('panel-right').onClick(() => openPanels()));
	menu.addItem((i) => i.setTitle('Minimap').setIcon('map').setChecked(board.minimapShown).onClick(() => board.toggleMinimap()));
	menu.addSeparator();
	menu.addItem((i) => i.setTitle('Keyboard and mouse').setIcon('keyboard').onClick(() => new ShortcutsModal(board.app).open()));
	board.showMenuAt(menu, e);
}

export function showAddPageMenu(board: BoardViewport, e?: MouseEvent) {
	const menu = new Menu();
	for (const preset of PAGE_PRESETS) {
		menu.addItem((i) => i.setTitle(preset.name).onClick(() => board.addPage(preset)));
		if (preset.w !== preset.h) menu.addItem((i) => i.setTitle(`${preset.name} landscape`).onClick(() => board.addPage(swapOrientation(preset))));
	}
	board.showMenuAt(menu, e);
}
