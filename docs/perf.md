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

## M2 export of the stress board (2026-10-20)

`scripts/perf/exportStress.js`: the 100-page × 3-module stress board (fixture notes, the fixture PDF, the 64 MB illustrated rulebook, an image), exported at native size.

| Quality | Time | Pages | File | Peak JS heap | Renderer RSS after |
|---|---|---|---|---|---|
| Smallest file (PDF regions as 150 dpi images) | 19.1 s | 100 | 12 MB | 119 MB | 1.47 GB |
| Best quality (PDF regions as vector) | 11.7 s | 100 | 84 MB | 411 MB | 1.58 GB |

No crash (M2 acceptance). Vector export is faster (no rasterizing) but larger: each crop carries its source page's full-resolution art (spike S8). RSS includes Chromium's print buffers and drops back over time.

## Re-measured after M2 (2026-10-20)

The dev window now runs at **60 Hz** (16.7 ms frames; the M0 numbers were at 144 Hz), so "smooth" means p50 ≈ 16.7 ms.

| Measurement | Result | SPEC 8 target |
|---|---|---|
| Open zoomed to fit: 100 pages painted | ~380 ms | < 1 s ✅ |
| One page at working zoom, cold (two rulebook crops) | 0.55–0.68 s | < 1 s ✅ (Q13 no longer misses on this board) |
| Same page revisited after panning away | **~42 ms** (bitmap cache) | ✅ |
| Pan, whole board visible | p50 16.6 ms, p95 18 ms | smooth ✅ |
| Pan along a row at working zoom | p50 16.6 ms, p95 24 ms, 3 frames > 50 ms per 240 | smooth ⚠️ small hitches on mount |
| Renderer memory start / end / after close | ~640 / 650 / 650 MB | bounded ✅ |

**Regression found and fixed:** whole-board panning had dropped to ~30 fps since M1. Cause: page labels lived inside the zoomed layer with a counter-scaled font (≈170 px glyphs at 7 % zoom), which Chromium re-rasterized every frame. Labels now sit in a screen-space overlay without `will-change` (giving each of 100 labels its own compositor layer also cost ~8 ms per frame). Ruler colours are cached instead of read with `getComputedStyle` every frame.

## Linked frames (M5, 2026-10-20)

Each chain is measured by rendering its blocks offscreen at every frame's width. A chain of 80 paragraphs across 5 frames, resized 30 times in a row (once per animation frame, like a drag): **1** measurement in total, **~16 ms** per move (60 fps). Layouts wait for 120 ms of quiet and are cached per chain, content and font, so panning, revisits and other edits don't re-measure.
