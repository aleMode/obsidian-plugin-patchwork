# Testing guide (state as of 2026-10-20, morning)

What to try by hand, in the order that gives the most signal. Everything here is also covered by automated checks (`npm run e2e`: 181 checks across 17 suites, all passing; `npm test`: 164 unit tests), so you're mostly looking for **feel, visuals, and anything the scripts can't judge**. Note results in `docs/qa.md` (or just tell me).

## Setup

1. `npm run build` (or `npm run dev`), then open the dev Obsidian: `scripts/launchObsidian.sh` (test vault, isolated profile). Your own Obsidian works too: copy `main.js`, `manifest.json`, `styles.css` into a vault's `.obsidian/plugins/patchwork/`.
2. The dev Obsidian now launches with flags that keep it rendering when covered by other windows (needed for automated runs). If you launched it before tonight, restart it with the script.

## New in M3 (latest)

### PDF contents and search, in the crop editor
- Open the crop editor (add a PDF, double-click a PDF module, or right-click → *Edit crop…*).
- **Contents…** lists the PDF's bookmarks (indented by level, with page numbers): pick one to jump there.
- **Search this PDF…**: type a term and press Enter. Matches across the whole PDF are listed with their page and text; click one to go there with a crop proposed around it (a column centred on the match, extending below it). Adjust and *Apply*.
- Try "Rigged to Blow" or "Agatha" in the big rulebook: the first result should frame the purple box.

### Saved views and minimap
- **Views** (top of the outline panel): *+* saves the current camera position under a name; click a view to jump back; hover for rename and delete. Also: **Patchwork: Save current view…**, **Go to view…**. Views are stored in the board file.
- **Minimap** (bottom right; toolbar *map* icon or **Toggle minimap**): all pages and the visible area; click or drag in it to move around. Whether it's shown is remembered on this device.

## New in M2 (session 3)

### Page numbers, headers, footers, safe area
- Inspector with nothing selected → **Page numbers**: on/off, start at, format (1/i/a), position (6 options), skip first page. **Header / Footer** with tokens `{page}`, `{pages}`, `{title}`, `{date}`. **Safe area**: a dashed margin guide on every page (never printed).
- Select a page → **Page furniture**: number Automatic / Custom (e.g. "Cover") / None, header and footer Board default / Custom / None, and a per-page safe area.
- Export: numbers, headers and footers print exactly as on screen; the PDF viewer's page box shows the same numbers (try roman with a custom "Cover" first page).

### Export dialog: sheets, tiling, ranges, PNG
- **Patchwork: Export…** now offers: Format (PDF / PNG), Pages (all / selected / range like `1-3, 5`), Sheet size (each page at its own size, A4/A3/A5/Letter/Legal/Tabloid, or custom), Orientation (automatic picks the fewest sheets), Smaller pages (actual size / scale to fit), Tile overlap, Tile labels.
- Try a big page (e.g. set a page to 1000 × 700 mm in the inspector) and export to A4: it becomes a grid of A4 tiles, all vector (zoom in: text stays sharp), with "A1… C5" labels if enabled. Bookmarks jump to each page's first sheet.
- PNG: each sheet becomes an image (`name-01.png`, …). Very large sheets at high DPI are split into `-r1c1`, `-r1c2`, … tiles (8192 px cap).
- Your choices are remembered in the board.

### Auto-arrange and canvas export
- Inspector (nothing selected) → **Arrange pages: In a row / In a grid**, or the commands *Arrange pages in a row / in a grid*. Pages keep their output order; the first page stays put; one Ctrl+Z undoes it.
- **Export to canvas** (inspector button or command): writes `Board name.canvas` next to the board; open it in Obsidian's Canvas. Pages become groups, notes keep their section, PDFs open at the right page (crops and styles are dropped — the notice says so).

## New since M0

### 1. Resize handles
- Click a module: 8 square handles appear. Drag a corner or an edge. Sizes snap to the 5 mm grid; **Alt** places freely; **Shift** on a corner keeps proportions.
- Click a page (on empty paper): same handles resize the page. Modules keep their position relative to the page's top-left.
- One **Ctrl+Z** undoes a whole resize drag.
- Look for: handles readable at every zoom, never clipped at page edges, cursor shapes right.

### 2. Duplicate, nudge, lock
- **Ctrl+D** duplicates the selected module (offset 5 mm) or page (placed to the right, modules included). Also in the right-click menu.
- **Arrow keys** move the selection 1 mm; **Shift+arrow** 10 mm. A burst of presses undoes as one step.
- Right-click a module → **Lock**: no handles, can't be dragged or nudged. **Unlock** restores.

### 1a. Inspector and outline panels (new, session 3)
- Toolbar *panel* icon, or **Patchwork: Open inspector and outline**: both open in the right sidebar and follow the last board you clicked.
- **Inspector:** nothing selected → board settings and title; a page → name, position, size, size preset, orientation, background; a module → label, position, size, lock, arrange, its own options (note: file, section, include heading, **line range**, overflow, scale; PDF: file, page, crop with *Edit crop…*, fit, rotation, vector/image in exports; text: markdown; image: file, fit) and **style** (padding, border width/colour/radius, background, opacity, text scale, CSS class).
- Lengths are in the board's display unit, but you can type any unit ("5 cm", "2 in"). Typing in a field updates live and undoes as one step.
- **Outline:** pages in output order with their modules; click one to select it and centre the board on it.
- Check: styles (padding, border, background) look the same on the board and in an exported PDF, including on PDF crops.

