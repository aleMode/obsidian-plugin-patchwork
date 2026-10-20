# Interface reorganisation and inline editing (proposal, 2026-10-20)

Written after the manual test rounds. **Status:** quick wins, step 1 (Patchwork settings dialog, toolbar, export menu, wording), step 2 (context bar and properties popover) and step 3 (inline editing, options A and B with a plain text area rather than CodeMirror) and the floating outline-and-views panel are built; option C (real Live Preview) is not. The decisions in section 6 were taken on 2026-10-20: optional dock, inline editing on double-click, "patchwork" in place of "board", toolbar first.

## 1. Where everything is today

Counts are controls a person can reach, not code.

| Surface | What it holds | Count |
|---|---|---|
| Toolbar (floating, top) | add page / note / PDF / text / image / tracker, export, board settings, panels, zoom −/+/fit, minimap, undo/redo | 15 icons, none labelled |
| Inspector, nothing selected ("board") | title, unit, grid size, snap, show grid, app theme, font, dark PDFs, numbering ×5, header, footer, arrange ×2, canvas export, default safe area | 19 |
| Board settings dialog | unit, grid size, snap, show grid, app theme | 5, **all duplicates** of the inspector |
| Inspector, a page | name, X, Y, W, H, preset, orientation, background, master toggle, master pick, number, header, footer, safe area | 14 |
| Inspector, any module | label, X, Y, W, H, lock, front/back, then **Style**: padding, border width / colour / radius, background, opacity, text scale, CSS class | 15 |
| ...plus a note | file, section, include heading, from / to line, overflow, scale, freeze | +8 (23 rows) |
| ...plus a PDF | file, page, crop, fit, rotation, exports mode, invert, source check | +8 (23 rows) |
| ...plus text / image / frame / tracker / TOC | 1 / 2 / 2 / up to 6 / 1 | |
| Right-click menus | page (4), module (up to ~12, varies by type), multi-select (align ×6, distribute ×2, lock, duplicate, delete) | |
| Export dialog | format, file, pages, sheet size, orientation, smaller pages, tile overlap, tile labels, quality, ink saver, DPI, open after, layout, bleed, crop marks | 15, one scrolling column |
| Outline panel | views (save / jump / rename / delete), pages and modules tree | |
| Plugin settings | render cache, overflow marker | 2 |
| Command palette | 20 commands (add ×7, zoom ×2, export, board settings, arrange ×2, canvas, views ×2, minimap, frame, new) | |

### What is wrong

1. **A note or PDF needs ~23 rows in a 300 px column.** Style (8 rows) sits under every module type, so the content-specific controls scroll off. Rare controls (CSS class, source check, line range, opacity) get the same weight as common ones (file, section, fit).
2. **Board-level settings live in four places** (inspector, Board settings dialog, Export dialog, plugin settings), with 5 duplicated.
3. **X / Y / W / H take 4 rows** for something you mostly do by dragging.
4. **Some functions exist only as commands or a bare icon.** Export had no menu entry; "Export to canvas" is an inspector button and a command; Arrange is the same.
5. **Vocabulary collides with Canvas:** "New board", "Board settings", "Open a Patchwork board…".

### Quick wins already done (`c3acff1`)

- Right-click and command: **New patchwork** (was "New board").
- Export is now in the view's `⋮` menu (**Export as PDF or PNG…**, **Export to canvas**) and the toolbar tooltip says "PDF or PNG".

## 2. Proposal: no sidebar needed by default

Four layers. Each control has one home; the sidebar becomes optional.

### 2.1 Context bar (floating above the selection)

Six or fewer controls, the ones used every time. Appears when something is selected, follows it while panning and zooming (like Canvas / Figma).

```
 ┌ Section ▾ ┬ Overflow ▾ ┬ ❄ Freeze ┬ ↗ Open note ┬ ⋯ ┐
 └────────────────────────────────────────────────────┘
                  ┌──────────────┐
                  │  selected    │
                  │  note module │
```

