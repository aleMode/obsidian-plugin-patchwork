# Testing guide (state as of 2026-10-20, 00:45)

What to try by hand, in the order that gives the most signal. Everything here is also covered by automated checks (`npm run e2e`: 109 checks across 9 suites, all passing; `npm test`: 135 unit tests), so you're mostly looking for **feel, visuals, and anything the scripts can't judge**. Note results in `docs/qa.md` (or just tell me).

## Setup

1. `npm run build` (or `npm run dev`), then open the dev Obsidian: `scripts/launchObsidian.sh` (test vault, isolated profile). Your own Obsidian works too: copy `main.js`, `manifest.json`, `styles.css` into a vault's `.obsidian/plugins/patchwork/`.
2. The dev Obsidian now launches with flags that keep it rendering when covered by other windows (needed for automated runs). If you launched it before tonight, restart it with the script.

## New since M0 (please focus here)

### 1. Resize handles
- Click a module: 8 square handles appear. Drag a corner or an edge. Sizes snap to the 5 mm grid; **Alt** places freely; **Shift** on a corner keeps proportions.
- Click a page (on empty paper): same handles resize the page. Modules keep their position relative to the page's top-left.
- One **Ctrl+Z** undoes a whole resize drag.
- Look for: handles readable at every zoom, never clipped at page edges, cursor shapes right.

### 2. Duplicate, nudge, lock
- **Ctrl+D** duplicates the selected module (offset 5 mm) or page (placed to the right, modules included). Also in the right-click menu.
- **Arrow keys** move the selection 1 mm; **Shift+arrow** 10 mm. A burst of presses undoes as one step.
- Right-click a module → **Lock**: no handles, can't be dragged or nudged. **Unlock** restores.

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

- No inspector or outline panel yet (positions, sizes and options are set by dragging, the crop editor, or editing the `.patchwork` JSON).
- No multi-select or align/distribute yet.
- Page numbers, headers/footers, tiled export, PNG export are M2.

## Fixed tonight (worth a quick re-check)
- Deleting a board while it has unsaved changes no longer shows Obsidian's scary "Failed to save file … make a backup" notice.

## If something breaks

- Tell me what you did and what you saw; a screenshot helps. If a board won't open, the error view shows the exact problem and **Copy file contents** — the file itself is never modified.
- Your leftover test files from earlier (`test-vault/Untitled board.patchwork`, `Untitled board.pdf`, and the "penepene3" edit in `Spells/Spell index.md`) are untouched and uncommitted.
