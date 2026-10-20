import type { AnyModule, TrackerModule } from '../model/schema';
import { boxCount, bump, clickBox, printedState, toggleItem, trackerValue } from '../model/tracker';
import type { ModuleRenderer } from './types';

export type TrackerChange = (fn: (m: TrackerModule) => TrackerModule) => void;

/**
 * Counters, boxes and checklists (M5). With `change` (the board) the controls are clickable; without
 * (export, read-only boards) they are drawn as they'd print.
 */
export class TrackerRenderer implements ModuleRenderer {
	constructor(private el: HTMLElement, private change?: TrackerChange) {}

	dependencies(): ReadonlySet<string> {
		return new Set();
	}

	rendered(): Promise<void> {
		return Promise.resolve();
	}

	render(m: AnyModule) {
		const t = this.change ? (m as TrackerModule) : printedState(m as TrackerModule);
		this.el.empty();
		const root = this.el.createDiv({ cls: `pw-tracker pw-tracker-${t.kind}` });
		if (t.label) root.createDiv({ cls: 'pw-tracker-label', text: t.label });
		if (t.kind === 'counter') this.counter(root, t);
		else if (t.kind === 'boxes') this.boxes(root, t);
		else this.checklist(root, t);
	}

	private counter(root: HTMLElement, t: TrackerModule) {
		const row = root.createDiv({ cls: 'pw-tracker-row' });
		this.control(row, 'pw-tracker-step', '−', () => bump(t, -1), 'Decrease');
		// Blank-printed counters leave an empty space to write in.
		row.createSpan({ cls: 'pw-tracker-value', text: t.value === undefined && !this.change && t.printBlank ? '' : String(trackerValue(t)) });
		this.control(row, 'pw-tracker-step', '+', () => bump(t, 1), 'Increase');
	}

	private boxes(root: HTMLElement, t: TrackerModule) {
		const row = root.createDiv({ cls: 'pw-tracker-row pw-tracker-boxes-row' });
		const filled = trackerValue(t);
		for (let i = 0; i < boxCount(t); i++) {
			const box = this.control(row, 'pw-tracker-box', '', () => clickBox(t, i), `Box ${i + 1}`);
			box.toggleClass('is-filled', i < filled);
		}
	}

	private checklist(root: HTMLElement, t: TrackerModule) {
		(t.items ?? []).forEach((it, i) => {
			const row = root.createDiv({ cls: 'pw-tracker-item' });
			row.toggleClass('is-done', !!it.done);
			this.control(row, 'pw-tracker-box', '', () => toggleItem(t, i), it.text).toggleClass('is-filled', !!it.done);
			row.createSpan({ cls: 'pw-tracker-text', text: it.text });
		});
	}

	/** A clickable control; on paper the same element without the click (and without −/+ buttons). */
	private control(parent: HTMLElement, cls: string, text: string, next: () => TrackerModule, label: string): HTMLElement {
		const el = parent.createSpan({ cls, text, attr: { 'aria-label': label } });
		const change = this.change;
		if (!change) {
			if (cls === 'pw-tracker-step') el.remove();
			return el;
		}
		el.addClass('pw-interactive');
		el.addEventListener('click', (e) => {
			e.stopPropagation();
			const value = next();
			change(() => value);
		});
		return el;
	}

	destroy() {
		this.el.empty();
	}
}
