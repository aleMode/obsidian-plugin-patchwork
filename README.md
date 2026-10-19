# Patchwork

An Obsidian desktop plugin for composing **boards** of fixed-size pages from live references to notes and PDF regions, and exporting them to PDF or PNG. See [`SPEC.md`](SPEC.md) for scope and design.

Status: pre-alpha (setup and risk spikes).

## Development

Requirements: Node.js 20+ and Obsidian desktop.

```sh
npm install
npm run dev        # watch build into test-vault/.obsidian/plugins/patchwork/
npm run build      # type-check + production build (main.js at repo root)
npm test           # Vitest
npm run lint
npm run fixtures   # regenerate the binary fixtures in test-vault/
```

### Dev loop

1. `npm run dev` (keeps rebuilding on save).
2. Open `./test-vault` as a vault in Obsidian ("Open folder as vault"). The first time, choose **Trust author and enable plugins**.
3. After a rebuild, reload the plugin: toggle Patchwork off and on in *Settings → Community plugins*, or run *Reload app without saving* from the command palette.

## Licence

MIT
