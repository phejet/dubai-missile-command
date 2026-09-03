# Authenticated Capture Ingestion

Status: repository implementation complete through the native staging-ready slice;
Cloudflare provisioning, consent/queue UI, and physical-device enrollment remain disabled.
Last updated: 2026-08-10.
Review audience: an engineer or AI reviewing the capture stack before Cloudflare
provisioning is enabled.

This revision incorporates the correctness findings from the 2026-08-08 inline review
and removes state or abstractions that the current product does not need.

## Executive decision

Remote capture ingestion will not be a public, anonymous API. For the current product
scope, only a native iPhone build may submit to the staging or production Worker, and
it must prove its app instance with Apple App Attest. Local browser play may capture
only through the local Vite middleware.

Cloud eligibility is a closed runtime policy, not a consequence of knowing an endpoint.
Headless simulations, replay playback, bots, AI-controlled games, Playwright runs, and
ordinary local production builds are cloud-ineligible by default. This remains true
even if somebody sets a Worker URL manually.

Authentication answers **which authorized app instance sent these bytes**. It does not
answer **whether the claimed score is true**. Leaderboard eligibility still requires a
separate server-side replay re-simulation process to set `replay_verified`.

This design deliberately assumes that the repository, wire protocol, bundle, and
Worker URL are public. There is no global write secret in JavaScript or in the app
bundle. Security that depends on hiding client code is merely cosplay with a lanyard.

## Review request

The reviewer should try to falsify these claims:

1. No unauthenticated request can create D1 or R2 capture data in staging or production.
2. Capturing a valid request does not make it replayable or transferable to another
   body, route, build, or environment.
3. Client-supplied `installId`, build metadata, CORS origin, and SHA-256 are not treated
   as identity.
4. Maintained automation and replay tools make zero remote requests under default
   repository configuration. This is data-hygiene behavior, not an anti-adversary claim.
5. App Attest failure never prevents play. An Apple outage can block new enrollment but
   not on-device assertions for an already-enrolled key.
6. Supported staging and production paths select separate credentials, resources,
   submitter records, and App Attest policies and fail closed on missing configuration.
7. Approving a production GitHub deployment has a precise and inspectable effect.

The unresolved questions at the end are intentional review targets, not hidden
implementation trivia.

## Current repository state

The fail-closed authorization path is implemented and locally verified. Remote capture
remains operationally disabled until staging resources, GitHub environment policy, user
consent, and physical-device enrollment are completed.

### What already exists

- `worker/src/index.ts` exposes `POST /api/session` and `POST /api/report`, plus
  bearer-protected private retrieval routes.
- `worker/src/ingest.ts` bounds and validates capture bytes, then requires a fresh App
  Attest assertion and atomically reserves its counter before any D1 or R2 capture write.
- `worker/src/app-attest.ts` verifies Apple's certificate chain against the pinned App
  Attest root, attestation nonce, App ID, key ID, AAGUID/environment, assertion signature,
  bundle signal, validation category, and counter.
- migrations `0001` and `0002` define replay/session/report storage, revocable App Attest
  credentials, and server-owned capture ownership. `replay_verified` remains false.
- `src/capture-policy.ts` selects local or remote transport before hashing, compression,
  challenge acquisition, or signing. Remote capture requires native human play and
  granted consent.
- `src/capture-auth.ts` enrolls native keys and serializes each challenge/assertion/upload
  transaction so legitimate uploads cannot race App Attest counters.
- `vite.config.ts` keeps ordinary browser and generic iOS builds capture-off; explicit
  staging/production builds require their reviewed HTTPS origin in
  `capture-worker-urls.json`.
- `src/install-id.ts` creates an anonymous local identifier. It is useful correlation
  metadata, not a credential.
- `ios/App/App/AppAttestPlugin.swift` exposes only support, key generation, attestation,
  and assertion operations; the private key remains inside Apple's App Attest service.
- `worker/wrangler.jsonc` defines separate local, staging, and production Worker names,
  D1 databases, R2 buckets, rate-limit namespaces, and Worker labels.
- `.github/workflows/deploy-worker.yml` uses distinct `staging` and `production` GitHub
  Environments. Staging is eligible after qualifying pushes to `main`; production is a
  manual dispatch.

### What remains disabled

Repository-level `CAPTURE_STAGING_PROVISIONED` and `CAPTURE_PRODUCTION_PROVISIONED`
remain unset. They are separate because job-level conditions are evaluated before a
GitHub Environment's variables become available. The checked-in staging and production
Worker configurations deliberately contain an empty build allowlist, so a deployment
that bypasses the protected workflow still rejects enrollment and submission. The
workflow must receive a distinct HMAC secret, exact distributed build allowlist, App
Attest environment policy, and enrollment switch from each GitHub Environment.

The consent/queue surface and direct-development Staging attestation path are shipped and
physically proven; the proper TestFlight category `2` submission remains pending. Production
collection must remain off until the parent consent/retention/privacy work and the physical
Staging attack matrix pass.
`CAPTURE_BEARER_TOKEN` remains a server/operator read credential and never enters the app.

## Scope

### In scope now

- Native iPhone builds installed directly during development or distributed through
  TestFlight.
- Local browser development against the Vite capture middleware.
- Separate staging and production Workers within one Cloudflare account.
- Separate Cloudflare deployment tokens and retrieval bearer tokens per environment.
- Explicit exclusion of headless, replay, bot, AI, and ordinary local-build traffic.
- Enrollment, revocation, challenge/assertion verification, credential-based quotas,
  and integration with the parent consent/offline-queue/retention design.

### Deliberately deferred

