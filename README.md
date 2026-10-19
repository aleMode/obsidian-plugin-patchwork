# Patchwork

An Obsidian desktop plugin for composing **boards** of fixed-size pages from live references to notes and PDF regions, and exporting them to PDF or PNG. See [`SPEC.md`](SPEC.md) for scope and design.

Status: pre-alpha. Milestone M0 (foundations and a vertical slice) is done: boards, pages, note / PDF / text / image modules, and PDF export with vector text and vector PDF crops.

## Using it (M0)

- **Patchwork: New board** (or right-click a folder → *New board*) creates an A4 board and opens it.
- Toolbar: add a page (presets, portrait or landscape), add a note section or a PDF page, export, zoom, undo/redo.
- Drag pages and modules to move them (5 mm grid; hold Alt to place freely). Right-click for orientation, z-order and delete. Delete key removes the selection; Ctrl+Z / Ctrl+Shift+Z undo and redo.
- Pan with the wheel, by dragging empty space, or holding Space; zoom with Ctrl+wheel or a pinch.
- **Patchwork: Export…** writes a PDF next to the board. "Best quality" keeps PDF crops as sharp, selectable vector content; "Smallest file" turns them into images.

## Development

Requirements: Node.js 20+ and Obsidian desktop.

```sh
npm install
npm run dev        # watch build into test-vault/.obsidian/plugins/patchwork/
npm run build      # type-check + production build (main.js at repo root)
npm test           # Vitest
npm run lint
npm run fixtures   # regenerate the binary fixtures in test-vault/
```

### Testing in Obsidian

`scripts/launchObsidian.sh` starts Obsidian on the test vault with an isolated profile and remote debugging; `npm run e2e` then runs the end-to-end suites in `scripts/e2e/` against the dev build, and `scripts/perf/stressBoard.js` measures performance (see `docs/perf.md`).

### Dev loop

1. `npm run dev` (keeps rebuilding on save).
2. Open `./test-vault` as a vault in Obsidian ("Open folder as vault"). The first time, choose **Trust author and enable plugins**.
3. After a rebuild, reload the plugin: toggle Patchwork off and on in *Settings → Community plugins*, or run *Reload app without saving* from the command palette.

## Licence

MIT
