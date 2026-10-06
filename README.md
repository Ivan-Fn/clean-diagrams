# clean-diagrams

A Claude Code skill that draws clean architecture and flow diagrams as standalone SVG
files. The diagrams have flat boxes, thin grey borders, one accent colour and labelled
arrows. They switch between light and dark themes with the reader's setting, and render
on GitHub, in MkDocs and in any browser. From the same SVG the skill exports PNG for
slides, PDF for papers, and an editable draw.io file. It also redraws existing Mermaid,
draw.io and Excalidraw diagrams in this style.

![Reads go to the cache first, and only a miss reaches the database](skills/clean-diagrams/templates/flow.svg)

![Nobody changed the report job: a new grant opened a route to payment data](skills/clean-diagrams/templates/before-after.svg)

## Install

As a Claude Code plugin:

```bash
claude plugin marketplace add Ivan-Fn/clean-diagrams
claude plugin install clean-diagrams@clean-diagrams
```

Or copy `skills/clean-diagrams` into `~/.claude/skills/` (all projects) or a project's
`.claude/skills/`.

The checks, the draw.io converter and the SVG exports run on Node 18 or later with
nothing to install, and need no browser. Optional extras, used when present:

| Extra | Adds | Install |
|---|---|---|
| `resvg`, `rsvg-convert` | PNG and PDF exports and preview images without a browser, drawn with the bundled Liberation Sans so they look the same on every machine | `nix profile install nixpkgs#resvg nixpkgs#librsvg` or `brew install resvg librsvg` |
| Playwright with Chrome, Edge or its own Chromium | a second, render-based check pass and browser-rendered PNG and PDF | `npm install` in the skill's `scripts` folder; `npm run browser` for Chromium |
| A running Chrome with a debug port | the same, without installing a browser | `CLEAN_DIAGRAMS_BROWSER=http://127.0.0.1:9222` |
| draw.io desktop | `.drawio.svg` and `.drawio.png` exports | `brew install --cask drawio` |

## Use

Ask in plain words:

- "Draw the request path from the browser to the database, showing where the cache sits."
- "Turn this Mermaid flowchart into a clean diagram for the README."
- "Redraw `docs/arch.drawio` in the clean style and give me a PNG for the deck."
- "Make a before and after diagram of the permission change, for the incident report."

Claude writes the SVG, runs the checker until it reports no failures, looks at the light
and dark renders, and exports the formats you need.

## What the checker catches

`scripts/check.mjs` reads the SVG with its stylesheet applied for the light and the dark
theme, measures text with a table of character widths taken from the widest common
fonts, and fails on:

- text that does not fit its box, overlaps other text, or crosses a border
- arrow labels crowding a box
- arrows that start or end away from the box they name, run through another box, or run
  over text
- contrast below WCAG AA in either theme, and text under 11 pixels
- boxes outside the canvas, too close to each other, or straddling a container's border

When a browser is available it also renders the file in light, dark and Arial and runs
the same checks on the render. `npm test` in the `scripts` folder proves each check fires
on a deliberately broken diagram, with and without a browser, and that the exports and
the draw.io round trip work.

## Files

| Path | What it is |
|---|---|
| `skills/clean-diagrams/SKILL.md` | The instructions Claude follows |
| `skills/clean-diagrams/references/` | Style and markup rules, layouts, importing, publishing |
| `skills/clean-diagrams/templates/` | Four example diagrams to start from |
| `skills/clean-diagrams/scripts/` | Checker, exporter, draw.io converter, importer, tests |

## Licence

MIT. See [LICENSE](LICENSE). The bundled Liberation Sans font files in
`skills/clean-diagrams/scripts/fonts/` are under the SIL Open Font License 1.1; see
`LICENSE-LiberationSans.txt` in that folder.
