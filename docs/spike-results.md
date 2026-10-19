# Spike results (S1–S7)

Run on 2026-10-19 against **Obsidian 1.14.4** (Flatpak, Linux), Electron 43.7.7, Chrome 150, PDF.js 5.3.34, device pixel ratio 1, app in **dark** theme. Code is in `spikes/`; raw reports and artifacts go to `.dev/spike-output/` (not committed).

All seven spikes pass (plus S8, added after review). None needs its fallback. Three findings change the plan (marked **Plan change**); they are proposals until reviewed.

## How the spikes were run

Obsidian was started with an isolated profile and remote debugging (`scripts/launchObsidian.sh`), and each spike was run inside it via `scripts/cdp.mjs`, a small Chrome DevTools Protocol client. The isolated profile only knows `./test-vault`, so personal vaults were never opened. The same loop can drive manual QA later.

Dataview 0.5.68 was installed into the test vault for S2 (downloaded from its GitHub releases; not committed).

## Summary

| Spike | Result | Chosen approach |
|---|---|---|
| S1 print to PDF | **Pass.** Vector text, exact custom sizes (tested 210×297, 1000×700, 5080×300 mm). | `@electron/remote` → `webContents.printToPDF({ preferCSSPageSize: true })` from the **main window**, print host carries class `print`, paper scope for light theme. Behind one adapter file. |
| S2 Markdown rendering | **Pass, better than expected.** Embeds render natively. | Use `MarkdownRenderer.render` as is. **Plan change:** drop our own embed expansion. |
| S3 PDF crop | **Pass.** Crop renders into a crop-sized canvas; cancellation, outline, text positions all work. | Viewport + offset transform; pass Obsidian's PDF.js asset URLs. |
| S4 canvas limits | Max area **16384² px (268 MP)**, max side **65535 px**. Failures are **silent**. | Tile cap **8192 × 8192 px**; verify each canvas with a pixel probe. |
| S5 mixed page sizes | **Pass.** CSS named pages give one PDF with different page sizes. | Named pages. **Plan change:** `pdf-lib` not needed for mixed sizes. |
| S6 `.patchwork` view | **Pass**, with one data-loss risk found. | `registerExtensions` + `TextFileView`. **Plan change:** guard saves against external changes. |
| S7 `.canvas` export | **Pass.** Heading, nested-heading and block subpaths work; PDF `#page=N` works. | Mapping in SPEC 9.3 confirmed as written. |
| S8 two-stage export | **Pass.** Vector PDF crops, vector tiling, bookmarks, page labels. Costs: larger files, hidden text outside crops. | Chromium for HTML + `@cantoo/pdf-lib` for assembly; per-module vector/raster/auto. Proposed, pending review. |

---

## S1 — Print to PDF

**Question:** how can a plugin call Chromium's print-to-PDF, and does `preferCSSPageSize` work?

**Findings**
- `require('@electron/remote').getCurrentWebContents().printToPDF(...)` is available to plugins and works. Each call took 15–30 ms for these sheets.
- `preferCSSPageSize: true` with `@page { size: W H; margin: 0 }` gives the requested size. Sizes come back with small rounding: 210 × 297 mm → 209.89 × 297.01 mm; 1000 × 700 → 1000.17 × 699.94. Negligible for print; don't assert exact sizes in tests.
- The Electron `pageSize: { width, height }` (inches) option also works when `preferCSSPageSize` is false.
- **Text stays vector**: PDF.js extracts all text from the output (61 text items on the A4 test page, including rendered markdown and embeds).
- Canvases and images print as raster, as expected.
- **Blank-page trap:** Obsidian's own print CSS hides `body > :not(.print)`. A host without the `print` class prints **blank** pages (confirmed both ways). Obsidian's own "Export to PDF" uses the same class, so this is a stable convention, and it also gives us Obsidian's print styles (e.g. PDF embed toolbars hidden).
- **Chromium has no 5080 mm guard:** a 6000 × 300 mm page was produced without complaint. That exceeds the PDF limit (14 400 units), so our own guard in SPEC 9.2 is required.
- `generateDocumentOutline: true` produced **no** outline from headings. Revisit for M4 bookmarks (maybe it needs `generateTaggedPDF: true`).
- How Obsidian's own export works: it opens a separate window, switches that window's body to `theme-light`, adds a `.print` div and sends an internal IPC message (`print-to-pdf`) to the main process. Both that channel and `@electron/remote` are undocumented for plugins.

