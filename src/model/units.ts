import type { DisplayUnit } from './schema';

// Storage is always mm (hard rule 4). These are the only conversions to other units.

/** CSS pixels per mm: CSS defines 96 px per inch. */
export const PX_PER_MM = 96 / 25.4;
/** PDF points per mm: PDF defines 72 pt per inch. */
export const PT_PER_MM = 72 / 25.4;

const MM_PER_UNIT: Record<DisplayUnit, number> = { mm: 1, cm: 10, in: 25.4 };

export const mmToPx = (mm: number) => mm * PX_PER_MM;
export const pxToMm = (px: number) => px / PX_PER_MM;
export const mmToPt = (mm: number) => mm * PT_PER_MM;
export const ptToMm = (pt: number) => pt / PT_PER_MM;

export const toUnit = (mm: number, unit: DisplayUnit) => mm / MM_PER_UNIT[unit];
export const fromUnit = (value: number, unit: DisplayUnit) => value * MM_PER_UNIT[unit];

const DECIMALS: Record<DisplayUnit, number> = { mm: 1, cm: 2, in: 2 };

/** "210", "21", "8.27": the number alone, for fields that show the unit next to the input. */
export function formatLengthValue(mm: number, unit: DisplayUnit): string {
	return String(Number(toUnit(mm, unit).toFixed(DECIMALS[unit])));
}

/** "210 mm", "21 cm", "8.27 in". Trailing zeros are dropped so whole values read cleanly. */
export function formatLength(mm: number, unit: DisplayUnit): string {
	return `${formatLengthValue(mm, unit)} ${unit}`;
}

/**
 * Parse user input like "21cm", "8.5 in", "210" (in `defaultUnit`). Returns mm, or null if unparseable.
 * Accepts a comma as decimal separator, which many European keyboards type.
 */
export function parseLength(input: string, defaultUnit: DisplayUnit): number | null {
	const m = /^\s*(-?\d+(?:[.,]\d+)?)\s*(mm|cm|in|")?\s*$/i.exec(input);
	if (!m) return null;
	const value = Number(m[1]!.replace(',', '.'));
	const raw = m[2]?.toLowerCase();
	const unit: DisplayUnit = raw === '"' ? 'in' : ((raw as DisplayUnit | undefined) ?? defaultUnit);
	return fromUnit(value, unit);
}