### 1a'. Multi-select, align, distribute (new, session 3)
- **Shift-click** modules to add or remove them; **Shift-drag** on paper or empty board draws a marquee that selects the modules it touches (or pages, if it touches no modules). Shift-click on a page's paper toggles the page.
- Drag any selected item: the whole selection moves together (guides snap the one you hold; the rest follow). One Ctrl+Z undoes it.
- With 2+ selected: right-click a selected item, or use the inspector, for **align** (left/centre/right, top/middle/bottom) and **distribute** (3+). Works across pages (board coordinates) and for pages themselves.
- Arrow keys, Ctrl+D, Delete, lock/unlock act on the whole selection.
- Also check: "zoom to fit" now keeps the page clear of the floating toolbar (it used to sit under it with the sidebar open).

### 1b. Rulers (new)
- Top and left rulers in the board's display unit (mm by default; change it in **Board settings**, below).
- Zero is the **selected page's top-left corner** (or the board origin when nothing is selected), so you can read module positions directly. Zoom and pan: ticks stay readable (label spacing adapts).

### 1c. Board settings (new)
- Toolbar gear icon, or **Patchwork: Board settings…**: display unit (mm / cm / in), grid size (type "5", "0.5 cm", "0.25 in"), snap on/off, grid on/off, "use app theme for pages".
- Page labels and rulers switch units; *Apply* is one undo step.
- Try "use app theme" in dark mode: pages turn dark on screen *and in the export* (that's what the option means).

### 2a. Smart guides (new)
- Drag a module near another module (or the page's edges / centre): when an edge or centre comes within ~6 px on screen, it snaps and a pink guide line appears. Guides win over the grid; **Alt** places freely.
- Dragging a page snaps it to other pages' edges and centres the same way.

### 2b. Move a module to another page (new)
- Drag a module so its centre is over another page: that page gets a dashed outline, and on release the module moves onto it (same spot on the board, snapped to the grid). One Ctrl+Z undoes the whole move.
- While dragging, the module stays clipped to its old page (you see it jump on release); tell me if that's confusing.

### 3. Double-click actions
- **Note module:** opens the note at that section in a split pane.
- **PDF module:** opens the **crop editor** (also: right-click → *Edit crop…*).

### 3b. Crop editor (new)
- Toolbar → *Add PDF* → pick a PDF: the crop editor opens on page 1 instead of asking for a page number. Use *Previous / Next* to find the page.
- Drag on the page to draw a crop; drag inside it to move; drag a corner to resize; *Full page* clears it.
- "Resize module to the crop shape" (on by default) sets the module's height so the crop fills it without bars.
- *Apply* is one undo step. Try it on the big rulebook and on the rotated page 3 of `Sample rulebook.pdf`.

### 3c. Note overflow (new)
- Right-click a note module → *Overflow: clip / shrink to fit / grow*.
- **Clip** (default): if the note doesn't fit, a red dashed marker appears along the module's bottom edge (screen only, never exported).
- **Shrink to fit**: text shrinks (down to 50%) and re-wraps across the full width until it fits; still too long → clipped with the marker.
- **Grow**: the module grows to the note's height on screen and in the export; the saved size doesn't change.
- Edit the source note while watching: the fit/grow updates as the text changes.

### 3d. Drag from the file explorer (new)
- Drag a note, PDF or image from the file explorer onto a page. The board gets an accent outline while you hover.
- **Note** → note module at the drop point (90 × 80 mm). **Image** → image module 60 mm wide, keeping its proportions. **PDF** → the crop editor opens first; *Apply* places it.
- Drag several files at once: they cascade.
- Dropping outside any page shows "Drop files onto a page."

### 4. Renames follow
- With a board open that shows a note, rename the note (or its folder) in the file explorer: the module keeps working, and the board file is updated.
- Close the board, rename again, reopen: still correct (closed boards are rewritten on disk).
- Delete the note: the module shows a striped "Note not found" placeholder instead of vanishing. Undo the delete (or restore from trash) and it comes back.
- Ctrl+Z on the board right after a rename reverts the reference (expected; mention if this feels wrong).

### 5. PDF render cache and smoother panning
- Open a board with crops from the big rulebook. Pan away several pages and come back: crops should reappear **instantly** (cached), not re-render.
- While panning into new pages, modules first show a light-grey box, then fill in over a few frames, instead of the whole board stuttering.
- **Settings → Patchwork → PDF render cache** (MB, default 512). Lowering it frees memory; very low values just mean more re-rendering.

## Still worth checking from M0

- Export a page with a note section and a rulebook crop; open in two PDF viewers; select text in both.
- Zoom out below 25%: pages show outline boxes; zoom back in: content returns.
- Dark theme, and a community theme: paper stays white with dark text.

## Known gaps (not bugs, not built yet)

- M3 so far: PDF contents and search, saved views, minimap. Still to come: low-resolution previews instead of outline boxes when zoomed far out.

## Fixed tonight (worth a quick re-check)
- Deleting a board while it has unsaved changes no longer shows Obsidian's scary "Failed to save file … make a backup" notice.

## If something breaks

- Tell me what you did and what you saw; a screenshot helps. If a board won't open, the error view shows the exact problem and **Copy file contents** — the file itself is never modified.
- Your leftover test files from earlier (`test-vault/Untitled board.patchwork`, `Untitled board.pdf`, and the "penepene3" edit in `Spells/Spell index.md`) are untouched and uncommitted.
