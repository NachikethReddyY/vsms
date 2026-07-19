# VSMS components

## Shared rules

Every interactive control has a visible label or accessible name, 44px minimum touch target, hover, focus, pressed, disabled and loading states. Use one Lucide icon plus text for clinical and sync states; icons never carry meaning alone.

## Application shell

- **Sidebar:** 248px expanded, 72px rail at ≤1024px. It owns navigation scrolling; event and sync context stay visible.
- **Command bar:** event context, global command launcher, connectivity, notifications and account. It is 64px high.
- **Context inspector:** secondary, selected-participant detail on desktop; becomes a drawer below 1180px. Tabs: Participant, Event flow, Flags, Sync.

## Queue grid

Purpose: choose the next safe participant action. Columns are participant identity, station, wait, status, action and overflow. A selected row replaces the inspector content; urgent rows sort first when requested. Keep name, ID, queue number, status and primary action visible at all widths.

## Participant identity

Name, participant ID and queue number stay together. Initials are an optional fallback avatar, not an identity substitute. Never repeat these fields in decorative cards.

## Status

Render icon + text + colour. Canonical states: Not started, Waiting, In progress, Complete, Review required, Referral required, Urgent escalation, Saved offline, Pending sync, Syncing, Synced, Sync failed, Unavailable. Red is urgent/destructive/failure only; amber is review; orange is referral; teal is completion; blue is active/information.

## Forms

Labels sit above controls; helper text stays adjacent. Use 48px controls and 52px fast-entry controls. Failed submit moves focus to a linked error summary, keeps valid input, and exposes an inline explanation. Prefer progressive disclosure to permanent side-by-side forms.

## Overlays

Use dialog only for destructive confirmation. Use the inspector/drawer for contextual work. Dialogs trap focus and restore it on close; menus and tooltips must escape scrolling containers.