- Remote browser capture, including itch.io.
- Anonymous guest upload, Turnstile, OAuth, passkeys, and user accounts.
- Public replay/share-link playback and social metadata.
- Leaderboard identity, moderation, and UI.
- Server-side deterministic replay re-simulation. The schema remains ready for it, but
  authentication must not pretend to be score verification.

When web upload becomes a requirement, it needs a web-appropriate trust design. App
Attest cannot authenticate an itch.io browser. Likely ingredients are a server-issued
guest/account credential, origin checks, an abuse challenge at enrollment, strict
quotas, and replay verification. None makes a public browser intrinsically trusted.

## Threat model

| Threat                                                 | Required response                                                                                 | Residual risk                                                                                    |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| A script copies the public request format              | Reject before D1/R2 writes because it lacks an enrolled App Attest credential and fresh assertion | It may still spend Worker CPU on cheap rejected requests                                         |
| A valid request is captured and replayed               | Expiring signed nonce plus increasing App Attest counter rejects it                               | A compromised legitimate app can originate fresh requests until revoked or rate-limited          |
| A valid assertion is attached to another body or route | Sign the Worker-issued context token plus decoded-body SHA; require token purpose to match route  | Canonicalization bugs are a critical implementation risk                                         |
| A client invents `installId`, origin, build, or SHA    | Treat these as validated metadata only; resolve identity from the verified credential             | Allowed-build policy still needs operator maintenance                                            |
| The repository and app reveal endpoint/configuration   | Assume they are public; store no reusable submission secret in either                             | App Attest key IDs are identifiers, not secrets                                                  |
| A bot or AI run executes the same game code            | First-party runtime policy keeps maintained automation out of collected data                      | This is not a security boundary; external automation can drive a genuine enrolled app            |
| One authorized tester uploads excessively              | Credential, IP, and route quotas; revocation; bounded object size and retention                   | Distributed abuse from many enrolled devices remains a cost/moderation problem                   |
| A staging deployment token leaks                       | Revoke it independently and audit its use                                                         | Useful Cloudflare permissions are account-scoped, so one account is not a hard resource boundary |
| Production deployment is triggered accidentally        | Manual dispatch plus protected GitHub Environment review                                          | Approval covers a whole job, not each mutation individually                                      |
| App Attest is unavailable                              | Gameplay continues; new enrollment waits, while enrolled keys can still assert on-device          | A local App Attest/key failure still leaves capture local                                        |

## Security invariants

- Staging and production fail closed. No valid credential means no remote write.
- The Worker verifies `submitter_key_id_hash` and derives the attestation environment.
  A client-supplied lookup ID cannot establish either fact.
- No client-held static bearer authorizes remote ingest.
- Every remote request uses a fresh, purpose-bound, expiring, Worker-signed nonce token.
- The assertion covers the exact decoded JSON bytes indirectly through their SHA-256.
- Assertion-counter advancement is an atomic conditional update.
- Authorization completes before any capture object is written to R2 or row to D1.
- An endpoint string cannot grant cloud eligibility.
- Consent and authentication are separate gates; possessing a credential is not consent.
- Capture failure cannot block, crash, or alter gameplay.
- `replay_verified` is server-owned and remains false on authenticated ingest.
- Development and production App Attest credentials are not interchangeable.
- Cloudflare deployment credentials and private retrieval credentials never enter the
  app, browser, capture envelope, logs, or R2 metadata.

## Capture eligibility policy

One pure function should decide whether capture may leave the current process. It runs
before endpoint resolution, body compression, challenge acquisition, or native signing.
Scattering the checks through the game and transport would make omissions inevitable.

```ts
type CaptureChannel = "off" | "local" | "staging" | "production";
type RuntimeKind = "native-ios" | "local-browser" | "headless";
type ExecutionKind = "human" | "replay" | "automation";

interface CapturePolicyInput {
  channel: CaptureChannel;
  runtime: RuntimeKind;
  execution: ExecutionKind;
  remoteConsent: "unknown" | "denied" | "granted";
}

type CapturePolicyResult =
  | { allowed: false; reason: string }
  | { allowed: true; destination: "local" }
  | { allowed: true; destination: "remote"; environment: "staging" | "production" };
```

Required truth table:

| Channel            | Runtime             | Execution            | Remote consent    | Default result                        |
| ------------------ | ------------------- | -------------------- | ----------------- | ------------------------------------- |
| `off`              | Any                 | Any                  | Any               | Deny                                  |
| `local`            | Local browser       | Any                  | Any               | Local middleware only                 |
| `local`            | Native iOS          | Any                  | Any               | Deny; static iOS has no local sink    |
| `local`            | Headless            | Any                  | Any               | No transport; local tools own files   |
| `staging`          | Native iOS          | Human                | Granted           | Remote after App Attest authorization |
| `production`       | Native iOS          | Human                | Granted           | Remote after App Attest authorization |
| Staging/production | Browser or headless | Any                  | Any               | Deny                                  |
| Staging/production | Native iOS          | Replay or automation | Any               | Deny                                  |
| Staging/production | Native iOS          | Human                | Unknown or denied | Deny                                  |

Capture execution is derived from the artifact being submitted:

- An artifact with `replaySource = "playback"` is replay execution. Live and
  last-completed human-run artifacts remain human even after the user watches a replay.
- Playwright bot/AI fixtures install `execution = "automation"` before game boot.
- Headless entry points have no remote transport dependency at all.
- `window.__captureNow()` is a deliberate capture request, not an authorization bypass.
- Automation may create local artifacts through local tooling. Transport-level staging
  tests use the auth client directly with a designated test credential; gameplay code
  has no remote automation override.

Tests must inject a production URL while each ineligible state is active and assert that
no challenge or ingest request occurs.

## Build channels and endpoints

Replace the nullable free-form endpoint define with a closed build channel. Endpoint
mapping belongs in reviewed build configuration:

