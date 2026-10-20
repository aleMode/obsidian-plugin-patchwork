# Testing guide (state as of 2026-10-20, evening)

What to try by hand, in the order that gives the most signal. Everything here is also covered by automated checks (`npm run e2e`: 32 suites, all passing; `npm test`: 266 unit tests), so you're mostly looking for **feel, visuals, and anything the scripts can't judge**. Note results in `docs/qa.md` (or just tell me).

## Setup

1. `npm run build` (or `npm run dev`), then open the dev Obsidian: `scripts/launchObsidian.sh` (test vault, isolated profile). Your own Obsidian works too: copy `main.js`, `manifest.json`, `styles.css` into a vault's `.obsidian/plugins/patchwork/`.
2. The dev Obsidian now launches with flags that keep it rendering when covered by other windows (needed for automated runs). If you launched it before tonight, restart it with the script.

## New: Use mode (a patchwork as a dashboard)

Plan and decisions: `docs/use-mode-plan.md`. Open `Dashboard/Dashboard.patchwork` in the test vault: it opens in Use mode.

- **Switch:** the **Arrange | Use** switch at the left of the toolbar, or the command *Switch between arrange and use*. Close and reopen the file: it comes back in the mode you left it in. Ctrl+Z after switching doesn't switch back.
- **Look:** no rulers, grid, page labels or handles; pages are faint panels in your theme (try light and dark); the toolbar is just the switch, zoom to fit and View (minimap still toggles there). Master pages are hidden.
- **Nothing moves:** drag on a module's text (selects text), on the page's background or empty board (pans). Right-click, double-click, Delete and arrow keys do nothing.
- **Links:** click [[Goblin]] in *Prep*: it opens in a pane to the side. Click Fireball in *Party*: the same side pane switches to it. Ctrl/Cmd-click opens a new tab; Ctrl/Cmd-hover shows the page preview.
- **Checkboxes:** tick "Prepare the ambush map": open `Dashboard/Session.md`, the line is ticked. Untick it. Tick a task in *Table notes* (a text box): Ctrl+Z unticks it. Tick twice very fast: the second may say the note changed (the module re-renders first); that is the safety check.
- **Colours:** in Arrange, select a module → the palette button on the context bar: Red … Purple, or "Custom colour…" (Style tab). The cards look right in both themes and in a PDF export (light values).
- **Plugins:** Dataview, Tasks, Buttons and Meta Bind are downloaded into the test vault (`.obsidian/plugins`, git-ignored) but not switched on: enable them in Settings → Community plugins, and Bases in Core plugins. Then open `Dashboard/Plugin blocks.patchwork`: tick Dataview's and Tasks' checkboxes (Session.md changes), type in the Tasks filter, press the Buttons and Meta Bind buttons (they toggle the sidebars), flip Meta Bind's "Ready" toggle (frontmatter), click a Bases row (opens to the side).
- **Fixed:** opening a patchwork sometimes showed it at 2 % zoom (a speck in the corner); it should now always fit.

## Interface pass

Everything here is also described in `docs/ui-reorganisation.md`.

### Context bar and properties popover
- Select a page or an item: a small **⋯** pill appears above it; hover it (or click it) and it opens into the bar, which stays open while you are near it, while a menu or the popover is open or a field has focus, and closes shortly after you move away. Page: name, size, orientation, background, master. Note: section ▾, overflow ▾, Freeze text, Edit, Open. PDF: Crop, page ‹ n ›, fit ▾, invert. Text: Edit. Image: Change, fit ▾. Tracker: kind ▾, Edit, print blank. Text frame: "Frame 2 of 3", Next frame. Table of contents: Heading. Several items: Align ▾, Distribute ▾, Lock, Delete.
- The `⋯` button opens the **properties popover** next to the item: tabs *Content / Layout / Style / Advanced* (a page: *Page / Layout / Numbers*). Typing in it edits live; Escape or a click on the board closes it. It should never sit on top of the item you are editing.
- Check: the bar follows the item while you pan and zoom, hides while you drag, comes back where the item lands, and stays reachable for a page bigger than the screen. Typing Delete or the arrow keys in a popover field must not delete or move the item.
- Adding text, a tracker or a table of contents opens the popover on it. The sidebar inspector no longer opens by itself: **View → Inspector and outline** if you want the dock.

