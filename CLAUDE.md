# Patchwork — instructions for Claude Code

Patchwork is an Obsidian **desktop-only** plugin that composes boards of fixed-size pages from live references to notes and PDF regions, and exports them to PDF/PNG. Read `SPEC.md` first. It is the source of truth for scope, data model, architecture, and milestones. Decisions D1–D10 in the spec are final.

## Stack and commands

- TypeScript (strict), esbuild, Obsidian API, Vitest. Start from `obsidianmd/obsidian-sample-plugin`.
- Keep this list current as the repo takes shape:
  - `npm run dev` — watch build into the test vault's `.obsidian/plugins/patchwork/`
  - `npm run build` — production build
  - `npm test` — Vitest
  - `npm run lint`
  - `npm run e2e` — end-to-end suites in `scripts/e2e/` against the dev Obsidian (needs `scripts/launchObsidian.sh` and a dev build); `npm run e2e board` runs one suite
  - `npm run fixtures` — regenerate the test vault's sample PDF and image (`scripts/makeFixtures.mjs`); add `-- --rulers` to draw mm rulers on the PDF pages (off by default)
  - `npm run spikes:build` — build the throwaway spike plugin (`spikes/`) into the test vault
  - `scripts/launchObsidian.sh` — start Obsidian on `./test-vault` with an isolated profile and remote debugging on port 9222
  - `scripts/launchObsidian.ps1` — same as the above on Windows (installed Obsidian, isolated profile, port 9222)
  - `node scripts/cdp.mjs -f scripts/perf/stressBoard.js` — performance probe (100 pages × 3 modules); record results in `docs/perf.md`
  - `node scripts/cdp.mjs '<js>'` — evaluate JS in that Obsidian (`--shot file.png` for a screenshot). Use this to verify features in the real app.
- Node comes from Homebrew (`/home/linuxbrew/.linuxbrew/bin`). Obsidian is the Flatpak `md.obsidian.Obsidian`.
- Test vault: `./test-vault` (committed fixtures only; no personal notes).

## Hard rules

1. **Spikes first.** Before building M0 features, run spikes S1–S7 from `SPEC.md` section 10 in `/spikes`, and write results to `docs/spike-results.md`. Stop and summarize if a spike's fallback changes the plan.
2. **Never overwrite a `.patchwork` file you failed to parse.** Show the error view with the raw text instead.
3. **Preserve unknown keys** when loading and saving. Never drop data you do not understand.
4. **Storage is millimetres.** Convert to pixels only at render time. Convert display units only in the UI layer.
5. **`src/model/` is pure:** no `obsidian` imports, no DOM. Everything there needs unit tests.
6. **Do not use undocumented Obsidian internals** (Canvas internals, private view APIs) unless a spike shows there is no alternative, and then isolate them behind one adapter file with a comment explaining why.
7. **No reflow or pagination engine.** Pages are fixed-size. Do not add Paged.js or Vivliostyle.
8. **No MCM code.** MCM is GPL-3.0. Do not copy from it.
9. **Performance is part of every feature.** Anything that mounts per-module DOM or renders a canvas must support virtualization (unmount when off-screen) and cancellation. Release canvases and PDF documents when unused.
10. **Exports use the light paper theme** unless `board.useAppTheme` is set.
11. Comments explain *why*, not *what*. Keep functions small. No new runtime dependency without a one-line justification in the PR/commit message.

## Conventions

- Files: `camelCase.ts` for modules, `PascalCase.ts` for classes that are the file's main export.
- IDs: short random strings, unique per file.
- All vault paths are vault-relative.
- Commands are prefixed `Patchwork:` in the command palette.
- CSS classes are prefixed `pw-`. Use Obsidian CSS variables for UI chrome; paper content uses the light-scope overrides.
- Commit per logical step. Update `SPEC.md` (not just code) when a decision changes, and note it in a "Changelog" section at the bottom.

## Working style

- Plan briefly, then implement in small verified steps. After each milestone item, run build, lint, and tests.
- When something in the spec is ambiguous or a spike disproves an assumption, write the question and your recommended answer in `docs/open-questions.md` and continue with the recommendation unless it is a one-way door.
- Manual QA steps for each milestone go in `docs/qa.md`.

## Opening prompt for the first session

> Read `SPEC.md` and `CLAUDE.md`. Scaffold the repo from the Obsidian sample plugin (esbuild, TypeScript strict, Vitest, lint), create `./test-vault` with a few fixture notes (nested headings, block IDs, an embed, a callout) and a small sample PDF, and set up the dev loop. Then run risk spikes S1–S7 in `/spikes`, and write `docs/spike-results.md` with findings, the chosen approach for each, and any change to the plan. Do not start M0 feature work until I have reviewed the spike results.
