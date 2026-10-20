# Use mode: a patchwork as a dashboard (plan, 2026-10-20)

**Status:** steps 1–6 built and tested, plugin checks included (Dataview, Tasks, Buttons, Meta Bind, Bases; results in `docs/qa.md`). One change from the plan: in Use, a press inside a module belongs to its content (links, buttons, text selection) and only a drag elsewhere pans, so plugin controls that aren't links or buttons still get their clicks.

Replaces the Live Preview editing idea (Q18): instead of editing notes in Obsidian's editor, a patchwork gets a second mode for **using** what it shows. Notes render cleanly in the app theme; links, checkboxes and plugin buttons work; nothing can be moved by accident. In-place text editing (the text area, in Arrange) stays as it is.

## Decisions (taken with the user, 2026-10-20)

| | Decision |
|---|---|
| Modes | **Arrange** (today's board, the default) and **Use**, switched from the toolbar or a command. |
| Remembered | Per patchwork, in the file (`board.mode: "use"`; absent means Arrange). A dashboard reopens in Use. Switching is not an undo step. |
| In Use | Nothing is selected, moved, resized or deleted. Dragging pans, the wheel pans and zooms as today. Content is live: links, task checkboxes, callout folds, plugin buttons and queries. |
| Look in Use | Board chrome hides (rulers, grid, page labels, safe-area guides, overflow marker, handles, context bar, popover); the toolbar shrinks to the mode switch, zoom to fit and the minimap toggle. Content uses the **app theme**, not white paper. Pages are **faint panels**. |
| Colours | Modules get Canvas's colour palette (6 theme colours that follow light and dark, or a custom colour): a tinted card with a coloured border. Shown in both modes and in exports (light values on paper). |
| Overflow | Unchanged: each module's clip / shrink to fit / grow, also in Use. |
| Links | Open in a pane to the side, reused by later clicks. External links open in the browser. |
| Exports | Unchanged (light paper unless "use app theme" is set). |
| Later | Optional reading-view typography (notes styled exactly like Obsidian's reading view). |

## What "live" covers

- **Links** in notes and text boxes: internal links open to the side, with the page preview on hover (Ctrl/Cmd) like the reading view; external links open in the browser.
- **Task checkboxes** (`- [ ]`): ticking writes back to the source line. For a note module that is the note file (only that line, and never when the file changed since it was rendered); for a text box, the patchwork. Frozen notes are snapshots, so their checkboxes are read-only.
- **Plugins** that render interactive content through Obsidian's markdown renderer get their clicks: Dataview (queries, task lists), Tasks (queries, completing tasks), Buttons, and suggested additions Meta Bind (inputs and buttons; maintained, unlike Buttons) and Bases (Obsidian's own database views).
- **Trackers** work as today.
- **Linked frames:** links work; checkboxes in frames are read-only at first (their lines map through the chain's blocks, a later step).

## Steps

1. **Model:** `board.mode`, module `style.tint` ("1"–"6" or `#rrggbb`); validate, serialize, unit tests. A store change that saves without an undo step (for the mode).
2. **Mode switch:** the toolbar's mode toggle, the command, and remembering the mode. In Use, the board's input skips selection and dragging (drag pans), the context bar, popover and keyboard edits are off, and the chrome hides.
3. **Look:** pages lose the paper scope in Use (CSS only, so nothing re-renders) and become faint panels.
4. **Live content:** module content takes the pointer in Use. Internal links open to the side and show hover previews; checkboxes write back.
5. **Colours:** `style.tint` on cards; palette on the context bar and in the Style tab; paper and export use the light values.
6. **Checks:**
   - e2e suite `usemode.mjs`: switch, remembered mode, no drag, link opens to the side, checkbox writes the note line, frozen read-only, tint;
   - stress-board pan in Use;
   - plugin checks;
   - testing guide, `docs/qa.md`, SPEC changelog.

## Risks

- **Checkbox lines.** Obsidian's renderer marks each task with its line in the rendered markdown; a note module shows a slice, so the line maps through the slice offset (`sliceBounds`). Covered by e2e with a section module and a line range.
- **Plugins in the test vault** need installing (third-party code, not committed; `.obsidian/plugins` is git-ignored).
- **Panning vs clicks:** a press on live content that turns into a drag pans; a press and release without moving is a click.