### Outline and views panel
- Toolbar **View → Outline and views** (or the command *Toggle outline and views panel*) opens a floating panel at the left of the board: saved **Views** (+ saves the current camera, click goes back, hover for rename and delete) and the **Pages** with their items. Click a row to select it; Shift-click adds to the selection. The panel is only as big as its list needs; drag it by its title (double-click the title to put it back). Selecting a row brings the item into the comfortable middle of the view: an item already there does not move the view, one near the edge or under the panel is moved just enough, one off screen is brought in. It updates as you edit. Whether it is open, and where you put it, is kept in the plugin settings of the vault, so it comes back after restarting Obsidian however you start it. The sidebar dock still exists under **View → Inspector and outline in the sidebar**.

### Where settings live
- **Toolbar → Settings** is for the whole patchwork only (units, grid, numbering, header and footer, appearance, title).
- **Right-click a page** → Page settings, Size and position, Page numbers, header and footer. **Right-click an item** → Item settings, Size and position, Style. They open the same popover as the ⋯ button, on the right tab.

### Text formatting
- A text box's bar has **Alignment ▾**, a **text colour** swatch and **A−** / **A+** (text size). The popover's **Style** tab has the same plus **Font**. They apply to the whole box, headings and bold included, on screen and in exports.
- While editing, a **formatting toolbar** floats above the box: bold, italic, strikethrough, code, headings 1–3, bulleted and numbered lists, quote, link. It wraps the selection or marks the lines you have selected, and Ctrl+Z undoes it. Clicking it never ends the edit. (Ctrl+B and Ctrl+I also work when Obsidian lets them through.)
- Text boxes and notes now carry the same classes Obsidian's reading view has (`markdown-rendered`, `markdown-preview-view`), so theme and snippet rules written for notes apply to both, and a note's `cssclasses` frontmatter is applied to its module.

### Editing in place
- Double-click a text box or a note (or select it and press **Enter**, or press **Edit** on the bar): a text area with the raw markdown opens over it, in the module's own padding and border; the rendered text is hidden meanwhile. **Escape** or clicking elsewhere finishes. (Ctrl+Enter is not used: Obsidian's own hotkeys take it.)
- **Text box:** saved into the patchwork; one Ctrl+Z undoes the whole edit.
- **Note:** only the part the module shows is rewritten in the note's file (a section, a line range, whole note); the rest of the file is untouched. Try a section with *Include heading* on, retype its heading: the module follows the new heading. Editing a note that someone else (or Sync) changed while the text area was open must not overwrite it: you get a notice and your text on the clipboard.
- A **frozen** note says to unfreeze first. Scroll or zoom away mid-edit: what you typed is kept.
- Typing Delete, Backspace or arrows in the text area must not delete or move the item.

## New in M5 (latest, M5 complete)

### Zoomed-out previews (M3 leftover)
- Zoom out below 25 %: PDF regions and images you've seen at working zoom show as small previews instead of flat boxes; notes and text show faint lines. Panning a 100-page board stays at 60 fps (`docs/perf.md`).

### Small spec items filled in
- Toolbar → **Settings** → Appearance → **Font**, e.g. `Georgia, serif`: notes, text and headers on the pages use it, on screen, in exports, and when linked frames measure their text.
- A module whose note, PDF or image was deleted shows **Pick another…** right on the board. For a PDF, the crop editor opens after picking, to check the crop.
- Right-click a page → **Zoom to page**; command *Zoom to selection* fits whatever is selected.
- A page wider or taller than 5080 mm gets a warning in the inspector: export it on a sheet size (tiles).

### Trackers
- Toolbar → **More** → Counter, Boxes or Checklist. Click − / + on a counter, click boxes (clicking the last filled one empties it), tick checklist items. Every click is one undo step and is saved.
- Clicking the tracker anywhere except its controls selects it; drag to move. Lock it to keep it in place while playing.
- Inspector: kind, value, min/max/step, number of boxes, checklist items (one per line; ticks stay with their line), **Print blank**. Export: the state prints without the −/+ buttons; with Print blank, empty boxes and an empty value to fill in by pencil.

### Linked text frames
- Right-click a note or text module → **Continue in a new frame** (or command *Continue selected text in a new frame*). A frame of the same size appears at the same spot on the next page (a new page if needed). Text that doesn't fit the first box continues there, a paragraph/list/table at a time; the last frame gets the red overflow marker if text is still left.
- Resize either box, edit the text or the note: the split updates. A heading is never stranded at the bottom of a frame.
- Add more frames from a frame's right-click menu or the inspector (*Add another frame*). Delete a middle frame: the chain closes up. Export: each page prints its share.
- Worth checking with your real notes: callouts, tables, embeds and images, and how the split looks.