| Build command                   | Identity   | Channel      | Destination                 |
| ------------------------------- | ---------- | ------------ | --------------------------- |
| `npm run dev`                   | Web        | `local`      | Same-origin Vite middleware |
| `npm run dev:lan`               | Dev        | `staging`    | Fixed staging Worker URL    |
| `npm run dev:lan:offline`       | Dev        | `off`        | None                        |
| Ordinary `npm run build`        | Web        | `off`        | None                        |
| `npm run build:ios:dev`         | Dev        | `staging`    | Fixed staging Worker URL    |
| `npm run build:ios:dev:offline` | Dev        | `off`        | None                        |
| `npm run build:ios:staging`     | Staging    | `staging`    | Fixed staging Worker URL    |
| `npm run build:ios`             | Production | `off`        | None                        |
| `npm run build:ios:production`  | Production | `production` | Fixed production Worker URL |

Dev, Staging, and Production use `com.phejet.dubaicmd.dev`,
`com.phejet.dubaicmd.staging`, and `com.phejet.dubaicmd` respectively. Flavor selection
is mandatory for Capacitor builds. Vite and Xcode independently reject omitted,
mismatched, or stale flavor/channel/app-ID combinations.

Dev and Staging may both submit native human-play artifacts to the Staging Worker after
explicit consent. The Worker derives submission flavor from the Apple app ID verified by
App Attest, persists it on the session or diagnostic-report reference, and never stamps
flavor onto the shared content-addressed replay object. Dev is never accepted by the
Production Worker.

The iPhone receives no Cloudflare API token or retrieval bearer. It receives only the
public Worker URL and non-secret channel/build identifiers. The native App Attest
private key stays in Apple's protected key service and signs fresh assertions.

A directly installed development build normally uses Apple's App Attest development
environment. TestFlight and App Store builds use the production App Attest environment,
even if a TestFlight build calls the staging Worker. Worker environment and Apple
attestation environment are independent dimensions; store and check both. A production
Worker must not accept development attestations.

## iOS enrollment protocol

Enrollment stores one revocable App Attest key. Direct development signing and private
TestFlight distribution already control who receives a valid build, so this phase adds
no second invitation system. A required, fail-closed `ENROLLMENT_ENABLED` Worker variable
is normally `true` for an environment where capture is available. Setting it to `false`
is an emergency pause on new credentials, not a per-device approval or onboarding step.

### Client flow

1. Request `POST /api/auth/challenge` with purpose `ios-enroll` and build ID.
2. Receive a random nonce inside a short-lived Worker-signed challenge token.
3. The native plugin creates or reuses a `DCAppAttestService` key.
4. Compute App Attest `clientDataHash` as
   `SHA256(UTF8("DMC-ENROLL-v1\0") || u32be(tokenByteLength) || UTF8(exactToken))`,
   then ask Apple to attest the key.
5. Send key ID, attestation object, challenge token, and build ID to
   `POST /api/auth/ios/enroll`.
6. Persist a newly generated App Attest key ID immediately and keep a temporary pending
   enrollment record containing the exact challenge and, once minted, its attestation
   object until the Worker acknowledges enrollment. A `serverUnavailable` retry reuses
   the same key and client-data hash; an ambiguous Worker POST retries the same proof
   instead of attesting an already-attested key. Expired pending state and terminal App
   Attest or enrollment failures discard the key before a later attempt. These values
   are public proof material, not reusable authentication secrets; submissions still
   require the hardware-backed private key.

### Worker validation

Using Apple's documented App Attest validation procedure, verify:

- challenge-token HMAC, version, expiry, nonce, purpose, and build are valid;
- token environment comes from `env.WORKER_BUILD`;
- `ENROLLMENT_ENABLED` is true for this Worker environment;
- certificate chain terminates at the pinned Apple App Attest Root CA, not system trust,
  and required certificate extensions are valid;
- nonce derived from authenticator data and the independently reconstructed
  `clientDataHash`;
- relying-party/App ID hash for the expected Team ID and bundle ID;
- attested key ID matches the credential public key;
- AAGUID matches the explicitly allowed App Attest environment;
- attestation counter equals zero;
- validation category and bundle version are validated when the target OS includes those
  authenticator extensions; missing optional newer signals do not replace the core App
  Attest checks for the current iOS 15 deployment target.

After validation, hash the App Attest key ID with domain separation and insert one
credential row under that unique hash. Repeating enrollment for the same verified key is
an idempotent success; a collision with different verified key material is a conflict.

### Enrollment lifecycle

- Reinstall/key loss creates a new credential and re-enrolls through the same allowlisted,
  consented path while the environment is not emergency-paused.
- A credential can be revoked without redeploying the Worker.
- A revoked key cannot re-enroll. The client must explicitly forget it, generate a new
  key, and leave the revoked row as audit history.
- Development credentials remain separate from production credentials.
- Staging and production have independent `ENROLLMENT_ENABLED` values. Production accepts
  only production App Attest credentials.
- Enrollment abuse is bounded by genuine App Attest proof plus build, bundle, version,
  category, and environment allowlists, pre-proof IP limits, post-proof credential quotas,
  and revocation. Use the global switch only when those controls need an emergency pause.

## Authenticated submission protocol

The existing session/report envelope and gzip transport remain. Authentication wraps
them without changing which bytes are the capture body.

### Challenge request

Request `POST /api/auth/challenge` with purpose (`session` or `report`), App Attest key
ID, and build ID. Apply only an IP rate limit at this unauthenticated stage; a claimed
key ID must not become a targeted-lockout key.

