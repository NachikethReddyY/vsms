# VSMS participant flow

## 1. Registration — approved MVP

Participants do **not** create accounts. A signed-in Registration Officer creates or finds their record.

```text
Participant arrives
│
├─ Registration Officer signs in
├─ Selects today’s event
├─ Searches participant
│  │
│  ├─ Existing participant found
│  │  ├─ Confirm identity
│  │  ├─ Update changed details if needed
│  │  └─ Create this event’s registration/check-in
│  │
│  └─ No participant found
│     ├─ Create participant record
│     ├─ Record consent
│     └─ Create this event’s registration/check-in
│
├─ System creates participant ID
├─ Officer adds participant to the first station queue
└─ Participant goes to screening
```

### Registration fields

- Full name
- Date of birth / age
- Gender
- Contact number
- ID/reference number only if required
- Emergency contact only if required
- Consent confirmation
- Optional operational notes: mobility assistance or preferred language

### Keep these records separate

- **Staff account:** signed-in Administrator, Registration Officer, Screener, or Reviewer.
- **Participant record:** no password or login; reusable across events.
- **Event registration/check-in:** links the participant to one event and starts their queue journey.

For a returning participant, search first and create a new event check-in instead of creating a duplicate participant.

## 2. After registration: queue and first station

```text
Participant has event check-in
│
├─ System places them in the first station queue
├─ Registration Officer gives queue number / directs participant
├─ Screener opens their station queue
├─ Screener selects the next participant
├─ System marks the participant “in progress” at that station
└─ Screener opens the correct screening form
```

The first station is **Visual Acuity**. The Screener records the result, sees any automatic flag, saves it, and then transfers the participant to the next station or marks them ready for review.

## 3. QR pass, queue status, and station scan — approved production direction

The Registration Officer generates one event-specific QR pass after registration. The QR contains an opaque, signed token—not the participant’s name, queue number, or medical data.

```text
1. Registration Officer registers participant
   → creates participant/event check-in
   → assigns queue number
   → generates event QR code

2. Participant scans QR on their phone
   → private status page shows:
      - participant name
      - their queue number
      - assigned station
      - current number being served
      - queue status / estimated wait

3. Station 1 Screener signs in and scans the participant QR
   → VSMS verifies the event check-in
   → opens that participant’s Visual Acuity form
   → screener records results

4. Screener saves
   → result saved in local device storage immediately
   → automatic flag is shown if relevant
   → participant is transferred to the next station queue
   → if online: sync to database now
   → if offline: mark Pending Sync; upload automatically later
```

The participant QR is an event pass and expires after the event. Staff actions require staff sign-in and role permission. If a QR slip is lost, staff revoke it and generate a replacement.

## 4. Station 1: Visual Acuity data entry — approved direction

Use controlled numeric fields, not unrestricted free text. The test distance is fixed by the selected chart; the Screener enters only the denominator.

```text
Test distance: 6 m

Right eye (OD):  6 / [ 12 ]
Left eye (OS):   6 / [  6 ]
```

The app displays and stores `6/12` and `6/6`. It validates the denominator against configured chart lines before saving. For a 3 m chart, the form shows `3 / [ ]`; staff never enter the numerator.

For cases where a participant cannot read the chart, provide explicit actions:

```text
[CF] Count Fingers   [HM] Hand Motion   [LP] Light Perception
[NLP] No Light Perception   [Not testable]
```

After save, the app validates the result, calculates a preliminary rule-based flag, saves locally first, and synchronizes to the server when online.

### Station instructions

Include an always-visible **information (`i`) button** on every station form. It opens short, station-specific instructions, for example:

```text
Visual Acuity: position the participant at the marked chart distance.
Test right eye, then left eye; cover the other eye without pressure.
Record the smallest line read. Use the exception buttons if no chart line is readable.
Use the participant’s usual distance glasses where applicable.
```

The instructions support staff; they do not replace clinical training or make a diagnosis.

## 5. Station hand-off — approved direction

After a Screener saves Station 1, the participant is automatically moved to **Station B’s queue**. Any preliminary flag remains attached to the participant record for the Reviewer, but does not stop the normal screening journey.

```text
Station 1 result saved
→ save locally and sync when online
→ mark Visual Acuity complete
→ create Station B queue entry
→ participant waits for Station B
→ Station B Screener scans the same QR pass
→ Station B form opens for that participant
```

