# Risk spikes S1–S7

Throwaway code that answers the questions in `SPEC.md` section 10. Findings live in `docs/spike-results.md`; this code is kept only so the results can be reproduced. Do not import from here into `src/`.

It is a separate plugin (`patchwork-spikes`) built into the test vault. Each spike is a function that returns a JSON-serializable report and may write artifacts (PDFs, PNGs) to `.dev/spike-output/`.

## Running

```sh
npm run spikes:build                       # builds into test-vault/.obsidian/plugins/patchwork-spikes/
scripts/launchObsidian.sh                 # Obsidian on ./test-vault, isolated profile, remote debugging
node scripts/cdp.mjs 'app.plugins.plugins["patchwork-spikes"].run("s3")'
```

After a rebuild, reload the plugin:

```sh
node scripts/cdp.mjs 'app.plugins.disablePlugin("patchwork-spikes").then(() => app.plugins.enablePlugin("patchwork-spikes"))'
```
