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

export type Module = PdfModule | NoteModule | TextModule | ImageModule;

/**
 * A module whose `type` this version doesn't know (written by a newer plugin, or hand-edited).
 * Kept verbatim so saving never drops it; rendered as a placeholder.
 */
export interface ForeignModule extends BaseModule {
	type: string;
}

export type AnyModule = Module | ForeignModule;

export const MODULE_TYPES = ['pdf', 'note', 'text', 'image'] as const;

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
	[extra: string]: unknown;
}