The same pattern repeats at each station: scan QR → complete station form → save locally → sync → move participant to the next station queue.

## 6. Station B: Refraction — proposed workflow, pending client confirmation

Station A records how clearly the participant sees. Station B uses a refraction device to estimate how the eye focuses. If Station B is equipped with an autorefractor, **every participant is measured**, whether or not they wear glasses.

```text
Participant scans QR at Station B
→ Screener asks: “Do you normally wear distance glasses?”
→ record Yes / No / Unknown
→ run autorefractor measurement for both eyes
→ enter or import the machine readings
→ save locally and sync when online
→ move participant to Station C queue
```

### Data produced by the autorefractor

Record the machine’s result separately for each eye:

- **Sphere (SPH):** lens power, in dioptres
- **Cylinder (CYL):** astigmatism correction, in dioptres
- **Axis:** astigmatism direction, 0–180°
- **Measurement status:** completed / unable to measure / repeat required
- **Device and operator:** device ID and Screener ID
- **Recorded time**

The machine estimate is a screening input, not a prescription. Do not show “prescribe glasses” or generate a prescription in the app.

### Images are a separate test

An autorefractor normally returns measurements; it is not the retinal photograph taken during an eye-health or diabetic-retinal-photography examination. Store an eye image only if the client confirms that Station D includes retinal/fundus photography or another imaging test.

### Questions to confirm with client / lecturer

- **Q-REF-01:** Does every participant go through an autorefractor measurement at Station B?
- **Q-REF-02:** For participants with glasses, should staff only record Yes/No, or also measure the current lenses with a lensmeter?
- **Q-REF-03:** Which machine values are required: only SPH/CYL/Axis, or also pupillary distance, keratometry, prism, add, and distance visual acuity?
- **Q-REF-04:** Will staff type machine readings, upload a device export, or integrate directly with a device?
- **Q-REF-05:** Does the Eye Health station capture retinal/fundus photographs? If yes, what image format, consent, storage period, and reviewer access are required?

### Reference links

