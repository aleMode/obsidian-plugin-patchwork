import { Notice } from 'obsidian';

/** Shown instead of the board when the file can't be parsed. The file itself is never touched. */
export function renderErrorView(el: HTMLElement, errors: string[], raw: string, reload: () => void) {
	el.empty();
	el.removeClass('pw-view');
	const box = el.createDiv({ cls: 'pw-error-view' });
	box.createEl('h3', { text: 'This patchwork could not be opened' });
	box.createEl('p', {
		text: 'Patchwork will not change this file. Fix it in a text editor or restore it from a backup, then reload.',
	});
	const list = box.createEl('ul');
	for (const e of errors.slice(0, 50)) list.createEl('li', { text: e });
	if (errors.length > 50) list.createEl('li', { text: `…and ${errors.length - 50} more` });

	const actions = box.createDiv({ cls: 'pw-error-actions' });
	actions.createEl('button', { text: 'Copy file contents', cls: 'mod-cta' }, (b) =>
		b.addEventListener('click', () => {
			void navigator.clipboard.writeText(raw).then(() => new Notice('Copied'));
		}),
	);
	actions.createEl('button', { text: 'Reload' }, (b) => b.addEventListener('click', reload));
	box.createEl('pre', { cls: 'pw-error-raw', text: raw });
}
