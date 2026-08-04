---
name: VSMS
description: "Midnight clinic run sheet — calm operational UI for community vision-screening events."
colors:
  events-canvas-light: "#f7f7f4"
  events-surface-light: "#ffffff"
  events-ink-light: "#17191c"
  events-muted-light: "#4f545b"
  events-line-light: "rgba(23,25,28,.24)"
  events-action-light: "#172233"
  events-canvas-dark: "#0b0b0d"
  events-surface-dark: "#101011"
  events-ink-dark: "#f1f2f3"
  events-muted-dark: "#b3b7bf"
  events-line-dark: "rgba(241,242,243,.24)"
  events-action-dark: "#f7f7f5"
  published-light: "#315a8c"
  published-dark: "#8eacd1"
  live-light: "#b84d25"
  live-dark: "#f08a55"
  completed-light: "#1f8a65"
  completed-dark: "#72ac87"
  cancelled-light: "#b42335"
  cancelled-dark: "#c96873"
  focus: "#315a8c"
typography:
  event-display: '"Geist", -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", sans-serif / 34px / 650 / 1 / -0.035em'
  event-title: '"Geist", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif / 20px / 650 / 24px / -0.025em'
  body: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", sans-serif / 12–15px / 500–700'
  public-display: "clamp(38px, 6vw, 66px) / 760 / 0.94 / -0.055em"
rounded:
  dense-input: "6px"
  control: "7px"
  utility: "8px"
  event-card: "12px"
  event-media: "11–12px"
  mobile-action: "10px"
  status: "999px"
  workspace-section: "12px"
  workspace-hero: "12px"
spacing:
  control-height: "44px"
  event-card-padding: "12px"
  event-row-gap: "44px"
  workspace-card-padding: "22px"
  panel-gap: "18px"
---

# Design System: VSMS

## Overview

**Direction:** Midnight clinic run sheet.

VSMS is a staff-facing, offline-capable system for registration, screening, review/referral, staffing, and event operations. It should feel calm, exact, and ready for a physical venue rather than like a consumer-health product or online-meeting tool.

The accepted Events page is the structural source for the whole authenticated product: warm near-white canvas, flat white records, fine rules, restrained imagery, and a slender chronological rail. Dark mode preserves that geometry and swaps only the palette. Event workspaces and operational pages use the same flat surfaces and compact edge navigation.

- Keep operational hierarchy direct: status, schedule, venue, attendance, staffing, then action.
- Use photography as a compact event/banner record, never decoration.
- Keep desktop navigation at the page edge; only mobile uses the fixed minimal dock.

## Colors

Events light mode is normative for structure. Use the `events-*-light` tokens for its warm canvas, white cards, dark text, thin borders, and navy `Open` action. Dark mode uses the paired `events-*-dark` tokens without changing spacing, size, radius, or hierarchy: canvas and cards become near-black, text becomes light, borders gray, and `Open` becomes white.

**The Palette-Only Theme Rule.** A theme change recolors the accepted composition; it does not invert card prominence or invent a new layout. Events never uses dark cards on the light canvas or cream cards on the dark canvas.

Event-list labels are final: Draft, Published, Live, and Past, with Cancelled only as an exceptional state. Past covers both audited completion and a schedule that has elapsed, avoiding separate Completed and Ended labels. Published is blue, Live is orange, Past and Draft are neutral, and Cancelled is red. Blue focus treatment remains distinct from product state.

Workspace sections and the public-event hero use the same light and dark surface pairing as Events. Do not invert cards independently from the active theme.

## Typography

Use the system stack, with Geist where available for event headings. Desktop Events uses a compact 34px heading and 20px record titles; mobile reduces these to 24px and 18px. Supporting schedule, venue, attendance, status, navigation, and controls remain dense at 11–13px with clear weight contrast and tabular times.

Workspace section headings remain 20px/750, metrics 26px/780, and the public event title keeps the larger `public-display` scale with a short measure. Do not add novelty type, oversized all-caps labels, or marketing copy.

## Layout

Events uses a minimal 52px edge header with no enclosing card: 16px viewport insets, mark at far left, the Events link aligned toward the 1040px content column, and utilities at right. The main register is `min(1040px, 100% - 48px)` with 36px top spacing.

On desktop, each record is date column, 20px timeline column, then card. The card keeps media at the right at about 100px wide; text and operational context occupy the flexible left side. Do not replace the edge header with a floating centered navigation panel.

