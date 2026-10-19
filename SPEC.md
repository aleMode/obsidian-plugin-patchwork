# Patchwork — Product & Technical Spec

Status: draft v0.4 · 2026-10-19 · Target: Obsidian desktop plugin (TypeScript)

## 1. Summary

Patchwork is an Obsidian plugin for composing **boards**. A board is an infinite pan/zoom surface that holds **pages** (fixed-size, real-unit rectangles). Pages hold **modules**: live references to parts of other files (a note, a heading section, a block, a cropped region of a PDF page, an image) plus free text. Boards are viewed side by side on screen and exported to PDF or PNG.

It is a new plugin, not a fork of Multi-Column Markdown (MCM). MCM carves up the text of a single note with inline tags and inherits Live Preview fragility. Patchwork is a separate layout document with its own editor view. No MCM code is reused (MCM is GPL-3.0); MCM-style column groups may be added later as a native module type.

## 2. Decisions already made (do not relitigate)

| # | Decision |
|---|---|
| D1 | New plugin named **Patchwork**. |
| D2 | Own file format `.patchwork` (JSON) is the source of truth. One-way **export to `.canvas`** for interop. Never edit `.canvas` as primary storage; do not hook into Canvas internals. |
| D3 | **Fixed pages with free-positioned modules.** No auto-pagination or reflow engine in v1. |
| D4 | **Real units.** Everything stored in millimetres. The grid is a snapping aid, not a sizing rule (so A4 = 210 × 297 mm exactly). |
| D5 | Optional **non-printing safe-area** guide per page, never enforced. |
| D6 | **Desktop only.** `isDesktopOnly: true`. No tablet/mobile work. |
| D7 | Sources live inside the vault. `.md` notes are first-class; PDFs are equally important for the main use case. Files outside the vault are out of scope. |
| D8 | **Performance is a feature**, not a late polish pass. Virtualize, cache, budget memory, and test with a stress board from M0. |
| D9 | Pages bigger than the chosen output sheet are **split regularly into tiles** of the chosen sheet size. Max single PDF page is 200 in (5080 mm) per side; larger pages must be tiled. |
| D10 | Feature priority order is the order in section 4. |

## 3. Primary use case

The author plays D&D and keeps rules as `.md` notes (previously exported to PDF one long page at a time) plus PDF rulebooks.

- As a player, I want to put a spell list, a monster stat block, and a rules note on one sheet, side by side, without copy-pasting text.
- As a player, I want to crop a region of a rulebook PDF page and place it next to other content.
- As a player, I want several pages visible side by side on screen instead of one endless scroll.
- As a player, I want edits to my source notes to show up on the board automatically.
- As a player, I want to export A4/Letter PDFs (or PNGs) with page numbers, and print a very large board as multiple regular sheets.

## 4. Scope and priority

**v1 core (M0–M2)**
- PDF module (page, crop rectangle, rotate, fit mode) and note module (whole note, heading section, block, line range). Text and image modules.
- Board with pan/zoom, grid, real-unit rulers, resizable and movable pages, custom sizes and presets.
- Page numbers (start offset, format, position, skip first page), header/footer text with tokens (`{page}`, `{pages}`, `{title}`).
- Undo/redo, align/distribute, duplicate, lock, z-order, smart snapping guides.
- Auto-arrange pages in a row/grid.
- Export to PDF (all / selected / range) and PNG, with tiling when a page exceeds the output sheet.
- Non-printing safe-area guide.

**Next (M3–M4), in this order**
1. Pick a PDF section from its outline instead of typing page numbers.
2. Search a PDF for a term and create a module from the matching region.
3. Saved views (named camera positions on the board).
4. Dark-mode viewing for PDF modules and an ink-saver print mode.
5. Booklet imposition, bleed and crop marks, poster-tiling polish (labels, overlap).
6. Master pages (header/footer defined once).
7. Table of contents and PDF bookmarks generated from page names.
8. Stale-source warnings and a per-module "freeze" snapshot.

**Later (M5)**
- Linked text frames that flow content between boxes.
- Interactive modules (checkboxes, counters, trackers) with state saved in the file.

**Non-goals**
- Mobile or tablet support.
- A reflow/pagination engine (Paged.js / Vivliostyle style).
- Editing PDFs or annotating inside source PDFs.
- Replacing Obsidian's native Canvas.
- Real-time collaboration.

## 5. Concepts and UX

