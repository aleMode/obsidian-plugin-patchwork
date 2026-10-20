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
