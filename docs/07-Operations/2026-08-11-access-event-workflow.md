# Access and event workflow update — 11 August 2026

## Access model

VSMS now presents four stable organisation account types:

- **Administrator** — manages the organisation and can manage every event.
- **Event manager** — manages events to which they are assigned.
- **Doctor** — an approved clinical account that may be assigned clinical review work.
- **Staff** — an approved operational account.

Registration, screening, review, and support are event roles, not permanent job titles. An administrator or an event manager for that event assigns these roles from the event's **People and roles** page. A Staff account can therefore perform registration at one event and screening or support at another without changing its organisation account.

Clinical review can only be assigned to an account categorized as Doctor, and event management can only be assigned to an Event manager account. These rules are checked both when roles are assigned and when protected work is performed. Account type is administrator-controlled and cannot be changed from the user's profile.

The backend remains authoritative. Navigation and controls are hidden when a user cannot use them, while API authorization independently verifies the account state, event assignment, role, and current duty where required. Administrators inherit organisation-wide event visibility and management access in the shared event-authorization service; other users remain limited to active event assignments.

## Event creation and operation

- Creating an event is now one details form and saves a **Draft** directly. Stations and people are configured from the saved event.
- Singapore postal code is required and must contain exactly six digits.
- Native browser date and time inputs replace the duplicated time text. They retain keyboard support and use the device's date/clock picker.
- The Create draft action is available at the bottom of the form as well as in the sticky header.
- Event stations are imported one at a time. Route order was removed because availability and operational flow can differ by event day.
- The station library uses cards, a top refresh icon, and seeded defaults: Registration, Visual acuity, Eye health, Clinical review, Refraction, and Colour vision.

## Reports and navigation

- Administrators can report across all organisation events.
- Event managers can report only on assigned events.
- Users without report access do not see Reports in navigation and still cannot call report APIs.
- A valid empty result says **No reports yet**. Request failures remain errors.
- Report filters are opened from the header filter button; refresh is a labelled icon button.

## UI consistency

- Staff administration, account review, and event staffing use the same light/dark design tokens.
- Repeated refresh text buttons were replaced with labelled icon buttons where the icon is unambiguous.
- Organisation role guidance is behind an accessible information dialog instead of occupying permanent page space.
- Technical storage terms such as “membership envelopes” and “duties endpoints” are no longer exposed in event staffing.

## Deferred: dynamic station form builder

The current station execution code supports fixed clinical engines. A Google-Forms-style arbitrary station builder is not a safe dropdown-only change and is deliberately deferred. It requires a versioned field-definition schema, drag-and-drop editor, generic runtime renderer, validation rules, response storage, reporting/export behavior, migration rules, and authorization/privacy review. The seeded station library supplies useful defaults until that complete runtime is designed and implemented.

## Release order

1. Run frontend lint, build, and focused behavior tests.
2. Run backend authorization/reporting tests and validate the Prisma migration.
3. Push the reviewed commit to the school repository feature branch.
4. Push the same commit to the personal repository `main` branch.
5. Allow Amplify to build the frontend from personal `main`.
6. Deploy the same commit to EC2, run `prisma migrate deploy`, restart `vsms-backend`, and verify service, database, API health, and the public frontend.

School and personal repositories must point to the same commit before cloud verification is considered complete.
