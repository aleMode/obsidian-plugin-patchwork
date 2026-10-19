# Patchwork test vault

Fixtures for developing and testing Patchwork. Committed content only; no personal notes.

- `Rules/Combat.md`: nested headings (H1–H4), block IDs, a callout, a table, frontmatter, and a code block containing a fake heading.
- `Spells/Fireball.md`: frontmatter, block ID.
- `Spells/Spell list.md`: note, section, block, image and PDF embeds, links, math, code and Mermaid.
- `Monsters/Goblin.md`: stat-block tables and a callout.
- `Embeds/`: an embed cycle (A ↔ B) and a 4-deep embed chain.
- `PDFs/Sample rulebook.pdf`: 4 pages (A4, A4, A4 with `/Rotate 90`, Letter), a nested outline, extractable text, and mm rulers on every page edge. Page 1 has a stat block at x 20–110 mm, y 150–230 mm.
- `Images/Map.png`: 400×300 test image.

Regenerate the binary fixtures with `npm run fixtures`.