At 760px and below, switch to compact image-left rows, hide the standalone date column and chronology rail, show the `Your Events` heading, and fold the date into the schedule line. At 680px and below, replace the desktop header with the minimal mobile header and fixed bottom dock; reserve safe-area space above and below. Mobile rows use 16px page gutters.

Workspace content remains 1180px wide and the public event shell 980px. Workspace heroes and overview panels collapse to one column near 900px; public cover moves first there, and public details become one column near 620px. Hide nonessential labels before reducing touch targets.

## Elevation & Depth

The system is flat and print-like. Events cards have no shadow: desktop records are separated by a thin border, mobile records by a single bottom divider, and hover changes border/surface tone only. A small shadow is acceptable on the selected segmented-control thumb; it must not turn the page into stacked floating panels. Workspace and public surfaces continue to use color, one-pixel dividers, and adjacency.

Never use gradients, glass/blur, glow, oversized shadows, or an app sidebar.

## Shapes

Events desktop cards use restrained 12px corners, with 11–12px media cropping and a pill-shaped status tag. Controls remain compact at 7–10px; only markers, status dots, and avatars are circular. Mobile removes the card silhouette entirely: rows are flat, media stays softly rounded, and the action remains a compact rounded rectangle.

Workspace sections and heroes use 12px corners, reducing to 10–12px on narrow screens. Keep all dividers one pixel.

## Components

### Events header and controls

The desktop header is sparse and transparent: logo, one Events link, optional `New event`, local time, search, shared theme toggle, notifications, and profile. Header actions remain 44px targets. The Upcoming/Past control is a compact two-option segment beside the title; mobile keeps the same control and moves primary navigation into the fixed dock.

Every interactive element needs a visible focus outline and a truthful accessible name. Keep primary mobile dock targets at least 44px.

### Event register and row

The desktop timeline uses a 72px date column, a one-pixel connecting rule, and 9px markers with a canvas halo. Each flat bordered card is at least 168px high with 12px padding, roughly 100px × 106px right media, compact status/time, title, venue, attendance, assigned staff, and a 100px navy `Open` action. Dark mode keeps the exact card geometry and changes `Open` to white.

Mobile uses 76px × 96px image-left rows, no date rail, a 68px action, and a single divider. Keep essential context visible; truncate long titles to two lines and secondary facts to one. Show `No staff assigned` rather than fabricated avatars.

### Shared theme toggle

Use the shared Magic UI `ThemeToggle` everywhere. When the View Transition API is available, reveal the new theme as a circle expanding from the toggle center over 400ms with `ease-in-out`; suppress the browser's default root transition animation. If View Transitions are unavailable or `prefers-reduced-motion: reduce` is active, apply the palette immediately. Do not overlap theme transitions.

### Workspace and public event surfaces

The workspace hero remains a 116px-banner command record with actions; its 48px tab row uses a 3px orange selected underline. Workspace sections keep 22px padding, factual icon-label-value rows, exact metrics, four linked lifecycle steps, ordered station availability, and named staffing coverage.

The public event page remains a read-only briefing: high-contrast copy-and-cover hero, then `Where` and `When` details divided by one-pixel rules. Use real venue, address, date, and schedule data. It is not a meeting interface and does not invent registration.

### Status and truthful metrics

Use Draft, Published, Live, and Past on the event list; reserve Cancelled for the exception. Internal lifecycle controls may retain exact audited states. Publishing requires at least one active station and one assigned person. `Signups` are registrations, `Checked in` are arrivals, `Active` is current active signups against actual capacity, and attendance is checked-in divided by active signups. Never invent attendance, outcomes, capacity, referral, or staffing figures.

If an event is still stored as `IN_PROGRESS` after `endsAt`, the register labels it Past and moves it to the Past view. The backend still retains the exact audited lifecycle state.

## Do's and Don'ts

**Do:** use the light Events page as the geometry source; preserve identical geometry in dark mode; keep the edge header, slender desktop rail, compact right media, image-left mobile rows, fixed mobile dock, direct labels, truthful data, restrained imagery, one-pixel rules, and accessible targets.

**Don't:** use a floating centered desktop nav, cream-on-black Events cards, dark command cards in light Events, keep the date rail on mobile, add gradients/glass/glow, use rounded-everything bento layouts, invent operational data, or introduce online-meeting conventions.
