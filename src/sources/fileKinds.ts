import type { TFile } from 'obsidian';

/** Image files Patchwork can place (what Chromium decodes). */
const IMAGE_EXT = /^(png|jpe?g|gif|webp|svg|bmp|avif)$/i;

export const isImage = (f: TFile) => IMAGE_EXT.test(f.extension);
export const isPdf = (f: TFile) => f.extension.toLowerCase() === 'pdf';