The Worker returns a stateless token containing protocol version, at least 32 random
nonce bytes, purpose, key-ID hash (empty for enrollment), build, server-derived
`env.WORKER_BUILD`, expiry (proposed: two minutes), and the credential's current
assertion counter for submission tokens. It authenticates the canonical token bytes with
HMAC-SHA-256 under the environment's `CAPTURE_AUTH_SECRET`. The Worker stores no
challenge row.

Submission accepts the token only while the stored counter still equals the token's
expected counter, then advances it atomically. A successful use therefore invalidates
the token without a challenge table. Key-ID uniqueness makes repeated enrollment of the
same valid attestation idempotent rather than creating another identity.

Credential status is checked again during submission and in the same conditional counter
update. Revocation therefore takes effect at verification even for a token issued before
the revocation; challenge issuance is never an authorization promise.

### Canonical assertion input

Sign a versioned, unambiguous byte representation. Do not sign ad hoc JSON whose property
order or Unicode treatment may differ between Swift, JavaScript, and the Worker.

The token already authenticates purpose, key ID, build, Worker environment, expiry,
nonce, and expected counter. Repeating those fields in the signed client data creates
more canonicalization paths without adding trust. Version 1 signs only the exact token
and decoded-body hash:

```text
UTF8("DMC-CAPTURE-v1\0")
u32be(tokenByteLength)
UTF8(exactChallengeToken)
decodedBodySHA256Bytes                    // exactly 32 bytes
```

The Worker requires the token purpose to match its fixed `session` or `report` route and
rejects every non-POST method before verification. Build ID is accepted only after the
existing contract check proves `x-dmc-build === meta.buildId`, then it must match the
verified token. No configured base path or raw `url.pathname` enters signed data.

JavaScript assembles these canonical bytes with a shared TypeScript helper and hashes
them with `src/sha256.ts` (WebCrypto with its existing pure-JS fallback). Swift receives
only the resulting 32-byte `clientDataHash` and calls `generateAssertion`. The Worker
independently reconstructs the bytes from its verified token, matched route, decoded
body, and server environment, then hashes them with Workers WebCrypto.

The body hash covers the exact uncompressed UTF-8 JSON bytes produced before optional
gzip. This matches the current `x-dmc-sha256` contract. It deliberately does not hash
gzip wire bytes, whose encoder metadata and compression can vary. The Worker bounds and
decompresses the body, calculates the actual decoded hash, and only then constructs the
assertion input.

### Submission request and processing

Post the existing body and headers plus `x-dmc-challenge-token` and
`x-dmc-assertion`. The token supplies protocol version and credential lookup. Binary
header values use one declared base64url-without-padding encoding.

Worker order is security-relevant:

1. Require `POST`; reject invalid content length and unsupported encoding.
2. Apply the cheap IP rate limit.
3. Read compressed bytes with the current compressed limit.
4. Decode with the current decoded limit; calculate the actual decoded SHA-256.
5. Run existing capture-contract and allowed-build validation.
6. Verify the challenge-token HMAC, purpose, build, and server-owned environment; load
   the active credential by the token's key-ID hash and match its current counter to the
   token's expected counter.
7. Verify App ID, signature, canonical request hash, token expiry, validation category,
   bundle version when present, and a strictly increasing assertion counter.
8. Apply the verified credential/route quota.
9. Reserve that counter with one conditional D1 update whose `WHERE` clause requires
   active status, the expected old counter, and a greater new counter; require one
   changed row.
10. Write R2 and D1 with server-owned authorization data.

One client-side upload coordinator allows only one assertion/upload in flight per
credential, preventing legitimate N+2 requests from arriving before N+1. The server
still rejects an equal or lower counter. A resilience test must queue session and report
uploads concurrently and prove the coordinator preserves order.

No R2 write occurs before step 9. This requires explicitly restructuring today's
`prepareReplay()` and diagnostic-report object puts, which currently write R2 before the
D1 batch. If storage fails afterward, obtain a new challenge token and retry the same
idempotent `run_id` or `report_id`. This favors replay resistance over
reusing proof after an ambiguous failure. Review existing upsert behavior so one
credential cannot overwrite an identifier owned by another.

Authentication failures return a generic external response and a structured, non-secret
server log reason. Never log raw challenge tokens, assertion objects, attestation objects,
or full key IDs.

## Proposed server data model

Add a forward-only migration after `0001_init.sql`. Exact DDL follows the verifier spike,
but the logical model is:

### `app_attest_credentials`

| Column              | Purpose                                                |
| ------------------- | ------------------------------------------------------ |
| `key_id_hash`       | Domain-separated primary key derived from Apple key ID |
| `public_key`        | Verified P-256 public key                              |
| `apple_environment` | `development` or `production`                          |
| `assertion_counter` | Last accepted counter                                  |
| Lifecycle state     | Status and created/last-seen/revoked timestamps        |

No separate principal table or opaque DMC credential ID exists: there are no user
accounts, and the domain-separated key hash is already a stable server identifier. The
Worker validates optional validation-category/bundle-version facts but does not persist
them. It also does not retain or exchange the App Attest fraud-risk receipt in v1; add
that storage and its App Store Connect secret only if fraud metrics become a requirement.

Credential retention is security policy, not gameplay retention. An active credential remains
while active. After revocation, retain the minimum key hash, revoked status, and audit timestamps
for the life of the capture service so the same revoked App Attest key cannot re-enroll. The
manual gameplay-data deletion procedure does not silently remove that deny-list record. If a
tester also asks to stop future submissions, revoke the credential as a separate explicit
operator action and disclose the retained pseudonymous security record in the privacy policy.

### Capture-row changes

Add nullable `submitter_key_id_hash` and decoded capture `sha256` to `sessions`; add
nullable `submitter_key_id_hash` to `diagnostic_reports`, which already stores its capture
SHA. Existing local/test rows remain null, so the migration needs no fabricated non-null
default.

