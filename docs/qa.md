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

Automated (`npm run e2e`, all passing 2026-10-19): file view and save guard (18 checks), board input (15), modules (19), export (19). The M0 acceptance criterion is covered by `scripts/e2e/export.js` ("note text is vector", "vector PDF crop keeps its text", page sizes, pixel positions).

Manual:
- [ ] Create a board with "New board", add an A4 page, a note section and a PDF crop via the toolbar, move them, export. Open the PDF in two viewers; select text in the note and in the crop.
- [ ] Light and dark app themes: paper stays light in both, on screen and in the export.
- [ ] A community theme (e.g. Minimal) with dark mode: paper still light.
- [ ] 2× display scaling (not available on the dev machine): PDF crops sharp, labels readable.
- [ ] Zoom from 2% to 800% with Ctrl+wheel and a trackpad pinch; modules switch to outlines below 25%.
- [ ] Edit a source note while its board is open: the module updates.
- [ ] Edit the board file in a text editor while the board has unsaved changes: a conflict copy appears and the dialog offers "Use my version".
- [ ] Printed scale: print an exported A4 page at 100%; a 90 mm wide module measures 90 mm.
