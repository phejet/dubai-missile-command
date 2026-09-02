# Canonical Roadmap Schema

Use this reference when creating ROADMAP.html, changing its structure, reconciling drift,
or reviewing whether an edit still preserves one current source.

## Ownership

ROADMAP.html owns:

- current initiative order and status;
- the active initiative and next action;
- gates that control sequencing or release;
- current scope decisions and explicit deferrals;
- links to evidence and detailed supporting documents;
- a short dated record of material roadmap changes.

Supporting documents own detailed rationale, architecture, implementation checklists, and
verification logs. They may contain dated snapshots, but must link back to a roadmap ID and
must not call themselves the current or canonical roadmap.

## Required document structure

Keep one v1 roadmap-source meta element and one roadmap-source:v1 comment in the root roadmap.

The document must contain these section IDs:

- now — active initiative and one concrete next action;
- roadmap — every current initiative, exactly once;
- gates — unresolved conditions that prevent sequencing or release;
- decisions — current product or delivery choices that constrain work;
- references — evidence, design, and execution links;
- changes — dated material refinements.

## Initiative element

Each initiative is one native details disclosure with:

- class phase;
- a lowercase DOM id such as rm-04;
- data-roadmap-id containing the stable ID, such as RM-04;
- data-status containing one approved status;
- optional data-depends-on containing space-separated roadmap IDs;
- one summary with ID, title, visible status, and one outcome sentence;
- one phase\_\_body containing only the detail needed to understand scope and exit.

Rules:

- IDs use RM- plus at least two digits and never change after assignment.
- An initiative appears once. Do not create a separate summary table that duplicates it.
- Summary text stays short enough to scan while collapsed.
- Detail explains outcome, delivered proof, remaining work, and exit gate only as needed.
- Pictures use ordinary relative figure, img, and figcaption elements inside the relevant
  initiative. Do not add an asset or placeholder merely to demonstrate capability.

## Status vocabulary

Use only:

- planned — accepted direction, not started;
- gated — intentionally waiting on a named condition;
- in_progress — current execution is authorized and underway;
- shipped — the initiative's stated exit evidence exists;
- deferred — intentionally not scheduled pending evidence or a later decision;
- cancelled — no longer intended; retain the reason in the change record.

Visible labels may clarify environment, such as Staging, while the semantic data-status
remains one of the values above. Do not use shipped when code exists but a recorded deployment
or physical gate remains unmet; represent the remaining gate explicitly.

## Evidence and precedence

When sources disagree, investigate in this order:

1. inspectable code, tests, artifacts, deployment records, and remote state;
2. user-confirmed behavior on devices or systems the agent cannot observe;
3. the current roadmap;
4. execution logs and subsystem documentation;
5. historical design documents.

Evidence outranks stale roadmap prose, but it does not become current truth until the roadmap
is reconciled. Clearly distinguish user-confirmed evidence from agent-reproduced evidence.

## Editing protocol

Before writing:

1. read the whole roadmap;
2. inspect git status and the roadmap diff;
3. locate the stable initiative ID;
4. read only the supporting evidence needed for the change.

When writing:

- patch the smallest relevant section;
- preserve human wording and unrelated agent edits;
- update Now when the active initiative or next action changes;
- update gates and decisions in the same change when their meaning changed;
- add one concise dated change entry for material direction or status changes;
- link detailed evidence instead of pasting long test logs into the roadmap.

After writing:

1. run the roadmap validator;
2. format the HTML;
3. open it at desktop and mobile width when structure or styling changed;
4. hand visual or priority-bearing changes back for human review.

## Simplicity boundary

HTML is used because it is easier for humans to review and can embed images or dynamic
elements when needed. It is not permission to build a roadmap application. Prefer readable
HTML and CSS. Add JavaScript, graph libraries, filters, or controls only after a concrete
review problem demonstrates their value.
