# Patchwork

An Obsidian desktop plugin for composing **boards** of fixed-size pages from live references to notes and PDF regions, and exporting them to PDF or PNG. See [`SPEC.md`](SPEC.md) for scope and design.

Status: pre-alpha, feature-complete against the SPEC milestones M0–M5. See `docs/testing-guide.md` for what to try.

## What it does

- **Boards and pages:** fixed-size pages (A3–A6, Letter, Legal, Tabloid, 16:9, square, custom) on an infinite board with rulers, grid, snapping, smart guides, minimap, saved views, auto-arrange, and zoomed-out previews.
- **Modules:** live note sections (heading, block or line range, with clip / shrink / grow overflow), PDF regions (crop editor with the PDF's contents and text search), free markdown text, images, a table of contents, linked text frames that flow across pages, and trackers (counters, boxes, checklists) you can click during play.
- **Editing:** inspector and outline panels, multi-select, align and distribute, lock, z-order, duplicate, undo/redo, drag files from the explorer, renames followed, master pages, page numbers and headers/footers with tokens, a board font, frozen note snapshots, and warnings when a PDF behind a crop is replaced.
- **Export:** PDF with vector text and vector PDF regions (or smaller raster), page ranges, sheet sizes with poster tiling, booklets, bleed and crop marks, bookmarks, page labels and clickable contents; PNG; ink saver; `.canvas`.

## Using it

- **Patchwork: New patchwork** (or right-click a folder → *New patchwork*) creates a patchwork with one A4 page and opens it.
- Toolbar: *Arrange* / *Use* mode switch; add a page, a note section, a PDF region, a shape, or (under *More*) a text box, an image, a table of contents or a tracker; zoom; undo/redo; *Settings* for the whole patchwork; *Export*; *View* (outline and saved views, minimap, sidebar inspector). Drag notes, PDFs and images from the file explorer onto a page.
- Select an item to get its context bar (hover the small `⋯` pill above it); `⋯` on the bar opens its properties. Double-click a text box or note to edit it in place, a PDF region to crop it.
- Drag pages and modules to move them (5 mm grid; hold Alt to place freely). Right-click for more: crop, freeze, continue in a new frame, z-order, zoom to page, delete.
- Pan with the wheel, by dragging empty space, or holding Space; zoom with Ctrl+wheel or a pinch.
- **Use** mode turns the patchwork into a dashboard: links open to the side, checkboxes and trackers work, nothing moves.
- **Patchwork: Export…** writes a PDF (or PNGs) next to the patchwork.

## Development

Requirements: Node.js 24 (what CI uses) and Obsidian desktop.

```sh
npm install
npm run dev        # watch build into test-vault/.obsidian/plugins/patchwork/
npm run build      # type-check + production build (main.js at repo root)
npm test           # Vitest
npm run lint
npm run fixtures   # regenerate the binary fixtures in test-vault/
```

### Testing in Obsidian

`scripts/launchObsidian.sh` (or `scripts/launchObsidian.ps1` on Windows) starts Obsidian on the test vault with an isolated profile and remote debugging; `npm run e2e` then runs the end-to-end suites in `scripts/e2e/` against the dev build, and `scripts/perf/stressBoard.js` measures performance (see `docs/perf.md`).

### Dev loop

1. `npm run dev` (keeps rebuilding on save).
2. Open `./test-vault` as a vault in Obsidian ("Open folder as vault"). The first time, choose **Trust author and enable plugins**.
3. After a rebuild, reload the plugin: toggle Patchwork off and on in *Settings → Community plugins*, or run *Reload app without saving* from the command palette.

## Licence

MIT