### 5.1 Board
- Opens as a custom view for `.patchwork` files. Pan (wheel/trackpad, space+drag), zoom (ctrl+wheel, pinch, buttons, zoom-to-fit-all, zoom-to-fit-page), minimap in M3.
- Rulers in the user's display unit (mm / cm / in). Display unit is a setting; storage is always mm.
- Grid default 5 mm, toggleable snap, hold Alt to bypass snap.

### 5.2 Pages
- A page has position `(x, y)` on the board and a size `(w, h)` in mm. Presets: A3, A4, A5, A6, Letter, Legal, Tabloid, 16:9 slide, square, custom. Orientation swap button.
- Pages can be any size up to the 5080 mm per-side output limit. Larger pages are rejected at creation with an explanation (or allowed only if the user acknowledges export will tile).
- Optional `safeArea` insets (mm) drawn as a dashed non-printing guide. Defaults from board settings. Modules are never constrained by it.
- Modules are clipped to the page bounds at render and export time. Dragging a module so its center crosses into another page re-parents it.

### 5.3 Modules
Common: position/size (mm, relative to page), `z`, `locked`, `label`, `style` (padding, border, background, opacity, font scale, css class).

| Type | Purpose | Key options |
|---|---|---|
| `pdf` | A page (or crop) of a vault PDF | `file`, `page`, `crop` (normalized), `fit`, `rotation`, `invert` (M4), `renderDpi`, `render` (vector/raster/auto) |
| `note` | Live view of a `.md` file or part of it | `file`, `subpath`, `lines`, `includeHeading`, `overflow`, `scale` |
| `text` | Free markdown written in the board | `markdown` |
| `image` | A vault image | `file`, `fit` |

Note module rules:
- `subpath` forms: `#Heading`, `#Parent#Child`, `#^blockid`. Heading section = from the heading line to the line before the next heading of equal or higher level.
- Frontmatter is stripped by default. `includeHeading` toggles the heading line itself.
- `lines` is relative to the `subpath` section when one is set, otherwise to the whole note. (Provisional; see `docs/open-questions.md`.)
- Overflow policy: `clip`, `fit` (uniform shrink down to a configurable minimum scale, then clip), or `grow` (module height follows content). The grown height is computed at render time and never written to the file; the stored `h` is left untouched, so opening a board never modifies it. In edit mode an overflow indicator is always shown; it never appears in exports.
- Missing file or section: placeholder with a "pick another" action. Never silently blank.

