# Patchwork — Product & Technical Spec

Status: draft v0.19 · 2026-11-14 · Target: Obsidian desktop plugin (TypeScript)

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

Patchwork is a general utility: a builder for pages, images, PDFs and dashboards made of what is already in the vault. It is not tied to any one hobby or domain. (It started from tabletop rules kept as `.md` notes plus PDF rulebooks, which is where several examples in this spec come from; features specific to one game are out of scope.)

- As a user, I want to put parts of several notes (a list, a reference table, a section of a longer note) on one sheet, side by side, without copy-pasting text.
- As a user, I want to crop a region of a PDF page and place it next to other content.
- As a user, I want several pages visible side by side on screen instead of one endless scroll.
- As a user, I want edits to my source notes to show up on the board automatically.
- As a user, I want to export A4/Letter PDFs (or PNGs) with page numbers, and print a very large board as multiple regular sheets.
- As a user, I want to keep a board open as a dashboard, with live links, checkboxes and counters.

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
- Opens as a custom view for `.patchwork` files. Pan (wheel/trackpad, space+drag), zoom (ctrl+wheel at 10 % per notch, pinch, +/- buttons through fixed stops, a click on the zoom label for 100 %, zoom-to-fit-all, zoom-to-fit-page), minimap in M3.
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
| `pdf` | A page (or crop) of a vault PDF | `file`, `page`, `crop` (normalized), `fit`, `rotation`, `invert` (M4), `render` (vector/raster/auto) |
| `note` | Live view of a `.md` file or part of it | `file`, `subpath`, `lines`, `includeHeading`, `overflow`, `scale` |
| `text` | Free markdown written in the board | `markdown` |
| `image` | A vault image | `file`, `fit` |

Note module rules:
- `subpath` forms: `#Heading`, `#Parent#Child`, `#^blockid`. Heading section = from the heading line to the line before the next heading of equal or higher level. The section picker writes `#Heading` when the name is unique in the note, else the full path of ancestors (`#Monsters#Orc#Actions`), since `#Actions` always finds the first.
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
- Page order is reading order (rows top to bottom by y-band, then left to right): move pages on the board to reorder them. Auto-arrange can rewrite positions. (A manual order list was planned and dropped in v0.19; files that have `order`/`pageOrder` keep them untouched.)
- Board-level numbering: enabled, start offset, format (`arabic`, `roman`, `alpha`), position (6 presets), skip-first-page. Per-page override via `page.numberLabel`: a custom string printed instead of the number (also when board numbering is off), or `false` to hide it. Pages with a custom or hidden number (including the first page under skip-first-page) still count: numbering continues normally on the next page and they are included in `{pages}`.
- Header/footer text per page and board default, with tokens `{page}`, `{pages}`, `{name}`, `{title}`, `{date}`.
- `{page}` and `{pages}` count **board pages**, not output sheets. A page split into tiles keeps one page number; individual tiles are identified by their row/col label (section 9.2).
- `{page}` is the page's number (or its custom label); `{pages}` is the **last** page's number, so "page {page} of {pages}" stays right with a start offset. `{name}` is the page's name (empty when it has none); `{title}` is the board's title, else its file name; `{date}` is the export (or viewing) day as YYYY-MM-DD. A page's own `header`/`footer` replaces the board's; an empty string removes it on that page.
- Exported PDFs carry `/PageLabels` matching the numbering, so viewers show the same numbers.

### 5.5 Theming
- Export and on-screen "paper" always use a **light scope** by default (CSS variable overrides) so dark-mode vaults do not produce white-on-white pages. Board setting `useAppTheme` opts out.
- Mechanism (spike S1): a nested `.theme-light` alone does nothing, because Obsidian declares its derived variables (`--background-primary`, `--text-normal`, …) on `body`, where they resolve once against the app theme. At runtime we copy every custom property declared on `body` into a `.pw-paper { … }` rule, and paper elements get `pw-paper theme-light`, so the variables resolve against the light base colours. Rebuild that rule on `css-change` (theme or snippet changes).
- Board-level font override optional. Per-module font scale.

### 5.6 Editing interactions
- Drag a file from the file explorer onto a page: `.md` becomes a `note` module, `.pdf` becomes a `pdf` module (page 1, with a page picker), images become `image` modules. Several PDFs dropped at once open their crop editors one after another ("2 of 3" in the title); cancelling one skips that file.
- Double-click a text box or a note module (or Enter on it) edits it in place as raw markdown in a text area over the module; Escape or clicking away finishes. A text box saves into the patchwork as one undo step; a note is written back to its file, only the part the module shows (section, lines). Frozen notes cannot be edited, and nothing is written if the note changed while the text area was open. The "Open" button on the context bar, and double-click on a linked frame, open the note in a side pane. Double-click a PDF module opens the crop editor.
- Inspector panel (right side) edits the selection. Outline panel lists pages and modules.
- Multi-select, align, distribute, duplicate, lock, z-order, smart guides, arrow-key nudge, undo/redo.