Authenticated sessions become immutable, matching diagnostic reports: a new `run_id`
inserts once; retrying the same owner and SHA is idempotent success; a different owner or
SHA returns `409`. Remote ingest must not use today's broad session
`ON CONFLICT ... DO UPDATE`, which can rewrite history and reset verification state.

`install_id` remains anonymous correlation metadata. Queries and quotas representing
identity move to `submitter_key_id_hash`.

## Native implementation

Create an app-local Capacitor plugin rather than exposing App Attest private-key
operations to JavaScript. Candidate split:

- `ios/App/App/AppAttestPlugin.swift`: `isSupported`, key generation, attestation, and
  assertion methods using `DCAppAttestService`.
- `ios/App/App/MainViewController.swift`: plugin registration, following the existing
  memory-probe pattern.
- iOS entitlements/project settings: enable App Attest and verify signing for direct,
  TestFlight, and production configurations.
- `src/app-attest.ts`: typed Capacitor adapter and error normalization.
- `src/capture-auth.ts`: enrollment/challenge protocol, isolated from game logic.
- `src/capture-policy.ts`: pure eligibility decision.
- `src/capture-sink.ts`: authenticated remote transport after policy approval.

Persist the Apple key ID locally and, only while enrollment is unresolved, its exact
challenge/expiry and attestation object. Clear that pending record after Worker
acknowledgment. JavaScript builds and hashes canonical assertion data as specified above;
Swift only invokes App Attest with the resulting 32-byte hash. Treat unsupported devices,
key invalidation, network failure, and revocation as ordinary upload states with local
fallback. Never downgrade silently to unauthenticated remote upload.

`attestKey` needs Apple's service during enrollment. `generateAssertion` is on-device,
so an Apple-service outage blocks new enrollment but does not block ongoing authenticated
submissions from already-enrolled devices.

Each serialized assertion/upload turn has a 20-second caller deadline. The coordinator
aborts challenge/upload fetches and fences the native continuation before `send`, because
an App Attest callback itself cannot be cancelled. The next queued turn may proceed after
the deadline without allowing the expired turn to upload later.

The compatibility spike must prove attestation-object validation, certificate-path
validation, CBOR decoding, COSE/P-256 conversion, and assertion verification in the
Cloudflare Workers runtime. Use maintained, auditable components and official fixtures
or captured development attestations. Do not hand-roll a general ASN.1/X.509 stack
because a package almost worked. If the runtime cannot support the verifier cleanly,
stop and reconsider the verifier boundary before building client code.

## Consent and offline-queue integration

Enrollment is not consent. The consent surface specified in
`.plans/run-recap-playtest-platform.md` independently determines whether a session or
problem report may upload.

- Default remote consent is unknown/denied; no background remote upload occurs. Local
  developer artifacts do not cross this cloud-consent boundary.
- A deliberate problem report may present its own clear send confirmation.
- Failed/offline completed sessions remain in Capacitor `LibraryNoCloud`, bounded to five
  sessions, 20 MiB of raw envelopes, and seven days. Oldest items are removed first.
- The queue stores no assertion or challenge token; fresh proof is obtained at retry.
- Network, timeout, HTTP 408/425/429, and 5xx failures retry after exponential backoff
  starting at 30 seconds and capped at six hours. One transient failure stops the current
  drain; later items do not stampede the same unavailable transport.
- Authentication, policy, and terminal 4xx failures are removed instead of retried, so a
  revoked credential cannot wedge or churn the queue.
- The Options surface shows the queued count. Disabling automatic upload or withdrawing
  consent stops future attempts and clears queued sessions.
- Automatic upload handles completed human sessions only. Problem reports always require
  a deliberate send, and replay/automation artifacts remain transport-ineligible.
- App Attest errors affect upload state only, never the run, score, or game state machine.

The deletion-request procedure belongs to `.plans/run-recap-playtest-platform.md`, which
owns the product's retention policy and shared-replay reference semantics. This auth plan
supplies `submitter_key_id_hash` for trustworthy ownership lookup but deliberately does not
invent a player-facing delete route. Self-service management is deferred; the small cohort
uses a documented, tested operator procedure when a tester requests deletion.

Choose exact local retention limits with that consent/queue UI, then test under iOS storage
pressure. Product policy keeps D1 session summaries for 365 days, full R2 replays and public
share mappings for 270 days, and diagnostic reports/objects/free-text notes for 90 days.

## Staging and production separation

One Cloudflare account is accepted for now, with these boundaries:

| Concern                   | Staging                                                        | Production                                                                     |
| ------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Worker                    | `dmc-captures-staging`                                         | `dmc-captures`                                                                 |
| D1                        | `dmc-captures-staging`                                         | `dmc-captures`                                                                 |
| R2                        | `dmc-captures-staging`                                         | `dmc-captures`                                                                 |
| Rate-limit namespaces     | 2001-2003                                                      | 3001-3003                                                                      |
| GitHub Environment        | `staging`                                                      | `production`                                                                   |
| Cloudflare API token      | Staging environment secret                                     | Different production environment secret                                        |
| Retrieval bearer          | Staging environment secret                                     | Different production environment secret                                        |
| App Attest credentials    | Staging D1 only                                                | Production D1 only                                                             |
| Challenge HMAC key        | Staging environment secret                                     | Different production environment secret                                        |
| Enrollment switch         | Enabled while Staging capture is offered; emergency pause only | Disabled until Production capture launches, then enabled; emergency pause only |
| Remote development        | May use explicit staging preview bindings                      | Prohibited; dry-run/deployed smoke only                                        |
| Supported deployment path | Qualifying `main` push or manual staging dispatch              | Manual production dispatch only                                                |

