---
target: final VSMS landing page
total_score: 23
max_score: 32
na_heuristics: 7,10
p0_count: 0
p1_count: 3
timestamp: 2026-07-30T13-33-58Z
slug: design-landing-page-design-final-mix-html
---
## Design Health Score

| # | Heuristic | Score | Key issue |
|---|---|---:|---|
| 1 | Visibility of system status | 3 | Theme state and product sync states are visible. |
| 2 | Match with the real world | 4 | Event-day, screening, queue, reviewer, and offline language is concrete. |
| 3 | User control and freedom | 3 | Skip navigation, theme control, and sign-in paths are clear. |
| 4 | Consistency and standards | 2 | Sign-in and workspace CTA terminology competes. |
| 5 | Error prevention | 3 | Authorised-user and reviewer-owned language prevents key misunderstandings. |
| 6 | Recognition rather than recall | 3 | Workflow and interface views explain the service. |
| 7 | Flexibility and efficiency | n/a | Not applicable to a landing-page decision. |
| 8 | Aesthetic and minimalist design | 3 | Strong hierarchy, but the lower trust sections repeat content. |
| 9 | Error recovery | 2 | Offline recovery is promised without showing failure or conflict recovery. |
| 10 | Help and documentation | n/a | Not required for this Persuade surface. |
| **Total** | | **23/32** | **Good, with coherence issues to polish** |

## Design Specificity Verdict

The content is recognisably VSMS: community-screening photography, QR handoff, offline capture, screening stations, and reviewer-owned decisions. The remaining generic layer is structural rather than factual. The repeated reliability and governance sections read like adjacent feature inventories, and the final Pixel CTA uses a separate display voice without a strong closing message.

The deterministic detector returned seven warnings, all `overused-font`. Three are font-face declarations, two are appropriate monospace uses for codes and metadata, and one is the requested Pixel display face. The count overstates one intentional typography decision. No additional layout-pattern rules were reported.

No browser overlay was available because the browser inventory was empty. The CLI scan is the fallback evidence.

## Overall Impression

The hero and interface gallery are the strongest authored moments. The biggest opportunity is to let the gallery remain the proof peak, compress the repeated trust content beneath it, and close with one situational action.

## What's Working

- The hero image establishes the real screening environment immediately.
- QR, offline, and reviewer language is clinically restrained and specific.
- The visual gallery proves the event overview, station capture, and clinical review workflow without generic feature cards.

## Priority Issues

1. **P1: Repeated trust content.** Reliability and governance explain overlapping ideas in two consecutive sections. Merge them into one short visual trust strip with four icon-led facts.
2. **P1: Workflow specificity.** Queue appears as a clinical stage while named screening stations are collapsed. Restore the known screening journey when this section is revisited.
3. **P1: Product proof gaps.** The gallery shows healthy sync states but not failure or conflict recovery. A future approved product capture should include one recovery state.
4. **P2: CTA language.** “Continue to the workspace” assumes prior progress and duplicates the sign-in intent. Use a situational closing statement and a distinct, direct action.
5. **P2: Gallery details.** A few light border values remain inside the dark interface views, and simulated interface text is small on mobile.

## Persona Red Flags

- **Jordan, first-timer:** The poetic hero requires the next section for full product understanding, while the closing “Continue” language implies missing context.
- **Riley, stress tester:** Only successful sync examples are visible. The page claims recovery states without demonstrating one.
- **Casey, mobile:** Dense interface text approaches 9-10px and some evidence is hidden rather than reformatted.

## Minor Observations

- Focus, skip navigation, touch targets, reduced-motion support, and image alt text are strong.
- The Pixel face should remain restricted to the final statement.
- The page should avoid adding another explanatory paragraph beneath the compressed trust strip.

## Questions to Consider

1. Should the next product capture show sync conflict recovery or the QR check-in moment?
2. Could the public page eventually use approved screenshots from the deployed workspace instead of representative component views?