### 5.7 Arrange and Use modes
- A patchwork has two modes, switched on the toolbar (or the command *Switch between arrange and use*). **Arrange** is everything above and the default. **Use** turns it into a dashboard: nothing can be selected, moved, resized or deleted, and the content is live.
- The mode is stored in the file (`board.mode: "use"`), outside the undo history, so a dashboard reopens in Use. A read-only patchwork switches for the session only.
- In Use: links open in a pane to the side, reused by later clicks (Ctrl/Cmd and the other modifiers as anywhere in Obsidian; Ctrl/Cmd-hover shows the page preview). Task checkboxes write back to the line they come from: the note file for note modules (only if the note still matches what is shown), the patchwork for text boxes (an undo step). Frozen notes, linked frames and master content keep their checkboxes read-only for now. Plugin content (Dataview, Tasks, Buttons, Meta Bind, Bases) gets its own clicks, except internal links, which always open to the side (Bases would otherwise replace the dashboard). Trackers work as in Arrange.
- Undo in Use reaches back only to the moment Use was entered, so undoing a checkbox tick can't undo an Arrange edit; redo likewise replays only what was undone in Use. It is one history: back in Arrange, undo continues through the Use edits into the earlier Arrange ones.
- A press inside a module belongs to its content; a drag anywhere else pans (also middle button, or Space + drag).
- Look: rulers, grid, page labels, safe-area guides, the overflow marker, handles, the context bar and master pages are hidden; the toolbar keeps the mode switch, zoom to fit and the View menu (minimap, outline). Content uses the app theme instead of light paper, and pages are faint panels. Each module keeps its overflow policy.
- Module colours (`style.tint`): Canvas's six theme colours or a custom colour give a tinted card with a coloured edge, in both modes and in exports (light values on paper). Set from the context bar's palette or the Style tab.
- Exports are unchanged by the mode.

### 5.8 Shapes
- A `shape` module is a rectangle (optionally with rounded corners), an ellipse, or a line. An arrow is a line with an arrowhead at either end (`arrow` filled, `open`, or `dot`). Colours are plain CSS colours; outline width is in mm, so shapes scale with the page like everything else (hard rule 4).
- Drawn as inline SVG whose user unit is the millimetre (`src/model/shapes.ts` computes the primitives, purely), so screen, PDF and PNG agree; exports are vector. Shapes keep their colours on dark app themes (paper content), take the module's opacity, and have no text: put a text box on top for a label.
- **Drawing:** the toolbar's *Shape* menu (or the command *Draw shape on page*) arms a shape; the next drag on a page draws it, from the first corner to wherever the pointer is. Shift makes boxes square (circles) and lines a multiple of 45°. A plain click places a 40 × 30 mm shape centred there. The tool disarms after one shape (Esc cancels it); the whole gesture is one undo step. The grid snaps drawing unless Alt is held.
- **Lines** store their box and two endpoints as fractions of it (`p1`, `p2`), so a line can run at any angle, and a horizontal or vertical one sits in a box 1 mm thick. A selected line shows a handle on each end instead of the eight box handles; dragging one moves that end only (Shift: 45° steps). Move, align, snap, lock, duplicate and stacking work as for any module.
- **Clicking:** only painted pixels take clicks: the outline (with a wider invisible target, about 8 screen px), and the inside of a filled shape. An unfilled rectangle or a diagonal line does not block what is under its box. Shapes are inert in Use mode.
- The context bar has fill, outline colour, thickness, solid/dashed/dotted, corners (rectangles) and arrowheads (lines); the properties popover has the rest (kind, exact widths, both ends' heads, opacity). Canvas export drops shapes (Canvas has no equivalent); the dialog lists them as dropped.

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
  views?: SavedView[];                   // M3
  [extra: string]: unknown;              // unknown keys preserved on round-trip
}

export interface BoardSettings {
  grid: { size: number; snap: boolean; visible: boolean };      // mm, default 5
  displayUnit: "mm" | "cm" | "in";
  numbering: {
    enabled: boolean; start: number;
    format: "arabic" | "roman" | "alpha";
    position: "bottom-center" | "bottom-left" | "bottom-right" | "top-center" | "top-left" | "top-right";
    skipFirst: boolean;
  };
  defaultSafeArea?: Insets;              // mm
  header?: string; footer?: string;      // tokens allowed
  useAppTheme: boolean;                  // default false
  pdfDarkMode?: boolean;                 // M4, viewing only: invert PDF regions in a dark theme
  fontFamily?: string;
  mode?: string;                         // "use": opens as a dashboard (5.7); anything else: arrange
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
  isMaster?: boolean;                            // M4: a master page; never exported or numbered; holds no linked frames (v0.19)
  master?: string;                               // M4: ID of the master page this page uses
  modules: Module[];                             // draw order = array order unless z set
}