- [DICOM: Autorefraction Measurements Module](https://dicom.nema.org/medical/dicom/current/output/chtml/part03/sect_c.8.25.9.html)
- [StatPearls: Autorefractors](https://www.ncbi.nlm.nih.gov/books/NBK580520/)
- [National Eye Institute: Refractive Errors](https://www.nei.nih.gov/eye-health-information/eye-conditions-and-diseases/refractive-errors)
- [HealthHub Singapore: Diabetic Retinal Photography](https://www.healthhub.sg/support-and-tools/screening/diabetic-retinal-photography)

## 7. Station D: Clinical Review & Eye Health — Option B (implemented direction)

Keep the formal review/referral requirements at a clinician-led booth. **Eye health is a screener station** (`EYE_HEALTH`) with offline capture; clinicians may still add optional eye-health notes on the immutable clinical review decision (`Review.eyeHealthObservations`). The screen is a **Clinical Review Workspace**, not a generic dashboard.

```text
Participant enters Station D / Clinical Review queue
→ clinician scans QR
→ one participant summary opens
→ clinician reviews Station A–D results and preliminary flags
→ clinician may add optional eye-health observations (cataract/glaucoma risk, symptoms, notes, optional device findings)
→ clinician decides: complete / monitor / refer / urgent escalation
→ system stores one signed review (and optional draft referral)
```

### Clinical Review Workspace

- Participant identity, event, consent status, and contact details needed for follow-up
- Red-flag/symptom banner and screening timeline
- Visual Acuity: OD, OS, correction/pinhole status, flag
- Refraction: glasses status and machine readings per eye
- Colour Vision: test kit, per-eye score, and flag
- Eye-health observations captured by the reviewer (not a Station A–C screener form)
- Image attachments only if a later product decision adds imaging (out of Option B MVP)
- Clinician notes, decision, urgency, referral destination, and follow-up instructions
- Clinician identity, review time, report version, and audit trail
### Report output

Generate one clinician-friendly **PDF clinical screening summary** for download/printing. It is a handover summary, not a diagnosis or prescription.

For production integration, keep results structured and map to an interoperability standard only when the receiving system requires it. HL7 FHIR `DiagnosticReport` can represent a report with individual observations, interpretation, images, and a formatted PDF attachment.

### Questions to confirm with client / lecturer

- **Q-CR-01:** Is the Station D reviewer a doctor, optometrist, or another named clinical role?
- **Q-CR-02:** Which approved eye-health findings and devices must be recorded at Station D?
- **Q-CR-03:** Does Station D capture and store retinal/fundus images? If yes, what consent, format, retention, and access rules apply?
- **Q-CR-04:** What referral destinations, urgency levels, and follow-up wording are approved?
- **Q-CR-05:** Is a clinician PDF enough, or must the project export an agreed healthcare-interoperability format such as FHIR?
- **Q-CR-06:** How can the clinician access a participant’s complete health and eye-care history? Is it self-reported at the event, brought by the participant, uploaded with consent, retrieved from an approved external health-record integration, or unavailable to VSMS? Which role may view it, and for how long?

### Reference links

- [Royal College of Ophthalmologists: minimum referral content example](https://www.rcophth.ac.uk/wp-content/uploads/2021/08/AMD-Services-Commissioning-Guidance-Recommendtions.pdf)
- [HL7 FHIR: DiagnosticReport](https://hl7.org/fhir/diagnosticreport.html)
- [HL7 FHIR: QuestionnaireResponse](https://fhir.hl7.org/fhir/questionnaireresponse.html)

## 8. Clinical-review staffing, referral, and urgent escalation — approved direction

The normal event setup uses trained Screeners/technicians at Stations A–C and one doctor or qualified clinical reviewer at Station D. The system supports more than one reviewer, but a second doctor is not required for the MVP.

Only participants with `REVIEW_REQUIRED` or `URGENT` results enter the Station D clinical-review queue. Participants without flags receive a completed-screening summary and may leave.

```text
Flagged participant
→ Station D clinical-review queue
→ clinician reviews and examines as needed
→ clinician decides referral outcome
→ clinician approves the referral
→ system generates PDF
→ staff prints and hands referral letter to participant at Station D
```

Urgent cases bypass the normal queue:

```text
Urgent flag or severe symptom at any station
→ system raises urgent alert
→ Screener calls clinician immediately
→ participant marked URGENT
→ clinician assesses / arranges immediate handover
→ system records time, receiving person/service, destination, and notes
→ referral PDF is generated after immediate safety action
```

### Questions to confirm with client / lecturer

- **Q-STAFF-01:** Must every participant physically see the clinician at Station D, or only participants with review-required/urgent flags?
- **Q-SIGN-01:** Is authenticated electronic approval accepted for referral letters, or must the clinician physically sign the printed copy?
- **Q-OUT-01:** Which documents are required: screening summary, specialist/clinic referral letter, optometrist follow-up letter, and/or participant action sheet?
- **Q-OUT-02:** Is printed handover at the event the required delivery method, and is consented secure-email backup also required?

## 9. Roles and flow ownership

| Role | Required / actor | Responsibilities in this flow | Discussed in this document |
| --- | --- | --- | --- |
| Participant | Actor | Arrives, receives QR pass, monitors private queue, completes stations, receives summary/referral. No VSMS account. | ✓ |
| Registration Officer | Required role | Finds/creates participant, records consent, creates event check-in, generates QR, starts first queue. | ✓ |
| Screener | Required role | Runs Stations A–C, scans QR, records results, acknowledges flags, saves offline, transfers queue. | ✓ |
| Reviewer / Clinical Reviewer | Required role | Runs Station D; reviews flagged cases, records approved findings, decides outcome/referral, approves documents and urgent handover. A doctor or other authorised clinician may hold this role. | ✓ |
| Event Manager / Event Organiser | Required role | Creates/opens events, configures stations and staff assignment, monitors queues, throughput, sync health, and operational issues. | ✓ |
| Administrator | Required role | Creates/disables staff accounts, assigns roles, controls access, views audit/security settings. Does not need to participate in each participant journey. | ✓ |

### Do not create new roles unless the client needs them

- **Queue coordinator / print assistant:** use Registration Officer or Event Manager permissions; no separate role needed for MVP.
- **IT support:** use Administrator access; keep separate production support procedures outside participant flow.
- **Doctor:** use the existing Reviewer role with clinical-review permission, unless the client requires a legally distinct role.
