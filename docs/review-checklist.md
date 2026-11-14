# Review checklist and attack plan

Working list distilled from `docs/review-2026-11.md` (the long version, with file:line references, scenarios and reasoning). IDs point back to it: **B** = bug (§2), **S** = spec drift (§3), **P** = performance and maintainability (§4), **T** = tweak (§5), **U** = UX (§6), **F** = feature (§7), **Q** = question (§9).

How items move: **Decide** items need an answer from the author (usually one line). **Elaborate** items need a short plan or spec section before any code. Once decided or elaborated, an item moves into a phase of the attack plan at the bottom.

## 1. Done (branch `review-fixes`, 2026-11-14)

All checked with `npm run check` (351 unit tests, 0 lint errors) and in the dev Obsidian over CDP where the bug was visible there.

- [x] **B1** Popout windows: light paper rule per window (it also matched no rules there: cross-window `instanceof`); exports always built in the main window. `b4687d3`, `f5253c4`
- [x] **B2** Linked frames keep their chain when moved to another page, duplicated, or on a duplicated page. `d0bad8c`
- [x] **B3** Conflict copies take a free name, are written before the disk version loads, and fall back to "Copy my version". `dace27b`
- [x] **B4** Rename rewrites are not undo steps. `a61c26f` (the `links.js` e2e check now asserts the opposite of before)
- [x] **B5** Section picker writes `#Parent#Child` when a heading name repeats. `e822117`
- [x] **B6** Export to canvas asks before replacing an existing `.canvas`. `80d0e2d`
- [x] **B7** Images and PDFs embedded in notes re-render when their file changes. `6a1d3be`
- [x] **B9** One export at a time. `456bc40`
- [x] **B10** (part) Export choices are not an undo step; nudges and wheel scrolls more than 1 s apart are separate undo steps. `456bc40`, `4ceb753`
- [x] **B11** Space-to-pan is released when the board loses focus. `6d59230`
- [x] **B12** PDF searches in the crop editor are cancelled by a newer search or by closing. `6d59230`
- [x] **B13** Shapes serialized like other modules. `53903b5`
- [x] **B14** View IDs unique `0d89297`; masters out of auto-arrange and canvas export `60b0d5f`; `$&` in retyped headings `6d59230`; masters not mounted in Use mode `6d59230`.
- [x] **B15** `.gitattributes` (LF everywhere). `2e33a38`
- [x] Rule 3 soft spot: editing a checklist line keeps its tick and unknown keys. `3c6b916`
- [x] **S** SPEC header, §5.3, §6 (`scrollY`, conflict copies, renames), §7 file tree, changelog v0.18; README commands, toolbar, Node version.
- [x] Withdrawn: "links in tracker checklist items are not rewritten on rename". Items are drawn as plain text, so there are no links to rewrite.

## 2. Decide

Each has a recommendation; a one-word answer is enough.

**Product direction (decides what gets built next)**

- [ ] **Q1** At the table you are: player, DM, or both? → decides F8 (encounter tracker) vs a character dashboard template first.
- [ ] **Q2** What is on the table: laptop, second screen facing players, touch screen? → priority of F3, F14 and bigger hit targets.
- [ ] **Q3** Session state (HP, slots, roll history) lives in the `.patchwork` file (as now) or in a separate session file? *Recommend: keep it in the file, outside the undo history.*
- [ ] **Q4** Do you use the Dice Roller plugin? If yes, F1 hands rolls to it instead of parsing dice itself.
- [ ] **Q8** Public release planned? If yes: plugin ID, `@electron/remote` in review, stress command, tested `minAppVersion`, English only.
- [ ] **Q9** Do you share exports made from commercial rulebooks? Vector crops carry the whole source page (hidden text too). *Recommend: louder note in the export dialog.*

**Open behaviour questions**

- [ ] **B8** Linked frames on a master page don't work on the pages using it. Fix (rewrite `from` in `resolvePage`, run chains on resolved pages) or block frames on masters? *Recommend: block, with a notice; masters are for furniture.*
- [ ] **B10** Use mode keeps Ctrl+Z active, and it can undo an Arrange edit after a checkbox tick. Limit undo in Use mode to edits made since entering it, or turn it off there? *Recommend: limit.*
- [ ] **Q5** Popout windows: supported from now on (they work after B1; add them to the QA list), or "main window only"? *Recommend: supported.*
- [ ] **Q6 / S** Manual page order (`board.order: "manual"`) has a model but no UI. Build it (drag rows in the outline) or drop it from the spec? *Recommend: drop until a need shows.*
- [ ] **S** `PdfModule.renderDpi` is validated and saved but never read. Implement (per-module raster DPI) or remove from the spec (keep it in files as an unknown-ish key)? *Recommend: remove from the spec.*
- [ ] **B14** Retyping a heading in place fixes only that module's link; other modules and boards showing the section break. Follow everywhere (like a rename) or leave it? *Recommend: follow in the open board only.*
- [ ] **B14** Dropping several PDFs opens one crop dialog per file, stacked. Queue them one after another, or place them uncropped? *Recommend: queue.*
- [ ] **T** An unfilled shape over a PDF region forces it to raster in exports. Ignore unfilled shapes and lines when deciding? *Recommend: yes.*

