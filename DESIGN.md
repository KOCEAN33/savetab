---
version: alpha
name: savetab
description: A tab list page that heavy-tab users scan to find, restore, and tidy hundreds of stored tabs.
colors:
  surface: "#ffffff"
  on-surface: "#444444"
  on-surface-weak: "#767676"
  border: "#eeeeee"
  primary: "#234da7"
  primary-tint: "#f1f4f9"
  danger: "#d93025"
typography:
  body-md:
    fontFamily: system-ui
    fontSize: 13px
    fontWeight: 400
    lineHeight: 20px
  title-md:
    fontFamily: system-ui
    fontSize: 17px
    fontWeight: 600
    lineHeight: 24px
  headline-lg:
    fontFamily: system-ui
    fontSize: 22px
    fontWeight: 600
    lineHeight: 28px
    letterSpacing: 0px
rounded:
  sm: 4px
  md: 4px
spacing:
  xs: 4px
  sm: 8px
  md: 12px
  lg: 20px
  xl: 32px
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.surface}"
    rounded: "{rounded.sm}"
  button-danger:
    backgroundColor: "{colors.danger}"
    textColor: "{colors.surface}"
    rounded: "{rounded.sm}"
  tab-row:
    textColor: "{colors.primary}"
    typography: "{typography.body-md}"
  meta-line:
    textColor: "{colors.on-surface-weak}"
    typography: "{typography.body-md}"
  group-divider:
    backgroundColor: "{colors.border}"
  drop-area:
    backgroundColor: "{colors.primary-tint}"
    textColor: "{colors.on-surface}"
---

## Overview

Heavy-tab users open the list after storing a window, or to find one tab among hundreds. They scan titles and restore by click. Density: dense. A row is one line of 20px text, so a laptop screen shows about 35 tabs. The page should feel like OneTab: a plain list, nothing between the user and the links.

## Colors

- Accent `primary`: #234da7. Why: OneTab uses this link blue, and users of OneTab read blue rows as "click to restore". Used only for tab title links and the one primary button in a dialog.
- Surface and text: white surface, #444 text, #767676 for meta lines (creation date, counts, URLs). Why: the titles carry the page, meta text steps back. #767676 keeps 4.5:1 contrast on white.
- Status colors: `danger` #d93025 for the confirm-delete action only. Locked and starred states use glyphs, not color.

## Typography

- Family: system-ui. Why: stored titles are often Korean, and the system font renders Hangul and Latin at matched sizes without a webfont download.
- Weights: 400 for text, 600 for group headers and the page total.
- Size steps: 13px body, 17px group header, 22px page total. Why: 13px keeps rows dense like OneTab. Each step is at least 1.25x the one below.

## Layout

- Spacing scale: 4, 8, 12, 20, 32. Tight inside a group (4 between rows), 20 between groups, 32 around the page.
- Grid and max width: one left-aligned column, max 960px. Why: tab titles are long, and a full-width line is hard to scan.
- First thing the eye lands on: the newest group's first tab titles.

## Elevation & Depth

Flat. Menus and dialogs use a 1px border on the surface, no shadow.

## Shapes

- Radius: 4px for buttons, menus, inputs, and dialogs. Rows and groups have no radius, since they are not boxes.

## Motion

- Easing: ease-out, 150ms.
- What moves: drag and drop reflow of rows. Nothing else animates.
- `prefers-reduced-motion`: drag reflow duration drops to 0.

## Components

Svelte components in `apps/extension/components/`. Shared styles in `apps/extension/styles/`: `tokens.css` holds the raw values, `base.css` the element and component rules.

## Do's and Don'ts

- Do show every group's count, creation time, and actions on one meta line, in weak text.
- Do show row actions (delete) on hover and on keyboard focus only.
- Don't add cards, shadows, or colored backgrounds around groups.
- Don't add icons where a word fits, except the delete cross, lock, star, and pin glyphs OneTab users already know.
