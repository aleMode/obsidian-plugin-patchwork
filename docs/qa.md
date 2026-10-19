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

- [ ] Light and dark app themes: paper stays light in both.
- [ ] 2× display scaling (not available on the dev machine).
- [ ] Export of the acceptance board opens correctly in at least two PDF viewers.
