---
name: clean-diagrams
description: Draws clean architecture and flow diagrams as standalone SVG files (flat boxes, thin grey borders, one accent colour, labelled arrows, automatic light and dark themes), checks them for layout defects with Node alone (no browser needed), and exports PNG, PDF and editable draw.io files. Also redraws an existing Mermaid, draw.io or Excalidraw diagram in this style. Use when asked for an architecture, system, flow, data-flow, pipeline, before-and-after or comparison diagram, a diagram for a README, docs page, slide deck or paper, or to make an existing diagram look better.
license: MIT
---

# Clean diagrams

Each diagram is one hand-written SVG file. That file is the source: it renders on GitHub,
in MkDocs and in browsers, follows the reader's light or dark theme by itself, and every
other format is generated from it.

Scripts live in `scripts/` next to this file and run on Node 18 or later with nothing to
install. Optional extras, used automatically when present:

- `resvg` (PNG) and `rsvg-convert` (PNG and PDF) on PATH: exports and preview images
  without a browser, drawn with the bundled Liberation Sans so they look the same on every
  machine (`nix profile install nixpkgs#resvg nixpkgs#librsvg`, or `brew install resvg librsvg`).
- A browser, for a second, render-based check pass: `npm install` in `scripts/` adds
  Playwright, which uses installed Chrome or Edge, or `npm run browser` for its own
  Chromium. To use a Chrome you started with `--remote-debugging-port=9222`, set
  `CLEAN_DIAGRAMS_BROWSER=http://127.0.0.1:9222`. `CLEAN_DIAGRAMS_BROWSER=none` turns the
  browser off.

## Workflow

1. **Settle the content before drawing.** Write the title as the finding the reader should
   leave with ("Reads go to the cache first, and only a miss reaches the database"), not the
   topic ("Caching architecture"). List the boxes, the containers that hold them, every
   arrow with its label, and the one thing to emphasise. Use only what the user or the
   source states: no invented numbers, components or steps. When the user says the diagram
   is for other people (a customer, a deck, a paper) and the content is not already agreed,
   show this outline to the user first. Otherwise go ahead.
   When neither the user nor the source states a finding, as in most redraws, write a title
   that says plainly what the picture shows ("Checkout path from shopper to shipping") and
   offer a finding title in your reply.
2. **Pick a layout** from [references/layouts.md](references/layouts.md) and copy the
   closest file from `templates/`. Keep its `<style>` and `<defs>` blocks as they are.
3. **Write the SVG** following [references/style.md](references/style.md): the markup the
   scripts read, the box-sizing arithmetic, the colour rules, and where icons go. Use whole
   numbers. If the diagram has icons, run `node scripts/icons.mjs diagram.svg` after
   writing or changing them.
   Exact alignment matters most: boxes in a row share their top edge and height, and gaps
   in a row are equal.
4. **Check it, then look at it.**
   ```bash
   node scripts/check.mjs diagram.svg --out /tmp/diagram-check
   ```
   Fix every `FAIL` line; each one names the element, and most say how to fix it. Then open
   `diagram.check-light.png` and `diagram.check-dark.png` from the output folder and ask
   whether the title's claim is visible at a glance. Repeat until both are true. The last
   line says what checked the file and made the previews; without a browser or a renderer
   there are no PNG previews, and the checks alone decide. The checker measures text with
   the widest of the macOS system font, Arial, Helvetica and Helvetica Neue at each size,
   so it may ask for a box a few units wider than one browser needs; widen it.