**Light paper scope (spec 5.5)**
- Adding `theme-light` to a subtree **does nothing** in a dark app. Obsidian defines the base colours (`--color-base-00` …) on `.theme-light` / `.theme-dark`, but ~900 derived variables (`--background-primary: var(--color-base-00)`, `--text-normal`, …) on `body`, where they are resolved once.
- **Fix that works:** at runtime, copy every custom property declared on `body` into a `.pw-paper { … }` rule, and give paper elements `pw-paper theme-light`. Measured in a dark app: text `#222`, background `#fff`, links and callouts in their light variants. Pure CSS, no internals. Needs re-running when the theme or CSS snippets change (`css-change` event).

**Chosen approach:** print from the main window. Offscreen host `div.pw-print-host.print` holding one `.pw-sheet.pw-paper.theme-light` per output sheet, `@media print` rules that show only the host, then `printToPDF`. `@electron/remote` lives in **one adapter file** (`export/printAdapter.ts`) per hard rule 6, with `window.print()` + the system dialog as the documented fallback if `remote` disappears.

**Fallback needed:** no.

## S2 — `MarkdownRenderer.render`

**Question:** what does it handle?

| Feature | Result |
|---|---|
| Whole-note embed `![[Fireball]]` | ✅ rendered, frontmatter excluded |
| Section embed `![[Combat#Prone]]` | ✅ only that section (does not leak into the next) |
| Nested heading path | ✅ (seen in S7 via Canvas, same resolver) |
| Block embed `![[Combat#^opportunity]]` | ✅ |
| Image embed `![[Map.png\|200]]` | ✅ loaded |
| PDF embed `![[…pdf#page=2]]` | ⚠️ renders a **full interactive PDF viewer** with toolbar. Obsidian's print CSS hides the toolbar in print. |
| Callouts, tables, highlighted code, math | ✅ |
| Mermaid | ⚠️ Obsidian 1.14 **guards Mermaid per vault** ("Display Mermaid diagrams in this vault?"). Until allowed, the guard box renders (and would print). After allowing, new renders produce the SVG. |
| Dataview (0.5.68) | ✅ table rendered |
| Embed cycle A ↔ B | ✅ terminates (Obsidian stops it itself) |
| 4-deep embed chain | ✅ all levels rendered (Obsidian's own limit is deeper than our planned 3) |

- Rendering into a **detached** element (not in the document) also works, but async parts (embeds, Dataview) need the element attached to settle reliably. We should mount into an attached, offscreen container.
- Render calls took 2–400 ms. The 400 ms was the embed-heavy note with a PDF embed.
- `metadataCache` gives what `markdownSource` needs for slicing: headings with levels and lines, block IDs with line ranges, typed sections (`code`, `callout`, `table`, …) and the frontmatter end line. Code blocks are typed sections, so a `# fake heading` inside a fence is correctly **not** a heading.

**Plan change (proposed):** remove "pre-expand embeds ourselves with cycle detection and a depth limit of 3" from SPEC 7. We still need the **transitive dependency set** of each note module for live updates (Q7). Build it from `metadataCache.getFileCache(f).embeds`, recursively, instead of from our own expansion.

**Follow-ups:** decide how PDF embeds inside notes look on the board and in export (Q9). Detect a guarded Mermaid block during export settle and warn (Q10).

## S3 — PDF.js crop rendering

**Question:** can `loadPdfJs()` render a cropped region at 2× without allocating the full page? Are outline and text available?

- `loadPdfJs()` returns PDF.js **5.3.34**.
- Cropping by rendering with the full-page viewport plus `transform: [1, 0, 0, 1, -x, -y]` into a canvas sized to the crop works. Stat-block crop at 2×: **511 × 454 px** canvas instead of the full page's 1191 × 1684. At 12× (~860 dpi) a small crop is 1361 × 681 px (4 MB); the full page would be 7144 × 10103 (275 MB). Renderer memory rose by ~9 MB.
- Pixel checks and visual checks match the fixture (box fill colour, ruler positions).
- **Crop after intrinsic rotation:** on page 3 (`/Rotate 90`) the crop is taken on the page *as displayed* (297 × 210 mm) and comes out rotated as displayed, which matches the decided rule (SPEC 5.3).
- **Cancellation:** `renderTask.cancel()` rejects with `RenderingCancelledException`. Works for the scheduler.
- **Outline:** `getOutline()` + `getDestination()` + `getPageIndex()` give nested titles with 1-based page numbers. Ready for the M3 outline picker.
- **Text positions:** `getTextContent()` items + `viewport.convertToViewportPoint()` gave the exact normalized position of "Goblin Skirmisher" (0.1143, 0.5320 vs. expected 0.1143, 0.5320). Ready for M3 search-to-region.
- Timing: whole spike ~90 ms on the 4-page fixture.
- Pass Obsidian's own PDF.js asset URLs to `getDocument` (`cMapUrl`, `standardFontDataUrl`, `wasmUrl`, `iccUrl` under `/lib/pdfjs/`), as its viewer does. Standard fonts rendered fine without them (system fonts), but CJK CMaps, JPEG 2000 and ICC profiles need them. These paths are app assets, not API, so keep them in `sources/pdfSource.ts` with a comment.
- Avoid Electron's `process.getProcessMemoryInfo()` for measuring: it stalled for **15 s** after `doc.destroy()`. Use `process.memoryUsage()`.

### S3 on a real rulebook (`spikes/src/s3Real.ts`)

Measured on a 63.7 MB, 159-page (Letter), image-heavy adventure PDF with a 47-entry outline. The file is kept locally and never committed (`.gitignore`).

| Measurement | Result |
|---|---|
| Open document | ~130 ms (both `data` and `url` loading) |
| Memory after open + first thumbnail | +200–250 MB renderer RSS (`url` slightly lower); most of it released after `doc.destroy()` |
| Full page at 2× (1224 × 1584 px), first render | 190–550 ms |
| Crop at 2× on a **cold** page | 120–215 ms. Cropping saves **memory**, not time: decoding the page's images dominates. |
| Re-render of an already-rendered page at another scale | 2–5 ms (PDF.js keeps decoded images on the page object) |
| Main-thread blocking per cold render | at most one long task of ~60 ms; often none (parsing and decoding run in the worker) |
| Thumbnails at 0.2× | ~180 ms per page (20 pages in 3.6 s) |
| Cancel a 4× render after 30 ms | ✅ `RenderingCancelledException` |
| Text extraction per page | 2–8 ms |

**Implications for the design:**
- Keep `PDFPageProxy` objects for visible modules alive (LRU), so zoom changes re-render in milliseconds; cache output bitmaps per (file, page, crop, scale).
- Limit PDF render concurrency to 1–2 and show a placeholder or low-res bitmap while rendering (LOD).
- A page picker must render thumbnails lazily and cache them: eagerly thumbnailing 159 pages would take ~30 s. The outline picker (M3) is the faster route.
- The "visible pages paint in under 1 s" target holds for a page with a couple of crops from this book.

## S4 — Canvas limits

**Question:** safe canvas sizes for raster export.

| Size | Megapixels | Works |
|---|---|---|
| 8192 × 8192 | 67 | ✅ |
| 16384 × 16384 | 268 | ✅ |
| 16384 × 16385 | 268+ | ❌ |
| 20000 × 14000 | 280 | ❌ |
| 65535 × 512 | 34 | ✅ |
| 65536 × 512 | 34 | ❌ |

- Same limits for `HTMLCanvasElement` and `OffscreenCanvas`. Limits: **area ≤ 268 435 456 px (16384²)** and **side ≤ 65535 px**.
- Failure is **silent**: no exception, the context exists, but pixels read back as transparent. Export must verify each canvas (draw and read one pixel) and fail loudly.
- PNG encode (`convertToBlob`): 4096² in 116 ms, 8192² in 433 ms.

**Chosen approach:** raster tile cap **8192 × 8192 px** (256 MB RGBA), a 4× safety margin under the area limit and modest memory. With a pixel probe on every allocated canvas.

## S5 — Mixed page sizes in one PDF

**Question:** can one PDF mix page sizes via CSS named pages?

- **Yes.** `@page pw-s0 { size: 210mm 297mm }`, `.pw-sheet[data-i="0"] { page: pw-s0 }` and so on gave a 5-page PDF of A4 portrait, A4 landscape, Letter, 1000 × 700 and A5, in order, with no blank pages, nothing clipped.
- Without named pages (one `@page` rule) every page is A4 and an extra blank page appears.

**Plan change (proposed):** `pdf-lib` is **not** needed for `sheet: "native"` exports. It stays a research item only for vector PDF pass-through (post-M4). Update SPEC 13 accordingly.

## S6 — `.patchwork` file view

**Question:** does `registerExtensions` + `TextFileView` give a creatable, visible file with reliable save and rename?

| Check | Result |
|---|---|
| `vault.create('x.patchwork')` | ✅ |
| Shows in the file explorer | ✅ with a "PATCHWORK" extension badge |
| Opens in our view | ✅ `setViewData(data, clear=true)` |
| `requestSave()` | ✅ written after **~2.0 s** (debounce) |
| Rename while open | ✅ view follows the new path; next save goes to the new path; old path not recreated |
| External change, view clean | ✅ `setViewData(newData, clear=false)` is called |
| External change, **save pending** | ❌ **our pending save overwrote the external change** (external rev 5 lost, file ended at rev 4); `setViewData` was not called |
| Close tab with a pending save | ✅ flushed |
| Unparseable content | View receives the raw text; safety is up to us (hard rule 2) |

**Plan change (proposed):** wrap saves with a conflict check. Remember the text we last loaded or saved. Before writing, compare it with what's on disk (`vault.read`). If they differ, don't write: reload from disk if we have no unsaved changes, otherwise show a conflict notice (keep ours / take theirs / save ours as a copy). This matters with Obsidian Sync and git. Same idea for rename rewrites (Q8).

Also: `setViewData(…, clear=false)` on an external change should rebuild the model; the undo history becomes invalid then. Clear it (Q8).

**Correction found in M0:** in a real view, Obsidian calls `setViewData(diskText, false)` on an outside change **even when edits are pending**, which silently drops them (the spike missed this because it wrote `TextFileView.data` directly). The guard therefore runs in two places: in `setViewData` (a reload arriving with unsaved edits) and in `save` (disk changed before our write). Covered by `scripts/e2e/fileView.js`.

## S7 — `.canvas` interop

**Question:** does native Canvas open our generated `.canvas`, and do subpaths and `#page=N` work?

- Canvas opened the file; all 7 nodes rendered.
- `file` node with `subpath: "#Prone"` → only the Prone section. `#Conditions#Prone` (nested path) → same. `#^opportunity` → the block.
- `file` node for a PDF with `subpath: "#page=2"` → PDF viewer opened at **page 2**, as a full scrollable viewer (no crop).
- `group` node label shows as the page name. `text` node renders markdown. Image node shows the image.

**Decision for SPEC 9.3:** keep the mapping as written. PDF modules export as `file` + `subpath: "#page=N"`; crop, rotation and style are dropped (listed in the export dialog).

## S8 — Two-stage export: Chromium + pdf-lib (added after review)

**Question:** can we keep Chromium for the HTML layer but place PDF modules as **vector** (sharp, selectable) and do document-level work (tiling, bookmarks, page labels, metadata) with `pdf-lib`? Run on an A4 board with a note module and four PDF crops: fixture stat block, fixture rotated page, and two crops from the real rulebook (a text column with a sidebar box, and a colour illustration). Code: `spikes/src/s8Hybrid.ts`.

**Method:** Chromium prints the sheet with PDF module areas left empty. `pdf-lib` loads that PDF and each source PDF, `embedPage(page, cropBox)` turns each crop into a Form XObject clipped to the crop, and `drawPage` places it with contain-fit (rotated −90° for a `/Rotate 90` source page). The raster variant puts 200 dpi canvases in the same print for comparison.

| Check | Result |
|---|---|
| Placement and clipping | ✅ all four crops land exactly in their boxes, matching the raster variant; the `/Rotate 90` crop is oriented correctly |
| Sharpness | ✅ vector stays crisp at ~576 dpi zoom; raster at 200 dpi is visibly soft (`.dev/spike-output/s8-zoom-*.png`) |
| Text in crops | ✅ selectable and searchable (251 text items vs 84 in the raster variant) |
| Bookmarks (outline) | ✅ added via `pdf-lib` low-level objects |
| Page labels | ✅ `/PageLabels` gave "i", "7" in PDF.js |
| Metadata | ✅ title, creator |
| Vector tiling | ✅ a 1000 × 700 mm printed page → 15 A4 sheets (5 × 3), each a clipped vector copy, edge tiles padded, row/column label drawn |
| Time | vector 1.7 s vs raster 2.2 s for this sheet; `pdf-lib` parsed the 64 MB rulebook in ~780 ms; compose + save 50–75 ms |
| Library | `pdf-lib` 1.17.1 (last release 2021) and the maintained fork `@cantoo/pdf-lib` 2.11.1 (Sept 2026) both ran the code unchanged with identical results |

**Two costs found:**
1. **File size.** A Form XObject carries the **whole source page's resources**, not just the visible part. The vector sheet was **5.9 MB vs 0.6 MB** raster, mostly because the illustration crop embeds the full-resolution artwork and the text crop embeds the page's paper texture. Text-only or vector-art pages stay small.
2. **Hidden text.** Text outside the crop is still in the file: searching the exported PDF finds text you can't see (probe: fixture page 1 text outside the stat block was found). Copy/select can pick it up too. Removing it would mean rewriting content streams (out of scope).

Also by construction: vector PDF modules are drawn **after** the HTML layer, so they sit on top of everything; a module that has other modules stacked above it must fall back to raster.

**Recommendation:** adopt the two-stage pipeline.
- Stage 1 (Chromium) prints each board page at its native size, PDF modules left empty.
- Stage 2 (`pdf-lib`) places PDF modules, then builds output sheets: native, scaled, or tiled (vector), and adds bookmarks, page labels and metadata. Booklet imposition and crop marks (M4) fit the same stage.
- PDF modules get a **render mode**: `vector` (sharp, selectable, can be large), `raster` (small, at export DPI), or `auto` (default). `auto` picks vector unless the module is overlapped from above, or embedding its page would add more than a size threshold (e.g. 2 MB) of resources. The export dialog can override all modules at once ("smallest file" / "best quality").
- Use the maintained fork `@cantoo/pdf-lib` (MIT, ~580 KB minified, ~245 KB gzip). Justification: Chromium can't place vector PDF content or write outlines/labels, and this is the only way to get sharp crops from rulebooks.
- PNG export is unchanged: rasterize the final PDF with PDF.js.

---

## Proposed changes to the plan (for review)

1. **SPEC 7:** drop our own embed pre-expansion; `MarkdownRenderer.render` handles embeds. Build the dependency set from `metadataCache` embeds.
2. **SPEC 9.1 / 13:** printing goes through `@electron/remote` `printToPDF` from the main window, isolated in one adapter. Mixed sizes via named pages; `pdf-lib` is not needed for v1.
3. **SPEC 5.5:** describe the paper-scope mechanism (re-declare `body` variables under `.pw-paper.theme-light`).
4. **SPEC 6 (file I/O):** saves check for external changes before writing; never silently overwrite.
5. **SPEC 8 / 9.2:** raster tile cap 8192 px per side with pixel-probe verification.

## Needs your input

- **2× display scaling** wasn't tested (this machine runs at 1×).
