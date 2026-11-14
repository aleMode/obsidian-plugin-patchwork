# Manual QA

Checks that need a human (a real printer, a real PDF viewer, eyes on the screen). Automated checks run through `scripts/cdp.mjs`; this list is what they can't cover.

## Carried over from spikes

- [ ] **Printed scale.** Print `.dev/spike-output/s8-vector.pdf` page 1 at 100% / actual size. The beige Goblin box must measure 95 × 84 mm. (2026-10-19: checked on screen against A4 width only; looked right. No printer available.)
- [x] Vector PDF crops are sharper than 200 dpi raster at high zoom (2026-10-19).
- [x] Text in vector crops is selectable (2026-10-19).
- [x] Hidden text outside a crop is found by search, as expected (2026-10-19).
- [x] Bookmarks and page labels ("i", "7") show in the viewer (2026-10-19).
- [ ] Tiles: view `s8-tiles.pdf` as a contact sheet (or print) and confirm the frame lines up across all 15 sheets. (2026-10-19: only two pages visible at a time; looked fine.)

## M0

Automated (`npm run e2e`, all passing 2026-10-19): file view and save guard (18 checks), board input (15), modules (21), export (19). The M0 acceptance criterion is covered by `scripts/e2e/export.js` ("note text is vector", "vector PDF crop keeps its text", page sizes, pixel positions).

Manual:
- [x] Create a board with "New board", add an A4 page, a note section and a PDF crop via the toolbar, move them, export. Open the PDF in two viewers; select text in the note and in the crop.
- [x] Light and dark app themes: paper stays light in both, on screen and in the export.
- [x] A community theme (e.g. Minimal) with dark mode: paper still light.
- [ ] 2× display scaling (not available on the dev machine): PDF crops sharp, labels readable.
- [x] Zoom from 2% to 800% with Ctrl+wheel and a trackpad pinch; modules switch to outlines below 25%.
- [x] Edit a source note while its board is open: the module updates.
- [x] Edit the board file in a text editor while the board has unsaved changes: a conflict copy appears and the dialog offers "Use my version". (2026-10-20: not reproducible by hand, since unsaved changes only exist for ~2 s before autosave; an outside edit after that reloads cleanly, which is what was observed. The conflict path is covered by `scripts/e2e/fileView.js`.)
- [ ] Printed scale: print an exported A4 page at 100%; a 90 mm wide module measures 90 mm. (Deprioritized: no printer; on-screen checks matched.)

## Use mode (2026-10-20)

Automated: `scripts/e2e/usemode.mjs` (19 checks: switch, remembered mode, no undo step, hidden chrome, app theme, pan instead of move, no selection, links to a reused side pane, note and text-box checkboxes, frozen refuses, tints). Stress board in Use mode pans like Arrange (whole board p50 16.6 ms).