## New in M4 (M4 complete)

### Dark PDFs, invert, ink saver
- Toolbar → **Settings** → Appearance → **PDF regions in dark mode**: with Obsidian in a dark theme, PDF regions on the board are shown colour-inverted (hues kept). Viewing only; exports unchanged.
- Select a PDF module → **Invert colours**: for rulebook pages with dark backgrounds. Applies on screen and in exports (such modules export as images).
- Export dialog → **Ink saver**: PDF regions and images print grayscale and lighter. Notes and text are unchanged. Pages with a dark background stay dark by decision (2026-10-20): use **Invert colours** on those modules.

### Freeze and stale sources
- Right-click a note module → **Freeze text (snapshot)** (or the bar's **Freeze text**). A "Frozen YYYY-MM-DD" tag appears. Edit the note: the module keeps the old text and the tag turns orange ("note changed"). **Update snapshot** or **Unfreeze** in the properties (⋯ → Content). Exports print the snapshot, never the tag.
- PDF crops now remember which version of the file they were made on. Replace a PDF with a different file under the same name (e.g. a new rulebook version): its crops get an orange "PDF changed: check this crop" tag until you re-edit the crop or press ⋯ → Advanced → Warn if this PDF changes → **Mark as checked**. Crops made before today have no record; **Turn on** adds one.

### Table of contents
- Command palette → **Patchwork: Add table of contents to page** (on the selected page). It lists every named page with its number, dot leaders in between; unnamed pages, masters and its own page are left out. Rename or reorder pages and it updates.
- Inspector → Heading: default "Contents", custom, or none.
- Export and open the PDF: clicking an entry jumps to that page (also on A4 sheets, booklets, with bleed).

### Master pages
- Select a page → Inspector → **Master page** on. It gets a dashed outline, its label reads "Master: …", it shows its header/footer templates as typed and "#" for the number, and it disappears from the outline's numbering.
- Put a logo or frame on it, set its header and background. Then select other pages (one, or several with Shift-click) → **Master** dropdown → pick it. The master's modules appear under each page's own (clicking them selects the page), with the header and background, unless the page sets its own.
- Edit the master: every page using it updates. Export: the master page is not in the PDF, numbers skip it, its content prints on the pages using it.

### Booklets, bleed, crop marks
- Export dialog → **Layout: Booklet (fold in half)** with sheet size A4 on a board of A5 pages: each side of a landscape A4 sheet carries two pages in folding order (8|1, 2|7, …; blanks pad to a multiple of 4). Print double-sided, flip on the short edge, fold: the pages should read in order. Worth one real print if you can.
- Layout *One page per sheet* → **Bleed** 3 mm and **Crop marks** on: give a page a background colour and a module poking past its edge. The colour and the module should extend 3 mm past the trim, with thin corner marks outside it. With *Each page at its own size* the sheet grows by 26 mm per side pair; with A4 the page is centred.
- Re-check tiles with a vector PDF region on them (A4 sheets, big page): the region used to vanish from tiled and scaled exports. Fixed now.

## New in M3

### PDF contents and search, in the crop editor
- Open the crop editor (add a PDF, double-click a PDF module, or right-click → *Edit crop…*).
- **Contents…** lists the PDF's bookmarks (indented by level, with page numbers): pick one to jump there.
- **Search this PDF…**: type a term and press Enter. Matches across the whole PDF are listed with their page and text; click one to go there with a crop proposed around it (a column centred on the match, extending below it). Adjust and *Apply*.
- Try "Rigged to Blow" or "Agatha" in the big rulebook: the first result should frame the purple box.

### Saved views and minimap
- **Views** (top of the outline panel): *+* saves the current camera position under a name; click a view to jump back; hover for rename and delete. Also: **Patchwork: Save current view…**, **Go to view…**. Views are stored in the board file.
- **Minimap** (bottom right; toolbar **View** → Minimap, or **Toggle minimap**): all pages and the visible area; click or drag in it to move around. Whether it's shown is kept in the plugin settings of the vault.

## New in M2 (session 3)

### Page numbers, headers, footers, safe area
- Toolbar → **Settings** → Numbering → **Show page numbers**: on/off, start at, format (1/i/a), position (6 options), skip first page. **Header / Footer** with tokens `{page}`, `{pages}`, `{title}`, `{date}`. **Safe area**: a dashed margin guide on every page (never printed).
- Select a page → **Page furniture**: number Automatic / Custom (e.g. "Cover") / None, header and footer Board default / Custom / None, and a per-page safe area.
- Export: numbers, headers and footers print exactly as on screen; the PDF viewer's page box shows the same numbers (try roman with a custom "Cover" first page).

### Export dialog: sheets, tiling, ranges, PNG
- **Patchwork: Export…** now offers: Format (PDF / PNG), Pages (all / selected / range like `1-3, 5`), Sheet size (each page at its own size, A4/A3/A5/Letter/Legal/Tabloid, or custom), Orientation (automatic picks the fewest sheets), Smaller pages (actual size / scale to fit), Tile overlap, Tile labels.
- Try a big page (e.g. set a page to 1000 × 700 mm in the inspector) and export to A4: it becomes a grid of A4 tiles, all vector (zoom in: text stays sharp), with "A1… C5" labels if enabled. Bookmarks jump to each page's first sheet.
- PNG: each sheet becomes an image (`name-01.png`, …). Very large sheets at high DPI are split into `-r1c1`, `-r1c2`, … tiles (8192 px cap).
- Your choices are remembered in the board.

### Auto-arrange and canvas export
- Toolbar → **Settings** → Layout → **Arrange pages: In a row / In a grid**, or the commands *Arrange pages in a row / in a grid*. Pages keep their output order; the first page stays put; one Ctrl+Z undoes it.
- **Export to canvas** (toolbar **Export** menu, the view's ⋮ menu, or command): writes `Board name.canvas` next to the board; open it in Obsidian's Canvas. Pages become groups, notes keep their section, PDFs open at the right page (crops and styles are dropped — the notice says so).

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
- Toolbar **View** → Inspector and outline, or **Patchwork: Open inspector and outline**: both open in the right sidebar and follow the last board you clicked.
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
- Top and left rulers in the board's display unit (mm by default; change it in **Settings**, below).
- Zero is the **selected page's top-left corner** (or the board origin when nothing is selected), so you can read module positions directly. Zoom and pan: ticks stay readable (label spacing adapts).

### 1c. Patchwork settings (new)
- Toolbar **Settings**, or **Patchwork: Settings…**: one dialog with four tabs: Layout (display unit, grid size, snap, grid, safe area, arrange pages), Numbering (page numbers, header, footer), Appearance (app theme for pages, font, PDF regions in dark mode), Document (title). Lengths are a plain number with the unit beside them. *Apply* is one undo step for everything you changed.
- Page labels and rulers switch units; *Apply* is one undo step.
- Try "use app theme" in dark mode: pages turn dark on screen *and in the export* (that's what the option means).

### 2a. Smart guides (new)
- Drag a module near another module (or the page's edges / centre): when an edge or centre comes within ~6 px on screen, it snaps and a pink guide line appears. Guides win over the grid; **Alt** places freely.
- Dragging a page snaps it to other pages' edges and centres the same way.

### 2b. Move a module to another page (new)
- Drag a module so its centre is over another page: that page gets a dashed outline, and on release the module moves onto it (same spot on the board, snapped to the grid). One Ctrl+Z undoes the whole move.
- While dragging, the module stays clipped to its old page (you see it jump on release); tell me if that's confusing.

### 3. Double-click actions
- **Text box or note module:** edits it **in place** (see "Editing in place" above). To open the note in a pane instead: the **Open** button on the bar, or double-click a linked frame.
- **PDF module:** opens the **crop editor** (also: right-click → *Edit crop…*).

### 3b. Crop editor (new)
- Toolbar → **PDF** → pick a PDF: the crop editor opens on page 1 instead of asking for a page number. Use *Previous / Next* to find the page.
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

- All SPEC milestones (M0–M5) are built. Not built, by decision: freezing PDF crops or images (Q15); stale warnings for live notes (Q15). Open questions worth a look: Q1, Q2, Q12, Q14, Q15 in `docs/open-questions.md`.

## Fixed tonight (worth a quick re-check)
- Deleting a board while it has unsaved changes no longer shows Obsidian's scary "Failed to save file … make a backup" notice.

## If something breaks

- Tell me what you did and what you saw; a screenshot helps. If a board won't open, the error view shows the exact problem and **Copy file contents** — the file itself is never modified.
- Your leftover test files from earlier (`test-vault/Untitled board.patchwork`, `Untitled board.pdf`, and the "penepene3" edit in `Spells/Spell index.md`) are untouched and uncommitted.
