# Privacy And Manual Deletion Runbook

Roadmap initiative: [`RM-04`](../ROADMAP.html#rm-04)
Policy page: [`privacy.html`](../privacy.html)

## Before accepting a request

Verify the requester through the known tester relationship. The random install label and a
shared-run URL help locate records; neither is proof of identity. Record whether the request is
for one run, all uploads under an install label, or also asks to stop future capture. Credential
revocation is a separate security action and is not silently bundled into data deletion.

Record the approver and the absolute date outside the repository. Never put a bearer token,
diagnostic note, replay body, App Attest credential, or private tester identifier in an issue,
commit, or evidence file.

## Preview and execute

Use a fresh shell and read the environment-specific operator token without placing its value in
shell history:

```bash
read -rs DMC_CAPTURE_BEARER_TOKEN
export DMC_CAPTURE_BEARER_TOKEN
npm run operator:delete -- --env staging --scope run --reference RUN_ID
```

For every upload associated with an install label:

```bash
npm run operator:delete -- --env staging --scope install --reference INSTALL_ID
```

The script always previews first. Review the exact session IDs, report IDs, public mappings,
diagnostic R2 keys, replay R2 keys, preserved shared replay keys, and plan digest. Execution
requires typing the complete confirmation string. A changed target set invalidates the digest
and requires a new preview. This can happen normally when a replay reference crosses its
retention boundary between preview and execution; it is policy-clock drift, not tampering.

The preview also scans every live `telemetry-results/*/candidates.private.json` artifact for the
target session IDs. Matching private candidate files are listed before confirmation and removed
before the remote deletion executes. A malformed or unreadable candidate artifact aborts the
operation; do not bypass that failure, because deleting D1 while retaining a derived local run ID
is not a completed privacy deletion. Identifier-free telemetry summaries remain because they
cannot be linked back to the deleted run.

Production requires both the environment and a separate acknowledgement:

```bash
npm run operator:delete -- --env production --production --scope run --reference RUN_ID
```

## What execution removes

The Worker creates a durable job, locks the run/install scope, and locks every candidate replay
before deleting anything. It records expiry-bounded hashes of deleted session/report IDs so an
old offline retry cannot resurrect them. It deletes and verifies each diagnostic object in R2,
removes the target public share
mappings, diagnostic rows, and session rows in D1, then deletes and verifies only replay objects
with no surviving in-policy reference. A replay used by another live run or diagnostic report is
listed as preserved and remains intact.

The response is complete only when `verified` is `true`. The script writes a redacted record to
the gitignored `operator-results/` directory containing only the environment, date, job ID,
digest, result, and counts.
The counts include any private telemetry candidate artifacts removed locally before execution.

## Resume and escalation

If an upload holds a replay write reservation or R2 fails partway through, the job and replay
locks remain durable. Do not start a new deletion for the same request. Resume the reported job:

```bash
npm run operator:delete -- --env staging --resume JOB_ID
```

A retry is idempotent. If a reservation remains blocked, first determine whether the owning
upload committed. Do not delete the reservation by hand merely because it is old; Cloudflare
HTTP request wall time is not bounded by the default CPU limit. Inspect the reservation first:

```bash
npm run operator:delete -- --env staging --inspect-reservation REQUEST_ID
```

Use structured Worker logs to prove the reserving invocation completed or terminated. If that
cannot be proven, leave it blocked. After proof, recover the committed or orphaned reservation
through its own preview digest and durable recovery job:

```bash
npm run operator:delete -- --env staging --recover-reservation REQUEST_ID
```

Then resume any deletion job that the reservation had blocked.

If the job ID was not recorded, list and inspect incomplete jobs:

```bash
npm run operator:delete -- --env staging --list-jobs
npm run operator:delete -- --env staging --inspect-job JOB_ID
```

Use `--recover-job JOB_ID` for the exact-confirmation recovery flow. A job blocked before any
deletion releases partial locks and can be safely aborted; its temporary manifest is purged after
30 days if it remains untouched. A post-mutation job deliberately retains its manifest and locks
until verified completion. Do not release those locks by hand: the manifest is the remaining map
to the requested data, and destroying the map is not deletion.

## Completion record

Record the verified job ID, plan digest, target counts, preserved replay count, approver, and
execution date. Confirm the requester’s target rows are absent, the job is `complete`, its
temporary manifest is gone, its replay locks are released, deleted R2 keys return no object, and
every preserved key still exists.