Identical GitHub secret names are intentional because GitHub Environments namespace
their values. There must be no repository-level fallback with the same name. Values
already configured are:

- environment secret `CLOUDFLARE_API_TOKEN` in each environment, with different values;
- environment secret `CAPTURE_BEARER_TOKEN` in each environment, with different values;
- environment variable `CLOUDFLARE_ACCOUNT_ID` in each environment;
- production required-reviewer protection.

The job-level deployment switches are repository variables because environment-level
variables are not available while GitHub evaluates whether to start a job:

- `CAPTURE_STAGING_PROVISIONED` enables only the staging mutation job;
- `CAPTURE_PRODUCTION_PROVISIONED` enables only the manually dispatched production job.

Before provisioning, add a different environment secret `CAPTURE_AUTH_SECRET` to each
GitHub Environment and require a non-empty `ALLOWED_BUILDS` Worker variable in each
remote environment. `ALLOWED_BUILDS` is a rolling exact list of distributed
`__DMC_BUILD_ID__` values: add a build before distribution, retain only builds still in
test, and remove retired values during normal deployment. It is rollout hygiene for
first-party clients, not authentication or dependable revocation; revoke the App Attest
key to block a submitter. `ENROLLMENT_ENABLED` is also required and defaults to `false`.
Require `APPLE_BUNDLE_IDS` as an exact comma-separated allowlist. Staging may temporarily
carry reviewed Dev/Staging/legacy identities during migration; production must contain
only `com.phejet.dubaicmd`.
Require `APPLE_BUNDLE_VERSIONS` alongside it as a comma-separated rolling allowlist of
the `CFBundleVersion` values still distributed. TestFlight build numbers overlap during
rollout, so this must not be a scalar baked into the workflow. Require
`APPLE_VALIDATION_CATEGORIES` as a separate comma-separated allowlist matched to the
distribution path: direct development `3`, TestFlight `2`, App Store `4`. Values `0` and
`7` through `9` are invalid or system-reserved and cannot be configured.

Remove the `worker:deploy` package shortcut before production is armed. The supported
production path is the protected GitHub job; an operator with account credentials can
always type a raw Wrangler command, but the repository should not make bypass the
muscle-memory path.

Replace staging preview placeholders with explicit staging preview bindings. Production
has no preview D1/R2 bindings and does not support `wrangler dev --remote`; verify that
the pinned Wrangler version fails that command rather than falling back to production
bindings. Production supports dry-run and deployed smoke tests only. Ordinary development
remains local emulation.

Remove `https://phejet.github.io` from the Worker's default CORS origins while remote web
ingest is deferred. Retain only the Capacitor origin required by native WebView requests.

Give Cloudflare deployment tokens only the Wrangler permissions required for Workers,
D1, R2, and related deployment resources. Useful permissions are generally account
scoped, so separate tokens in one account improve attribution, independent rotation,
and leak response but do not cryptographically block staging credentials from production
resources. Separate Cloudflare accounts remain the hard-isolation option.

## Example working flows

### Local browser

1. Run `npm run dev`.
2. Channel `local` permits only the same-origin Vite capture middleware.
3. Human, replay, bot, and AI testing may produce local artifacts. The policy forbids
   those automated modes from selecting a remote destination.
4. No Cloudflare credentials or internet connection are required.

### Direct iPhone development against staging

1. Build with the explicit staging iOS command.
2. The public staging Worker URL and channel are baked into the bundle.
3. With Staging enrollment enabled, the device creates a development App Attest credential
   and enrolls automatically after explicit consent and policy validation.
4. After consent, each upload obtains a fresh staging challenge token and assertion.
5. Failure leaves the artifact local. The app never falls back to production or to an
   unauthenticated request.

### TestFlight against staging

1. Archive the reviewed commit with channel `staging`.
2. TestFlight uses Apple's production App Attest environment even though its endpoint is
   the staging Worker.
3. Staging accepts that combination only for allowed QA builds while the emergency pause
   is not active.
4. Exercise enrollment, consent, offline retry, revocation, and hostile API tests before
   considering production; verify the parent plan's retention and manual deletion procedure.

### Production promotion and manual approval

1. Identify the exact commit/build that passed staging gates.
2. Build the production mobile artifact from that commit with channel `production` and
   the fixed production Worker URL.
3. Manually run **Deploy Capture Worker** in GitHub Actions with target `production`.
4. An unprivileged preflight job runs `npm ci`, Worker tests, typecheck, and a Wrangler
   deploy dry-run without environment secrets. Only successful preflight releases the
   protected production job to its approval wait.
5. Check repository, workflow, commit SHA, actor, preflight result, and environment.
   Approval authorizes the entire job, not one command.
6. After approval, GitHub exposes production environment secrets to that job. The
   protected job validates credentials, applies production D1 migrations, deploys the
   Worker with the production retrieval and challenge-HMAC secrets, and applies the
   production R2 lifecycle rule.
7. Run controlled health/authentication smoke tests using a designated test credential.
   Do not manufacture an ordinary leaderboard-looking row just to celebrate HTTP 200.

Because migrations currently precede Worker deployment, approval includes both schema
mutation and code deployment. Migrations must be additive and backward-compatible. A
pre-migration test and dry-run gate is mandatory before this workflow may be enabled.
The workflow now contains this preflight and both mutation jobs depend on it.

Self-review prevention is currently disabled because `phejet` is the only collaborator.
The approval remains a deliberate pause and audit event, but it is not two-person
control. Enable `prevent_self_review` when a second trusted reviewer exists.

## Implementation plan

### Phase 1: safety catch and verifier proof — implemented

- Keep `CAPTURE_STAGING_PROVISIONED` and `CAPTURE_PRODUCTION_PROVISIONED` unset until the
  corresponding resources and protected environment values are ready.
