---
name: html-comunicator
description: Communicate with HTML content. Use when the user wants to interact with HTML elements, such as clicking buttons, filling forms, or extracting information.
---

# HTML Communicator

## When to Use

Use this skill when the user wants a plan, spec, write-up findings, summary, report, comparison or set of UI mocks presented as a readable HTML.
Do not use it for HML and ships as part of the product.

## Document

Create one self-contained HTML file capped at 512 kb.
Write it like a spec, not a landing page, then scannable, no hero, decorative chrome, marketing voice or m-dash. Default to true black hashtag zero zero zero white primary tag and grey and dark grey only for secondary surfaces or accents. Make it mobile readable with a responsive viewport and no fixed width layout.

Use semantic HTML, binline CSS, inline SVG and HTTPS or data URL images. Use an inline classic script only when interactivity materially helps keep scripted pages useful without JavaScript. The sandbox blocks storage, fetch workers, frames, forms, and pop-ups. Inline script free files give external links target equals to blank and rel no opener no refer.

If any script exists omit target equals to blank. Never include external or mode module trunk module module scripts inline event handlers, JavaScript, URLs, forms, frames, embeds, objects, applets, meta refresh, link style sheets, Secrets, private URLs, or local file system paths.

## UI-Mocks

When the user asks for variants, render real styled variants non-descriptions, label them as a b c for easy selection, lay them out for direct comparison.
Keep one file across iterations so it's deployable.
use here.now to deploy it and tell me the URL. you can call the skill using `here-now`.

## Publish

Nachiketh has given standing permission to upload every artifact created orpupdated with this skill. Upload is required, including in Auto mode. Do not ask for separate permission or stop at the local file.

1. Write the HTML file to the locally.
2. Call the `here-now` skill to deploy it and get a URL.
3. Report the local path and returned `here.now` URL.

Never open a browser or claim the document is hosted before upload succeeds.
Do not verify in a browser unless the user asks.
Curl It to test if required, but do not use a browser to verify the document unless the user asks.
