// A thin stand-in for the `obsidian` module (aliased in vitest.config.ts), so view and source code
// that talks to the vault can be unit-tested. Only what those tests touch does anything; the rest of
// the names exist so imports resolve. Not a model of Obsidian: keep each fake as small as a test needs.

export class TAbstractFile {
	constructor(public path: string) {}
	get name(): string {
		return this.path.replace(/^.*\//, '');
	}
	get parent(): { path: string } | null {
		const i = this.path.lastIndexOf('/');
		return { path: i < 0 ? '/' : this.path.slice(0, i) };
	}
}

export class TFile extends TAbstractFile {
	get basename(): string {
		return this.name.replace(/\.[^.]*$/, '');
	}
	get extension(): string {
		return /\.([^.]*)$/.exec(this.name)?.[1] ?? '';
	}
}

export class TFolder extends TAbstractFile {}

/** An element that accepts the calls the views make while building their DOM, and remembers text. */
export class FakeEl {
	children: FakeEl[] = [];
	classes = new Set<string>();
	text = '';
	constructor(opts?: { cls?: string; text?: string }) {
		opts?.cls?.split(/\s+/).filter(Boolean).forEach((c) => this.classes.add(c));
		this.text = opts?.text ?? '';
	}
	empty() {
		this.children = [];
	}
	addClass(c: string) {
		this.classes.add(c);
	}
	removeClass(c: string) {
		this.classes.delete(c);
	}
	createDiv(opts?: { cls?: string; text?: string }, cb?: (el: FakeEl) => void): FakeEl {
		return this.child(opts, cb);
	}
	createSpan(opts?: { cls?: string; text?: string }, cb?: (el: FakeEl) => void): FakeEl {
		return this.child(opts, cb);
	}
	createEl(_tag: string, opts?: { cls?: string; text?: string }, cb?: (el: FakeEl) => void): FakeEl {
		return this.child(opts, cb);
	}
	private child(opts?: { cls?: string; text?: string }, cb?: (el: FakeEl) => void): FakeEl {
		const el = new FakeEl(opts);
		this.children.push(el);
		cb?.(el);
		return el;
	}
	addEventListener() {}
	remove() {}
	get allText(): string {
		return [this.text, ...this.children.map((c) => c.allText)].filter(Boolean).join(' ');
	}
}

export class Notice {
	static shown: string[] = [];
	constructor(message: unknown) {
		Notice.shown.push(typeof message === 'string' ? message : message instanceof FakeEl ? message.allText : String(message));
	}
	hide() {}
}

export class Component {
	load() {}
	unload() {}
	register() {}
	registerEvent() {}
	addChild<T>(c: T): T {
		return c;
	}
}

export class Modal {
	static opened: Modal[] = [];
	contentEl = new FakeEl();
	modalEl = new FakeEl();
	constructor(public app: unknown) {}
	open() {
		Modal.opened.push(this);
		(this as { onOpen?: () => void }).onOpen?.();
	}
	close() {
		(this as { onClose?: () => void }).onClose?.();
	}
	setTitle() {
		return this;
	}
}

export class Scope {
	constructor(_parent?: unknown) {}
	register() {}
}

/** What the fake views call on the app; tests pass a whole fake app (tests/fakes/vault.ts). */
interface FakeViewApp {
	vault: { modify(file: TFile, text: string): Promise<void> };
}

export class ItemView extends Component {
	app: FakeViewApp;
	contentEl = new FakeEl();
	constructor(public leaf: { app: FakeViewApp }) {
		super();
		this.app = leaf.app;
	}
	onPaneMenu() {}
}

/** Writes like the real one: `data` becomes the view's text, then the file is modified with it. */
export class TextFileView extends ItemView {
	data = '';
	file: TFile | null = null;
	scope: unknown;
	requestSave = () => {};
	getViewData(): string {
		return this.data;
	}
	async save(_clear?: boolean): Promise<void> {
		if (!this.file) return;
		this.data = this.getViewData();
		await this.app.vault.modify(this.file, this.data);
	}
}

export class Menu {
	addItem() {
		return this;
	}
	addSeparator() {
		return this;
	}
}

export class Plugin extends Component {}
export class PluginSettingTab {}
export class Setting {}
export class SuggestModal extends Modal {}
export class FuzzySuggestModal extends Modal {}
export class WorkspaceLeaf {}
export type App = unknown;
export type HoverParent = unknown;

export const Keymap = { isModEvent: () => false };
export const MarkdownRenderer = { render: async () => {} };
export const setIcon = () => {};
export const normalizePath = (p: string) => p;
export const loadPdfJs = async () => ({});
export const getLinkpath = (link: string) => link.replace(/#.*$/, '');
export const parseLinktext = (text: string) => {
	const i = text.indexOf('#');
	return i < 0 ? { path: text, subpath: '' } : { path: text.slice(0, i), subpath: text.slice(i) };
};
export const resolveSubpath = () => null;
