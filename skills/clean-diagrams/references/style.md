# Style and markup

This file holds the rules for writing a clean-diagrams SVG: the markup the scripts read,
the classes the template defines, and the arithmetic for sizing boxes and placing text.

Contents: markup · classes · colour · box sizing · text placement · arrows · spacing

## Markup the scripts read

Start from a template. Every diagram keeps the template's `<style>` and `<defs>` blocks and
its background rectangle. Then:

```xml
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 760 H" width="760" height="H"
     role="img" aria-label="(the title's words)">
  <style>…from the template…</style>
  <defs>…the four arrowhead markers…</defs>
  <rect class="bg" width="760" height="H"/>

  <text class="title" x="24" y="34">The finding, in one line</text>

  <g class="group" id="private-net">                     <!-- a container -->
    <rect class="group dashed" x="…" y="…" width="…" height="…" rx="8"/>
    <text class="group-name" x="…" y="…">Private network</text>
  </g>

  <g class="node" id="orders">                           <!-- a box -->
    <rect class="box" x="…" y="…" width="…" height="…" rx="8"/>
    <text class="name" x="(centre)" y="…">Orders service</text>
    <text class="note" x="(centre)" y="…">3 replicas</text>
  </g>

  <path class="edge" id="e-orders-db" data-from="orders" data-to="db"
        d="M… H… V…" marker-end="url(#arrow)"/>
  <text class="label" x="…" y="…">writes</text>
</svg>
```

- A box is a `<g class="node">` with an `id`, exactly one `<rect>` as a direct child, and
  its text lines. A container is the same with `class="group"`. Boxes inside a container
  are written after it, as siblings.
- An arrow is a `<path class="edge">` with `data-from` and `data-to` naming box or
  container ids. Write `d` with absolute `M`, `H`, `V` and `L` commands only; the draw.io
  converter reads those.
- Arrow labels and other free text are plain `<text>` elements outside any box.
- `id`s are short slugs (`orders`, `e-orders-db`). draw.io keeps them as cell ids.
- No `transform` attributes. The checker measures untransformed geometry.

## Classes

| Element | Class | Look |
|---|---|---|
| title | `title` | 15 semibold, ink |
| box | `box` | no fill, grey border 1.25 |
| | `box tint` | neutral grey fill, for items inside a container |
| | `box accent` | blue border 2, pale blue fill: the one thing the picture is about |
| | `box good` / `box bad` / `box warn` | green / red / amber border 2 with pale fill: a stated meaning |
| box name | `name` | 15 semibold, centred |
| box note | `note` | 13, quiet, centred |
| single-line item | `item` | 13, ink, centred |
| container | `group` on the `<rect>`, optional `dashed` or `tint` | grey border 1.25 |
| container name | `group-name`, optional `accent` | 14 semibold, quiet or blue |
| arrow | `edge`, optional `accent` / `good` / `bad`, optional `dashed` | grey 1.25, or coloured 2 |
| arrowhead | `marker-end="url(#arrow)"`, `#arrow-accent`, `#arrow-good`, `#arrow-bad` | match the arrow's colour |
| arrow label | `label`, optional `strong`, `accent`, `good`, `bad` | 11.5, quiet |

An arrow drawn without a head gets the class `plain` so the checker knows it is meant.

## Colour

Colour carries meaning, so readers will ask what each colour stands for.

- **Accent (blue):** the focus of the picture. One box, at most two, plus the arrow that
  leads to it if that arrow is the point.
- **Good, bad, warning:** only when the diagram states that meaning, and always with a
  legend or a label that says it.
- **Everything else** stays grey on white. A diagram with no accent at all is fine.
- Never write a colour value in an element. Use the classes; the variables behind them
  switch for dark mode.

The template's palette, for reference:

| Variable | Light | Dark | Used for |
|---|---|---|---|
| `--bg` | `#ffffff` | `#1f1e1d` | background |
| `--ink` | `#0e0e0e` | `#f2f1ec` | names, title, items |
| `--quiet` | `#484745` | `#b8b6ad` | notes, labels, container names |
| `--line` | `#bbbaaf` | `#6b6962` | borders, arrows |
| `--tint` | `#f3f2ee` | `#2a2927` | neutral item fill |
| `--accent` / `--accent-soft` | `#266dcc` / `#e5edf9` | `#6ea6ee` / `#1d2a3c` | focus |
| `--good` / `--good-soft` | `#169824` / `#e3f3e5` | `#5cc06a` / `#1c3020` | approved, healthy |
| `--bad` / `--bad-soft` | `#c93537` / `#f8e7e7` | `#f07373` / `#3a2020` | broken, unapproved |
| `--warn` / `--warn-soft` | `#a15c00` / `#fbefd9` | `#e5a54b` / `#382a14` | at risk |

## Box sizing

SVG text never wraps. Count characters and size the box from its longest line. Widths
per character, measured and rounded up so a fallback font still fits:

| Text | Units per character |
|---|---|
| `name`, `title` (15 semibold) | 7.5 |
| `group-name` (14 semibold) | 7 |
| `note`, `item` (13) | 6.4 |
| `label` (11.5) | 5.8 |

- **Width** = longest line × its units + 24. Round up to a multiple of 8. Boxes in one row
  share a width.
- **Height** = 40 + 16 per note line. A name with no notes: 48. An `item`: 40.
- A line that does not fit gets broken in two at a natural phrase boundary, or the box gets
  wider. Never let a word touch the border.

## Text placement

Text is centred with `text-anchor: middle` at the box's centre x. Baselines, measured from
the box's top edge `y`:

| Box contents | Name baseline | Note baselines |
|---|---|---|
| name only, height 48 | `y + 29` | none |
| name + 1 note, height 56 | `y + 24` | `y + 42` |
| name + n notes, height 40 + 16n | `y + 24` | `y + 42`, then +16 each |
| single `item`, height 40 | `y + 24.5` | none |

A taller box than its text needs: move the whole block down by half the extra height.

Container names sit 28 below the container's top edge, centred or 16 in from the left.
The first box inside starts 44 below the container's top edge, 16 in from its sides, and
the last ends at least 16 above its bottom edge.

## Arrows

- Start on the source box's edge and end on the target box's edge, at the middle of that
  side unless several arrows share it. The arrowhead's tip sits on the edge.
- Straight across a gap when the boxes line up. Otherwise bend at right angles, with the
  bend in the gap between columns or rows, never inside a box.
- Several arrows fanning out from one box share their first segment and split in the gap.
- Dashed (`dashed`) means conditional, planned or not yet in effect. Say which in the
  label or legend.
- A label goes above a horizontal run or beside a vertical one, at least 4 clear of every
  box. When the gap is narrower than the label plus 8, widen the gap or put the label above
  the row.

## Spacing

- Margins: 24 on the left and right of the canvas, title baseline at 34, first row about
  32 below the title (or below the legend).
- At least 16 between boxes; 40 to 56 when an arrow with a label crosses the gap.
- Height = the lowest element's bottom edge + 24. No empty band at the bottom.
- Line up shared edges and centres exactly. A diagram that reads as deliberate is mostly
  shared baselines and equal gaps.
