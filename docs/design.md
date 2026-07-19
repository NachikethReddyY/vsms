# VSMS design system

## Final direction

VSMS is a calm, compact healthcare operations workspace. Its visual DNA is **60% Cal.com coss UI** (geometry, controls, density and neutral hierarchy), **20% ChatGPT-style restraint** (quiet canvas and task focus), **10% Claude-style warmth** (human typography and explanatory copy), and **10% NHS/GOV.UK behavioural rules**. It must not resemble Carbon, Fluent, Mantine, a government portal, Bootstrap, or default shadcn.

| Concern | System | Rule |
| --- | --- | --- |
| Visual language | [coss UI / Cal.com](https://github.com/calcom/cal.com) | Control geometry, sidebar proportions, compact settings/table patterns, neutral hierarchy, dialogs and owned components. |
| Behaviour primitives | [Base UI](https://base-ui.com/) | Dialog, drawer, menus, fields, tooltips, number inputs and focus handling. |
| Styling and charts | Tailwind + semantic variables; Recharts | VSMS owns the visual layer; charts are only for reports and operational data. |
| Clinical language | [NHS patterns](https://service-manual.nhs.uk/design-system) | Clear clinical wording, warnings, review/referral messages. No NHS visual branding. |
| Validation behaviour | [GOV.UK patterns](https://design-system.service.gov.uk/) | Error summary, inline errors, linked correction and plain language. No GOV.UK visual branding. |
| Icons and font | Lucide; Inter | Use no other icon family; use slightly relaxed line heights. |

Use Motion for React only for state continuity (sidebar, queue reorder, drawers, validation and sync); respect reduced motion. Use React Aria patterns as an interaction-quality benchmark. Do not add dependencies to the static preview.

## Tokens

```css
:root {
  --canvas: #f6f7f9; --sidebar: #fbfcfd; --surface: #ffffff;
  --surface-raised: #ffffff; --surface-subtle: #f0f3f5;
  --text-primary: #101828; --text-secondary: #475467; --text-muted: #667085;
  --border: #e4e7ec; --border-strong: #cfd5dc;
  --brand: #164e63; --brand-hover: #123f50; --brand-subtle: #e7f2f5;
  --success: #0f766e; --success-subtle: #e5f5f1;
  --review: #9a5d00; --review-subtle: #fff3d6;
  --referral: #c2410c; --referral-subtle: #fff0e7;
  --urgent: #b42318; --urgent-subtle: #feeceb;
  /* dark: #0a0f14 canvas, #0d131a sidebar, #101820 surface */
  --vsms-brand: var(--brand);
  --vsms-brand-hover: var(--brand-hover);
  --vsms-brand-subtle: var(--brand-subtle);
  --vsms-canvas: var(--canvas);
  --vsms-sidebar: var(--sidebar);
  --vsms-surface: #ffffff;
  --vsms-surface-raised: #ffffff;
  --vsms-surface-muted: #f0f3f5;
  --vsms-text: #17212b;
  --vsms-text-secondary: #52616d;
  --vsms-text-muted: #74818b;
  --vsms-border: #dce2e7;
  --vsms-border-strong: #c5ced5;
  --vsms-success: #16856b; --vsms-success-bg: #e6f5f0;
  --vsms-review: #996515; --vsms-review-bg: #fff4d8;
  --vsms-referral: #bd581d; --vsms-referral-bg: #fff0e7;
  --vsms-danger: #b42318; --vsms-danger-bg: #fdecea;
  --vsms-info: #176b9c; --vsms-info-bg: #e7f3f9;
  --vsms-radius-sm: 6px; --vsms-radius-md: 10px; --vsms-radius-lg: 14px;
  --vsms-shadow-card: 0 1px 2px rgb(16 24 40 / .04), 0 4px 12px rgb(16 24 40 / .05);
  --vsms-shadow-floating: 0 8px 24px rgb(16 24 40 / .12);
}
```

| Foundation | Specification |
| --- | --- |
| Surface hierarchy | Canvas; white standard surface with border; white raised surface with restrained shadow. Do not card every element. |
| Shape | 10–14px major panels; 6–8px controls; no pills for normal controls. |
| Type | Page 28–32px/650; panel 18px/650; body 15–16px; metadata 13–14px; queue name 16–18px/600; metric 30–36px/650. |
| Interaction | 44px minimum target, visible keyboard focus, hover/pressed feedback, reduced motion. |
| Colour | Navy for brand/actions; teal completion; blue active/info; amber review; orange referral; red urgent/destructive/failure only. |

## Layout

The desktop shell has a 240px light sidebar, 64px header and full operational dashboard. At 1024px the sidebar becomes a 72px labelled-on-focus icon rail; priority information stays visible.

```text
┌──────── light sidebar ───────┬──────────────────── event header ───────────────────┐
│ brand / event switcher        │ Northside Community Screening       [Register] […] │
│ EVENT                         ├────────────────── overview surface ─────────────────┤
│ Dashboard / Participants      │ Registered · Waiting · Completed · Review · Sync    │
│ SCREENING                     ├───────────────────────────┬────────────────────────┤
│ Queue / Screening / Reviews   │ live screening queue      │ station pipeline       │
│ MANAGEMENT                    │                           ├────────────────────────┤
│ Reports / Settings             │                           │ reviews requiring action│
│                               ├───────────────────────────┼────────────────────────┤
│ offline + sync at bottom      │ recent activity           │ sync and device health │
└───────────────────────────────┴───────────────────────────┴────────────────────────┘
```

## Operational dashboard

The page header is event-focused: event name, active state, date/location, registered count and elapsed duration. Its actions are **Register participant** (primary), **Open queue** (secondary) and an overflow menu.

One overview surface, divided internally, presents Registered, Waiting, Completed, Review required, Referred and Pending sync. Only metrics needing attention use a semantic colour.

The live queue is the page’s largest region. Its 68–76px rows show initials, name, ID, queue position, station, wait duration, icon + text status, visible contextual action and overflow actions. Rows use quiet separators, not individual cards.

The primary progress view is a station pipeline. Every row exposes count, percentage, horizontal progress, waiting count and a bottleneck warning where needed. Completion-by-hour belongs in Reports.

## Forms and clinical states

Mantine controls use labels above fields, hint text, native input modes, 48px default controls and 52px fast-entry clinical controls. On invalid submission, focus a GOV.UK-style summary linked to every inline error; preserve valid input. Use NHS-style neutral wording: “Flagged for reviewer assessment” and “Referral recommended by screening rules”. The system never diagnoses.

All statuses render a Tabler icon, visible label and semantic colour: Not started, Waiting, In progress, Complete, Review required, Referral required, Urgent escalation, Saved offline, Pending sync, Syncing, Synced, Sync failed and Unavailable.

Offline saving is reassuring: “Saved safely on this device. It will synchronise when the connection returns.” Sync Centre exposes pending, syncing, synced and failed records, last success, retry count/reason, Sync now and Retry failed.

## Release checklist

- [ ] Light 240px sidebar / 72px tablet rail; no full-height navy wall.
- [ ] A populated dashboard fills a 1440px viewport with queue, pipeline, reviews, activity and sync health.
- [ ] One overview surface, not identical metric cards.
- [ ] Queue is visually dominant; actions never hide only in an overflow menu.
- [ ] Tabler icon + text + colour for every status.
- [ ] WCAG 2.2 AA, keyboard path, visible focus, 44px targets, 200% zoom and reduced motion checked.