PDF module rules:
- Crop is stored as normalized `[x0, y0, x1, y1]` (0–1, top-left origin) of the PDF page so it survives zoom and DPI changes.
- Crop is applied first, on the page as normally displayed (the PDF's own page rotation already applied). The module's `rotation` then rotates the cropped result.
- A crop editor lets the user drag a rectangle over the PDF page preview.
- `fit`: `contain` (default), `cover`, or `stretch`.

### 5.4 Page order and numbering
- Default order is reading order (rows top to bottom by y-band, then left to right). Manual override via `board.pageOrder` (a list of page IDs, used when `order` is `"manual"`). Pages missing from the list follow in reading order; IDs with no matching page are ignored and removed on save. Auto-arrange can rewrite positions.
- Board-level numbering: enabled, start offset, format (`arabic`, `roman`, `alpha`), position (6 presets), skip-first-page. Per-page override via `page.numberLabel`: a custom string printed instead of the number, or `false` to hide it. Pages with a custom or hidden number (including the first page under skip-first-page) still count: numbering continues normally on the next page and they are included in `{pages}`.
- Header/footer text per page and board default, with tokens `{page}`, `{pages}`, `{title}`, `{date}`.
- `{page}` and `{pages}` count **board pages**, not output sheets. A page split into tiles keeps one page number; individual tiles are identified by their row/col label (section 9.2).

### 5.5 Theming
- Export and on-screen "paper" always use a **light scope** by default (CSS variable overrides) so dark-mode vaults do not produce white-on-white pages. Board setting `useAppTheme` opts out.
- Mechanism (spike S1): a nested `.theme-light` alone does nothing, because Obsidian declares its derived variables (`--background-primary`, `--text-normal`, …) on `body`, where they resolve once against the app theme. At runtime we copy every custom property declared on `body` into a `.pw-paper { … }` rule, and paper elements get `pw-paper theme-light`, so the variables resolve against the light base colours. Rebuild that rule on `css-change` (theme or snippet changes).
- Board-level font override optional. Per-module font scale.

### 5.6 Editing interactions
- Drag a file from the file explorer onto a page: `.md` becomes a `note` module, `.pdf` becomes a `pdf` module (page 1, with a page picker), images become `image` modules.
- Double-click a note module opens a source side-pane at that section. Double-click a PDF module opens the crop editor.
- Inspector panel (right side) edits the selection. Outline panel lists pages and modules.
- Multi-select, align, distribute, duplicate, lock, z-order, smart guides, arrow-key nudge, undo/redo.

## 6. Data model

Stored as pretty-printed JSON (2 spaces, stable key order) so it diffs well in git.

```ts
export const SCHEMA_VERSION = 1;

export interface PatchworkFile {
  version: number;                       // SCHEMA_VERSION
  unit: "mm";                            // storage unit, always mm
  meta?: { title?: string; created?: string };   // no `modified`: it would churn every save
  board: BoardSettings;
  pages: Page[];
  masters?: Master[];                    // M4
  views?: SavedView[];                   // M3
  [extra: string]: unknown;              // unknown keys preserved on round-trip
}

export interface BoardSettings {
  grid: { size: number; snap: boolean; visible: boolean };      // mm, default 5
  displayUnit: "mm" | "cm" | "in";
  order: "reading" | "manual";
  pageOrder?: string[];                  // page IDs; used when order = "manual"
  numbering: {
    enabled: boolean; start: number;
    format: "arabic" | "roman" | "alpha";
    position: "bottom-center" | "bottom-left" | "bottom-right" | "top-center" | "top-left" | "top-right";
    skipFirst: boolean;
  };
  defaultSafeArea?: Insets;              // mm
  header?: string; footer?: string;      // tokens allowed
  useAppTheme: boolean;                  // default false
  fontFamily?: string;
  export: ExportDefaults;
}

export interface Insets { top: number; right: number; bottom: number; left: number }

export interface Page {
  id: string;
  name?: string;
  x: number; y: number; w: number; h: number;   // mm on the board
  safeArea?: Insets;
  background?: string;
  numberLabel?: string | false;                  // page-number override; false hides it
  header?: string; footer?: string;
  modules: Module[];                             // draw order = array order unless z set
}

export type Module = PdfModule | NoteModule | TextModule | ImageModule;

export interface BaseModule {
  id: string; x: number; y: number; w: number; h: number;   // mm, relative to page
  z?: number; locked?: boolean; label?: string; style?: ModuleStyle;
}

export interface PdfModule extends BaseModule {
  type: "pdf"; file: string; page: number;       // 1-based
  crop?: [number, number, number, number];      // normalized x0,y0,x1,y1
  fit?: "contain" | "cover" | "stretch";
  rotation?: 0 | 90 | 180 | 270;
  invert?: boolean;                              // M4
  renderDpi?: number;
  render?: "auto" | "vector" | "raster";        // export rendering, default "auto" (section 9.1)
}

export interface NoteModule extends BaseModule {
  type: "note"; file: string;
  subpath?: string;                              // "#Heading" | "#^block"
  lines?: [number, number];                      // relative to the subpath section if set
  includeHeading?: boolean;
  overflow?: "clip" | "fit" | "grow";
  scale?: number;
}

export interface TextModule extends BaseModule { type: "text"; markdown: string }
export interface ImageModule extends BaseModule { type: "image"; file: string; fit?: "contain" | "cover" | "stretch" }

export interface ModuleStyle {
  padding?: number; border?: { width: number; color: string; radius?: number };
  background?: string; opacity?: number; fontScale?: number; cssClass?: string;
}

export interface ExportDefaults {
  format: "pdf" | "png";
  sheet: "native" | "A4" | "A3" | "A5" | "Letter" | "Legal" | "Tabloid" | { w: number; h: number };
  orientation: "auto" | "portrait" | "landscape";
  tileOverlap: number;                           // mm
  cropMarks: boolean;                            // M4
  dpi: number;                                   // raster modules, default 200
  quality: "best" | "small";                     // "small" forces raster PDF modules; default "best"
}
```

Rules:
- **Round-trip safety:** preserve unknown keys at every level. Never drop data you do not understand.
- **Migration:** `version` is checked on load; `migrate.ts` upgrades step by step. A file with a newer version than the plugin opens read-only with a warning.
- **Corrupt file:** if parsing fails, show an error view with the raw text and a copy button. Never overwrite the file.
- **External changes:** never silently overwrite a change made outside the view (Sync, git, another editor). Remember the text last loaded or saved; before writing, compare it with the file on disk. If they differ: reload from disk when there are no unsaved changes, otherwise show a conflict notice (keep mine / take theirs / save mine as a copy). Reloading from disk clears the undo history. (Spike S6 showed the default `TextFileView` debounced save does overwrite.)
- **IDs:** short random strings, unique within the file.
- **Paths:** vault-relative. On vault `rename`, rewrite references in every `.patchwork` file (use `vault.process` for atomic edits). On `delete`, keep the reference and mark the module missing.

## 7. Architecture

Stack: TypeScript (strict), esbuild, Obsidian API, vanilla DOM (Obsidian's `createEl` helpers) for the board to keep the bundle small, Vitest for pure logic. Start from the official `obsidian-sample-plugin` template. Runtime dependency: `@cantoo/pdf-lib` (MIT, maintained fork of `pdf-lib`, ~580 KB minified), justified by spike S8: Chromium cannot place vector PDF content or write bookmarks and page labels.

```
src/
  main.ts                  plugin entry: registerView, registerExtensions, commands, settings
  settings.ts
  model/                   PURE, no Obsidian imports, fully unit-tested
    schema.ts defaults.ts migrate.ts validate.ts units.ts geometry.ts
    ordering.ts numbering.ts tiling.ts snapping.ts
  store/                   board state, selection, undo/redo (command pattern, drag coalescing)
  view/                    PatchworkView (TextFileView), BoardViewport, PageFrame, ModuleHost,
                           Inspector, Outline, Toolbar, guides, cropEditor
  modules/                 registry + pdfModule, noteModule, textModule, imageModule
  sources/                 markdownSource (resolve file/subpath/lines), pdfSource (doc cache, render,
                           outline, text search), linkTracker (rename/delete/modify)
  render/                  scheduler (queue, priorities, cancel), bitmapCache (LRU), virtualization
  export/                  printAdapter (@electron/remote, isolated), printHost, settle, assemble
                           (pdf-lib stage: vector modules, sheets, tiling via model/tiling, outline,
                           labels), pngExport, canvasExport
tests/                     Vitest
```

Layers: `model` knows nothing about Obsidian or the DOM. `store` mutates the model through commands. `view` renders the store. `sources` and `render` supply content to modules. `export` builds an offscreen print host from the same model.

File I/O: `PatchworkView extends TextFileView`. `setViewData` parses and migrates; `getViewData` serializes; saves go through `requestSave()` (debounced, ~2 s) wrapped by the external-change check in section 6. Register extension `patchwork` so it shows in the file explorer. Add commands: "Patchwork: New board", "Patchwork: Add page", "Patchwork: Export…".

Rendering notes via `MarkdownRenderer.render(app, markdown, el, sourcePath, component)` with a per-module child `Component` for cleanup. Spike S2 showed it renders note, section, block and image embeds natively (and stops embed cycles itself), so we do **not** expand embeds ourselves. Render into an attached, offscreen container so async content (embeds, Dataview) settles.

Live updates: listen to `vault.on('modify')`, debounce, and re-render only modules whose **dependency set** contains the changed file. A note module's dependency set is its source file plus everything it embeds, transitively, built from `metadataCache.getFileCache(file).embeds` with a visited set. For PDFs, invalidate the cached document and bitmaps.

## 8. Rendering and performance

Targets (verify with the stress board; adjust if unrealistic):
- Pan/zoom stays smooth (no dropped-frame stutter) on a board with 100 pages and 300 modules.
- Opening that board paints visible pages in under 1 second; off-screen pages render lazily.
- Bitmap memory is capped by a setting (default 512 MB) with LRU eviction. No unbounded growth when scrolling around.

Strategies:
1. **Pan/zoom with CSS transform** on a single board layer. Never re-layout on pan.
2. **Virtualization:** only pages intersecting the viewport (plus a margin) mount modules. Others show a lightweight placeholder (name, size).
3. **Level of detail:** while zoomed far out, show a low-resolution bitmap or placeholder; after a short settle (~150 ms) re-render at the resolution actually needed (`zoom × devicePixelRatio × module scale`, clamped).
4. **PDF rendering:** one shared `PDFDocumentProxy` per file with reference counting; destroy when unused. Render only the cropped region into a canvas sized to the crop (apply an offset transform), not the whole page. Cancel stale `RenderTask`s. Cache results as bitmaps keyed by (file, page, crop, scale).
5. **Render scheduler:** priority queue (visible and selected first), limited concurrency, cancel on viewport change.
6. **Note modules:** render once and keep DOM while visible; unmount when culled. Use `content-visibility: auto` where safe.
7. **Debounce** vault events and save requests. Coalesce drag/resize into single undo steps.
8. **Export memory control:** process one output sheet at a time, release canvases between sheets, tile rasters so no single canvas exceeds **8192 × 8192 px**. Spike S4 measured Chromium's hard limits (area ≤ 16384² px, side ≤ 65535 px) and found that exceeding them fails **silently** (blank pixels, no error), so every allocated export canvas is verified by drawing and reading back one pixel, and export fails loudly if the probe fails.
9. **Stress tooling:** command "Patchwork: Generate stress board" creates N pages × M modules from vault files, for manual profiling and an automated smoke test of the model layer.

## 9. Export

### 9.1 Pipeline (v1): two stages (spikes S1, S5, S8)

**Stage 1, HTML layer (Chromium).**
1. Build an offscreen **print host** in the main window: `div.pw-print-host.print` (Obsidian's print CSS hides `body > :not(.print)`) holding one `.pw-sheet.pw-paper.theme-light` per **board page** at its native mm size. Each sheet gets a CSS named page (`@page pw-sN { size: W H; margin: 0 }`) so sizes can differ within one PDF.
2. Render modules into it: notes live via the Markdown renderer (light paper scope), images decoded. PDF modules rendered as **vector** are left empty (their position is known from the model). PDF modules rendered as **raster** become canvases at export DPI (default 200).
3. **Settle:** wait for all module render promises, `document.fonts.ready`, image `decode()`, and a MutationObserver quiet period (≈300 ms, 10 s timeout). Report any module that never settled.
4. Print with `webContents.printToPDF({ preferCSSPageSize: true, printBackground: true })` via `@electron/remote`, isolated in one adapter (`export/printAdapter.ts`, hard rule 6). Fallback if `remote` ever disappears: `window.print()` and the system dialog.

**Stage 2, assembly (`@cantoo/pdf-lib`).**
5. Draw each vector PDF module: `embedPage(sourcePage, cropBox)` gives a Form XObject clipped to the crop; `drawPage` places it with the module's fit and rotation. Crops are mapped from the displayed page to the source page's user space, honouring its `/Rotate`.
6. Build the output sheets from the printed pages: native size, scaled to fit, or **tiled** (each tile a clipped vector copy of its region, section 9.2). Booklet imposition and crop marks (M4) live here too.
7. Add document features: bookmarks from page names, `/PageLabels` matching our page numbering, title and creator metadata.

**PNG export:** render the final PDF with PDF.js, sheet by sheet, within the raster tile cap (section 8).

**PDF module render mode.** Each PDF module has `render: "auto" | "vector" | "raster"` (default `auto`). `auto` means vector, unless another module is stacked above it on the same page: vector content is drawn after the HTML layer and would cover it, so such a module falls back to raster. The export dialog has a quality switch: **Best quality** (default; honours module modes) or **Smallest file** (everything raster).

Known costs of vector modules (spike S8), stated in the export dialog's help: the file carries the whole source page's resources (a crop of an illustrated page can add several MB), and text outside the crop stays in the file, invisible but findable by search.

### 9.2 Output sheet and tiling
- `sheet: "native"` exports each page at its own size (CSS named pages, spike S5).
- Every output layout is built in stage 2 from the native-size printed pages, so tiles and scaled sheets stay vector.
- A fixed sheet (e.g. A4) with a page that is the same size: 1 sheet. Smaller page: placed at actual size or scaled to fit (option). **Larger page: split into a regular grid of tiles, each exactly the sheet size.**
- Tile count per axis: `max(1, ceil((pageSize − overlap − ε) / (sheetSize − overlap)))` with a tolerance `ε = 0.1 mm`, so floating-point error (e.g. 297.0000001 mm) never adds a near-empty tile. Overlap must be ≥ 0 and smaller than the sheet side; reject otherwise. Edge tiles are padded with blank space so every sheet is the same size. Tile order is reading order. (Tolerance flagged for review; see `docs/open-questions.md`.)
- Optional labels (row/col, e.g. "B3") and, in M4, crop and registration marks. Overlap default 0 mm, configurable.
- `tiling.ts` is a pure function with thorough unit tests (exact fit, off-by-one, overlap, page smaller than sheet, rotation choice).
- Guardrails: a native page larger than 5080 mm per side cannot be a single PDF page; force tiling or show an error. Do not rely on PDF UserUnit in v1.

### 9.3 `.canvas` export (interop, one-way, lossy)
- Each page becomes a `group` node (x, y, w, h converted to integer pixels, default 3.78 px/mm).
- `note` → `file` node with `subpath`. `pdf` → `file` node (page via `#page=N` if spike S7 confirms; crop and style are dropped). `text` → `text` node. `image` → `file` node.
- No edges. The export dialog states what is dropped.

## 10. Risk spikes (run first, report in `docs/spike-results.md`)

| ID | Question | Pass criteria / fallback |
|---|---|---|
| S1 | How can a plugin call Chromium's print-to-PDF in the current Obsidian? Does `preferCSSPageSize` work? | Produce a vector-text PDF of an offscreen host at custom size (e.g. 1000×700 mm). Fallback: `window.print()` with print CSS and the system "Save as PDF" dialog. |
| S2 | Does `MarkdownRenderer.render` handle `![[embeds]]`, images, callouts, code blocks, Dataview output? | Document what works. Implement own embed expansion if not. |
| S3 | Can `loadPdfJs()` render a cropped region at 2× scale without allocating the full page? Outline and text extraction available? | Render crop into a right-sized canvas; measure memory. |
| S4 | What are safe canvas size limits for raster export in Obsidian's Chromium? | Pick a tile cap that never fails; encode in `pngExport`. |
| S5 | Can one PDF mix page sizes (CSS named pages) via print-to-PDF? | If not: export each sheet separately and merge (pdf-lib or equivalent). |
| S6 | Does `registerExtensions` + `TextFileView` give a creatable, visible `.patchwork` file with reliable save/rename behaviour? | Working hello-world view. |
| S7 | Does native Canvas open the generated `.canvas`, and do file-node `subpath` (headings/blocks) and PDF `#page=N` work? | Decide the exact PDF mapping in 9.3. |

## 11. Milestones and acceptance criteria

**M0 — Foundations and vertical slice** (thin end-to-end path first, to prove the riskiest parts early)
- Repo from sample template, esbuild, Vitest, lint, test vault, dev loop documented.
- Spikes S1–S7 done and written up.
- `.patchwork` file registered; "New board" command; view opens.
- Board with pan/zoom; add page from preset; move page.
- Save/load round-trip with unknown-key preservation; corrupt-file safety.
- Minimal `note` module (whole note or heading section) and minimal `pdf` module (page + crop), added by command.
- Basic PDF export of the board at native page size, both stages: Chromium HTML layer plus vector PDF modules placed with `pdf-lib`.
- Model unit tests (units, geometry, ordering, migration, tiling).
- Stress-board generator exists.
- **Acceptance:** one A4 page with a note section and a PDF crop exports to a correct PDF; note text and the PDF crop are both vector and selectable.

**M1 — Board editing and modules**
- Grid, rulers, page resize, snapping; undo/redo.
- `note` and `pdf` modules complete, plus `text` and `image`; add by drag from file explorer and by command.
- Crop editor for PDF modules; heading/block/line-range picker for notes; overflow policies.
- Inspector, outline panel, multi-select, align/distribute, duplicate, lock, z-order, smart guides.
- Link tracking: rename updates references; delete shows placeholders; modify refreshes modules.
- Virtualization and the render scheduler in place.
- **Acceptance:** one A4 page shows two PDF crops and two note sections side by side; editing a source note updates the board without reopening it.

**M2 — Export and page furniture**
- Page numbers, header/footer tokens, custom sizes and presets, safe-area guide, auto-arrange.
- Export dialog: PDF/PNG, all/selected/range, sheet size, DPI, light-paper theme, tiling with overlap and labels.
- `.canvas` export.
- **Acceptance:** an A4 board exports to a correct PDF; a 1 m wide page exports as regular A4 tiles; no export crashes on the stress board.

**M3 — Navigation and performance hardening**
- PDF outline picker, PDF text search to region, saved views, minimap.
- LOD, cache budgets, memory settings, profiling pass against the stress board.

**M4 — Print polish**
- Dark-mode viewing and ink-saver mode, booklet imposition, bleed and crop marks, master pages, TOC and PDF bookmarks, stale warnings and freeze.

**M5 — Advanced**
- Linked text frames, interactive modules.

## 12. Testing strategy

- **Unit (Vitest):** everything under `model/` (units, geometry, snapping, ordering, numbering, tiling, migration, validate) and `markdownSource` section slicing with fixture notes.
- **Round-trip tests:** load → save → load equality, including unknown keys and older schema versions.
- **Fixtures:** a small test vault with notes (nested headings, block IDs, embeds, callouts) and a sample PDF.
- **Manual QA checklist** per milestone in `docs/qa.md`: dark and light themes, 1× and 2× display scaling, large boards, rename/delete flows.
- **Perf smoke:** stress board generated in CI at model level (no DOM); manual profiling notes recorded in `docs/perf.md`.

## 13. Open decisions

- Licence (MIT recommended since no MCM code is reused).
- Plugin id: `patchwork` if free in the community list, otherwise `patchwork-boards`.
- Minimum Obsidian version (take the current sample-plugin default, raise only if an API needs it).
- ~~Whether `pdf-lib` is bundled~~: decided in v0.4, `@cantoo/pdf-lib` is bundled (spike S8).
- Default export DPI (200 proposed).

## 14. Research notes

- Obsidian exposes `loadPdfJs()` returning the bundled PDF.js; other plugins render PDF pages to canvas and read PDF outlines with it. PDF++ also uses `pdf-lib`.
- `MarkdownRenderer.render(app, markdown, el, sourcePath, component)` is the current render API. Link embeds historically needed workarounds (forum thread 24617); as of Obsidian 1.14.4 they render natively (spike S2).
- Print: existing plugins print a live DOM through Chromium (`printToPDF`, `preferCSSPageSize`) or use the system print dialog with exact slide geometry. An attempt to integrate Paged.js in Obsidian ended in blank pages, and Obsidian's native print preview can be blank in some runtimes. Hence fixed-size sheets, no pagination engine.
- JSON Canvas 1.0: nodes are text/file/link/group with integer pixel coordinates; file nodes have an optional `subpath` (heading/block); group containment is implied by geometry.
- PDF page size limit is 14,400 units (200 in / 5080 mm) per side unless `UserUnit` (PDF 1.6) is used, which not all viewers support.

## Changelog

- **v0.3 · 2026-10-19** (after spikes S1–S7, see `docs/spike-results.md`)
  - Embeds are rendered by `MarkdownRenderer` natively; dropped our own embed expansion. Live updates use a transitive dependency set built from `metadataCache` embeds.
  - Documented the light paper scope mechanism (re-declare `body` variables under `.pw-paper.theme-light`).
  - Saves check for external changes and never silently overwrite them.
  - Raster export canvases are capped at 8192 × 8192 px and verified with a pixel probe.
  - Print pipeline (section 9.1) not yet changed: a two-stage Chromium + `pdf-lib` pipeline is under discussion.
- **v0.4 · 2026-10-19** (after spike S8)
  - Export is two-stage: Chromium prints the HTML layer at native page sizes; `@cantoo/pdf-lib` places vector PDF modules, builds sheets and tiles (vector), and adds bookmarks, page labels and metadata. PNG = rasterized final PDF.
  - New `PdfModule.render: "auto" | "vector" | "raster"` (auto = vector unless something is stacked above) and `ExportDefaults.quality: "best" | "small"` (default best).
  - `@cantoo/pdf-lib` becomes the one runtime dependency. M0's export includes vector PDF modules.
- **v0.2 · 2026-10-19**
  - Manual page order moves from `page.index` to `board.pageOrder: string[]`.
  - Dropped `meta.modified` (it would change on every save and cause git/Sync noise).
  - `overflow: "grow"` height is computed at render time and never persisted.
  - PDF crop is applied before module `rotation`, on the page as displayed.
  - Note `lines` is relative to the `subpath` section when set (provisional).
  - Tiling uses a 0.1 mm tolerance and rejects overlap ≥ sheet size (flagged for review).
  - `{page}`/`{pages}` count board pages, not output sheets.
  - M0 reordered into a vertical slice (note + PDF crop + basic PDF export); grid, rulers, snapping and undo/redo move to M1.
  - `z` is kept as specified.
  - `page.label` renamed to `page.numberLabel` (avoids confusion with `page.name` and `module.label`). Pages with a custom or hidden number still count toward numbering and `{pages}`.
