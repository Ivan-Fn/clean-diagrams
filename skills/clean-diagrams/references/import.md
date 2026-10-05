# Redrawing Mermaid, draw.io and Excalidraw diagrams

The goal of a redraw is the same content in the clean style. Keep every box, label and
arrow of the source. Improve the layout, the wording only where it is unclear, and the
emphasis only where the source or the user marks it.

## Mermaid

Read the source directly; no script is needed.

| Mermaid | Clean diagram |
|---|---|
| `graph LR` / `flowchart LR` | flow left to right |
| `graph TD` / `flowchart TB` | rows top to bottom; consider turning a long thin chain into a row |
| `A[Text]`, `A(Text)` | box with a name |
| `A[(Text)]` | box; add the note "database" if the name does not say it |
| `A{Text}` | decision: a box with a question as its name and labelled arrows for each outcome |
| `A([Text])` (stadium), `A[[Text]]` (subroutine), `A{{Text}}`, `A[/Text/]`, `A((Text))`, `A>Text]` | box; keep a kind that matters as a note ("external user", "queue") |
| `subgraph X [Title] … end` | container named Title, holding its nodes |
| `A --> B`, `A -- text --> B`, `A -->|text| B` | arrow, with the label beside it |
| `A -.-> B` | `dashed` arrow |
| `A ==> B` | arrow; make it `accent` only when it is the path the diagram is about |
| `A --- B` | `plain` line without a head |
| `classDef`, `style`, `linkStyle` | ignored, except as a hint about which node the author meant to stress |
| `sequenceDiagram` | the sequence layout in layouts.md |

A Mermaid node label with `<br>` becomes a name and a note.

## draw.io

```bash
node scripts/extract.mjs diagram.drawio          # also .drawio.svg, .drawio.png, .xml
node scripts/extract.mjs diagram.drawio --page 2 # multi-page files list their pages
```

The outline lists containers with the boxes they hold, boxes with label, position, shape
and colours, arrows with label, line style and colour, and free text. Labels made of
several lines show them separated by ` / `; the first part is usually the name.

- Use the source positions to keep the author's arrangement: which boxes share a row,
  which column is which. Rebuild the coordinates on the clean grid.
- Source colours are not carried over. Decide the accent and status colours from meaning.
- Shapes such as cylinders, clouds and actors become boxes; put the kind in the note when
  it matters ("database", "external user").
- A draw.io PNG without the embedded diagram has nothing to extract; ask for the
  `.drawio` file, or redraw from the picture by reading it.

## Excalidraw

```bash
node scripts/extract.mjs sketch.excalidraw
```

Rectangles, ellipses and diamonds become boxes with their bound text. A large shape that
encloses others, or an Excalidraw frame, becomes a container. Arrows keep their bindings,
labels and dash style. Free text is listed separately because Excalidraw often has labels
that are placed near a shape without being bound to it; decide from its position whether
it names a box, labels an arrow, or is the title.

## After the redraw

Tell the user what changed in structure: boxes merged or split, labels shortened, colours
dropped or added, and anything in the source that has no place in the new picture.
