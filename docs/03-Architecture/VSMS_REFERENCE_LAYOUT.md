# VSMS reference layout specification

## Measurement basis

No raster reference was attached in the active message. These are the explicit reference-derived dimensions supplied in the brief, treated as the reconstruction target rather than a new design direction.

| Area | Target |
| --- | ---: |
| Desktop viewport | 1440 × 900 baseline |
| Expanded sidebar | 224px |
| Collapsed sidebar | 64px |
| Command bar | 52px |
| Inspector | 340px (320px at the sleek compact target) |
| Shell | 100dvh; no document horizontal scroll |
| Workspace padding | 24px desktop, 18px tablet, 14px narrow |
| Queue row | 64px; 60px compact density |
| Standard control | 36–40px |
| Primary touch action | 44px minimum |
| Major radius | 8px |
| Control radius | 6px |
| Related-control gap | 8px |
| Major-region gap | 24px |

## Structural reconstruction

The shell is sidebar → 52px command bar → one continuous queue workspace + inspector. The queue is the visual focal point and owns the main scroll region. The inspector is a contrasting contextual surface, not a stack of cards. Navigation scrolls internally and its footer stays fixed.

The command bar contains the compact event label, global command launcher, sync state and account controls. It replaces the second page-level event header. Queue context is one title and an inline operational summary: `146 registered · 18 waiting · 72 complete · 12 require review`.

## Type and density

| Role | Size / weight |
| --- | --- |
| Command-bar event | 14px / 600 |
| Queue title | 18px / 650 |
| Participant name | 15px / 600 |
| Body / button | 14px / 400–600 |
| Metadata | 12.5–13px / 450 |

Use tabular figures for queue numbers, times and counts. Participant names and the one row action are stronger than IDs, wait time and station labels.

## Surface and border hierarchy

Canvas → workspace → inspector → floating overlay. Use one subtle workspace boundary and row separators. Controls have a stronger but still low-contrast border. Selected rows use a 2px brand inset plus a very faint tint; urgent rows receive only a red status icon/text, never a red surface. Semantic status is icon + text, not a dot plus a large badge.

## Responsive assumptions

At 1024px, sidebar becomes a 64px icon rail and the inspector moves to an on-demand drawer. Queue retains participant, status and action; station and wait remain where room permits. At narrow administration widths, the queue hides secondary columns before text or targets shrink. `prefers-reduced-motion` reduces sidebar, selection and inspector transitions to instant state changes.

## Approved first implementation scope

Only the shell, sidebar, command bar, live queue, selected-participant inspector, and light/dark themes. Screenshots are required at 1024×768, 1280×800 and 1440×900 before further screens.