export type Module = PdfModule | NoteModule | TextModule | ImageModule | TocModule | FrameModule | TrackerModule | ShapeModule;

export interface BaseModule {
  id: string; x: number; y: number; w: number; h: number;   // mm, relative to page
  z?: number; locked?: boolean; label?: string; style?: ModuleStyle;
}

export interface PdfModule extends BaseModule {
  type: "pdf"; file: string; page: number;       // 1-based
  crop?: [number, number, number, number];      // normalized x0,y0,x1,y1
  fit?: "contain" | "cover" | "stretch";
  rotation?: 0 | 90 | 180 | 270;
  invert?: boolean;                              // M4: invert colours on screen and in exports (forces raster)
  sourceId?: string;                             // M4: PDF fingerprint when the crop was made; warns if the file is replaced
  render?: "auto" | "vector" | "raster";        // export rendering, default "auto" (section 9.1)
}

export interface NoteModule extends BaseModule {
  type: "note"; file: string;
  subpath?: string;                              // "#Heading" | "#^block"
  lines?: [number, number];                      // relative to the subpath section if set
  includeHeading?: boolean;
  overflow?: "clip" | "fit" | "grow";
  scale?: number;
  scrollY?: number;                              // v0.12, clip only: mm the content is moved up in the box
  frozen?: { at: string; markdown: string };     // M4: snapshot shown instead of the live note
}

export interface TextModule extends BaseModule { type: "text"; markdown: string }
export interface ImageModule extends BaseModule { type: "image"; file: string; fit?: "contain" | "cover" | "stretch" }
export interface TocModule extends BaseModule { type: "toc"; heading?: string }   // M4; heading default "Contents", "" = none
export interface FrameModule extends BaseModule { type: "frame"; from: string }   // M5: continues the note, text or frame `from`
export interface TrackerModule extends BaseModule {   // M5: interactive; state saved in the board
  type: "tracker"; kind: "counter" | "boxes" | "checklist";
  value?: number;                                // counter value / boxes filled
  min?: number; max?: number; step?: number;     // boxes: max = how many
  items?: { text: string; done?: boolean }[];    // checklist
  printBlank?: boolean;                          // exports show it empty
}

export interface ShapeModule extends BaseModule {   // v0.15: rectangle, ellipse, line (an arrow is a line with a head)
  type: "shape"; shape: "rect" | "ellipse" | "line";
  fill?: string;                                 // CSS colour; absent = none (not for lines)
  stroke?: { color?: string; width?: number; dash?: "solid" | "dashed" | "dotted" };   // defaults #222222, 0.5 mm, solid; width 0 = no outline
  radius?: number;                               // rect corner radius, mm
  p1?: [number, number]; p2?: [number, number];  // line endpoints as fractions of the box; absent = the diagonal
  startHead?: "none" | "arrow" | "open" | "dot"; endHead?: "none" | "arrow" | "open" | "dot";
}

export interface ModuleStyle {
  padding?: number; border?: { width: number; color: string; radius?: number };
  background?: string; opacity?: number; fontScale?: number; cssClass?: string;
  color?: string; align?: string; fontFamily?: string;
  tint?: string;                         // card colour: Canvas preset "1"–"6" or "#rrggbb" (5.7)
}

export interface SavedView {                      // M3
  id: string; name: string;
  x: number; y: number;                          // board point (mm) at the centre of the view
  zoom: number;
}

