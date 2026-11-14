# Review checklist and attack plan

Working list distilled from `docs/review-2026-11.md` (the long version, with file:line references, scenarios and reasoning). IDs point back to it: **B** = bug (§2), **S** = spec drift (§3), **P** = performance and maintainability (§4), **T** = tweak (§5), **U** = UX (§6), **F** = feature (§7), **Q** = question (§9).

Status 2026-11-14: phases 0–2 and the tweaks are done (sections 1–3). What is still open is in section 4.

## 1. Fixes (branch `review-fixes`, merged to `main` as `8d193fe`)

- [x] **B1** Popout windows: light paper rule per window; exports always built in the main window. `b4687d3`, `f5253c4`
- [x] **B2** Linked frames keep their chain when moved to another page, duplicated, or on a duplicated page. `d0bad8c`
- [x] **B3** Conflict copies take a free name, are written before the disk version loads, and fall back to "Copy my version". `dace27b`
- [x] **B4** Rename rewrites are not undo steps. `a61c26f`
- [x] **B5** Section picker writes `#Parent#Child` when a heading name repeats. `e822117`
- [x] **B6** Export to canvas asks before replacing an existing `.canvas`. `80d0e2d`
- [x] **B7** Images and PDFs embedded in notes re-render when their file changes. `6a1d3be`
- [x] **B9** One export at a time. `456bc40`
- [x] **B10** (part) Export choices are not an undo step; nudges and wheel scrolls more than 1 s apart are separate undo steps. `456bc40`, `4ceb753`
- [x] **B11** Space-to-pan is released when the board loses focus. `6d59230`
- [x] **B12** PDF searches in the crop editor are cancelled by a newer search or by closing. `6d59230`
- [x] **B13** Shapes serialized like other modules. `53903b5`
- [x] **B14** View IDs unique; masters out of auto-arrange, canvas export and Use mode; `$&` in retyped headings. `0d89297`, `60b0d5f`, `6d59230`
- [x] **B15** `.gitattributes` (LF everywhere). `2e33a38`
- [x] Rule 3: editing a checklist line keeps its tick and unknown keys. `3c6b916`
- [x] **S** SPEC v0.18 and README caught up with the code.
- [x] Withdrawn: "links in tracker checklist items are not rewritten on rename" (items are plain text).

## 2. Decisions (answered 2026-11-14; recorded in `docs/open-questions.md` Q20 and SPEC v0.19)

**Product direction**

- [x] **Q1–Q2** Patchwork is a general utility (an image, PDF and dashboard builder), not a tool for one game. SPEC section 3 reframed `a786576`; new trackers have neutral labels `1799e4c`.
- [x] **Q3** No separate session file: nothing to do.
- [x] **Q4** No dice support: F1 is not planned.
- [x] **Q8** A public release may come later. Keep in mind: plugin ID, `@electron/remote` in review, tested `minAppVersion`.
- [x] **Q9** No extra warning for exports from commercial PDFs.

**Behaviour**

- [x] **B8** Linked frames kept off master pages, with a notice. `4b6c80d`
- [x] **B10** Use-mode undo limited to edits since entering Use, one history shared with Arrange. `abe5f90`
- [x] **Q5** Popout windows supported; added to `docs/qa.md`. `58ee370`
- [x] **Q6** Manual page order dropped (old files keep the keys). `a786576`
- [x] **S** `renderDpi` removed from the spec and model (old files keep the key). `a786576`
- [x] **B14** A heading retyped in place is followed by every module in the open patchwork. `668337f`
- [x] **B14** Several dropped PDFs queue their crop editors ("1 of 2"). `c65ac74`
- [x] **T** A shape forces a PDF region to raster only where it paints over it. A frame around a crop leaves it vector; a line across it still forces raster, since vector content is drawn last and would hide the line. `0da0467`

**Repo**