- Remove the direct production deploy script, prohibit production remote dev, remove the
  web CORS origin, and add an unprivileged test/typecheck/Wrangler-dry-run preflight job
  required by both mutation jobs.
- Select auditable CBOR/COSE/X.509 components and verify real fixtures under workerd,
  chaining only to the pinned Apple App Attest Root CA.
- Prove attestation, assertion signature, counter, Team ID, bundle ID, AAGUID, and
  development/production behavior without a hand-written certificate stack.

Exit gate: an accidental push cannot deploy, and real App Attest fixtures verify in the
actual Worker runtime.

### Phase 2: local policy and fail-closed server auth — implemented

- Add the closed build channel and pure remote-eligibility policy before endpoint lookup.
- Derive replay execution from artifact provenance, let automation markers override it,
  and add zero-remote-network tests including malicious endpoint injection.
- Add `CAPTURE_AUTH_SECRET`, stateless challenge tokens, the compact token-plus-body-hash
  assertion format, key enrollment/revocation, and the one-table D1 credential model.
- Make `ENROLLMENT_ENABLED`, `ALLOWED_BUILDS`, `APPLE_BUNDLE_IDS`, `APPLE_BUNDLE_VERSIONS`, and
  `APPLE_VALIDATION_CATEGORIES` required/fail-closed remotely; use only IP limits before
  proof and key-hash quotas after proof.
- Reserve assertion counters atomically, move all R2 writes behind reservation, make
  authenticated sessions immutable, and enforce key ownership for both capture types.

Exit gate: local Worker tests prove every unauthenticated/tampered/replayed request leaves
capture D1/R2 unchanged, while local browser and automation behavior never selects cloud.

### Phase 3: native staging vertical slice — direct-development path live

- Provision only staging D1/R2/Worker resources, safe staging preview bindings, lifecycle,
  HMAC secret, required variables, and the staging deployment gate.
- Add App Attest entitlement and Capacitor plugin; persist the Apple key ID; serialize one
  assertion/upload at a time; and implement enrollment, revocation, retry, and local
  artifact fallback.
- Add explicit staging iOS build routing and integrate the parent plan's consent and
  bounded offline queue. Gameplay remains independent of upload success.
- Validate direct development and TestFlight builds separately on physical hardware, keep
  enrollment enabled as Staging's steady state, and run the complete hostile staging matrix.

The direct-development path is live: explicit consent, enrollment, manual submission,
automatic completed-session submission, bounded retry storage, and authenticated replay
retrieval are proven on a physical iPhone with enrollment closed afterward. TestFlight
category `2` remains the uncompleted distribution-path gate.

That closed state was historical rollout choreography. Staging now keeps enrollment enabled
so every genuine allowlisted build can enroll after consent; `false` is reserved for an
emergency pause.

Exit gate: both distribution paths submit consented human runs to staging; replay/bot/AI
gameplay makes no remote request; altered, replayed, or revoked requests fail.

### Phase 4: production promotion

- Provision production resources with no remote-preview bindings; allow only production
  App Attest credentials and reviewed production build IDs.
- Require the parent plan's tiered retention, tested manual deletion-request procedure,
  accessible privacy policy, and app-owned privacy declaration before collecting production
  data. Self-service management UI is not a launch requirement for the current cohort.
- Promote the exact staging-tested commit through preflight and protected manual approval;
  apply additive migration, deploy both Worker secrets, apply lifecycle, then run
  controlled authentication/revocation smoke tests.
- Enable the production client only after server verification. Once Production capture is
  offered, keep enrollment enabled as steady state and use the switch only as an emergency
  pause.

Exit gate: production accepts only consented human iPhone submissions from active App
Attest keys, enforces the parent retention contract, has a proven manual deletion path,
and remains independently disableable.

## Verification matrix

### Policy tests

- `off` never creates a request.
- Local browser uses only the local adapter.
- Production-style local build has capture off.
- Headless simulation has no remote transport.
- Replay playback, bot, AI, and Playwright runs make zero staging/production
  challenge/ingest requests; explicit local artifacts remain possible.
- A malicious endpoint define does not change any result above.
- Transport-level staging tests bypass gameplay policy by invoking the auth client
  directly; no gameplay automation override exists.

### Enrollment attacks

- Enrollment disabled; missing, expired, or wrong-purpose challenge token.
- Invalid certificate chain, nonce, App ID hash, key ID, or AAGUID.
- Invalid validation category/bundle version when extensions are present; supported
  legacy attestation without the newer optional fields.
- Development attestation where only production is allowed, and vice versa.
- Concurrent or replayed enrollment for one valid key creates exactly one credential row
  and returns idempotent success.

### Submission attacks

- Missing, unknown, or revoked credential.
- Expired, wrong-purpose, wrong-credential, and replayed challenge token.
- Assertion replay and out-of-order/equal counter.
- Body substitution after signing.
- Non-POST method, token-purpose/route mismatch, body build/token build mismatch, and
  Worker-environment substitution.
- Gzip body whose decoded SHA differs from the signed SHA.
- Oversized declared, compressed, and decoded bodies, including a gzip bomb.
- Valid credential with disallowed build.
- Cross-credential reuse of `run_id` or `report_id`.
- Concurrent valid-looking requests with the same counter.

Every failure above asserts **zero new capture rows and zero new R2 capture objects**.

### Resilience and product tests

- Apple service unavailable during enrollment, local App Attest unavailable, key
  invalidated, or server offline: gameplay is unchanged and the artifact remains local.
- An already-enrolled key continues generating assertions during an Apple service outage.
- Offline retry obtains a new challenge/assertion rather than persisting old proof.
- Consent denied/withdrawn: zero remote requests.
- Local queued-artifact deletion completes without affecting gameplay state; the manual
  server deletion procedure is verified by its owning product plan.