5. **Export for where it is going** ([references/publish.md](references/publish.md)):

   | Destination | Command | Output |
   |---|---|---|
   | GitHub, MkDocs, any Markdown | none | the SVG itself |
   | Markdown with a `<picture>` element | `node scripts/export.mjs diagram.svg --split` | `diagram.light.svg`, `diagram.dark.svg` |
   | Slides, chat, documents | `node scripts/export.mjs diagram.svg --png` | `diagram.png`, `diagram.dark.png` at 2x |
   | Papers, print | `node scripts/export.mjs diagram.svg --pdf` | `diagram.pdf`, vector; text selectable when made with a browser, outlined without one |
   | PowerPoint, Keynote, Inkscape, LaTeX `svg` package | `node scripts/export.mjs diagram.svg --flat` | `diagram.flat.svg`, `diagram.flat.dark.svg` |
   | Editable in draw.io | `node scripts/to-drawio.mjs diagram.svg` | `diagram.drawio` |
   | One file GitHub shows and draw.io edits | `node scripts/to-drawio.mjs diagram.svg --export` | `diagram.drawio.svg`, `diagram.drawio.png` (needs draw.io desktop) |

   `export.mjs` with no format flag writes all of its outputs; `--scale 3` makes larger
   PNGs. PNG and PDF need a browser or a renderer (see above) and are skipped with a note
   when there is neither. Keep the SVG next to its exports and regenerate them from it. Never hand-edit an
   export.

## Redrawing an existing diagram

- **Mermaid:** read the source directly. Each node becomes a box, each `subgraph` a
  container, each link an arrow with its label. Mapping details are in
  [references/import.md](references/import.md).
- **draw.io** (`.drawio`, `.drawio.svg`, `.drawio.png`) **and Excalidraw**
  (`.excalidraw`): run `node scripts/extract.mjs <file>`. It prints every box, container,
  arrow and label with the source's positions.

Then follow the workflow from step 1. Keep every box, label and arrow of the source. Keep
the author's arrangement unless it hides the point. Emphasise only what the source or the
user marks as important. Tell the user anything you merged, renamed or dropped.

## The rules that make it look right

- Boxes have no fill and a 1.25 grey border with corners of 8. One box, at most two, gets
  the accent: a 2-wide coloured border and a pale fill of the same colour.
- Green, red and amber mean good, bad and warning. Use them only for that, and add a
  legend when they appear.
- Text comes in four sizes: 15 semibold for names and the title, 14 semibold for container
  names, 13 for notes, 11.5 for arrow labels. Nothing below 11.
- SVG text does not wrap. Break lines yourself and size each box from its longest line
  (the arithmetic is in style.md).
- Arrows run in the gaps between boxes, start and end on a box edge, and bend at right
  angles around anything in the way. Labels sit beside the line, never on it.
- Icons are optional: a type icon on the left of each box and a place icon beside each
  container's name, from the bundled set, in grey or the box's own colour. No logos.
- No shadows, gradients, images or `<foreignObject>`. Colours come only from the CSS
  variables in the template, so the dark theme works.
- The canvas is 760 wide, the width of a documentation column. Grow down, not wide. Split
  a diagram that needs more than about 12 boxes.

## Files

| Path | What it is |
|---|---|
| `templates/flow.svg` | A row of steps with one branch down |
| `templates/hub.svg` | Several inputs into one component, several outputs from it |
| `templates/groups.svg` | Stages or zones as containers holding smaller items |
| `templates/before-after.svg` | An approved path in green and a new path in red, with a legend |
| `templates/sequence.svg` | Messages between parties in time order, on lifelines |
| `templates/boundaries.svg` | Where each part runs: on-premises and cloud containers, with icons |
| `scripts/icons.mjs` | Writes the icons a diagram uses into it; `--search` finds an icon |
| `scripts/check.mjs` | Layout, text-fit, arrow and contrast checks in light and dark, with Node alone; a browser adds a render pass |
| `scripts/export.mjs` | PNG, PDF, fixed-theme and flattened SVG exports |
| `scripts/to-drawio.mjs` | SVG to an editable `.drawio` file, optionally exported by draw.io |
| `scripts/extract.mjs` | Outline of a draw.io or Excalidraw file, for redrawing |
| `scripts/test.mjs` | Proves the templates pass and that each check catches its defect |