**Repo**

- [ ] Remove `image.png` and `image copy.png` (repo root), `test-vault/Untitled board (conflict 2026-10-20 1015).patchwork` and the two exported PDFs in `test-vault/`? Nothing references them. *Recommend: yes.*
- [ ] Hide *Generate stress-test patchwork* behind a setting (or dev builds only)? *Recommend: yes, before any release.*
- [ ] Add a Windows job to CI? *Recommend: yes, but first check that `npm ci` installs `@rolldown/binding-win32-x64-msvc` on a clean clone (it didn't here).*
- [ ] **Q10** Is Windows a supported dev platform now? If yes, `CLAUDE.md` needs Windows setup next to the Linux one.
- [ ] Four e2e suites fail on this machine (Windows, Obsidian 1.12.7, 1024×800 window) **before and after** the fixes: `masters.js`, `toc.js`, `usemode.mjs` (checkbox ticks), `outlinepanel.mjs` (one layout check). Likely window size or version. Run them at 1920×1040 on Linux to confirm, or make the suites size the window themselves?

## 3. Elaborate (plan before code)

**Foundations**

- [ ] **P** Split `BoardViewport.ts` (1 936 lines): input state machine, actions, toolbar, menus. No behaviour change; e2e is the safety net.
- [ ] **P** Module-type registry (keys, content keys, board renderer, print renderer, forms) to end the eight-places problem that caused B13.
- [ ] **P** Unit tests for `linkTracker`, the `PatchworkView` save/conflict flow, `liveContent` checkbox mapping (needs a thin fake of the Obsidian bits).
- [ ] **S** Move `paperScope`, `furniture` and `moduleTitle` out of `view/` so `export/` doesn't import the view layer.
- [ ] **P** Perf probes not yet measured: drag one module for 240 frames on the stress board; rename a folder of many notes (batch rename events, compute `moved` once); serialize once per save instead of three times.

**Tweaks (T) and UX (U), small each, worth one plan together**

- [ ] New note module: half the page wide, height fitted to content, "Fit box to text" on the context bar; default padding 1.5–2 mm.
- [ ] Text box starts in edit mode instead of the "Change this text with Edit above" placeholder.
- [ ] Context bar opens on selection (or one-time hint) instead of the 30 × 18 px pill; popover opens on the side with free space.
- [ ] Crop editor: page number field, zoom, PageUp/PageDown; "crop to block" (F10).
- [ ] Copy / paste (F5); Esc deselects; `Ctrl+0` fit, `Ctrl+1` 100 %; a "Keyboard and mouse" cheat sheet in the View menu.
- [ ] Empty-page hint, ribbon icon, "New patchwork" in the file explorer.
- [ ] Export: sticky Export button, remember "Open after export", clickable problems, "Export this page" in the page menu.
- [ ] Section picker: show the first words of block entries (`^opportunity` alone says little).
- [ ] Freeze: "Update snapshot" next to "Unfreeze".
- [ ] Settings tab: implement `getSettingDefinitions()` so settings show in Obsidian's settings search (needs a check against `minAppVersion`).

**Table play (F), each needs its own short spec section**

- [ ] **F2** Tracker upgrade: type a value or delta, Shift-click ±5, `value / max`, reset groups ("long rest").
- [ ] **F3** Use-mode navigation: fit width, PageUp/PageDown between pages, digits for saved views.
- [ ] **F1** Rollable tables in Use mode (die button on markdown tables, `dice:` inline code), no new data. Depends on Q4.
- [ ] **F4** Templates and starter boards (DM screen, character dashboard, spell-card sheet), "empty slot" note modules.
- [ ] **F6** Quick add: one search over notes, headings and PDF bookmarks.
- [ ] **F7** Pages from notes (spell and monster cards). Guard against drifting toward pagination (D3).
- [ ] **F8** Encounter tracker module. Depends on Q1.
- [ ] **F9** Visibility flags: hide in export / hide in Use.
- [ ] **F12** Peek (link opens as a floating card in Use mode); **F13** Find (Ctrl+F); **F11** roll history; **F14** player view; **F15** timer. Later, as needed.

## 4. Attack plan

1. **Phase 0, fixes.** Done (section 1). Merge `review-fixes` after a look at the diff and a manual pass over the popout, frames and conflict scenarios.
2. **Phase 1, decisions.** One sitting through section 2. Answers go into `docs/open-questions.md` (one entry each) and, where they change behaviour, into SPEC with a changelog line.
3. **Phase 2, foundations.** Split `BoardViewport`, the module registry, the missing unit tests, the layering move. Repo items from section 2. Goal: the next features land in small files with tests.
4. **Phase 3, table play, small.** F2, F3, then F1 (shape per Q4). Then the decided half of B8 and B10. These make Use mode usable for a real session.
5. **Phase 4, onboarding and arranging.** The tweaks and UX block of section 3, then F4 templates and F5 copy/paste.
6. **Phase 5, larger features.** F8 or F7 first (per Q1 and Q2), then F6, F9. Each starts with a SPEC section and a model with unit tests, as M0–M5 did.

Before each phase: re-read the relevant review section, write the plan in a few lines here, then tick items as they land.
