---
name: ai-assistance-declaration
description: Create a concise AI-assistance declaration for a project submission. Use when a user asks to document AI use, record AI/chat links, state what AI did, or assess the impact of AI-assisted work as Small, Medium, or Large. Do not use for enforced compliance workflows, hidden reasoning requests, or automatic transcript validation.
version: 1.0.0
category: project-documentation
portable: true
---

# AI Assistance Declaration

## Purpose

Create a short, honest declaration explaining AI use in a project submission.

## When to Use

Use this skill when the user needs an AI declaration, an AI transcript entry, or an external AI/chat-link log.

Do not use it to request hidden chain-of-thought, private prompts, credentials, or inaccessible provider metadata.

## Inputs

- Task or feature completed
- AI tool and model, if known
- Files or project areas affected
- Human review or edits
- Relevant transcript and external AI/chat links

Use `Unknown — not exposed by the AI provider` for unavailable details. Do not invent them.

## Workflow

1. Use `docs/ai-transcripts/DECLARATION_TEMPLATE.md` when it exists; otherwise use the output format below.
2. Describe what AI did and what the contributor reviewed.
3. Set project impact:
   - **Small** — wording, a minor fix, or a narrow isolated change.
   - **Medium** — one feature or several related files that materially support the submission.
   - **Large** — core design, substantial implementation, or work affecting major parts of the submission.
4. Add relevant links to `docs/ai-transcripts/EXTERNAL_AI_CHAT_LINKS.md`. Record only links the contributor is allowed to share.
5. Never include credentials, private data, or hidden AI reasoning.

## Output Format

```md
# AI Assistance Declaration

## Project impact

**Impact:** Small / Medium / Large

What was done and how it affects the project submission.

## AI assistance used

- Tool and model:
- What AI helped with:
- Files or project areas affected:
- Human review or changes made:

## Transcript and external links

- Transcript file(s):
- Related AI/chat link(s):

## Declaration

I reviewed this work and take responsibility for the submitted changes.

Name:
Date:
```

## Quality Bar

The declaration is complete when it states the impact, AI contribution, affected work, human review, and any shareable supporting links without exposing private information.
