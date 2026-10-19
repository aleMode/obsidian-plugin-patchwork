# Performance notes

Measured with `scripts/perf/stressBoard.js` (run inside Obsidian via `node scripts/cdp.mjs -f scripts/perf/stressBoard.js`). It generates a 100-page × 3-module board (`Patchwork: Generate stress board`) from the test vault: fixture notes, the fixture PDF, a test image, and a 64 MB illustrated rulebook PDF (local only, not committed).

Machine: Linux, 30 GB RAM, 1× display scaling, Obsidian 1.14.4 (Electron 43). Display refresh ~144 Hz, so a smooth frame is ~7 ms.

## M0 (2026-10-19)

### First run: problems found

| Measurement | Result |
|---|---|
| Open zoomed to fit (all 100 pages, 300 modules mounted) | 6.4 s, one 1 s long task |
| Renderer memory after open / after panning | 3.4 GB / 5.3 GB |
| Pan, whole board visible | p50 76 ms per frame |
| Pan at working zoom | p50 35 ms per frame |

Causes:
1. Camera position and grid offset were CSS custom properties on the board layer and its parent. Custom properties inherit, so every frame restyled every rendered note.
2. PDF.js keeps each page's decoded images until `page.cleanup()`; never calling it held tens of MB per rulebook page.
3. PDF modules rendered at a fixed 2× density regardless of zoom, and all at once.
4. Zoomed out, all 300 modules mounted and rendered although none was legible.

Fixes: direct `transform` / `background-position` per frame and `--pw-zoom` only after zoom settles (150 ms); `page.cleanup()` after every render; canvas resolution follows the zoom (re-rendered when it settles); at most 2 PDF renders at once; level of detail: below 25 % zoom pages show module outlines instead of content (SPEC 8.3).

### After fixes

| Measurement | Result | SPEC 8 target |
|---|---|---|
| Open zoomed to fit: all 100 pages painted | **~290 ms** (outlines) | < 1 s ✅ |
| Pan, whole board visible | p50 6.9 ms, p95 7.3 ms, max 9 ms | smooth ✅ |
| Pan along a row at working zoom (pages mount as they enter) | p50 6.9 ms, p95 ~24 ms, 3–6 frames > 50 ms per 240 | smooth ⚠️ hitches on mount |
| Renderer memory: start / after all runs / after close | ~830 / ~838 / ~840 MB | bounded ✅ |
| One page at working zoom, cold, two heavy rulebook crops | **1.2–1.5 s** | < 1 s ❌ |
| …its pre-mounted neighbours, after it | +~95 ms | |

The cold-page miss is decode-bound: the two crops come from full-page illustrations (1.16 s and 1.55 s to first pixels). PDF.js decodes one page at a time per document (one worker), so the second waits for the first. Crop size and resolution don't change decode time (spike S3 follow-up). Pages without heavy art meet the target.

### Follow-ups

- **M1 (render scheduler):** in-memory bitmap cache keyed by (file, page, crop, resolution) with an LRU budget (SPEC 8.4), so revisiting a page or toggling level of detail never re-decodes; spread module mounting across frames to remove the hitches while panning.
- **M3:** low-resolution bitmap instead of outlines below the detail threshold; consider a persistent thumbnail cache for big PDFs. Re-measure on a 2× display.
- See `docs/open-questions.md` Q13 for the target itself.