Manual:
- [ ] Light and dark themes, and a community theme: faint panels and tinted cards readable in each.
- [ ] Ctrl/Cmd-hover on a link shows the page preview.
- [x] Dataview, Tasks, Buttons, Meta Bind, Bases blocks in a note module respond in Use mode. 2026-10-20, real mouse input over CDP, fixture `Dashboard/Plugin blocks.patchwork` (Dataview 0.5.70, Tasks 8.6.0, Buttons 0.9.13, Meta Bind 1.5.1, Bases core):
  - Dataview: task checkbox ticks the source note; list links open to the side.
  - Tasks: query checkbox completes the task (with its ✅ date); the filter field takes typing (Space types, doesn't pan).
  - Buttons: a command button runs its command.
  - Meta Bind: the toggle writes its frontmatter field; a command button runs.
  - Bases: the table renders; its links (spans, with Bases' own handler) now open to the side instead of replacing the dashboard.
  - With Tasks loaded, Patchwork's own checkbox write-back still changes exactly one character (usemode.mjs 19/19).
- [ ] A PDF export of a patchwork with tinted modules: light tints, coloured edges.

## PDF embeds in notes (2026-10-20, Q9)

Automated: `scripts/e2e/pdfembed.js` (8 checks: no Obsidian viewer, page drawn at its shape, text after it laid out, sharper after zooming in, vector at best quality in the right place, picture at small quality).

Manual:
- [ ] A note with `![[some.pdf#page=N]]` in a note module: the note's text shows, the page appears where the embed is, crisp a moment after zooming in (redrawn when the zoom settles, like PDF modules).
- [ ] Export at best quality: the embedded page is sharp and its text selectable in a PDF viewer; at small quality it is a picture.

## Editing frames in place, editor padding, Delete key (2026-10-21)

Automated: `scripts/e2e/inline.mjs` (frame editors open on exactly the part the frame shows, splice back into the head text box and the head note file, Enter and double-click trigger it, one undo step, editor padding); Delete on a selection is in `select.mjs` and `board.mjs`.

Manual:
- [ ] Second frame of a long note: double-click it, change a word, Escape. Only that word changes in the note file; the first frame is unchanged.
- [ ] A frame left empty (text all fits in the first) opens an empty editor; typing adds a paragraph at the end of the note.
- [ ] The text area has a hairline of room from the module border, also on a module with a thick border.
- [ ] Select a module by clicking it, press Delete (Canc) and Backspace: it goes, Ctrl+Z brings it back. Typing in the editor does not delete modules.

## Small text on screen (2026-10-21)

Automated: `scripts/e2e/legibility.js` (no change at 100 %, hairline stroke and a lighter colour on dark paper and a darker one on light paper at 60 %, full strength at 40 %, wrapping unchanged, a module's own text colour kept, nothing outside the board layer touched).

Manual:
- [ ] A dark-paper board (app theme) at 60 %: body text looks about as solid as at 115 %; headings and bullets too; no halo, nothing looks bold.
- [ ] Same on the white paper: text is dark and solid, not grey.
- [ ] A module with a text colour or a light tint keeps its colour (darker or lighter in the direction it already leans, never washed out).
- [ ] Zoom 100 % → 60 % → 100 %: text changes smoothly once the zoom settles, and is identical to before at 100 %.
- [ ] Export to PDF and PNG: text looks exactly as before (no stroke, no brightening).
- [ ] 2× display scaling (not available on the dev machine): the effect is subtler, text is not too heavy.

## Zoom controls (2026-10-21)

Automated: `scripts/e2e/zoomSteps.js` (stops from and between stops, limits, label resets to 100 % about the centre, a notch is 10 %, a fast notch is still 10 %, a small delta is proportional); `board.mjs` (Ctrl+wheel around the cursor).

Manual:
- [ ] Ctrl + mouse wheel: one notch changes the zoom by about 10 %, in both directions, around the cursor. A trackpad pinch still feels smooth and not slower than before.
- [ ] + and -: from 100 % you get 125, 150, 200...; from a zoom the wheel left you on (say 67 %) the next stop (75 %, or 50 % with -). Nothing happens past 800 % or below 2 %.
- [ ] Click the zoom label: exactly 100 % (A4 page about 794 px wide), centred on what was in the middle of the view. It has a hover state and the tooltip "Reset to 100%"; the toolbar does not shift as the number changes.
- [ ] Use mode: the toolbar hides +/- and the label as before; Ctrl+wheel still zooms by 10 %.

## Shapes (2026-10-26)

Automated: `tests/model/shapes.test.ts` (geometry, heads, dashes, drag helpers, file format), `scripts/e2e/shapes.mjs` (real mouse: draw by dragging, Shift circle, Shift-horizontal arrow, click to place, one undo step per drawing, hit-testing of unfilled/filled/diagonal shapes, endpoint handles, Escape, context bar).

Manual:
- [ ] Shape menu → each of the five items arms the tool; drawing works on any page, also over an existing note or PDF; nothing happens if you press on empty board (the tool stays armed).
- [ ] Drawing from bottom-right to top-left gives the same shape; the shape stays inside the page.
- [ ] Zoomed out to 25 %: shapes are still there (drawn small, not boxes); zoomed in to 400 %: lines and outlines stay sharp, and a hairline stays easy to grab.
- [ ] A rectangle over a PDF crop with no fill: you can still click, drag and crop the PDF through it; with a fill, the shape takes the clicks.
- [ ] A long diagonal arrow across text: only the line itself is grabbable.
- [ ] Dashed and dotted outlines look right on an ellipse, a rounded rectangle and a line; dots are round.
- [ ] Arrow heads: end, start, both; open arrow; dot. A very short arrow still shows its head. A thick arrow (Heavy) has a proportionally larger head.
- [ ] Change the kind in ⋯: rectangle → line gives a diagonal; line → ellipse keeps colour and size.
- [ ] Duplicate (Ctrl+D), nudge with arrows, align and distribute shapes with other modules; lock one and try to drag it.
- [ ] Use mode: shapes are drawn but inert; a drag over them still pans.
- [ ] Export PDF: shapes are vector (zoom in a viewer), colours match, opacity respected. PNG likewise. Dark app theme: shapes keep their paper colours.
- [ ] A shape on a master page shows on every page that uses it and cannot be selected there.
- [ ] Open a patchwork written by this version in an older one (if you have one): the shapes show as "Unknown module type" and are kept when saved.


## Review follow-ups (2026-11-14)

Popout windows are supported from v0.18 (review Q5). Automated checks ran over CDP in the main window only.

- [ ] **Popout:** drag a patchwork tab into its own window. Paper is light with dark text; switching the app theme keeps it right in both windows.
- [ ] **Popout export:** export from the popout and from the main window; the two PDFs are the same.
- [ ] **Popout crop editor and dialogs** open in the popout, not behind it in the main window.
- [ ] **Master pages:** try to add *Next frame* on a master, drag a linked frame onto a master, and mark a page holding a frame as master. Each is refused with a notice.
- [ ] **Use mode undo:** in Arrange move something, switch to Use, tick a checkbox, press Ctrl+Z twice. Only the tick is undone. Back in Arrange, Ctrl+Z undoes the move.
- [ ] **Several PDFs dropped:** drop two PDFs from the file explorer onto a page. Their crop editors open one after another ("1 of 2", "2 of 2").
- [ ] **Undo after a new note:** add a note from the picker; it fits its text. One Ctrl+Z removes it (the fit is not a separate step).
- [ ] **Copy and paste:** copy two items, paste on another page and into another patchwork; paste text copied from a browser (text box) and a screenshot (image saved under the attachment folder).
- [ ] **Context bar:** select an item; the bar is open. Move the pointer away; it folds into the pill. Drag the item; the bar hides and comes back after the drop.
- [ ] **Crop editor on a real rulebook:** jump to page 187 with the page field, zoom to 300 %, double-click a paragraph and a table.
- [ ] **Settings search (Obsidian 1.13+):** type "render cache" in Obsidian's settings search; Patchwork's setting is found.

