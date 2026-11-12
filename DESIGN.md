---
version: alpha
name: savetab
description: A tab list page that heavy-tab users scan to find, restore, and tidy hundreds of stored tabs.
colors:
  surface: "#ffffff"
  surface-hover: "#f6f7f8"
  on-surface: "#1b1d21"
  on-surface-weak: "#6b7078"
  border: "#e4e6e9"
  primary: "#1f6feb"
  on-primary: "#ffffff"
  primary-tint: "#e8f0fe"
  danger: "#c62828"
  dark-surface: "#17181b"
  dark-surface-hover: "#1f2125"
  dark-on-surface: "#e8e9eb"
  dark-on-surface-weak: "#9a9fa8"
  dark-border: "#2e3136"
  dark-primary: "#6ea8fe"
  dark-on-primary: "#111111"
  dark-primary-tint: "#1c2a44"
  dark-danger: "#ef8a80"
typography:
  body-md:
    fontFamily: system-ui
    fontSize: 14px
    fontWeight: 400
    lineHeight: 20px
  title-md:
    fontFamily: system-ui
    fontSize: 14px
    fontWeight: 600
    lineHeight: 20px
  headline-lg:
    fontFamily: system-ui
    fontSize: 18px
    fontWeight: 600
    lineHeight: 24px
    letterSpacing: 0px
rounded:
  sm: 6px
  md: 10px
spacing:
  xs: 4px
  sm: 8px
  md: 12px
  lg: 20px
  xl: 32px
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    rounded: "{rounded.sm}"
  button-danger:
    backgroundColor: "{colors.danger}"
    textColor: "{colors.surface}"
    rounded: "{rounded.sm}"
  search-field:
    backgroundColor: "{colors.surface-hover}"
    textColor: "{colors.on-surface}"
    rounded: "{rounded.sm}"
  tab-row:
    textColor: "{colors.on-surface}"
    typography: "{typography.body-md}"
    rounded: "{rounded.sm}"
  tab-row-hover:
    backgroundColor: "{colors.surface-hover}"
  group-header:
    textColor: "{colors.on-surface}"
    typography: "{typography.title-md}"
  meta-line:
    textColor: "{colors.on-surface-weak}"
    typography: "{typography.body-md}"
  folder-chip-current:
    backgroundColor: "{colors.on-surface}"
    textColor: "{colors.surface}"
    rounded: "{rounded.sm}"
  menu:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.md}"
  divider:
    backgroundColor: "{colors.border}"
  drop-area:
    backgroundColor: "{colors.primary-tint}"
    textColor: "{colors.on-surface}"
---

## Overview

Heavy-tab users open the list after storing a window, or to find one tab among hundreds. They search or scan titles and restore by click. Density: compact. A row is 32px tall, so a laptop screen shows about 22 tabs. The page is one quiet column: a search field on top, then groups of rows, with actions out of sight until the pointer or the keyboard reaches a row.

## Colors

- Accent `primary`: #1f6feb. Why: the accent marks the one action that opens tabs, "Restore all", and users read blue as a link that opens. Used only for that action, the keyboard focus ring, and the one primary button in a dialog.
- Surface and text: white surface, #1b1d21 text, #6b7078 for meta text (counts, age, domains). `surface-hover` #f6f7f8 fills the search field and the row under the pointer. Why: tab titles are the content, so they take the full text color and everything else steps back. #6b7078 keeps 4.5:1 contrast on both surfaces.
- Status colors: `danger` #c62828 for the confirm-delete action only. Locked and starred states use text and a glyph, not color.
- Dark theme: the `dark-*` colors replace their light counterparts one for one. Why: a list page left open all day should not glare at night. Each text color keeps 4.5:1 on `dark-surface`. They apply under `prefers-color-scheme: dark` when `<html>` has no `data-theme`, and always under `data-theme="dark"`. The list page top bar cycles Automatic, Light, Dark.

## Typography

- Family: system-ui. Why: stored titles are often Korean, and the system font renders Hangul and Latin at matched sizes without a webfont download.
- Weights: 400 for text, 600 for group headers and page headings.
- Size steps: 14px for all list text, 18px for page headings on the options and import pages. Why: a group header and its rows share one size, so weight and the space above the header carry the hierarchy and the column stays even. 18px is 1.29x the body.

## Layout

- Spacing scale: 4, 8, 12, 20, 32. Tight inside a group (rows touch), 32 between groups, 12 between the favicon and the title.
- Grid and max width: one centered column, max 960px on the list page and 760px on the form pages. Why: tab titles are long, and at 960px most titles and their domains fit one line on a laptop screen without the two drifting apart. Forms read better narrow.
- The top bar sticks to the top of the viewport and holds the search field, so search stays one keystroke away at any scroll position. The head of the group being scrolled sticks under it, so its name and actions stay in reach inside a long group.
- Folders are chips under the top bar: the path to the open folder, then its child folders. The list body holds groups only.
- First thing the eye lands on: the search field, then the newest group's first tab titles.

## Elevation & Depth

Flat. One shadow, `0 8px 24px rgb(0 0 0 / 12%)`, marks the things that float over the list: menus, dialogs, and the selection toolbar. Each also carries a 1px border, so it holds its edge in the dark theme.

## Shapes

- Radius: 6px for buttons, inputs, chips, and the hover fill of a row. 10px for menus and dialogs. Why: two steps by element size, small controls and floating panels.

## Motion

- Easing: ease-out, 150ms.
- What moves: drag and drop reflow of rows. Nothing else animates.
- `prefers-reduced-motion`: drag reflow duration drops to 0.

## Components

Svelte components in `apps/extension/components/`. Shared styles in `apps/extension/styles/`: `tokens.css` holds the raw values, `base.css` the element and component rules. `Icon.svelte` holds every icon as an inline SVG path.

## Do's and Don'ts

- Do show a group's count, age, and state as one weak meta line next to its title.
- Do show row actions (delete, more) on hover and on keyboard focus only. A group head's "Delete all" follows the same rule, in the meta color.
- Do give a group head's free width to dragging the group. A head holds no space without a function.
- Do draw checkboxes and radios in CSS: a 16px box in `on-surface-weak`, filled `primary` with an `on-primary` check when ticked, and a radio as a 16px circle whose ring thickens in `primary` when chosen. A tick's click target is the whole margin cell beside its row.
- Do select rows by a rectangle dragged from empty page space. A drag that starts on a row moves the row.
- Do give every icon button an accessible name and a tooltip with the same text.
- Don't add cards, borders, or colored backgrounds around groups. Space separates them.
- Don't use an icon for an action that changes the list in bulk. "Restore all" stays a word.
