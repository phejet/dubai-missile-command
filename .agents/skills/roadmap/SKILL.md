---
name: roadmap
description: Design, refine, reconcile, review, or execute the canonical project roadmap. Use for roadmap status, priorities, phases, gates, current or next work, and handoffs between human collaborators, Codex, and Claude. Do not use for a one-off task plan that does not change product direction.
---

# Roadmap

Maintain one trustworthy current roadmap while humans and different AI agents refine and
execute it over time.

## Canonical source

`ROADMAP.html` at the repository root is the only source of current roadmap order, status,
gates, decisions, and next action. Read it before consulting supporting plans. Treat design
documents and execution logs as evidence or history, never as competing current status.

Read [references/schema.md](references/schema.md) before creating, structurally changing, or
reconciling the roadmap. Ordinary status reads and small content edits can follow the existing
HTML structure directly.

Keep the roadmap simple static HTML by default. Use semantic elements, light CSS, native
`<details>` disclosure, links, and optional figures. Add scripts or dynamic visuals only when
a concrete human-review need justifies them.

## Select the mode

### Read or report status

1. Read `ROADMAP.html` first.
2. Follow only the supporting links needed to answer the question or verify a doubtful claim.
3. Distinguish roadmap truth from evidence: report the recorded state, then name any proven
   drift rather than silently inventing a merged state.
4. Answer with stable initiative IDs, current gates, and the recorded next action.

### Design or refine

Work with the human on outcomes before tasks. For every material proposal, make the desired
player or project outcome, exit evidence, dependencies, tradeoffs, and non-goals explicit.
Ask for a decision when priority, scope, sequencing, or risk policy would materially change;
do not turn wording cleanup into approval theatre.

Preserve stable IDs. Patch the smallest relevant initiative, gate, or decision. Record a dated
change when direction or status changes. Move discarded work to deferred or cancelled instead
of erasing the reasoning trail.

### Execute

1. Re-read `ROADMAP.html` and the worktree immediately before starting.
2. Select an approved, ready initiative. Do not bypass a recorded gate because implementation
   looks convenient.
3. Put detailed steps and verification evidence in the project's execution plan, linked to the
   roadmap ID. Do not copy the whole roadmap into that plan.
4. Implement and verify proportionately.
5. Update roadmap status only when its stated exit evidence exists. Keep code complete,
   deployed, and physically proven distinct when the gate distinguishes them.
6. Record the next concrete action so another agent can resume without reconstructing intent.

### Reconcile or hand off

When code, deployment evidence, user-confirmed device behavior, and the roadmap disagree,
inspect the evidence and update `ROADMAP.html` in the same coherent change. Label superseded
status sections in old documents as historical; do not maintain multiple synchronized
summaries.

A handoff must leave the canonical roadmap with the actual status, evidence link, unresolved
gate, and next action. Never declare an externally verified gate complete from local tests.

## Concurrent-agent discipline

- Read `git status`, the current `ROADMAP.html`, and its diff immediately before editing.
- Preserve unrelated or newer edits. Patch by stable ID; never regenerate the whole file from
  memory.
- If another agent changed the same initiative, reconcile the meaning before writing. Do not
  choose whichever prose is longer and call it a merge.
- Use absolute dates (`YYYY-MM-DD`) and evidence that another agent can inspect.
- Keep agent-specific instructions out of the roadmap. This skill is shared by Codex and
  Claude through one canonical directory.

## Validate and review

Run:

```bash
node .agents/skills/roadmap/scripts/validate-roadmap.mjs
```

Then format and browser-review `ROADMAP.html`. For visual changes, hand the page back to the
human and say what changed. Passing validation proves structure, not that the priorities feel
right.
