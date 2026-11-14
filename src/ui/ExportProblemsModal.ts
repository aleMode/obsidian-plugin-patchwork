import { type App, Modal, type TFile } from 'obsidian';
import type { ExportProblem } from '../export/problems';

/**
 * After an export with problems: what was written, and each problem with a button that selects the item
 * it is about (a sticky notice could neither be read whole nor lead anywhere).
 */
export class ExportProblemsModal extends Modal {
	constructor(
		app: App,
		private written: TFile | undefined,
		private problems: readonly ExportProblem[],
		private show: (at: NonNullable<ExportProblem['at']>) => void,
	) {
		super(app);
	}

	onOpen() {
		this.setTitle('Export finished with problems');
		this.modalEl.addClass('pw-export-problems');
		const { contentEl } = this;
		if (this.written) {
			const line = contentEl.createEl('p', { text: 'Written to ' });
			const file = this.written;
			line.createEl('a', { text: file.path, href: '#' }).addEventListener('click', (e) => {
				e.preventDefault();
				this.close();
				void this.app.workspace.getLeaf('tab').openFile(file);
			});
		}
		const list = contentEl.createEl('ul');
		for (const p of this.problems) {
			const li = list.createEl('li');
			li.createSpan({ text: p.text });
			const at = p.at;
			if (!at) continue;
			li.createEl('button', { cls: 'mod-muted', text: 'Show' }).addEventListener('click', () => {
				this.close();
				this.show(at);
			});
		}
	}

	onClose() {
		this.contentEl.empty();
	}
}
