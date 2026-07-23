# Private courses

`private-courses/` stores listening materials that are useful for local course
production but are not cleared for public redistribution.

This directory is deliberately outside `public/`. Vite does not copy it into
`dist`, and the deployment scripts must never upload it.

## When to use it

Put a course here when any of the following is true:

- Complete audio republication rights are unknown.
- Transcript or translation republication rights are unknown.
- The material is licensed only for personal or internal use.
- The source transcript is still an unreviewed ASR draft.
- The course is awaiting a takedown, attribution, or licensing decision.

Public availability, a downloadable link, or an embeddable player is not
evidence of republication permission.

## Layout

Copy `_template/` to a directory named with the final course ID:

```text
private-courses/<course-id>/
  course.local.json       Rights, sources, hashes, and production status
  README.md               Course-specific notes and blockers
  source/
    audio.mp3             Original local audio
    captions.*            Original captions or transcript
    metadata.json         Captured source metadata
  course.en.json          Current English course draft
  translation/            translation-workflow.mjs chunks
  review/                 Human QA notes
  tools/                  Course-specific local conversion scripts
```

Real course directories and everything inside them are ignored by Git. Only
this convention and `_template/` are tracked.

## Rights gate

`course.local.json` uses one of these values:

- `unverified`: sources have been identified, but public reuse permission has
  not been established.
- `private-only`: the known license or owner decision limits use to private
  study or internal production.
- `approved`: written permission or an applicable license has been reviewed
  and its evidence is recorded.

A course may move into `public/` and `src/lessons.ts` only when:

1. `rights.status` is `approved`.
2. Permission covers the intended audio, English transcript, and translated
   transcript uses separately.
3. English text, speaker labels, and timing have completed human review.
4. `translation-workflow.mjs validate` passes.
5. The final JSON passes the app's Zod schema and timeline checks.

Moving an approved course is a deliberate release step. Files must not be
referenced directly from `private-courses/` by application code.
