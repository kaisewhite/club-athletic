# Home responsive audit — 2026-10-13

## Anti-patterns verdict

Pass for the targeted home composition. It uses a restrained editorial treatment, a clear typographic lead, no gradients, no decorative glass effects, and no repeated card-with-icon template. The audit did find one spacing defect: the prompt group and composer were touching at the narrow target viewport.

## Executive summary

- 1 medium responsive/layout issue found.
- 0 critical accessibility blockers found in the audited home surface.
- 0 horizontal-overflow issues at the target viewport.
- The primary hierarchy is correct: trip-help heading, supporting copy/FAQ link, prompts, then composer.

## Finding

### Medium — no separation between prompts and composer

Status: Resolved.

- Location: `src/styles.css`, mobile `.home-composer` layout.
- Category: Responsive design / layout rhythm.
- Evidence: at 372×515, the prompt group ended at y=688 and the composer began at y=688, producing a zero-pixel vertical gap.
- Impact: the two interactive groups read as one crowded control cluster, reducing scanability and making the composer feel attached to the last prompt.
- Recommendation: use the existing spacing token to create a deliberate 12px separation between the prompt group and composer without changing desktop positioning.
- Fix command: `$layout` + `$adapt`.
- Resolution: added `gap: var(--space-5)` to the mobile home composer.

## Follow-up polish

- Prompt pills now use a responsive flex-wrap layout instead of numbered grid placement.
- Each pill keeps `white-space: nowrap`, uses content-sized width, and preserves the 44px minimum touch target.
- The mobile composer gap is now `var(--space-5)` (24px), moving the prompt group upward while keeping the composer anchored.
- Verified at 320px, 372px, and 412px with zero horizontal overflow.

## Positive findings

- Mobile prompts are now in normal document flow, so wrapped headings and short viewports do not overlap the FAQ link.
- The prompt grid remains two columns with a centered final prompt.
- The composer remains narrower than the content column and avoids full-width stretching.
- The audited viewport had no horizontal overflow.

## Verification plan

- Recheck 372×515, 320×568, 375×812, and 412×915.
- Confirm the mobile gap is 12px and the desktop composer/prompt relationship is unchanged.
- Run the full unit/dom test suite, lint, and `git diff --check`.