| Selection | Context bar | Note |
|---|---|---|
| Page | Name · Size ▾ · Orientation · Background ● · Master ▾ · ⋯ | numbers / header / footer overrides move to ⋯ |
| Note | Section ▾ · Overflow ▾ · Freeze · Open note · ⋯ | |
| PDF region | Crop… · Page ‹ n › · Fit ▾ · Invert · ⋯ | Page stepper replaces typing a number |
| Text | Edit · Text scale · ⋯ | inline editing, section 4 |
| Image | Change… · Fit ▾ · ⋯ | |
| Tracker | Kind ▾ · Edit… · Print blank · ⋯ | |
| Linked frame | "Frame 2 of 3" · Add next frame · ⋯ | |
| Table of contents | Heading… · ⋯ | |
| Several items | Align ▾ · Distribute ▾ · Lock · Delete (+ Master ▾ for pages) | replaces the whole group panel |

### 2.2 Properties popover (the `⋯` button, or Enter)

A compact popover next to the item, never taller than about 8 rows, in four tabs. Only the tabs that apply are shown.

| Tab | Holds |
|---|---|
| Content | what the item is: note file, section, include heading, overflow, freeze · PDF file, page, crop, fit, invert · text, image, tracker, table of contents settings (as built) |
| Layout | X, Y, width, height; lock; to front / back |
| Style | padding; border; background; opacity; text scale |
| Advanced | label (outline name), line range and scale (notes), rotation, export mode and source check (PDF), CSS class |

A page gets three tabs: **Page** (name, size preset, orientation, background, master), **Layout** (X, Y, width, height) and **Numbers** (number, header, footer overrides, safe area). As built, the popover opens to the side of the selection when there is room, else below or above it, and never covers the item or the bar.

Worst case today (note, 23 rows) becomes: 5 controls on the bar + 4 tabs of at most 8 rows. No scrolling.

### 2.3 Board menu and one Board settings dialog

One **Board ▾** toolbar button replaces the gear. Its dialog merges the inspector's board section and the duplicate modal:

| Tab | Holds |
|---|---|
| Layout | display unit, grid size, snap, show grid, default safe area, **Arrange pages** (row / grid) |
| Numbering | show numbers, start, format, position, skip first · header, footer (with token hint) |
| Appearance | app theme for pages, board font, dark PDFs in dark mode |
| Document | title |

### 2.4 Export menu and a tidier Export dialog

**Export ▾** in the toolbar and the `⋮` menu: *PDF or PNG…*, *Canvas*. The dialog stays modal but is grouped, so it fits without scrolling:

- always visible: format, pages, file, open after export
- **Sheets and printing** (collapsed; opens automatically when a sheet size is chosen): sheet size, orientation, smaller pages, tile overlap + labels, layout, bleed, crop marks
- **Quality** (collapsed): quality, DPI, ink saver

### 2.5 Toolbar (15 icons → three groups)

`[+ Page] [+ Note] [+ PDF] [+ More ▾ text · image · tracker · table of contents]`  `[− 31 % + ⛶]`  `[↶ ↷]`  `[Board ▾] [Export ▾] [View ▾ outline · views · minimap · properties dock]`

Labels on hover and a short label on the primary buttons.

### 2.5.1 Sidebars

