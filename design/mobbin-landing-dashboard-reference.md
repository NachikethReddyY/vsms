# VSMS landing page and dashboard reference brief

Research date: 31 July 2026
Source: Mobbin desktop web sections, screens, and flows
Purpose: Shared reference for the later GPT-5.6 and multi-model HTML design round

Local image bundle: [`design/mobbin-references/`](./mobbin-references/README.md) — 36 validated WebP screenshots, so later agents do not need Mobbin access.

## 1. Product decision

The VSMS landing page is an **internal-product introduction and staff access page**, not a conventional SaaS sales page.

Primary users:

- Screening staff
- Event organisers and managers
- Doctors and clinical reviewers
- Registration and administrative staff

Primary action: **Sign in to VSMS**

Secondary action: **See how an event works**

The page must quickly explain this operating loop:

> Find an assigned event → open the event → scan a participant QR code → record station results → save and hand off → review flagged records → complete the event.

Managers additionally need to:

- See all relevant events
- Create and configure events
- Import, invite, approve, and deactivate staff
- Assign staff to events, roles, and stations
- Monitor queues, station readiness, incomplete records, and sync state

The landing page should use the real dashboard and workflow screens as its proof. It should not rely on a generic healthcare photograph as the main explanation.

## 2. Current implementation audit

Current source:

- `react-user-dashboard/src/components/LandingPage.tsx`
- `react-user-dashboard/src/components/LandingPage.module.css`

### Keep

- Outcome-led headline: “Keep the day moving.”
- One obvious staff sign-in action
- Real event-day workflow language
- Offline, QR handoff, role clarity, and reviewer decisions as core themes
- Large touch targets, skip link, focus states, and reduced-motion handling
- Restrained operational tone rather than consumer-wellness language

### Change in the redesign

- Replace the dominant stock-photo hero with a real or representative VSMS interface.
- Replace every dashboard placeholder with approved screens from the existing flows.
- Show the event-selection and event-launch step before the station workflow.
- Explain how the experience changes for managers, screeners, registration staff, and reviewers.
- Turn the six-step workflow from a flat icon list into a visible participant-state progression.
- Show queues, exceptions, assignments, and sync state—not only feature labels.
- Remove repeated marketing sections that do not add new evidence.
- Keep **Sign in** as the primary CTA; do not introduce “Book a demo” or email capture unless the product becomes externally sold.
- Use a labelled action such as **Open event** or **Start screening** on event cards. A play icon alone is too ambiguous for an operational tool.

## 3. Best Mobbin references

Mobbin did not surface a direct multi-station vision-screening product. The references below are therefore selected by functional analogy: healthcare review, event operations, queue work, permissions, QR handoff, and offline state.

### A. Landing-page narrative

#### 1. Ease — healthcare outcome and product explanation

