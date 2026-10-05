---
name: clean-diagrams
description: Draws clean architecture and flow diagrams as standalone SVG files (flat boxes, thin grey borders, one accent colour, labelled arrows, automatic light and dark themes), checks them for layout defects, and exports PNG, PDF and editable draw.io files. Also redraws an existing Mermaid, draw.io or Excalidraw diagram in this style. Use when asked for an architecture, system, flow, data-flow, pipeline, before-and-after or comparison diagram, a diagram for a README, docs page, slide deck or paper, or to make an existing diagram look better.
license: MIT
---

# Clean diagrams

Each diagram is one hand-written SVG file. That file is the source: it renders on GitHub,
in MkDocs and in browsers, follows the reader's light or dark theme by itself, and every
other format is generated from it.

Scripts live in `scripts/` next to this file. Install them once:

```bash
cd <this skill>/scripts && npm install      # Playwright and its Chromium, about 100 MB
```

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
   scripts read, the box-sizing arithmetic, and the colour rules. Use whole numbers, and
   multiples of 8 for sizes where the arithmetic allows. Exact alignment matters more:
   boxes in a row share their top edge and height, and gaps in a row are equal.
4. **Check it, then look at it.**
   ```bash
   node scripts/check.mjs diagram.svg --out /tmp/diagram-check
   ```
   Fix every `FAIL` line; each one names the element and the fix. Then open
   `diagram.check-light.png` and `diagram.check-dark.png` from the output folder and ask
   whether the title's claim is visible at a glance. Repeat until both are true.
5. **Export for where it is going** ([references/publish.md](references/publish.md)):

   | Destination | Command | Output |
   |---|---|---|
   | GitHub, MkDocs, any Markdown | none | the SVG itself |
   | Markdown with a `<picture>` element | `node scripts/export.mjs diagram.svg --split` | `diagram.light.svg`, `diagram.dark.svg` |
   | Slides, chat, documents | `node scripts/export.mjs diagram.svg --png` | `diagram.png`, `diagram.dark.png` at 2x |
   | Papers, print | `node scripts/export.mjs diagram.svg --pdf` | `diagram.pdf`, vector, fonts embedded |
   | Editable in draw.io | `node scripts/to-drawio.mjs diagram.svg` | `diagram.drawio` |
   | One file GitHub shows and draw.io edits | `node scripts/to-drawio.mjs diagram.svg --export` | `diagram.drawio.svg`, `diagram.drawio.png` (needs draw.io desktop) |

   `export.mjs` with no format flag writes all of its outputs; `--scale 3` makes larger
   PNGs. Keep the SVG next to its exports and regenerate them from it. Never hand-edit an
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
- Text comes in three sizes: 15 semibold for names and the title, 13 for notes, 11.5 for
  arrow labels. Nothing below 11.
- SVG text does not wrap. Break lines yourself and size each box from its longest line
  (the arithmetic is in style.md).
- Arrows run in the gaps between boxes, start and end on a box edge, and bend at right
  angles around anything in the way. Labels sit beside the line, never on it.
- No shadows, gradients, icons or `<foreignObject>`. Colours come only from the CSS
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
| `scripts/check.mjs` | Layout, text-fit, arrow and contrast checks in light, dark and a fallback font |
| `scripts/export.mjs` | PNG, PDF and fixed-theme SVG exports |
| `scripts/to-drawio.mjs` | SVG to an editable `.drawio` file, optionally exported by draw.io |
| `scripts/extract.mjs` | Outline of a draw.io or Excalidraw file, for redrawing |
| `scripts/test.mjs` | Proves the templates pass and that each check catches its defect |