- **Properties dock** (today's inspector) stays as an *option* in the View menu for people who like numeric precision, but is closed by default.
- **Outline and Views** become a floating panel at the left of the board (like the minimap), toggled from View ▾. They are not needed to edit.

## 3. Words

| Today | Proposed | Why |
|---|---|---|
| New board *(done)* | New patchwork | the file is a patchwork; "board" reads like Canvas |
| Board settings | Patchwork settings | same |
| "Open a Patchwork board to edit it here" | "Open a patchwork…" | same |
| Untitled board | Untitled patchwork | would touch 5 e2e checks; do with the rest |
| Master page | keep | |
| Freeze | Freeze text (snapshot) | says what it does |
| Source check / Start checking | Warn if this PDF changes | |
| Linked frame | Text frame (continues a note) | |
| In exports: Vector (sharp) / Image (smaller) | keep | |

The command palette keeps every action (it is the keyboard route), but nothing is **only** a command.

## 4. Editing notes inline (like Canvas)

### What Obsidian allows

- There is **no public API** to embed an editable note in your own view. `Editor` is abstract, `registerEditorExtension` only affects Obsidian's own editors, and `MarkdownRenderer` is read-only.
- Obsidian provides the CodeMirror 6 packages (`@codemirror/state`, `view`, `commands`, `language`...) to plugins, and our build already treats them as externals. A **plain CM6 editor** can therefore be created with no new dependency.
- Canvas itself uses internal APIs. Plugins such as Kanban reach the same internals; they are undocumented and have broken on Obsidian updates. Our hard rule 6 allows that only if a spike shows there is no alternative, isolated behind one adapter file.

### Three options

| | What you get | Cost | Risk |
|---|---|---|---|
| **A. Text modules, plain CM6** | double-click a text module, type in place, Esc / click away saves into the board file | small | low: documented packages, no file I/O beyond our own board |
| **B. Notes, plain CM6 on the section** | same for note modules: edit the shown slice (section / block / line range) and write back with `vault.process`, which is atomic and documented | medium | edge cases below; no Live Preview look while editing (raw markdown, optional syntax colouring needs `@codemirror/lang-markdown`, a new dependency to justify) |
| **C. Real Live Preview via internals** | identical to Canvas: rendered while editing, links and suggest menus, other plugins' editor extensions | spike first (about a day), then an adapter | high: undocumented, version-fragile, must also work on light paper in dark themes, virtualised, and released when off-screen |

### Edge cases that decide the work for B and C

- **Slices:** the editor shows only the module's slice; saving must splice it back into the right range of the file. Include-heading off, line ranges, and block IDs each change the mapping.
- **Source changed underneath:** while editing, re-rendering that module must pause; if the file changed on disk meanwhile, refuse or merge, never overwrite.
- **Frozen notes:** editing would edit the snapshot or the live note; needs a rule (suggest: disabled with a hint, "Unfreeze to edit").
- **Linked frames:** a frame shows a later part of the head note; suggest editing happens in the head module only, and double-clicking a frame focuses the head's editor.
- **Undo:** the editor has its own undo; the board's Ctrl+Z does not cover edits to a note file (and must not).
- **Performance:** at most one live editor at a time; destroy it on blur (hard rule 9).

### Gestures

- **Double-click a note / text module: edit in place.** (SPEC 5.x today says it opens a split pane; this changes that line and goes in the changelog.)
- **Open the note in a pane:** the `↗` button on the context bar, right-click → *Open note*, and Alt + double-click.
- Double-click a PDF region stays: crop editor. Double-click empty page paper: nothing.
- Esc or clicking outside leaves the editor.

### Recommendation

A first, then B, then decide on C from how B feels. A gives most of the "Canvas feel" for text boxes at low risk, and B reuses the same editor component. C only if the raw-markdown editing is not good enough; it needs its own spike (S8), not a guess.

## 5. Suggested order

1. **Toolbar + Board dialog + Export menu** (section 2.3 to 2.5). Mostly moving existing controls; removes the duplicates. One session.
2. **Context bar + Properties popover** (2.1, 2.2). The big one; the inspector can stay until it is done. Two sessions.
3. **Inline editing A, then B** (section 4).
4. **Words pass** (section 3), together with the filename change and e2e updates.
5. Optional: spike S8 for Live Preview.

## 6. Decisions needed

1. Make the inspector an **optional** dock and default to the context bar + popover?
2. Double-click on a note: **edit inline** (open-in-pane moves to ↗ / right-click)? Or keep opening the pane and use another gesture for editing?
3. Is "patchwork" the word for the file and "board" gone from the UI, or keep "board" for the surface you pan around?
4. Start with step 1 (toolbar, Board dialog, Export) or with step 3 (inline editing)?
