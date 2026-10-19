import { TFile } from 'obsidian';
import type { AnyModule, ImageModule } from '../model/schema';
import { type ModuleContext, type ModuleRenderer, placeholder } from './types';

export class ImageModuleRenderer implements ModuleRenderer {
	private deps = new Set<string>();

	constructor(private el: HTMLElement, private ctx: ModuleContext) {}

	dependencies(): ReadonlySet<string> {
		return this.deps;
	}

	render(m: AnyModule) {
		const mod = m as ImageModule;
		this.deps = new Set([mod.file]);
		const file = this.ctx.app.vault.getAbstractFileByPath(mod.file);
		if (!(file instanceof TFile)) return placeholder(this.el, `Image not found: ${mod.file}`, 'missing');
		this.el.empty();
		this.el.createEl('img', {
			cls: `pw-image pw-fit-${mod.fit ?? 'contain'}`,
			attr: { src: this.ctx.app.vault.getResourcePath(file), alt: file.basename, draggable: 'false' },
		});
	}

	destroy() {
		this.el.empty();
	}
}