export interface ExportDefaults {
  format: "pdf" | "png";
  sheet: "native" | "A4" | "A3" | "A5" | "Letter" | "Legal" | "Tabloid" | { w: number; h: number };
  orientation: "auto" | "portrait" | "landscape";
  tileOverlap: number;                           // mm
  cropMarks: boolean;                            // M4
  dpi: number;                                   // raster modules, default 200
  quality: "best" | "small";                     // "small" forces raster PDF modules; default "best"
  fitSmallPages?: boolean;                       // pages smaller than the sheet: scale to fit (default: actual size)
  tileLabels?: boolean;                          // print "B3"-style labels on tiles
  inkSaver?: boolean;                            // M4: PDF regions and images grayscale + lighter (raster)
  layout?: "single" | "booklet";                 // M4: booklet = saddle-stitch, two pages per sheet side
  bleed?: number;                                // M4: mm printed beyond each page edge (single layout, whole pages)
}
```

Rules:
- **Round-trip safety:** preserve unknown keys at every level. Never drop data you do not understand.
- **Migration:** `version` is checked on load; `migrate.ts` upgrades step by step. A file with a newer version than the plugin opens read-only with a warning.
- **Corrupt file:** if parsing fails, show an error view with the raw text and a copy button. Never overwrite the file.
- **External changes:** never silently overwrite a change made outside the view (Sync, git, another editor). Remember the text last loaded or saved; before writing, compare it with the file on disk. If they differ: reload from disk when there are no unsaved changes; otherwise write our version to a conflict copy next to the file (`Name (conflict YYYY-MM-DD HHmm).patchwork`, numbered ` 2`, ` 3`… when that name is taken), and only then show the disk version (if the copy can't be written, keep showing ours and offer it for the clipboard), and offer "Use my version" (restores ours, deletes the copy). Nothing is lost either way. Reloading from disk clears the undo history. Obsidian's `TextFileView` both overwrites on save and reloads over pending edits (spike S6, M0), so the check runs in `save` and in `setViewData`.
- **IDs:** short random strings, unique within the file.
- **Paths:** vault-relative. On vault `rename`, rewrite references in every `.patchwork` file (use `vault.process` for atomic edits), including links written in text modules and frozen notes that pointed to the renamed file. An open board is rewritten outside its undo history (and the history is rewritten too), so undo never brings back a path that no longer exists. On `delete`, keep the reference and mark the module missing.

## 7. Architecture

Stack: TypeScript (strict), esbuild, Obsidian API, vanilla DOM (Obsidian's `createEl` helpers) for the board to keep the bundle small, Vitest for pure logic. Start from the official `obsidian-sample-plugin` template. Runtime dependency: `@cantoo/pdf-lib` (MIT, maintained fork of `pdf-lib`, ~580 KB minified), justified by spike S8: Chromium cannot place vector PDF content or write bookmarks and page labels.

As built (v0.18):

```
src/
  main.ts                  plugin entry: registerView, registerExtensions, commands, caches
  settings.ts              plugin settings (cache budget, overflow marker, panel state)
  model/                   PURE, no Obsidian imports, unit-tested: schema, defaults, migrate, validate,
                           serialize, units, geometry, ordering, numbering, tiling, sheetPlan,
                           exportPlan, snapping, guides, masters, flow, shapes, subpaths, links, …
  store/                   BoardStore (immutable snapshots, undo/redo, drag coalescing), pageOps
                           (immutable edits), saveGuard (external-change decision)
  view/                    PatchworkView (TextFileView, file I/O), BoardViewport (camera, input,
                           selection, toolbar, menus), ContextBar, PropertiesPopover/Form, Outline*,
                           InspectorView, InlineEdit, liveContent (Use mode), paperScope, boardChrome
  modules/                 ModuleHost (mount/unmount, render queue) + one renderer per module type,
                           flowLayout (linked frames), overflow, style
  sources/                 markdownSource (file/subpath/lines), noteSlice, pdfSource (shared
                           documents, render slots, outline, text search), linkTracker (renames)
  render/                  bitmapCache (LRU of PDF renders), lru, thumbnails (zoomed-out previews)
  export/                  printAdapter (@electron/remote, isolated), printHost (stage 1 and settle),
                           assemble (pdf-lib stage), exportPdf (orchestration), exportPng
  ui/                      modals: CropModal, ExportModal, PatchworkSettingsModal, pickers, prompts
