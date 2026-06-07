---
name: code-review
description: Review a code diff for correctness bugs and suggest concrete, minimal fixes.
---

When asked to review code:

1. Read the diff or the files under review.
2. Identify correctness issues -- logic errors, off-by-one, unhandled cases.
3. Propose the smallest fix for each, with `file:line` references.

Prefer a few high-confidence findings over a long list of speculative nits.
