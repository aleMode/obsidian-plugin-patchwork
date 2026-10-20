// Types for the .patchwork file format (SPEC section 6). All lengths are millimetres.

export const SCHEMA_VERSION = 1;

/** Largest page side a single PDF page can have (14 400 pt = 200 in). Larger pages must be tiled. */
export const MAX_PAGE_SIDE_MM = 5080;

export interface PatchworkFile {
	version: number;
	unit: 'mm';
	meta?: { title?: string; created?: string; [extra: string]: unknown };
	board: BoardSettings;
	pages: Page[];
	views?: SavedView[];
	[extra: string]: unknown;
}

/** A named camera position (SPEC 4 M3): the board point at the centre of the view, and the zoom. */
export interface SavedView {
	id: string;
	name: string;
	x: number;
	y: number;
	zoom: number;
	[extra: string]: unknown;
}

export type DisplayUnit = 'mm' | 'cm' | 'in';
export type NumberFormat = 'arabic' | 'roman' | 'alpha';
export type NumberPosition = 'bottom-center' | 'bottom-left' | 'bottom-right' | 'top-center' | 'top-left' | 'top-right';
export type Fit = 'contain' | 'cover' | 'stretch';
export type SheetPreset = 'A4' | 'A3' | 'A5' | 'Letter' | 'Legal' | 'Tabloid';

export interface BoardSettings {
	grid: { size: number; snap: boolean; visible: boolean; [extra: string]: unknown };
	displayUnit: DisplayUnit;
	order: 'reading' | 'manual';
	pageOrder?: string[];
	numbering: {
		enabled: boolean;
		start: number;
		format: NumberFormat;
		position: NumberPosition;
		skipFirst: boolean;
		[extra: string]: unknown;
	};
	defaultSafeArea?: Insets;
	header?: string;
	footer?: string;
	useAppTheme: boolean;
	/** Viewing only: show PDF regions colour-inverted when Obsidian uses a dark theme (M4). */
	pdfDarkMode?: boolean;
	fontFamily?: string;
	export: ExportDefaults;
	[extra: string]: unknown;
}

export interface Insets {
	top: number;
	right: number;
	bottom: number;
	left: number;
	[extra: string]: unknown;
}

export interface Page {
	id: string;
	name?: string;
	x: number;
	y: number;
	w: number;
	h: number;
	safeArea?: Insets;
	background?: string;
	numberLabel?: string | false;
	header?: string;
	footer?: string;
	/** M4: this page is a master; it is never exported or numbered. */
	isMaster?: boolean;
	/** M4: ID of the master page whose modules, header, footer, background and safe area this page inherits. */
	master?: string;
	modules: AnyModule[];
	[extra: string]: unknown;
}

export interface BaseModule {
	id: string;
	x: number;
	y: number;
	w: number;
	h: number;
	z?: number;
	locked?: boolean;
	label?: string;
	style?: ModuleStyle;
	[extra: string]: unknown;
}

export type Crop = [number, number, number, number];

export interface PdfModule extends BaseModule {
	type: 'pdf';
	file: string;
	page: number;
	crop?: Crop;
	fit?: Fit;
	rotation?: 0 | 90 | 180 | 270;
	invert?: boolean;
	/** M4: fingerprint of the PDF when the crop was made, to warn when the file is replaced. */
	sourceId?: string;
	renderDpi?: number;
	render?: 'auto' | 'vector' | 'raster';
}

export interface NoteModule extends BaseModule {
	type: 'note';
	file: string;
	subpath?: string;
	lines?: [number, number];
	includeHeading?: boolean;
	overflow?: 'clip' | 'fit' | 'grow';
	scale?: number;
	/** M4: shows this snapshot instead of the live note. */
	frozen?: FrozenNote;
}

export interface FrozenNote {
	/** When the snapshot was taken (YYYY-MM-DD). */
	at: string;
	markdown: string;
	[extra: string]: unknown;
}

export interface TextModule extends BaseModule {
	type: 'text';
	markdown: string;
}

export interface ImageModule extends BaseModule {
	type: 'image';
	file: string;
	fit?: Fit;
}

/** M4: lists the board's named pages with their numbers; entries link to the pages in exports. */
export interface TocModule extends BaseModule {
	type: 'toc';
	/** Heading above the list; absent means "Contents", "" means none. */
	heading?: string;
}

/** M5: a linked text frame; shows what doesn't fit in the module `from` (a note, text or frame). */
export interface FrameModule extends BaseModule {
	type: 'frame';
	from: string;
}

/** M5: interactive play aid; its state lives in the board. */
export interface TrackerModule extends BaseModule {
	type: 'tracker';
	kind: 'counter' | 'boxes' | 'checklist';
	label?: string;
	/** Counter value, or how many boxes are filled. */
	value?: number;
	/** Counter bounds; for boxes, `max` is how many there are. */
	min?: number;
	max?: number;
	step?: number;
	items?: TrackerItem[];
	/** Exports show the tracker empty (zero, no boxes or items ticked), to fill in by hand. */
	printBlank?: boolean;
}

export interface TrackerItem {
	text: string;
	done?: boolean;
	[extra: string]: unknown;
}

export type Module = PdfModule | NoteModule | TextModule | ImageModule | TocModule | FrameModule | TrackerModule;

/**
 * A module whose `type` this version doesn't know (written by a newer plugin, or hand-edited).
 * Kept verbatim so saving never drops it; rendered as a placeholder.
 */
export interface ForeignModule extends BaseModule {
	type: string;
}

export type AnyModule = Module | ForeignModule;

export const MODULE_TYPES = ['pdf', 'note', 'text', 'image', 'toc', 'frame', 'tracker'] as const;

export function isKnownModule(m: AnyModule): m is Module {
	return (MODULE_TYPES as readonly string[]).includes(m.type);
}

export interface ModuleStyle {
	padding?: number;
	border?: { width: number; color: string; radius?: number; [extra: string]: unknown };
	background?: string;
	opacity?: number;
	fontScale?: number;
	cssClass?: string;
	[extra: string]: unknown;
}

export interface ExportDefaults {
	format: 'pdf' | 'png';
	sheet: 'native' | SheetPreset | { w: number; h: number; [extra: string]: unknown };
	orientation: 'auto' | 'portrait' | 'landscape';
	tileOverlap: number;
	cropMarks: boolean;
	dpi: number;
	quality: 'best' | 'small';
	/** Pages smaller than the sheet: scale up to fill it (true) or print at actual size (default). */
	fitSmallPages?: boolean;
	/** Print a row/column label ("B3") on each tile. */
	tileLabels?: boolean;
	/** Ink saver (M4): PDF regions and images print grayscale and lightened (as images). */
	inkSaver?: boolean;
	/** Booklet (M4): saddle-stitch imposition, two pages per sheet side. */
	layout?: 'single' | 'booklet';
	/** Bleed (mm) printed beyond each page edge (M4); backgrounds and modules crossing the edge extend into it. */
	bleed?: number;
	[extra: string]: unknown;
}