tests/                     Vitest, mirroring src/
```

Layers: `model` knows nothing about Obsidian or the DOM. `store` mutates the model through commands. `view` renders the store. `sources` and `render` supply content to modules. `export` builds an offscreen print host from the same model.

File I/O: `PatchworkView extends TextFileView`. `setViewData` parses and migrates; `getViewData` serializes; saves go through `requestSave()` (debounced, ~2 s) wrapped by the external-change check in section 6. Register extension `patchwork` so it shows in the file explorer. Add commands: "Patchwork: New board", "Patchwork: Add page", "Patchwork: Export…".

Rendering notes via `MarkdownRenderer.render(app, markdown, el, sourcePath, component)` with a per-module child `Component` for cleanup. Spike S2 showed it renders note, section, block and image embeds natively (and stops embed cycles itself), so we do **not** expand embeds ourselves. Render into an attached, offscreen container so async content (embeds, Dataview) settles.

Live updates: listen to `vault.on('modify')`, debounce, and re-render only modules whose **dependency set** contains the changed file. A note module's dependency set is its source file plus everything it embeds, transitively, built from `metadataCache.getFileCache(file).embeds` with a visited set. For PDFs, invalidate the cached document and bitmaps.

## 8. Rendering and performance

Targets (verify with the stress board; adjust if unrealistic):
- Pan/zoom stays smooth (no dropped-frame stutter) on a board with 100 pages and 300 modules.
- Opening that board paints visible pages in under 1 second; off-screen pages render lazily.
- Bitmap memory is capped by a setting (default 512 MB) with LRU eviction. No unbounded growth when scrolling around. The cache is emptied a minute after the last patchwork closes.

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

**PDF module render mode.** Each PDF module has `render: "auto" | "vector" | "raster"` (default `auto`). `auto` means vector, unless another module is stacked above it on the same page: vector content is drawn after the HTML layer and would cover it, so such a module falls back to raster. A shape above it counts only where it paints (v0.19): an outline that surrounds the region without touching it, such as a frame drawn around a crop, leaves it vector; a fill, or a line or outline crossing it, does not. The export dialog has a quality switch: **Best quality** (default; honours module modes) or **Smallest file** (everything raster).

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
- **v0.7 · 2026-10-20** (M2 complete)
  - `{pages}` is the last page's number; `{date}` is YYYY-MM-DD; exported PDFs carry matching `/PageLabels` (tiles: "iii B2").
  - All output layouts (native, fixed sheets, tiles, scale-to-fit) are built in the pdf-lib stage from native-size printed pages, so tiles stay vector. Oversized pages are only rejected for native export.
  - PNG export rasterizes the final PDF; sheets above 8192 px per side become several files (`-r1c1`, …), resolving Q11 with option (a).
  - Export dialog adds page selection (all / selected / range) and remembers its choices in `board.export` (new optional `fitSmallPages`, `tileLabels`).
  - Auto-arrange keeps the first page in place and lays pages out in output order (row, or a grid of ⌈√n⌉ columns).
- **v0.9 · 2026-10-20** (M5 complete)
  - M3 leftover done: below 25 % zoom, outline boxes show small previews of PDF regions and images rendered earlier (never rendered just for the preview), and text lines for notes.
  - Filled in from sections 5.1–5.5: the board font (`board.fontFamily`) applies to paper content on screen, in print and in linked-frame measuring; missing-source placeholders have "Pick another…"; zoom to selection/page; oversized pages are allowed but flagged in the inspector (export tiles them).
  - Interactive modules are one `tracker` type with three kinds: counter (−/+ within min/max, decimal steps), boxes (click fills up to a box; clicking the last filled one empties it) and checklist. The module's `label` is its title. Clicks are ordinary store edits (undo, save); Shift-click and drags still select and move it, and locking keeps it in place during play. Exports print the state without the −/+ buttons, or blank with `printBlank` for pencil play.
  - Linked text frames: a `frame` module continues a note or text module (or another frame) via `from`, on any page. The text is cut into whole markdown blocks (paragraphs, lists, tables, fenced code, callouts; headings on their own), measured offscreen at each frame's width, and handed out greedily; a heading is never left last in a frame. Lines are never split and nothing reflows across pages, so hard rule 7 holds. The last frame shows the overflow marker when text is left over. Deleting a middle frame links its neighbours. Known limits: content that grows after rendering (late images, Dataview) isn't re-measured until the next change; footnotes and reference links don't cross block boundaries.
- **v0.8 · 2026-10-20** (M3 and M4 complete)
  - Saved views live in the board file (`views`). Dark-mode PDF viewing (`board.pdfDarkMode`) is viewing only; per-module `invert` and the `inkSaver` export option force raster for the affected modules.
  - Booklet imposition: pages pad with blanks to a multiple of 4 and are placed two per side of a landscape sheet in saddle-stitch order (native sheet = two pages wide). Pages scale down to fit a half; "scale to fit" also scales them up. No bleed or crop marks in booklets.
  - Bleed is printed by Chromium (each page printed larger, its background and edge-crossing modules extending into it); crop marks, TrimBox and BleedBox are added in the pdf-lib stage. Marks need a 10 mm margin around the bleed: native sheets grow, fixed sheets centre the page. Tiles never get bleed or marks.
  - Master pages are ordinary pages flagged `isMaster` (replacing the planned top-level `masters` list), so they are edited with the normal tools. Pages set `master` to a master's ID and inherit its modules (drawn below their own, not selectable there), header, footer, background and safe area; the page's own values win. Masters are skipped by export, numbering and page ranges, and can't use a master themselves. See `docs/open-questions.md` Q14.
  - Table of contents is a module (`type: "toc"`), so it can sit on any page with other content. It lists named, exported pages (not masters, not its own page) with their printed numbers, updates live, and its rows become PDF link annotations to the target page's first sheet (mapped through scaling, booklets, bleed and tiles). Links to pages outside an exported range are left out.
  - Stale sources and freeze: note modules can be frozen to a markdown snapshot stored in the board (rendered against the note's path, so links and embeds still resolve; embeds stay live). A badge shows the snapshot date and flags when the live note differs. PDF crops record the PDF.js fingerprint of the file they were made on (`sourceId`); a replaced file shows "PDF changed: check this crop" until the crop is re-edited or marked as checked. Badges never print. See Q15.
  - Fixed: vector PDF regions were missing from any export that re-lays pages onto sheets (tiles, scaled pages); pdf-lib embeds lazily, so the printed pages are flushed first.
- **v0.6 · 2026-10-20** (M1 complete)
  - Drag from the file explorer reads the `obsidian://open?…&file=…` URIs Obsidian puts on the drag (no internals).
  - Shift-drag draws a marquee (also when starting on a page's paper); plain drag on empty board pans. Shift-click toggles; selections never mix pages and modules.
  - Module styles render via a shared content box (border + padding), so on-screen and vector-exported PDF content match. `fit` overflow shrinks to at most 50 % before clipping.
  - Rename tracking rewrites closed boards with `vault.process` and open boards through their store (undoable); boards that fail to parse or have a newer format are never touched.
  - Rendered PDF crops are cached (default 512 MB, setting) and keyed by file mtime; module mounting is spread over frames (8 ms budget).
- **v0.5 · 2026-10-19** (M0)
  - A first level of detail lands in M0 rather than M3: below 25 % zoom, pages show module outlines instead of content, and PDF canvas resolution follows the zoom (re-rendered when it settles). At most 2 PDF renders run at once. The stress probe required these (`docs/perf.md`).
  - `minAppVersion` is 1.6.6 (`FileManager.trashFile`), see `docs/open-questions.md` Q12.
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
  - A page's custom number prints even when board numbering is off (an explicit per-page choice wins over the board default, as a page's own header already does). PDF page labels still need numbering on.
