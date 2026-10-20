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
- **Decided in SPEC v0.3** (section 7).
- If note A embeds note B and a module shows A, editing B must refresh the module.
- **Recommendation (updated by S2):** `MarkdownRenderer` expands embeds itself, so build each module's dependency set from `metadataCache.getFileCache(file).embeds`, recursively with a visited set, and re-render when any file in the set changes.

### Q8. Saves vs. external changes and rename rewrites
- **Save conflict check decided in SPEC v0.3** (section 6). Rename rewrites through the open view's store are still open.
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
- **Decided in M2 (SPEC v0.7):** option (a), several files named `-r1c1`, `-r1c2`, …
- A sheet over 8192 px per side at the chosen DPI (e.g. 1 m wide at 300 dpi = 11 811 px) can't be one canvas tile.
- Options: (a) write such sheets as multiple PNG files named by row/column (same labels as print tiling); (b) stream one large PNG ourselves, rendering one strip of rows at a time and compressing with Node's `zlib` (available in the renderer), so no giant canvas is ever needed; (c) cap DPI for oversized sheets.
- **Recommendation:** (b) if it stays small (a PNG writer is ~100 lines), else (a). Decide in M2.

### Q12. Minimum Obsidian version
- `minAppVersion` is raised only when an API needs it (SPEC 13); the `obsidianmd/no-unsupported-api` lint rule enforces this. Currently **1.6.6** (`FileManager.trashFile`).
- All behaviour is verified on **1.14.4** only. Some findings may be version-dependent (native embed rendering in `MarkdownRenderer`, the Mermaid guard). **Recommendation:** before the first release, either test on the oldest claimed version or raise `minAppVersion` to the oldest version actually tested.

### Q13. "Visible pages paint in under 1 s" with heavy PDF art
- Measured in M0 (`docs/perf.md`): a page with two crops of full-page rulebook illustrations takes 1.2–1.5 s the first time, bound by PDF.js decoding (one page at a time per document). Everything else meets the target.
- **Recommendation:** keep the target for warm content and for opening a board; for cold PDF pages, aim for "first crop within ~0.6 s, page complete within ~1.5 s" and make revisits instant with the M1 bitmap cache. Revisit after M1.

### Q14. Master pages: separate list or flagged pages?
- SPEC 6 planned a top-level `masters?: Master[]` with no shape defined. A separate list needs its own editing surface (every page tool would have to learn a second kind of page).
- **Chosen (M4, SPEC v0.8):** a master is an ordinary page with `isMaster: true`; pages use it with `master: "<page id>"`. Masters sit on the board like other pages, are edited with the same tools, and are left out of export, numbering, page ranges and the outline's numbers. Inherited modules are drawn below the page's own and can't be selected there. One level only (a master can't use a master).
- Easy to change while there are no users: a migration could move flagged pages into a `masters` list later. **Recommendation:** keep it unless you'd rather masters live off the board.

### Q15. What "stale-source warnings and freeze" mean
- SPEC 4 names the feature only. **Chosen (M4):** notes can be *frozen* (markdown snapshot stored in the board, badge flags later changes to the note). PDF crops remember which version of the PDF they were made on and warn when the file is replaced, since a new rulebook version can shift pages and crops.
- Not built: freezing PDF crops or images (would need stored image snapshots, e.g. PNGs next to the board), and stale warnings for live (unfrozen) notes, which change on purpose. **Recommendation:** wait for a real need; the stored-PNG route is straightforward if it comes up.

### Q16. Interface layout: sidebar, context bar, dialogs
- The inspector needs about 23 rows for a note or PDF module in a 300 px column, board settings live in four places (five of them duplicated), and several actions are only commands. Full inventory and proposal: `docs/ui-reorganisation.md` sections 1–3.
- **Recommendation:** a floating context bar plus a short tabbed properties popover for pages and modules, one Board dialog, an Export menu, and the inspector kept only as an optional dock. Nothing is lost: the command palette keeps every action.

### Q17. Editing notes in place (like Canvas)
- Obsidian has no public embeddable editor. Plain CodeMirror 6 is available without a new dependency; the Live Preview look needs undocumented internals (hard rule 6). Options A (text modules), B (notes, plain editor), C (internals) in `docs/ui-reorganisation.md` section 4.
- **Recommendation:** A, then B; spike C (S8) only if raw-markdown editing feels too bare. Double-click edits inline and "open note" moves to the context bar, right-click and Alt + double-click, which changes SPEC 5.x (changelog).

### Q18. Live Preview editing (option C)
- **Dropped (2026-10-20).** The user prefers a display mode to editing in Obsidian's editor: a patchwork gets a **Use** mode where content is live (links, checkboxes, plugin buttons) and nothing moves, next to today's **Arrange**. Plan and decisions: `docs/use-mode-plan.md`. In-place editing stays the plain text area (A and B).