- [x] Stray screenshots, the conflict-copy fixture and two exported PDFs removed. `3214cdb`
- [x] Stress-test command stays visible (answer: no).
- [x] Windows job in CI. A clean `npm ci` on Windows installs rolldown's binding; the failure during the review came from a stale local `node_modules`. `7803903`
- [x] **Q10** Windows is a supported dev platform. The author is updating `CLAUDE.md`; README notes the e2e window size.
- [x] The four e2e failures were the 1024 × 800 window. The runner now sizes the window to 1920 × 1040 and restores it; all 37 suites pass on Windows. `dd4d02b`

## 3. Foundations and tweaks

**Foundations**

- [x] **P** `BoardViewport.ts` split without behaviour change (2 001 → 1 648 lines): `boardMenus`, `boardContent` (adding and dropping content), `boardExport`. Camera, input, selection and the toolbar stay, since they share private state; splitting further would mean widening its API for little gain. `b6c0307`
- [x] **P** Module-type "registry" kept light: one checked `MODULE_TYPES` list, `Record<ModuleType, …>` tables and exhaustive switches. A new type fails to compile until every place handles it (what B13 needed). `fe7e56b`
- [x] **P** Unit tests for `linkTracker`, the save and conflict flow, and Use-mode checkboxes, on a thin fake of the `obsidian` module (`tests/fakes`). `9042f0d`
- [x] **P** Perf probes added to `scripts/perf/stressBoard.js` (drag, save, folder rename); results in `docs/perf.md`. The drag probe found a regression: the outline rebuilt every row on every frame (about 14 fps on the stress board). Fixed, now about 19 ms a frame `2617ca1`. Saves serialize once per snapshot `a79edc3`.
- [ ] **S** Move `paperScope`, `furniture` and `moduleTitle` out of `view/`? Asked for upside and downside, see section 4.

**Tweaks and UX**

- [x] New note: half the page wide, fitted to its text; *Fit* on the context bar; 1 mm default padding. `1799e4c`
- [x] New text box opens for typing. `1799e4c`
- [x] Context bar opens on selection and folds into the pill when the pointer leaves; the popover takes the less crowded side. `f3e375c`
- [x] Crop editor: page field, Page Up/Down, zoom, double-click to crop to a paragraph (F10). `9cfa21c`, `a4a6574`
- [x] Copy, cut, paste (F5), also across patchworks; pasted text becomes a text box, a pasted image is saved as an attachment. Esc deselects; Ctrl+0 fit; Ctrl+1 100 %; *View → Keyboard and mouse*. `f3e375c`
- [x] Empty-page hint; ribbon icon. "New patchwork" stays in the folder menu: Obsidian has no API for its new-file buttons. `a872a4b`
- [x] Export: sticky Export button, remembered "Open after export", problems dialog with *Show*, *Export this page…*. `1e9529b`
- [x] Settings tab declares its settings for Obsidian's settings search. `e883c3b`
- [x] ~~Section picker: first words of block entries~~ (answer: no).
- [x] ~~Freeze: "Update snapshot"~~ (answer: no, it would clutter).

**Table play (F)**: not planned (Q1–Q4). F2, F3, F1, F4, F6, F7, F8, F9, F11–F15 stay in the review for reference only.

## 4. Open

- [ ] **Layering move** (`paperScope`, `furniture`, `moduleTitle` out of `view/`). You asked for the trade-off:
  - *Upside:* `export/` would stop importing the view layer, so the print path reads and tests on its own, and a future view change can't break exports by accident.
  - *Downside:* about ten files change imports for no visible change, and a new shared folder (`src/render/` already holds caches) blurs what goes where. `paperScope` and `furniture` touch the DOM, so they can't go into `model/`.
  - *Recommendation:* do it only when one of these files changes for a real reason; today it is churn.
- [x] `followups` merged into `main` (2026-11-14).
- [ ] Manual pass over the QA list (`docs/qa.md`, "Review follow-ups").
- [ ] Before a public release (Q8): plugin ID, `@electron/remote` usage in review, test on the oldest claimed Obsidian version.
- [ ] Dev loop: `npm run dev` copies `styles.css` only when the code rebuilds, so a CSS-only edit needs a touch of a `.ts` file (or a manual copy) to show up.