- **v0.9 · 2026-10-20 (interface pass, step 1; see docs/ui-reorganisation.md)**
  - User-facing wording: the file is a "patchwork" (New patchwork, Patchwork settings, Untitled patchwork); "board" is no longer used in the UI. Internal names and the file format are unchanged.
  - One tabbed **Patchwork settings** dialog (Layout, Numbering, Appearance, Document) replaces the inspector's board section and the small Board settings dialog. The inspector with nothing selected only links to Settings and Export.
  - Toolbar regrouped: Page, Note, PDF, More (text, image, table of contents, trackers), zoom, undo/redo, Settings, Export, View. Labels collapse to icons when the toolbar does not fit.
  - Export is also in the view's menu; the export dialog groups sheet/tiling/booklet/bleed and quality into collapsible sections.
  - Decided, not yet built: inspector becomes an optional dock behind a floating context bar and properties popover; double-click on a note or text module will edit inline (opening the note in a pane moves to a button, the right-click menu and Alt+double-click).
- **v0.10 · 2026-10-20 (interface pass, step 2)**
  - A floating **context bar** above the selection holds the few controls used every time (page: name, size, orientation, background, master; note: section, overflow, freeze, open; PDF: crop, page stepper, fit, invert; text, image, tracker, frame, table of contents; several items: align, distribute, lock, delete). The `⋯` button opens a **properties popover** with the rest in tabs: Content, Layout, Style, Advanced for a module; Page, Layout, Numbers for a page.
  - The sidebar inspector is now an optional dock (View menu) that shows the same forms; it is no longer opened automatically when adding text, a tracker or a table of contents (the popover opens instead).
  - Double-click on a note still opens it in a pane for now; decision pending implementation: it will edit inline, and open-in-pane stays on the bar's Open button.
  - Built (step 3): inline editing of text boxes and notes as above, with a plain text area (no new dependency). Ctrl+Enter is not used to finish: Obsidian's own hotkeys take it first. Retyping a section's heading updates the module's section link. `sliceBounds` (pure, tested) gives the file range a note module shows.
  - The context bar starts as a small pill and opens on hover (stays while the pointer is near, a menu or the popover is open, or a field has focus). Page and item settings are also in the right-click menu; Patchwork settings holds only whole-patchwork options. The text area of in-place editing takes clicks (it had inherited the module body's pointer-events: none) and shows a caret in the text colour; Escape is taken at the window for the popover and the edit box.
  - Text formatting: module `style` gains `color`, `align` and `fontFamily` (applied to the module's content, headings included); the in-place editor has a formatting toolbar (pure helpers in `mdFormat`). Rendered markdown wrappers also carry `markdown-preview-view` (padding, scrolling and fixed height neutralised in styles.css) and a note's `cssclasses` frontmatter, for theme and snippet parity with Obsidian's reading view.
  - Outline and saved views also exist as a floating panel on the board (View menu); the sidebar outline shares its renderer (`OutlineRenderer`). This completes the interface plan: nothing needs a sidebar.
  - The outline panel is as big as its content needs (up to the room on the board), has margins around its text, and is dragged by its title (double-click the title to put it back).
  - Revealing an item from the outline no longer does nothing when it is on screen, nor always re-centres: the view pans only as far as needed to bring the item into a comfortable middle region (the central 70%, less the toolbar and the outline panel), and zooms out only if it cannot fit at all (`revealShift`, pure, tested).
  - Interface choices that must survive a restart (outline panel open and position, minimap) live in the plugin's saved settings (`data.json` in the vault), not in browser storage: storage belongs to the Obsidian profile, so reopening Obsidian another way started with the panel closed.
- **v0.10 · 2026-10-20 (interface pass, step 4: words)**
  - "Freeze" is "Freeze text (snapshot)" ("Freeze text" on the context bar); "Source check / Start checking" is "Warn if this PDF changes" (Turn on / Mark as checked); "Linked frame" is "Text frame (continues a note)" in the interface. The file format is unchanged (`frozen`, `sourceId`, type `frame`).
- **v0.10 · 2026-10-20 (memory review)**
  - Cached PDF renders are freed a minute after the last open patchwork closes (they used to stay, up to the cache budget, until Obsidian quit).
  - Export holds less at once: each printed batch is merged and dropped as soon as Chromium returns it, PNG files are written one at a time, and the finished bytes are no longer copied on write. Image previews decode straight to preview size.
- **v0.11 · 2026-10-20 (Use mode; docs/use-mode-plan.md)**
  - Live Preview editing (Q18) is dropped in favour of **Arrange / Use modes** (section 5.7): Use is a dashboard with live links, checkboxes and plugin content, app-theme pages as faint panels, and no editing chrome. New fields `board.mode` and `style.tint` (Canvas colour palette).
  - Opening a patchwork no longer fits the pages to a pane that is still being laid out (it could open at 2 % zoom).
  - PDF embeds inside notes (`![[book.pdf#page=2]]`, Q9) are drawn by Patchwork as a static page instead of Obsidian's PDF viewer, which collapsed inside modules, covered the note and exported blurry. Exports place them as vector at best quality (like PDF modules, drawn over the page), as a picture at small quality or with the ink saver.
  - Rename tracking also rewrites links in text modules and frozen notes (`[[…]]`, `![[…]]`, `[…](…)`) that no longer resolve and pointed to the renamed file or folder. A board open in several panes is rewritten through one of them (the one with unsaved edits) and saved at once, so the others reload; open boards are matched by file, not path, so moving the folder that holds an open board no longer writes behind it. Saves of one view run one at a time, which removes conflict copies made by two overlapping saves.
  - `minAppVersion` raised to 1.6.7, the oldest Obsidian the e2e suites were run on (Q12).
- **v0.12 · 2026-10-20 (QA round)**
  - Note field `scrollY` (mm, clip policy only): the box shows a later part of a note too long for it. Set with the mouse wheel over the selected note (one undo step per burst) or in Properties; applied on screen and in export.
  - *Continue in a new frame* puts the frame on the same page, in free space beside or under the chain's last frame (shrunk to the strip left, or offset on top if none), instead of adding or using the next page.
  - The section step of the note picker has a back arrow to choose another note.
- **v0.13 · 2026-10-21 (QA round)**
  - A frame's text is editable in place, like a text box or note: double-click, Enter or *Edit* on its context bar. A module in a chain of linked frames edits only the part of the text it shows (the head note's file or the head text box is rewritten there only; the rest of the chain's text is untouched, one undo step for text). A frame that shows nothing yet adds what is typed as a new block at the end. Double-click on a frame no longer opens the source note; the frame's context bar has *Open* for that.
  - The inline editor keeps 2 px of room inside the module's border.
- **v0.14 · 2026-10-21 (QA round)**
  - Small text is easier to read on screen. From 100 % down to 50 % zoom, note text eases toward full contrast (away from its background, so it works on dark and light paper and tinted cards) and gets a hairline stroke (0.15 px on screen at full strength). Below 100 % body-text strokes are thinner than a pixel and draw dim, a limit of the pixel grid; a render at the real size, a transform of exactly 1, hinting and font weights were tried and made no difference (they only reflowed the text). Pure CSS in `styles.css`, driven by the settled `--pw-zoom`, scoped to the board layer: wrapping is untouched and exports never see it.
  - Zoom controls: a mouse-wheel notch with Ctrl zooms by 10 % at most (it was about 22 %; a trackpad pinch is unchanged, one event is capped, not scaled). The +/- buttons step through fixed stops (5, 10, 15, 25, 50, 75, 100, 125, 150, 200, 300, 400, 600, 800 %) instead of x1.25, from wherever the zoom is. Clicking the zoom label sets exactly 100 %, about the centre of the view.
- **v0.15 · 2026-10-26 (shapes)**
  - New module type `shape` (rectangle, ellipse, line/arrow), drawn by dragging from the toolbar's *Shape* menu; see section 5.8. Lines keep two endpoints as fractions of their box (`p1`, `p2`) rather than a flip flag, so any angle (and an exactly horizontal line) works with the box-based tools; a line's selection shows endpoint handles instead of box handles. Shapes are SVG in millimetres and print as vector. Not built: text inside a shape (use a text box on top), glued connectors, freehand drawing.
- **v0.16 · 2026-11-09 (QA round)**
  - Export text colour fixed. Obsidian's print CSS sets `color: initial` on `.markdown-preview-view`, which turned every note's body text black in exports whatever the module's *Text colour* (headings and bold kept it, so a white-text card exported with white headings over dark paragraphs); with *Use app theme* on it also made dark-mode exports black on dark. The print host now gives the colour back to `--text-normal`. *Text colour* also recolours table headers, quotes and list markers, and dims `--text-muted` from it.
  - Colour rows with no colour set show "Auto" (and, for *Text colour*, "Auto: dark" on paper or "Auto: theme" with *Use app theme*) with a dimmed swatch and no clear button, so the white swatch is not read as a white colour in use.
  - Style/properties rows: labels keep a minimum width; the popover's inputs got the dock's 7.5em width (labels were squeezed to a few pixels).
- **v0.17 · 2026-11-10 (QA round: export parity, automatic ink)**
  - Automatic ink. Text with no colour of its own follows the background it sits on: light on dark page or module backgrounds, dark on light ones (`model/contrast.ts`, WCAG luminance; a background under 50 % alpha keeps the ink around it). A page or module whose ink differs from its surroundings gets `pw-rescope` plus `theme-dark`/`theme-light`, and the paper-scope rule re-declares Obsidian's derived variables there, so headings, tables, quotes and links take the matching theme's colours. Page furniture uses `--text-muted`, and a shape outline with no colour uses `currentColor`, so both follow the ink. *Text colour* shows "Auto: light" or "Auto: dark" accordingly. With *Use app theme*, a page with no background is the theme's background (it was white paper under light text in dark mode), on screen and in exports.
  - Vector PDF regions in exports follow the module's opacity and are clipped to the rounded area inside the border (`exportPlan.vectorFrame`), like the screen. A region forced to vector that covers items stacked above it is reported after export.
  - Export/screen parity: module text no longer froze at 16 px under themes that size `.markdown-preview-view` (Minimal), so *Text scale* and a note's *Scale* work there; tables follow the text scale; app-theme exports keep the screen's text font (Obsidian's print CSS swaps in `--font-print`); the external-link icon is not shown on paper (print dropped it, so lines wrapped differently); a stretched or rotated-and-stretched PDF region fills its box on screen and in image exports.
  - Card colour (`style.tint`) keeps at least 1.5 mm of padding inside its coloured edge (`model/style.effectivePadding`, also used for layout and vector placement).
  - After an export, the problems list names text boxes and notes whose text is cut off (scrolled notes excepted) and hand-set text colours that almost vanish into their background (contrast under 2:1).
  - Text boxes show the overflow marker like notes. Alignment also moves a tracker's boxes and checklist rows.
  - Panels: module headings name the type ("PDF region", "Text box"…); text rows (scale, colour, alignment, font) are hidden for PDF regions and images; "Colour" is "Card colour"; opacity is a percentage; crop reads as "43 % × 27 % of the page, from…"; *Grow* explains that the box may cover items below. The page's third tab is "Header & footer"; *Safe area* moved to Layout. Header/footer token `{name}` (the page name). Outline titles of text boxes are plain text. The overflow entries in the right-click menu have icons. The minimap draws pages in their background colour, with a faint edge.
- **v0.18 · 2026-11-14 (review fixes; see `docs/review-2026-11.md` and `docs/review-checklist.md`)**
  - Popout windows: each window gets the light-paper rule, and exports always build the print host in the main window, the one `printToPDF` prints.
  - Linked frames: moving a frame to another page keeps it in its chain; a copied frame continues the copy of its source when that was copied too (a copied chain is a new chain), otherwise it joins the end of its original chain.
  - Conflict copies take a free name and are written before the disk version is shown (section 6).
  - A rename rewrite is not an undo step (section 6); neither is storing the export dialog's choices.
  - The section picker writes a heading's full path when its name repeats in the note (section 5.3).
  - *Export to canvas* asks before replacing an existing `.canvas`; canvas export and auto-arrange leave master pages out (auto-arrange puts them in a row below).
  - One export at a time. Nudges and wheel scrolls more than a second apart are separate undo steps.
  - Shape modules are serialized with a fixed key order and tidy numbers like other modules; saved views always get unique IDs; editing a checklist line keeps its item's tick and unknown keys.
  - Repo: `.gitattributes` checks out LF on every platform.
- **v0.19 · 2026-11-14 (decisions on the review checklist, `docs/review-checklist.md` section 2)**
  - Product framing (section 3): a general page, PDF, image and dashboard builder, not a tool for one game. Game-specific features (dice, encounter trackers, character sheets) are not planned.
  - Manual page order dropped (section 5.4): output order is reading order. `board.order` and `board.pageOrder` are no longer read or validated, and are kept as they are in older files.
  - `PdfModule.renderDpi` removed: it was never read. Raster PDF regions use the export DPI. Older files keep the key.
  - Linked frames are kept off master pages (review B8): a chain there would restart on every page using the master. *Next frame* refuses on a master, a linked module can't be dragged onto one, and a page holding any part of a chain can't become a master. Each case says why in a notice.
  - Undo in Use mode is limited to the edits made since entering it (review B10); back in Arrange the same history continues (section 5.7).
  - A shape over a PDF region forces it to raster only where the shape paints over the region (section 9.1): a frame drawn around a crop no longer turns it into an image. A line or outline across the region still does, since vector content is drawn last and would hide it.
  - Several PDFs dropped at once open their crop editors one after another instead of stacked (section 5.6).
