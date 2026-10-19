# Open questions

Questions raised while building, each with the recommended answer we are proceeding on. Revisit at the milestone noted.

## Pinned for review

### Q1. Note `lines`: relative to the section or the file?
- **Current answer (provisional):** relative to the `subpath` section when one is set, otherwise to the whole note.
- **Why it's pinned:** line numbers drift whenever the source note is edited above the range. Section-relative is less fragile but not immune. Revisit once the line-range picker exists (M1), possibly in favour of anchoring to a block ID or heading instead.

### Q2. Tiling tolerance (ε = 0.1 mm)
- **Current answer:** tile count per axis is `max(1, ceil((page − overlap − ε) / (sheet − overlap)))` with ε = 0.1 mm, so float error like 297.0000001 mm never adds a near-empty tile. Overlap must be ≥ 0 and < sheet side.
- **Check at M2:** confirm with unit tests (exact fit, off-by-one, just-over-ε, overlap) **and** a real export that a page exactly N sheets wide gives N tiles, and that a page just over ε larger gets an extra tile. Also confirm that clipping up to 0.1 mm at the edge is invisible in print.
- **Note from S1:** Chromium rounds printed page sizes slightly (210 mm → 209.89 mm), so the export test should allow ~0.3 mm.

## Resolved

### Q3. Rename `page.label` to `numberLabel`?
- **Decided (2026-10-19):** renamed to `page.numberLabel` in SPEC v0.2.

### Q4. Where does the print host live? (S1)
- **Answered by S1:** the main window. Host `div.pw-print-host.print` (Obsidian's print CSS hides `body > :not(.print)`), sheets with the paper scope, `@electron/remote` `printToPDF` behind one adapter. See `docs/spike-results.md`.

## Open

### Q5. How is PNG export rasterized?
- **Recommendation:** print to PDF, then render that PDF to PNG with Obsidian's PDF.js. One renderer for both formats.
- **Evidence from spikes:** S1/S5 already rasterized their printed PDFs this way for inspection, and S4 sets the tile cap (8192 px per side).

### Q6. Page layout units on screen
- **Recommendation:** lay out page content in real CSS mm (and note text in pt), zoom with a CSS transform. Screen and print then share one layout.

### Q7. Transitive embed dependencies
- If note A embeds note B and a module shows A, editing B must refresh the module.
- **Recommendation (updated by S2):** `MarkdownRenderer` expands embeds itself, so build each module's dependency set from `metadataCache.getFileCache(file).embeds`, recursively with a visited set, and re-render when any file in the set changes.

### Q8. Saves vs. external changes and rename rewrites
- **S6 found data loss:** an external change (Sync, git) arriving while our debounced save is pending gets overwritten silently.
- **Recommendation:** remember the last loaded/saved text; before writing, compare with disk. If different: reload when we have no unsaved changes, otherwise show a conflict notice (keep ours / take theirs / save ours as a copy). Clear undo history when the model is reloaded from disk.
- Rename rewrites: if the board is open, apply through its store (undoable); use `vault.process` only for closed files.

### Q9. PDF embeds inside note modules
- `![[file.pdf#page=2]]` inside a note renders Obsidian's full PDF viewer (heavy, interactive, scrolls).
- **Recommendation:** on the board, replace PDF embeds inside note modules with a static render of that page through our own PDF pipeline (shared cache), or a placeholder linking to "convert to PDF module". Decide in M1.

### Q10. Mermaid guard
- Obsidian 1.14 asks per vault before rendering Mermaid; until allowed, the guard box renders in its place.
- **Recommendation:** during export settle, detect `.mermaid-wrapper.is-guarded` and warn ("allow Mermaid diagrams in this vault first") instead of printing the guard box.

### Q11. PNG sheets larger than the raster tile cap
- A sheet over 8192 px per side at the chosen DPI (e.g. 1 m wide at 300 dpi = 11 811 px) can't be one canvas tile.
- Options: (a) write such sheets as multiple PNG files named by row/column (same labels as print tiling); (b) stream one large PNG ourselves, rendering one strip of rows at a time and compressing with Node's `zlib` (available in the renderer), so no giant canvas is ever needed; (c) cap DPI for oversized sheets.
- **Recommendation:** (b) if it stays small (a PNG writer is ~100 lines), else (a). Decide in M2.