- Revocation takes effect without Worker redeployment.
- Retention cleanup preserves shared replay blobs still referenced by live rows.

### Deployment tests

- Worker local tests and Wrangler dry-runs for both environments.
- Production remote-development commands fail before acquiring D1/R2 bindings.
- Missing staging or production credentials fail before mutation.
- Staging deployment cannot select production bindings through workflow input.
- Production never deploys on push; manual target and environment approval are required.
- R2 lifecycle applies to the correct bucket in each environment.
- GitHub Pages origins are rejected while remote web ingest is deferred.
- No secret appears in Actions logs or generated artifacts.

## Operations and rollback

- Revoke a suspicious app instance without deploying.
- Rotate the affected environment's Cloudflare token, retrieval bearer, or challenge-HMAC
  secret independently.
- Empty `ALLOWED_BUILDS` is the fail-closed Worker ingest switch; channel `off` is the
  client-side counterpart. `ENROLLMENT_ENABLED` stays true while an environment offers
  capture and changes to false only to pause new credential enrollment during an incident.
- Empty `APPLE_BUNDLE_VERSIONS` also fails closed. Keep every still-distributed
  TestFlight/App Store build number during rollout, then remove retired versions.
- Empty `APPLE_VALIDATION_CATEGORIES` fails closed. Permit only the categories belonging
  to the environment's current distribution paths and remove direct-development category
  `3` before production.
- Roll Worker code back only to a version compatible with already-applied additive
  schema. Never reverse a production migration destructively during an incident.
- Count accepted/rejected enrollments and submissions by safe reason, environment, build,
  and credential without logging proof material or payload contents.
- Alert on sudden growth in auth failures, challenges, per-credential ingest, R2 bytes,
  and D1 rows. Quotas protect cost only if somebody notices the smoke.

## Alternatives considered

### Static API key in the app

Rejected. An open-source bundle exposes it once, after which every script is the app.
Rotation also forces a client release.

### CORS plus build/install headers

Retained only as defense-in-depth and metadata validation. Non-browser clients can set
headers freely, and CORS is enforced by browsers rather than the Worker.

### Anonymous public ingest with rate limits

Deferred for a future web product, not accepted for the current private iPhone scope.
IP limits reduce cost; they do not establish identity or prevent distributed spam.

### Shared Cloudflare deployment token

Rejected. Separate environment tokens improve auditing and independent revocation even
though one Cloudflare account limits resource isolation.

### Separate Cloudflare accounts immediately

Deferred. It is the strongest staging/production boundary, but its overhead is not
justified yet. The same-account limitation is explicit and accepted.

### App Attest as leaderboard verification

Rejected. App Attest raises confidence that a genuine app instance sent the request; it
does not prove honest gameplay. Deterministic server replay remains the authority.

### A second application-invitation system

Rejected for the private phase. Development signing and private TestFlight distribution
already control build access; a fail-closed enrollment window is enough. Reconsider
enrollment abuse controls only before public App Store distribution.

## Open review questions

1. Can the chosen Worker-compatible verifier perform strict Apple certificate-path,
   CBOR/COSE, nonce, AAGUID, and assertion validation without unsafe custom parsing?
2. Should direct developer-signed builds be allowed to target production? Recommended:
   no; development attestation is staging-only.
3. Is a two-minute challenge expiry suitable for mobile networks, or should it be longer
   with stricter creation quotas?
4. What credential/session/report quotas fit the first real traffic measurements?
5. Should a later phase enable Apple's receipt-based fraud-risk service, and what secret,
   privacy, and retention work would that require?
6. What local queue byte/count/age limits fit iPhone storage behavior?
7. At what cohort or support threshold should manual deletion be replaced by self-service
   upload management?
8. Should migration and deploy have separate production approvals, or is one approval
   over an additive reviewed job the desired unit?
9. At what traffic/team threshold should production move to a separate Cloudflare
   account and two-person approval?

### Physical validation-category gate

Apple's current server-validation article enumerates `apple_validation_category_01`:
`1` operating-system executable, `2` TestFlight, `3` development-signed, `4` App Store,
`5` enterprise/ad-hoc, `6` Developer ID, and `10` other code-signing identities. The
Worker uses an explicit environment-scoped allowlist rather than a universal value.
Direct-development staging uses category `3`; TestFlight and App Store promotion must
separately prove and allow categories `2` and `4`. Unknown, invalid, and system-reserved
values remain fail-closed.

## Authoritative references

- Apple, [Validating apps that connect to your server](https://developer.apple.com/documentation/devicecheck/validating-apps-that-connect-to-your-server)
- Apple, [Establishing your app's integrity](https://developer.apple.com/documentation/devicecheck/establishing-your-app-s-integrity)
- Apple, [Preparing to use the App Attest service](https://developer.apple.com/documentation/devicecheck/preparing-to-use-the-app-attest-service)
- Apple, [Attestation object validation guide](https://developer.apple.com/documentation/devicecheck/attestation-object-validation-guide)
- Cloudflare, [Deploy with GitHub Actions](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/)
- Cloudflare, [Wrangler configuration](https://developers.cloudflare.com/workers/wrangler/configuration/)
- Cloudflare, [D1 Database API](https://developers.cloudflare.com/d1/worker-api/d1-database/)
- GitHub, [Deployments and environments](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments)

Related local documents:

- [`capture-worker-backend-plan.md`](./capture-worker-backend-plan.md)
- [`capture-session-report-split-plan.md`](./capture-session-report-split-plan.md)
- [`replay-system.md`](./replay-system.md)
- [`build-targets.md`](./build-targets.md)
