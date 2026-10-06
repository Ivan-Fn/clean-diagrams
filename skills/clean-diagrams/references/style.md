# Style and markup

This file holds the rules for writing a clean-diagrams SVG: the markup the scripts read,
the classes the template defines, and the arithmetic for sizing boxes and placing text.

Contents: markup · classes · colour · box sizing · text placement · icons · arrows · spacing

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
- A lifeline (sequence diagrams) is a `<g class="lifeline">` with an `id` and one vertical
  `<path class="lifeline" d="Mx y1 Vy2">`, starting on the bottom edge of its party's box.
- An arrow is a `<path class="edge">` with `data-from` and `data-to` naming box, container
  or lifeline ids. Write `d` with absolute `M`, `H`, `V` and `L` commands only; the draw.io
  converter reads those.
- Arrow labels and other free text are plain `<text>` elements outside any box.
- `id`s are short slugs (`orders`, `e-orders-db`). draw.io keeps them as cell ids.
- No `transform` attributes. The checker measures untransformed geometry.

## Classes

"Ink" is the main text colour and "quiet" the softer grey for secondary text; both are in
the palette table under Colour.

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
| container | `group` on the `<rect>`, optional `dashed` or `tint` | grey border 1.25; `tint` is a grey fill with no border |
| lifeline | `lifeline` on the `<path>` | grey dashed line 1.25 |
| icon | `icon` on the `<use>`, optional `ink`, `accent`, `good`, `bad`, `warn` | grey outline drawing |
| text beside an icon | `start` added to `name`, `note` or `group-name` | left-aligned |
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

SVG text never wraps. Count characters and size the box from its longest line. Average
widths per character, from the checker's own width table (lower case and mixed case;
count a run of capitals at 1.3 times):

| Text | Units per character |
|---|---|
| `name`, `title` (15 semibold) | 8.5 |
| `group-name` (14 semibold) | 8 |
| `note`, `item` (13) | 7 |
| `label` (11.5) | 6.3 |

- **Width** = longest line × its units + 24, rounded up to a whole number. Boxes in one
  row share a width. The checker's number decides: when it asks for a wider box, use the
  width it names.
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

## Icons

Icons are optional. Use them when the kind of thing helps the reader: where it runs (on
premises, a cloud account) and what it is (a database, a function, a queue). Leave them out
when every box would get the same icon, or when the diagram is about order, not kinds.

- **Where it runs** goes on containers: a 16-unit icon in the container's top-left corner
  (x + 16, y + 14) and the container name beside it, left-aligned
  (`class="group-name start"`, x + 40, y + 28). Name the provider in words ("AWS account",
  "GCP project", "On-premises"); vendor logos are trademarks and break the one-accent look.
- **What it is** goes on boxes: an 18-unit icon 14 in from the box's left edge,
  vertically centred (y = box centre − 9), with the text left-aligned 42 in
  (`class="name start"`, `class="note start"`). Baselines are the same as for centred
  text (name y + 24, note y + 42). Box width = longest line × its units + 58 (42 on the
  left for the icon, 16 on the right).
- One icon per box. Give every box in a diagram an icon, or none; a few boxes with icons
  and the rest without looks unfinished.
- Colour: grey by default (`class="icon"`). On an accent or status box use the same class
  as the box (`class="icon accent"`, `good`, `bad`, `warn`).

Markup, then run `node scripts/icons.mjs diagram.svg`, which writes the drawing of every
icon used into `<defs>` and removes unused ones:

```xml
<g class="node" id="orders-db">
  <rect class="box" x="40" y="104" width="184" height="56" rx="8"/>
  <use class="icon" href="#icon-database" x="54" y="123" width="18" height="18"/>
  <text class="name start" x="82" y="128">Orders DB</text>
  <text class="note start" x="82" y="146">PostgreSQL</text>
</g>
```

Find an icon with `node scripts/icons.mjs --search <word>` (1,866 Lucide icons); it
checks the table below first, so architecture words such as "kubernetes", "gateway" or
"data centre" find the icon listed here. The usual ones:

| Thing | Icon |
|---|---|
| on premises, data centre, office | `building` |
| cloud account, project, subscription | `cloud` |
| Kubernetes cluster | `ship-wheel` |
| region, zone | `map-pin` |
| internet, external service | `globe` |
| network, VPC | `network` |
| server, virtual machine | `server` |
| container, pod | `container` |
| function, serverless | `square-function` |
| service, microservice | `box` |
| API | `braces` |
| web app | `app-window` |
| mobile app | `smartphone` |
| user, person | `user` |
| team, group | `users` |
| database | `database` |
| cache | `database-zap` |
| data warehouse | `warehouse` |
| object storage, files | `archive` |
| disk, volume | `hard-drive` |
| queue | `inbox` |
| event stream, pub/sub | `radio-tower` |
| gateway, firewall, policy | `shield` |
| load balancer | `split` |
| identity provider, keys | `key-round` |
| secrets, vault | `lock-keyhole` |
| scheduler, cron | `clock` |
| worker, batch job | `cog` |
| AI agent | `bot` |
| model | `brain` |
| pipeline, CI/CD | `workflow` |
| repository | `git-branch` |
| dashboard | `layout-dashboard` |
| metrics | `activity` |
| logs | `scroll-text` |
| alerts | `bell` |
| email | `mail` |
| chat | `message-square` |
| document | `file-text` |
| payments | `credit-card` |
| bank, core banking | `landmark` |
| plug-in, integration | `plug` |

## Arrows

- Start on the source box's edge and end on the target box's edge, at the middle of that
  side unless several arrows share it. The arrowhead's tip sits on the edge.
- Straight across a gap when the boxes line up. Otherwise bend at right angles, with the
  bend in the gap between columns or rows, never inside a box.
- Several arrows fanning out from one box share their first segment and split in the gap.
- Dashed (`dashed`) means conditional, planned or not yet in effect. Say which in the
  label or legend. In a sequence diagram, dashed is a reply.
- An arrow entering a container from above or below crosses the container's name if it
  enters at the name's x. Enter off-centre, or put the name 16 in from the left.
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
