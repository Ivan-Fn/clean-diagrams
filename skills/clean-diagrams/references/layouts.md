# Layouts

Pick the layout whose shape matches the claim in the title. The four templates cover most
architecture and process figures; the others below are built from the same parts.

## Choosing

| The reader should see | Layout | Template |
|---|---|---|
| The order a request or job moves through components | flow | `flow.svg` |
| Many sources feeding one component, or one component serving many consumers | hub | `hub.svg` |
| Stages, tiers or zones, each holding several items | groups | `groups.svg` |
| What changed: an approved or old path next to a new one | before / after | `before-after.svg` |
| Where a trust or network boundary falls | flow or hub inside dashed containers | `flow.svg` + `group dashed` |
| Layers stacked on each other | groups, one container per row, full width | `groups.svg`, rotated to rows |
| Two options side by side | two small flows at the same scale, the difference in the accent | `flow.svg` twice |

How much each box says depends on the question. Someone asking how a system works needs a
name and one or two lines on what each box does. Someone asking for the order of steps
needs bare names and the shape. Both are good diagrams.

## Flow

One row of boxes left to right, a branch below when a step has a second outcome. Four
boxes of 140 with gaps of 50 fill the 760 canvas. Five boxes: 120 wide, gaps of 28, labels
above the row instead of in the gaps. More than five steps: a second row, with the arrow
returning down the right edge and running right to left, or two diagrams.

### A chain that leaves a container and comes back

A Mermaid `flowchart LR` whose chain runs out of a subgraph and back in (a browser outside,
a payment provider outside, services inside) does not fit one row. Put the outside boxes
in a row above the container, and the inside boxes in rows inside it, keeping the chain's
order left to right within each row. Arrows cross the container's border at right angles.
Bend them in the gap between the outside row and the container, never along the border.

## Hub

Inputs in a left column, the hub in the middle, outputs in a right column. Columns of 200
with gaps of 56. The hub spans the height of its arrows. Arrows bend at the middle of the
gap, inputs merge into the hub's left edge at separate points, and outputs fan out from one
point on its right edge.

## Groups

Containers side by side (three of 216 with gaps of 32) or stacked full width. Items inside
are `box tint` with an `item` label, 40 high, 8 apart. Arrows run between containers at
their middle height, or between specific items when the item-to-item link is the point.
Give containers in one row the same height.

## Before / after

The unchanged path on the top row. The approved part ends in a `good` box with a `good`
arrow. The new path leaves the row with a `bad dashed` arrow labelled with what changed
and leads to `bad` boxes. A legend under the title names both colours. A count of what is
now outside the approval goes in a `label bad strong` under the new path.

## Sequence of messages between parties

Lifelines are full-height `plain` vertical edges under a box per party. Messages are
horizontal arrows between lifelines, top to bottom in time order, each with a label above
it. Keep at most about eight messages; split longer exchanges.

## Too big for one picture

Above about 12 boxes, or when the arrows start crossing, draw the overview with each
area as one box, and give each area its own diagram. The overview title says how the areas
connect, and each detail title says what happens inside one.