[Mobbin: “Fewer clicks. More care.” hero](https://mobbin.com/sites/sections/a52a1f9a-e372-4769-804f-0d8a8d2562d2)

Inspected: outcome-led proposition, workflow visual, CTA, and supporting proof.

Borrow:

- One short operational outcome
- Plain-language explanation of reduced staff burden
- A system-flow visual beside the copy

Do not copy:

- Investor logos as the main trust device
- Broad healthcare claims that VSMS cannot prove

VSMS use: voice and headline discipline.

#### 2. ClickUp — product-led operations hero

[Mobbin: “Manage operations like a boss” hero](https://mobbin.com/sites/sections/8327bdfc-5c9d-4240-b4af-9431eebd0f9e)

Inspected: operations-specific headline, product preview, login path, and customer proof.

Borrow:

- Make the real interface visible above the fold
- Explain an operational outcome instead of listing features
- Keep sign-in separate from explanatory navigation

Do not copy:

- Email capture
- Decorative gradient treatment
- Generic play-button interaction

VSMS use: first-viewport structure.

#### 3. Airtable — end-to-end process explanation

[Mobbin: critical-process workflow section](https://mobbin.com/sites/sections/2fe54680-a86e-4ab8-a3c5-b4dee3470cf1)

Inspected: five connected workflow stages and their supporting layers.

Borrow:

- A horizontal lifecycle
- One aligned layer each for role, state, and handoff
- Progressive detail after the simple journey is understood

Do not copy:

- Dense technical layers in the first explanation
- Generic automation language

VSMS use: participant journey section.

#### 4. Vanta — trust tied to user responsibility

[Mobbin: security and compliance by customer stage](https://mobbin.com/sites/sections/8aa3f869-4e72-489d-8fbf-2769562acf3a)

Inspected: audience segmentation, security proposition, and evidence overlays.

Borrow:

- Put trust evidence beside the workflow it protects
- Address distinct concerns for staff, managers, and reviewers

Do not copy:

- Segmenting by company size
- Generic padlock cards

VSMS use: role and governance explanation.

### B. Event and participant operations

#### 5. Luma — registration, approval, check-in, and QR identity

- [Mobbin: registration configuration](https://mobbin.com/flows/826ad04c-98f6-4f68-ac83-76af66479d46)
- [Mobbin: guest approval](https://mobbin.com/flows/e688bd8e-2edf-4fc4-9984-f8795837cc85)
- [Mobbin: attendee QR card](https://mobbin.com/screens/46e06266-500a-471c-812c-18cbecdd98f5)

Inspected: registration questions, approval states, guest list, check-in action, and named QR credential.

Borrow:

- Persistent participant status
- Explicit pending, approved, and declined states
- Fast approval actions beside the list
- A QR credential surrounded by enough identity context to prevent a wrong-person handoff

Do not copy:

- Treating the QR code itself as proof of security
- Event-ticketing language

VSMS use: staff approval, participant registration, and QR scan flow.

#### 6. Eventbrite — event overview and role assignment

- [Mobbin: organiser event dashboard](https://mobbin.com/screens/0470acb6-b4d1-4b88-a6b7-915d026eed75)
- [Mobbin: role-based invitation flow](https://mobbin.com/flows/afa107f7-5d02-4e4b-8c04-35d73d19de86)

Inspected: event status, headline measures, recommended actions, attendee management, role selection, and limited-event access.

Borrow:

- Event-scoped navigation
- A clear event status and next action
- Assign role and event scope together
- Explain what a permission allows before confirming it

Do not copy:

- Ticket-sales metrics
- Vague roles that hide permission consequences

VSMS use: global event list, event setup, people, roles, and assignments.

#### 7. Jobber — operational home and assigned work

- [Mobbin: workflow home dashboard](https://mobbin.com/screens/26563ea4-1b26-4a35-8c59-f9e8aab7de5c)
- [Mobbin: on-site assessment detail](https://mobbin.com/screens/6dc1095d-d55e-4a6b-a271-a53130088fa2)

Inspected: stage counts, exceptions, assigned team, appointment context, instructions, completion, and notes.

Borrow:

- Stage summary across the event
- Exception counts beside normal throughput
- Clearly assigned team or station
- Task instructions beside the active record

Do not copy:

- Revenue and invoicing concepts
- A noisy chronological activity feed

VSMS use: manager dashboard and event cards.

#### 8. Plain — queue and active-record workspace

[Mobbin: three-pane service queue](https://mobbin.com/screens/a0e5ed95-2b6f-472a-926e-3f495217c6a6)

Inspected: queue, selected work item, context panel, urgency, labels, and next/done actions.

Borrow:

- Queue → active participant → context layout
- One obvious completion action
- Immediate progression to the next participant
- Priority and incomplete-state visibility

Do not copy:

- Support-ticket terminology
- Conversation history taking priority over clinical results

VSMS use: station queue and reviewer queue.

#### 9. Headspace — completed/current/next handoff

[Mobbin: session confirmation and QR next steps](https://mobbin.com/screens/a3e730a6-ff92-412b-be2a-40ffb10721b4)

Inspected: completed-step trail, practitioner context, next-step checklist, and QR handoff.

Borrow:

- Completed, current, and next-stage progression
- A compact “next station” panel
- Clear explanation of why the QR is scanned

Do not copy:

- Consumer-health tone
- Large decorative gradients

VSMS use: participant confirmation after scanning and station handoff.

### C. Clinical review and system resilience

#### 10. Heidi — clinical assessment and review tasks

[Mobbin: patient assessment and task review](https://mobbin.com/screens/dfa07c96-879c-4cc4-93de-3f07d0061895)

Inspected: patient selector, assessment content, task panel, completion states, and review warning.

Borrow:

- Stable participant context
- Structured results in the centre
- Incomplete or follow-up tasks beside the results
- Explicit reviewed state before finalisation

Do not copy:

- Making a long narrative note the primary artefact
- AI-generated clinical wording or diagnosis claims

VSMS use: doctor and reviewer workspace.

#### 11. Figma — protection for unsynced work

[Mobbin: “Sync your offline changes” modal](https://mobbin.com/screens/f0a6343d-ab78-4a59-a375-6447f52d1ec8)

Inspected: unsynced-change warning, recovery explanation, sync, logout, and discard decisions.

Borrow:

- Show the number of unsynced records before logout or event closure
- Explain that local work remains recoverable
- Make **Sync now** the obvious safe action

Do not copy:

- Giving destructive discard equal emphasis

VSMS use: offline state, logout protection, and event close-out.

#### 12. Amazon Web Services — granular transfer status

[Mobbin: upload-status monitor](https://mobbin.com/screens/d0b2a1fa-99a9-4c29-ba83-f77a3f850d40)

Inspected: aggregate progress, remaining work, failed totals, and per-item states.

Borrow:

- Event-level sync health with drill-down
- Retry only failed records
- Pending, syncing, synced, failed, and conflict states

Do not copy:

- Engineering language, filenames, or storage destinations

VSMS use: manager sync monitor.

## 4. Recommended product hierarchy

The interface should have three clear levels.

### Level 1 — Global dashboard

For every signed-in worker:

- My assigned events
- Upcoming and active events
- Role and station assignment
- One clear action per event: **Open event** or **Start screening**

Additional manager controls:

- All events
- People and pending access
- Role and station assignments
- Event creation and configuration
- Cross-event sync or operational alerts

Additional reviewer controls:

- Flagged records awaiting review
- Incomplete reviews
- Follow-up or referral decisions

### Level 2 — Event dashboard

- Event status and readiness
- Registered, waiting, screening, review, and completed totals
- Station status and staff assignment
- Live participant queue
- Flagged and incomplete records
- Offline and sync health
- Event-scoped people and role management

### Level 3 — Active participant

- Scan QR
- Confirm participant and event
- Show completed, current, and next station
- Enter structured results
- Save locally
- Confirm handoff
- Route exceptions to review
- Let the next worker continue from the same participant state

## 5. Landing-page information architecture

Keep the page short. Every section must add evidence.

1. **Header**
   - VSMS identity
   - How it works
   - Roles
   - Event-day workflow
   - Sign in

2. **First viewport**
   - Outcome-led headline
   - One-sentence product explanation
   - Primary **Sign in to VSMS**
   - Secondary **See the event workflow**
   - Real dashboard composition showing events, stations, participant progress, and sync state

3. **One event, one participant journey**
   - Register
   - QR check-in
   - Screening stations
   - Clinical review
   - Completion or follow-up

4. **Work by role**
   - Manager: configure, import, approve, assign, monitor
   - Registration: find or create participant, confirm consent, issue QR
   - Screener: scan, record, save, send onward
   - Reviewer or doctor: inspect results, resolve flags, record next step

5. **Live event command centre**
   - Existing event card and dashboard screens
   - Throughput, queues, station health, incomplete work, and sync

6. **Offline and handoff**
   - Local save
   - Visible sync state
   - Safe QR handoff
   - Recovery and conflict handling

7. **Final access panel**
   - **Sign in to VSMS**
   - “For authorised screening personnel”

Do not add pricing, testimonials, investor logos, email capture, or a “Book a demo” funnel.

## 6. First-viewport direction

Recommended structure: approximately 40% message and 60% product proof.

Suggested headline:

> Keep every screening event moving.

Suggested explanation:

> VSMS gives organisers, screening staff, and reviewers one place to manage events, scan participant passes, record results, and act on the next safe step.

Actions:

- Primary: **Sign in to VSMS**
- Secondary: **See how an event works**

Product visual:

- A real “My events” or manager dashboard as the main frame
- One active event card with a labelled **Open event** action
- A visible station board or participant-stage progression
- A small, persistent saved/sync state
- One flagged record or review count so the page shows exceptions as well as normal throughput

Avoid:

- Stock photography as the dominant hero
- Floating device mockups
- A carousel
- Decorative metrics with no operational meaning
- A marketing-only fake dashboard that does not match the product

## 7. Dashboard-to-landing continuity

Use the same:

- Status vocabulary
- State colours
- Event-card structure
- Station names
- Role names
- Sync indicator
- Table and form density
- Participant progress component

Recommended shared status vocabulary:

- Registered
- Waiting
- Screening
- Clinical review
- Completed
- Follow-up required

Recommended sync vocabulary:

- Saved offline
- Pending sync
- Syncing
- Synced
- Sync failed
- Conflict requires review

The marketing render may simplify data volume, but it must not invent a second visual system.

## 8. Claims and safety boundary

Only show a capability as factual when the implementation supports it.

Verify before publishing claims about:

- Offline persistence and recovery
- QR token security or expiry
- Role-based permissions
- Audit history
- Encryption
- Conflict resolution
- Clinical governance or regulatory compliance

Always preserve these product rules:

- VSMS supports screening; it does not diagnose.
- A reviewer makes the final decision.
- QR content must not expose clinical data.
- Offline is a normal operating state, not an error.
- Destructive loss of unsynced screening data must never be the easy action.

## 9. Reference roles for the later design models

Use these as the core reference stack:

1. **Ease** — landing-page voice and healthcare clarity
2. **Luma** — registration, approval, check-in, and QR handoff
3. **Jobber** — event-manager operational shell
4. **Plain** — queue and active-participant workspace
5. **Heidi** — reviewer workspace
6. **Figma + AWS** — offline and sync state

The goal is not to visually average them. Each reference owns one job.

## 10. Requirements for every future design variant

Every model should receive the same product constraints and produce:

- One complete desktop HTML prototype
- Responsive tablet behaviour for event-day use
- Landing page
- Global role-aware dashboard
- Event list and event card launch action
- Event dashboard
- People, approval, and assignment view
- QR scan and participant confirmation
- One screening result-entry screen
- Clinical review queue and record
- Offline, pending sync, failure, and recovery states
- Representative empty, loading, error, and permission-denied states

Use existing VSMS routes, copy, assets, and flows as the source of truth. Synthetic participant data must be clearly fictional and must not introduce new product claims.

## 11. Variant scoring rubric

Score each model out of 100.

| Criterion | Weight | Test |
|---|---:|---|
| Operational clarity | 20 | Can a worker identify the next safe action immediately? |
| Product truth | 15 | Does it preserve the real event, QR, screening, review, and offline flow? |
| Role and permission clarity | 15 | Are manager, screener, registration, and reviewer capabilities understandable? |
| Event-day workflow | 15 | Is event → participant → station → review progression coherent? |
| Dashboard information hierarchy | 10 | Are queues, exceptions, assignments, and sync easy to scan? |
| Tablet usability and accessibility | 10 | Are targets, focus, contrast, and responsive layouts appropriate? |
| Landing-to-product continuity | 10 | Does the landing page truthfully preview the dashboard? |
| Visual distinctiveness | 5 | Is it memorable without decorative or AI-generated UI clichés? |

Automatic rejection:

- Diagnosis language
- Clinical data encoded or shown inside the QR
- Hidden sync state
- Ambiguous icon-only event launch
- Tiny tablet controls
- Generic metric-card dashboard with no queue or next action
- Stock photography used instead of product evidence
- A landing page and dashboard that look like unrelated products

## 12. Recommended comparison process

1. Give every model this same brief and the same existing screenshots.
2. Require each model to explain its three strongest design decisions in no more than five lines.
3. Score each independently before comparing aesthetics.
4. Select the strongest full interaction model as the base.
5. Borrow isolated visual or interaction details from other variants only when they fit the base system.
6. Run one final consistency pass so the result does not feel stitched together.
