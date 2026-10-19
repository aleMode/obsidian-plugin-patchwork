# Open questions

Questions raised while building, each with the recommended answer we are proceeding on. Revisit at the milestone noted.

## Pinned for review

### Q1. Note `lines`: relative to the section or the file?
- **Current answer (provisional):** relative to the `subpath` section when one is set, otherwise to the whole note.
- **Why it's pinned:** line numbers drift whenever the source note is edited above the range. Section-relative is less fragile but not immune. Revisit once the line-range picker exists (M1), possibly in favour of anchoring to a block ID or heading instead.

### Q2. Tiling tolerance (ε = 0.1 mm)
- **Current answer:** tile count per axis is `max(1, ceil((page − overlap − ε) / (sheet − overlap)))` with ε = 0.1 mm, so float error like 297.0000001 mm never adds a near-empty tile. Overlap must be ≥ 0 and < sheet side.
- **Check at M2:** confirm with unit tests (exact fit, off-by-one, just-over-ε, overlap) **and** a real export that a page exactly N sheets wide gives N tiles, and that a page just over ε larger gets an extra tile. Also confirm that clipping up to 0.1 mm at the edge is invisible in print.

## Open

### Q3. Rename `page.label` to `numberLabel`?
- `page.name`, `page.label` (page-number override) and `module.label` are easy to confuse.
- **Recommendation:** rename to `numberLabel`. Not yet decided.

## Recommendations to verify during spikes

### Q4. Where does the print host live? (S1)
- Note modules are rendered by Obsidian's `MarkdownRenderer`, which needs the app context and app CSS. A fresh Electron window has neither.
- **Recommendation:** print from the main window (or an Obsidian pop-out window) with a print-only stylesheet that hides the app and shows the host. S1 must test this, not just whether `printToPDF` is reachable.

### Q5. How is PNG export rasterized?
- The spec says "rasterize each sheet in tiles" without saying how DOM becomes pixels.
- **Recommendation:** print to PDF, then render that PDF to PNG with Obsidian's bundled PDF.js. One renderer for both formats, identical output, no html2canvas dependency.

### Q6. Page layout units on screen
- **Recommendation:** lay out page content in real CSS mm (and note text in pt), zoom with a CSS transform. Screen and print then share one layout.

### Q7. Transitive embed dependencies
- If note A embeds note B and a module shows A, editing B must refresh the module.
- **Recommendation:** the link tracker keeps a dependency graph built during embed expansion, not just direct file references.

### Q8. Rename rewriting vs. an open board
- `vault.process` on a `.patchwork` file that is open with unsaved edits loses one side's changes.
- **Recommendation:** if the board is open, apply rename rewrites through its view/store (as an undoable command); use `vault.process` only for closed files. Define what happens to the undo stack when the file changes externally (git pull, Sync): reload and clear undo.
