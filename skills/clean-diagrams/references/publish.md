# Publishing a diagram

The SVG is the source; every format below is generated from it. Commit the SVG next to the
document that uses it, and regenerate exports after each change.

## GitHub and other Markdown

GitHub shows an SVG only as an image, from a file in the repository:

```markdown
![Reads go to the cache first, and only a miss reaches the database](diagrams/cache-flow.svg)
```

GitHub removes inline `<svg>` from Markdown, and an SVG shown as an image cannot load
fonts, scripts or other files. The templates need none of these. The image follows the
reader's theme through the `prefers-color-scheme` rule inside the file.

When a host themes its page with a class instead of a colour scheme the image can see, the
image stays light. For those hosts, and for the most predictable result on GitHub, export
fixed-theme files and use a `<picture>` element:

```bash
node scripts/export.mjs diagrams/cache-flow.svg --split
```

```html
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="diagrams/cache-flow.dark.svg">
  <img alt="Reads go to the cache first, and only a miss reaches the database" src="diagrams/cache-flow.light.svg">
</picture>
```

Use the title as the alt text. It already states what the picture shows.

## MkDocs and other static sites

Reference the SVG as an image, as above. MkDocs Material also accepts the `<picture>`
element. Avoid pasting the SVG inline into the page: the page's own styles then reach into
the drawing.

## Slides and documents

```bash
node scripts/export.mjs diagram.svg --png --scale 3
```

writes `diagram.png` (light) and `diagram.dark.png`. Use scale 3 for slides projected on
large screens. Keep the dark PNG for dark slide templates.

## Papers and print

```bash
node scripts/export.mjs diagram.svg --pdf
```

writes a single-page PDF exactly the size of the diagram, light theme, with text kept as
vector text and the fonts embedded. In LaTeX: `\includegraphics[width=\linewidth]{diagram.pdf}`.

The PDF page is 760 by H pixels at 96 per inch, so 7.9 inches wide. Scaled into a
two-column paper's 3.3-inch column, an 11.5 label prints at under 4 points, too small to
read. Set the figure across both columns with `figure*` (labels print at about 8 points),
or draw a narrower diagram with fewer boxes for a single column.

## draw.io

```bash
node scripts/to-drawio.mjs diagram.svg                 # diagram.drawio
node scripts/to-drawio.mjs diagram.svg --export        # + diagram.drawio.svg, diagram.drawio.png
```

The `.drawio` file opens in draw.io, diagrams.net, the draw.io desktop app, the VS Code
draw.io extension and draw.io for Confluence. Boxes stay connected to their arrows, arrow
labels move with their arrows, and every colour is a light and dark pair, so draw.io's
dark mode shows the dark palette. The font becomes draw.io's Helvetica.

`--export` runs the draw.io desktop app (free; `brew install --cask drawio` on a Mac). It
writes `diagram.drawio.svg`, an image that GitHub shows and that draw.io and the VS Code
extension open for editing, and the same as a PNG. The first run on a Mac can hang on the
"downloaded from the Internet" prompt; clear it once with
`xattr -d com.apple.quarantine /Applications/draw.io.app`. On Linux the app needs a
virtual display; the `rlespinasse/drawio-desktop-headless` container provides one.

draw.io writes the labels of the exported SVG as HTML inside the SVG. Browsers show it,
but some tools that convert SVG outside a browser (rsvg-convert, Inkscape, LaTeX packages)
do not. If the `.drawio.svg` must work there, convert with `--plain-labels`, which writes
plain SVG text at the cost of one font size per box. For papers, prefer the PDF export.

Once people edit the `.drawio` file, it becomes the source and the SVG is out of date.
Say which one is the source in the document or the commit.
