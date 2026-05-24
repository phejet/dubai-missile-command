# Run Recap & Playtest Platform — Design Brain Dump

Status: design discussion, not yet committed to implementation
Date captured: 2026-05-24
Source: extended brainstorm conversation; this is the canonical record so we
don't lose context between sessions.

---

## 0. Origin of the problem

The game-over screen is overloaded. Currently shown (all at once):

- Score, Waves, Total Kills, Shots Fired, Hit Ratio, Multi Shots (6 stat
  cards in a grid)
- "Destroyed by Type" breakdown — up to 8 rows
  (Missiles / MIRVs / MIRV warheads / Stacked / Bombs / Shahed-136 /
  Shahed-238 / Other)
- Action buttons: Title Menu, Upgrade Graph, Retry, (sometimes) Watch
  Replay

It reads like a SQL report instead of an after-action moment. Late-wave
runs with diverse threats fill every breakdown row and the panel becomes a
wall of numbers.

Code references:

- `src/ui.ts` `showGameOver()` around line 712
- `index.html` `#gameover-panel` around line 179
- `renderDestroyedTypeRows()` `src/ui.ts` ~line 262
- The Upgrade Graph button currently calls `showUpgradeProgression()`
  (`src/ui.ts` ~line 752)

---

## 1. The agreed direction — repurpose "Upgrade Graph" into "Run Recap"

The Game Over screen becomes pure hero numbers + actions. Detail lives
behind a single "Run Recap" surface that replaces the current Upgrade
Graph button on the game-over panel.

### Game Over screen (after change)

Keep it ruthlessly compact. Three hero stats only:

- **Score**
- **Wave reached**
- **Hit Ratio**

Action buttons (vertical stack, unchanged behavior):

- Title Menu
- **Run Recap** (was: Upgrade Graph)
- Retry
- Watch Replay (when available)

### Run Recap surface (the new screen)

Everything analytic moves here. Content blocks:

1. **Hero summary band** — Score, Wave, Hit Ratio, Time Played, outcome
   ("Burj destroyed" / "All launchers down" / "Survived to wave N").
2. **Kill distribution as a stacked bar** — one horizontal proportional
   bar segmented by threat type, color-coded. Tap/hover → counts. Replaces
   the 8-row enumerated list. Scales fine as new threat types are added.
3. **Wave-by-wave timeline** — per-wave score earned, threats faced,
   upgrade purchases marked along the timeline. Death point clearly
   indicated.
4. **Upgrade decisions panel** — what was bought, in what order, at what
   cost. Helps the player see their build path; helps the dev see common
   builds.
5. **"Watch how you died" inline** — auto-play of the last ~5 seconds of
   the run in slight slow-motion. No share, no upload required. Pure
   catharsis ("oh, _that's_ what got me").
6. **Detailed stats accordion** (collapsed by default) — Shots Fired,
   Multi Shots, Max Combo, per-threat-type counts, any other granular
   numbers the data-nerds want.
7. **Actions** — Save Replay (iOS share sheet), Watch Replay (full
   playback), back to Game Over.

The Upgrade Graph itself is still reachable from the Title Menu (for
strategic planning between runs); it just stops being the post-death
default surface.

---

## 2. Reconstructing recap from replay — the seam

Replays in this codebase are **inputs + seed + action log**, not derived
statistics (see `src/replay.js`, `src/headless/sim-runner.js`). Therefore:

- **In-app, right after death**: the sim _just_ ran. All recap stats are
  already in memory. Snapshot what's there — no re-derivation needed.
- **Server-side later, from an uploaded replay**: re-run the sim
  headlessly to extract whatever signals we want.

**Key superpower**: we can add new metrics later and re-derive them
against old replays. Today's client doesn't have to compute everything
right now; the replay blob is the source of truth and the summary is the
fast-path snapshot.

**Implication for upload payload**: send **replay blob + small
precomputed summary**. Summary keeps queries cheap; blob keeps the door
open for future analysis.

---

## 3. The bigger picture this slots into

The user wants to release the game to TestFlight playtesters, collect
data on how people play and get stuck, and possibly offer "share your
run" links that play in a browser. The Run Recap is the surface
through which all of this is viewed, so it has to land first.

Three intertwined feature families:

1. **Run Recap** (local, no backend) — the post-death UI
2. **Playtest reports** (formerly "telemetry") — opt-in uploads of replays
   - small session summaries
3. **Viral share-link** — a tester taps "Share my run" → short URL → friend
   opens it in a browser → replay plays → CTA to play themselves

A possible fourth feature, **global leaderboard**, is deferred until
there are enough players to make it meaningful (~20+ installs).

---

## 4. The share-link flow — the secret weapon

```
Death screen → Run Recap → "Share my run"
    → upload replay → short link (e.g. dmc.gg/r/x7k2qp)
    → friend taps in iMessage → opens game URL with ?r=x7k2qp
    → web build fetches replay, auto-plays
    → replay ends → "Wave 14 · 124,580 — think you can beat it?" → Play
```

Why this is structurally important:

- The web build is already on GitHub Pages
- The replay system is already deterministic and runs in the browser
- `window.__loadReplay()` already accepts JSON
- This means the share-link is ~80% plumbing, not new game code

Crucially, making **share** the dominant upload path collapses the
consent story:

> "Share my run" = explicit per-action upload. No toggle, no settings
> page, no compliance theatre.

Anonymous telemetry then becomes a secondary opt-in path on the _same_
infrastructure. The viral hook _justifies_ the data collection rather
than being grafted onto it.

### Web/iOS parity caveat

Web is comparable to iOS in quality, with slightly different controls
(mouse vs touch). Mouse aim is meaningfully more precise. This is fine
for the watch-and-try use case but means competitive leaderboards need
platform segmentation (see §10).

### Install CTAs (platform-aware)

The web build is a great discovery surface but iOS is the deeper
experience. Add CTAs intelligently:

- **iOS Safari** → "Install on iOS" → TestFlight invite URL (or PWA Add to
  Home Screen)
- **Android Chrome** → PWA install prompt, or "Coming soon"
- **Desktop** → "Best on phone" + QR code linking to TestFlight invite
- **Already in Capacitor** → no CTA

Timing matters: _don't_ fire the install CTA before the friend has
played a wave. Surface it on the post-game screen, at the emotional
peak. Premature CTAs feel like ads.

### PWA as a sleeper option

Capacitor wraps the same web build. With a `manifest.json` + service
worker, the web version becomes installable to home screen — bypasses
TestFlight entirely for friends who just want to try the game _right
now_. Two install paths: TestFlight for the polished native build, PWA
for friction-free trial. Worth at minimum stamping a manifest and an
icon.

---

## 5. Consent model — two tiers by audience

User's call, agreed: **trust ladder mapped to UX**.

- **Friends & family**: "Opt in to share **all** game sessions from this
  device." One-time toggle, then everything auto-uploads.
- **Wider TestFlight / public**: "Share **this** single session." Per-
  action explicit consent every time. The share button is the trigger.

Build-channel approach (open question — see §13): probably **single
build with a settings toggle**, default OFF, shown to all testers.
Friends are verbally pointed at it during onboarding; wider testers
either don't notice it or self-promote. Avoids the build matrix hell
of two TestFlight tracks.

### What auto-stream requires (beyond a toggle)

If we tell a friend "everything goes up," we owe them:

- **Per-install random ID** generated once, stored in keychain. No Apple
  ID, no device fingerprint, nothing reversible.
- **Optional friendly self-naming** ("It's Mike") so we can ask "what
  happened in the wave 6 run?" without quoting install IDs.
- **"Recent uploads" list in settings** with timestamps and a working
  "Delete from server" button (Worker endpoint that actually nukes the
  R2 object). Even if nobody uses it, its existence is the honest
  signal.
- **Offline queue** — session ends in flight mode → replay stored
  locally → uploads on next launch with network. Otherwise we lose the
  most interesting sessions (the rage-quits on a train).
- **Persistent "auto-share is on" indicator** — a small dot somewhere,
  not a nag. Friends will forget.
- **Per-launch rate cap** — even friends shouldn't upload 200 sessions a
  day. Cap at ~50/day per install. Sanity check.

### De-dupe between paths

If a friend with auto-stream on also taps "Share with friend," don't
double-upload. The share button mints a short link pointing at the
already-streamed session ID.

### Keep the wider tier strictly binary

Don't add "and the next 5 sessions" to single-share flow. That's scope
creep that turns explicit consent into mush. A wider tester who loves
the game can become a friend and flip the toggle.

### The honest warning

Auto-share only works if we **actually look at the data**. Set up the
firehose, check it twice, friend notices their effort goes into a void,
favor burned, data poisoned. Commit to reviewing every session for the
first two weeks, or this feature is theatre.

### Post-session feedback prompt

After the recap, optional one-tap reaction: 😊 / 😐 / 😤. Ships with
the replay. Nobody writes paragraphs after dying. They'll tap an emoji.
(Text field is _optional_ on top of that for the rare detailed-feedback
person; emoji is the floor.)

---

## 6. Apple — how they feel about this

Apple doesn't care **where** the data lives. They care a lot about
**how it's disclosed.** Three concrete requirements either way:

1. **Privacy Manifest** (`PrivacyInfo.xcprivacy`) — required since iOS 17. Declares data types collected, why, and any Required Reason APIs
   used. Capacitor projects need it too.
2. **App Privacy questionnaire** in App Store Connect — applies to
   External TestFlight (Internal TestFlight skips Beta App Review but
   you still answer the questions before going External).
3. **Privacy policy URL** — required even for TestFlight-only if you
   collect anything.

**ATT prompt is NOT needed** as long as the install ID stays inside
this app and isn't linked to data from other companies' apps/sites.
Anonymous per-install random ID = not "tracking" by Apple's definition.

### Apple privacy questionnaire — anticipated answers

- **Data linked to user**: none. Random install ID is "Data not linked
  to user" because it can't be reversed to identity.
- **Data collection types**: Diagnostics (session metadata + replay) and
  optionally User Content (feedback emoji / note field).
- **Tracking**: No (not shared with third parties).

Boring, declarative, no horror stories.

---

## 7. Backend — own infra vs Apple infra

### Could use CloudKit

- Zero backend to maintain
- Free tier handles thousands of users
- Apple ID auth built-in; developer only sees opaque record IDs
- Almost zero App Review friction
- Per-user identity comes for free

### Why CloudKit doesn't fit _this_ app

The viral share-link flow is web-first. A friend opening a link in
their browser shouldn't have to sign in with Apple ID — that torpedoes
the loop. And it doesn't help Android users at all. We'd end up with
_two_ backends: CloudKit for iOS auto-stream, our own infra for the
public web path. Double the ops, guaranteed sync inconsistencies.

### Recommendation: **Cloudflare Worker + R2 + D1**, single stack

- Worker free tier: 100k requests/day
- R2 free tier: 10 GB storage, **no egress fees** (matters for replay
  downloads)
- D1 free tier: 5 GB
- One backend, one schema, one mental model
- AI inspection of trends is trivial — query D1 or dump to JSON
- Works for Android + web + iOS from day one
- Easy to migrate later if outgrown (we won't be)

Cost at TestFlight scale: **$0/month**. At "this game went mildly
viral" scale: maybe $5/month. The custom domain ($15/yr) will cost
more than the infra.

**Important reassurance**: "own infra" in this stack does **not** mean
a server to maintain. There's no OS to patch, no scaling to configure,
no uptime to babysit. `wrangler deploy` and walk away. Closer to
CloudKit's ops burden than to anything resembling a VPS.

### Short-link infrastructure

Don't roll a separate URL shortener. The Worker that handles
`POST /share` returns a short ID (6 random chars: `x7k2qp`). The same
Worker serves `GET /r/x7k2qp` → redirect to game URL with the ID
baked in. R2 object key = the short ID. Total surface: one Worker,
two routes.

### OG / social preview cards

When the link is pasted in iMessage/Discord, we want a real unfurled
card: "Wave 14 · 124,580 · 47% accuracy" with a screenshot/sprite.
Otherwise it looks like spam. Worker serves dynamic HTML with
`og:image` pointing at a generated thumbnail. Even a static well-
designed image with overlaid text via canvas-in-Worker beats a naked
link. Deferred until first share happens.

### Abuse / spam controls

Public anonymous upload endpoint = someone will eventually try to
flood it. Mitigations:

- Per-IP rate limit at the Worker
- Size cap (replays are tiny — cap at 256 KB)
- HMAC token from running game, signed by a key embedded in the build
  (security-by-obscurity but raises the bar enough to deter casual
  abuse)

### Retention policy from day one

- Auto-delete shared replays after **1 year**
- Auto-delete auto-streamed telemetry replays after **90 days**
- Discipline is cheaper than storage; both are cheap

---

## 8. Replay versioning — the long-term commitment

Every shared link is a contract: "this replay will play in the
future." Schema changes to actions or sim constants break old
replays.

Three options:

1. **Versioned web builds (recommend short-term)**. Stamp build version
   into the replay. Share link routes `?r=...&v=42` to the matching
   archived web build on Pages. Cheap, simple, links don't rot.
2. **Pre-render replays to MP4/GIF**. Worker renders each shared
   replay to video once. Durable forever, decouples viewing from sim
   version. More infra and bigger storage but bulletproof.
3. **Accept short-lived links**. Replays only guaranteed playable for
   current build. Honest, zero extra work, but a shared link from last
   month might break.

Go with **option 1** initially; switch to option 2 if/when the game
gets real traction.

---

## 9. Storage of derived stats vs replays — the schema

The session summary table is the single source of structured truth.
Approximate D1 schema:

```sql
CREATE TABLE sessions (
  id            TEXT PRIMARY KEY,           -- short ID, also R2 key prefix
  install_id    TEXT NOT NULL,              -- anonymous per-install UUID
  display_name  TEXT,                       -- optional friendly name
  build         TEXT NOT NULL,              -- sim version stamp
  platform      TEXT NOT NULL,              -- ios / web-touch / web-mouse / android
  created_at    INTEGER NOT NULL,           -- epoch ms

  -- outcome
  outcome       TEXT NOT NULL,              -- completed / abandoned / died
  death_cause   TEXT,                       -- burj_destroyed / launchers_down / ...
  wave_reached  INTEGER NOT NULL,
  score         INTEGER NOT NULL,
  time_played_ms INTEGER NOT NULL,

  -- derived from sim
  shots_fired   INTEGER NOT NULL,
  total_kills   INTEGER NOT NULL,
  hit_ratio     REAL NOT NULL,
  multi_shots   INTEGER NOT NULL,
  max_combo     INTEGER NOT NULL,
  destroyed_by_type_json TEXT NOT NULL,

  -- upgrades chosen in order
  upgrades_json TEXT NOT NULL,

  -- feedback
  feedback_emoji TEXT,                       -- 😊 | 😐 | 😤 | NULL
  feedback_note  TEXT,                       -- optional free text

  -- replay
  replay_size   INTEGER,
  replay_valid  INTEGER NOT NULL DEFAULT 1,  -- 0 if re-derivation failed

  -- share state
  shared        INTEGER NOT NULL DEFAULT 0,  -- 1 if exposed via short link
  source        TEXT NOT NULL                -- "share" | "auto-stream"
);

CREATE INDEX idx_sessions_install ON sessions(install_id, created_at DESC);
CREATE INDEX idx_sessions_leaderboard ON sessions(build, score DESC) WHERE replay_valid = 1;
CREATE INDEX idx_sessions_recent ON sessions(created_at DESC);
```

Replay blobs live in R2 under `replays/<id>.json.gz` (gzipped). The
`id` column is also the short link slug — no separate mapping table.

This is also basically the **leaderboard** table. When the
leaderboard ships, it's a query over this same table.

---

## 10. Leaderboard (deferred but designed)

Don't build the leaderboard until **20+ unique installs exist**. A
4-entry leaderboard with three of your own runs is depressing. Infra
is the same; only the _button_ in the UI is deferred.

### Killer property — replay-verified scores

Because the sim is deterministic, **every submitted score is
verifiable**:

1. Player submits → server queues replay validation
2. Headless sim (`src/headless/sim-runner.js`) re-runs the replay
3. If final score doesn't match submission → reject (`replay_valid = 0`)
4. Otherwise → eligible for leaderboard

Most mobile games can't do this. We get it nearly free because the sim
is already deterministic and replay-driven.

### Killer UX consequence

**Every leaderboard entry has a watchable replay attached.** Tap a
score → watch the run. Almost nobody else does this in this genre. It
also closes the viral loop perfectly: leaderboard browsing IS replay
browsing IS share-link generation.

### Platform segmentation question (open)

Mouse aim is meaningfully easier than touch. Options:

- **iOS-only canonical board** — cleanest, prioritizes the audience we
  care about, web is for watching not competing
- **Separate boards per input class** — touch vs mouse, honest but
  fragmenting
- **Unified board with platform icons** — simplest, top will skew
  desktop

User leaned toward asking the question later — defer until 20+ installs.

### Time windows

A single all-time leaderboard goes stale. Standard pattern:
**All-time / This week / Today**, with weekly resets. Schema already
captures `created_at`.

### Per-build comparability

Every balance change invalidates the comparability of old scores. A
score from build 42 means something different than a score from build 50. Either bucket leaderboards by build (fragmenting) or reset weekly
(cheap, conventional). Lean toward weekly resets + build column in the
data for filtering.

### Display name / identity

Anonymous install IDs are fine for telemetry, bad for leaderboards.
Need optional self-naming. No auth — just a display name stored per
device, editable in settings, no uniqueness enforcement (two "Mike"s
coexist). Profanity filter is its own rabbit hole; punt until needed.

### Game Center as complement (not replacement)

iOS scores can _also_ push to Apple Game Center alongside our own
leaderboard. Costs nothing, gives Apple-natives a familiar surface,
appears in their friends list. Our own leaderboard is the canonical
one (because of replays + cross-platform); Game Center is convenience.
Not either/or.

---

## 11. AI inspection — keep it simple

"AI/Claude analyzes trends over time" sounds great. In practice we
need (a) enough data, (b) good questions, (c) time to act. Honest
expectation: we'll **manually spot-check 20 replays after each build
for the first month** and get 80% of the insight that way. The AI
layer is dessert.

Build it as: **the data is queryable; when I want trends I ask
Claude/an LLM to look.** Not a dashboard, not a pipeline. D1 dump →
prompt → answer.

Concrete first questions worth asking:

- Which wave do most testers die on?
- What's the median upgrade-purchase order?
- Are testers using the Shop or just retrying?
- Do specific upgrade combos correlate with longer runs?
- What's the abandonment rate per wave (rage quits vs wins)?

---

## 12. Anomaly detection — the unsung helper

Don't make ourselves sift 100 normal replays to find the one weird
one. Server-side, when a replay is uploaded, compare its stats to
recent norms. Flag anything unusual:

- Death within 30 seconds
- Outlier score (top 1% or bottom 1%)
- Unusual upgrade path (combination almost no-one else picks)
- Impossible accuracy (potential cheat or bug)
- Mid-session abandonment after a specific event

Surface flagged sessions to a "Needs review" queue in the dashboard.
Could be a bug, could be cheating, could be a design insight. Almost
always interesting.

Cheap to implement: a few SQL queries scheduled or computed at upload
time.

---

## 13. Things that need decisions when each phase lands

- **Build channel approach** (leaning toward single build + settings
  toggle, default OFF; ask again at Phase 2)
- **Backend platform**: Cloudflare stack (current recommendation)
- **Custom short domain**: probably yes at Phase 3 (`dmc.gg` or
  similar, ~$15/yr); start on `dmc-share.workers.dev` for testing
- **PWA support**: yes, stamp manifest at Phase 1 even before Phase 4
- **Platform leaderboard segmentation**: defer to when leaderboard ships
- **Replay versioning strategy**: versioned web builds initially
- **Apple Game Center**: optional polish, very late

---

## 14. Things flagged and consciously deferred

- **Multi-language support** — not yet a concern
- **Achievements / badges** — could be cute, very late
- **Asynchronous co-op** (player A dies, player B picks up via replay)
  — architecturally possible, scope creep land
- **Replay scrubbing UI** — nice but not MVP
- **Frame-tagged replay annotations** ("I didn't know I could shoot
  this") — best-possible feedback signal, but only useful once there's
  a steady stream of replays to annotate. Build it after auto-stream
  exists.
- **Leaderboard moderation / profanity filter** — only when display
  names exist and there are >20 installs
- **GDPR data subject requests** — current opt-in + delete-from-server
  button covers most of this; revisit if EU testers join

---

## 15. Fresh ideas the architecture quietly enables

Captured for the future, with the user's clarifications:

### Ghost runs (with the right framing)

Show a translucent overlay of a previous best run's missile trails
during a new attempt. Self-competitive, free given replays.

**User clarification: this only makes sense with a fixed seed.**
Otherwise the ghost's threats spawn differently than yours and the
overlay is meaningless. So ghost runs pair naturally with **Daily
Challenge mode** — same seed for everyone that day, ghost overlay shows
your previous attempt against the same seed. Don't try to do ghosts in
normal randomized play.

### Daily Challenge

Publish a seed each morning. Everyone plays identical enemy spawns.
Apples-to-apples leaderboard, way more compelling than a generic one.
The deterministic sim makes this trivial. Combined with ghost runs:
"see your previous attempt against today's seed" is a tight, repeat-
visit-inducing loop.

### "Watch how you died" inline

Auto-play the last ~5 seconds of the run in slow-motion on the recap
screen. No share, no upload. Pure catharsis. Zero ops. High emotional
value. **In MVP.**

### Anomaly detection

See §12. Surface unusual replays automatically instead of sifting
manually.

### Replay annotations

Tester pauses a replay at a specific frame, taps to add a comment
("I didn't know I could shoot this"). Comments come back to the dev
tagged to that exact tick. Highest-signal feedback mechanism we could
build. Deferred until Phase 4+.

---

## 16. Risks and downsides — the unvarnished honest read

- **Scope drift** — this conversation started with "the game over
  screen is overloaded" and is now sketching a viral playtest
  platform. The game itself is still being tuned (recent commits are
  all Patriot timing fixes). Infrastructure on top of an unfinished
  game is a classic indie death spiral.
- **Viral loop assumes share-worthy experience** — without engaged
  players and friends who actually convert, the share button is fancy
  plumbing for nothing. Build for the first 10 people; assume nothing.
- **Community-management tax** — public uploads = moderation, names =
  profanity filter, leaderboards = arms races, hosted replays =
  delete-my-data emails. Real ongoing work, not a one-shot build.
- **Balance changes invalidate replay comparability** — any
  leaderboard scheme has to account for build version, weekly resets,
  or both.
- **AI trend inspection is the most hand-wavy part** — manual spot-
  checking will outperform any pipeline for the first ~50 sessions.
  Don't over-build.
- **TestFlight expiration (90 days) + tester churn** — assume bursty,
  low-volume data, not a steady stream.
- **Replay schema is a long-term commitment** — every shared link is a
  contract. Versioning hygiene matters from day one.

### Philosophical pause — what kind of game is this?

Leaderboards signal "competitive game." Missile Command historically
has a meditative arcade identity. A leaderboard reframes the game's
identity. The share-link is intimate ("watch what I did"); the
leaderboard is competitive ("beat me"). Worth a deliberate decision,
not a drift.

---

## 17. Build order — the locked roadmap

Each step ships and is useful on its own. Don't skip ahead.

### Phase 1 — Run Recap (local only, no backend)

**This is the MVP.** Status: agreed, ready to spec out.

What ships:

1. Game Over screen reduced to **Score, Wave, Hit Ratio** + actions
2. New Run Recap surface (replaces Upgrade Graph button on game-over)
3. Stacked-bar kill distribution viz (replaces 8-row table)
4. Wave-by-wave timeline with upgrade purchase markers
5. "Watch how you died" — last 5 seconds in slow-mo, inline
6. Detailed stats accordion (collapsed by default)
7. "Save Replay" via iOS share sheet — file goes to Files / iCloud /
   AirDrop, no backend involved
8. Upgrade Graph still reachable from Title Menu

**Why first**: every uploaded artifact will be viewed through this
surface. If it sucks, nothing else matters. Also tests the hypothesis
_do players actually care about replays?_ If no one opens their own
runs, we don't need any of the rest.

**Suggested concurrent low-cost adds**: PWA manifest + icon (lays the
groundwork for the web "install" path later).

### Phase 2 — Backend skeleton

Cloudflare Worker + R2 + D1. No game features yet. Just:

- `POST /share` accepts a replay, returns short ID
- `GET /r/<id>` redirects to game URL with `?r=<id>`
- `GET /api/replay/<id>` serves the replay blob
- Schema from §9 deployed to D1
- Per-IP rate limit, size cap, HMAC token check

Validate with `curl` before any game UI talks to it.

### Phase 3 — Share-link flow (the first viral feature)

- "Share my run" button on Run Recap → uploads → native share sheet
- Web build reads `?r=...` on boot → fetches → calls
  `window.__loadReplay()`
- Post-replay CTA screen: "Wave X · Score Y — your turn"
- Install CTA logic (platform-aware, see §4)
- OG preview cards (defer until first share happens if needed)

### Phase 4 — Auto-stream toggle (friends mode)

- Settings toggle, default OFF
- Per-install anonymous UUID in keychain
- Optional friendly display name
- "Recent uploads" list with delete-from-server button
- Offline upload queue
- Persistent "auto-share on" indicator
- Per-session emoji feedback prompt on recap
- De-dupe: share-button reuses already-streamed session ID

### Phase 5 — Leaderboard (only when 20+ installs exist)

- Top runs by Score (all-time / this week / today)
- Tap entry → watch replay
- Replay-verified score validation server-side
- Platform segmentation decision (see §10)
- Daily Challenge mode + ghost runs (per user's clarification, these
  belong here, not in normal play)
- Game Center push for iOS (optional polish)

### Phase 6 — AI inspection

- Ad-hoc: dump D1 to JSON, ask Claude/an LLM about trends
- Anomaly detection queries (auto-flag unusual sessions)
- Replay annotation feature for testers
- This stays manual/lightweight unless a real volume problem appears

### Phase 7 — Polish, late additions

- OG preview cards with generated thumbnails
- Custom short domain (`dmc.gg` or similar)
- Apple Game Center
- Achievements
- Whatever else seems valuable in light of actual usage data

---

## 18. What to ship in the next two weeks

Pure Phase 1, no infrastructure:

1. **Run Recap screen** with stacked-bar kill viz + wave-by-wave
   timeline + upgrade timeline + detailed stats accordion
2. **"Watch how you died"** 5-second slow-mo inline on the recap
3. **"Save replay to Files"** via iOS share sheet (Capacitor Share +
   Filesystem plugins or native UIActivityViewController bridge)
4. Reduce game-over panel to Score / Wave / Hit Ratio + actions
5. Stamp PWA manifest + icon (free hedge for later phases)

Tests the hypothesis cheaply. If players engage with their own
replays we've earned the right to build Phase 2. If they don't, we
just saved ourselves a month of backend work.

---

## 19. Open questions to revisit when each phase starts

- Phase 2 backend kickoff:
  - Which custom short domain (if any) to register
  - Whether to ship `wrangler` config to the repo or keep it private
- Phase 3 share-link:
  - Exact post-replay CTA copy / design
  - Whether to also build the desktop QR-code CTA on day one
- Phase 4 auto-stream:
  - Confirm build-channel approach (single build + toggle is current
    favorite)
  - Daily/per-install rate cap value
- Phase 5 leaderboard:
  - Platform segmentation strategy (defer until then)
  - Weekly reset vs build-bucketing
- Phase 6 AI:
  - Whether anomaly flagging warrants a tiny dashboard or stays
    query-only

---

## 20. Pointers into the existing codebase

For whoever picks this up (likely future-me / future-Claude):

- Game Over screen: `src/ui.ts` `showGameOver()` ~line 712,
  `#gameover-panel` in `index.html` ~line 179
- Upgrade Graph: `src/ui.ts` `showUpgradeProgression()` ~line 752
- Stats produced by sim: `gameRef.current.stats` (see CLAUDE.md
  "Game state" section)
- Destroyed-by-type breakdown: `DESTROYED_TYPE_KEYS` /
  `DESTROYED_TYPE_LABELS` in `src/ui.ts`
- Replay system: `src/replay.js`, deterministic via seeded RNG in
  `src/game-logic.js`
- Headless sim runner: `src/headless/sim-runner.js`
- Existing share / replay loader: `window.__loadReplay()` (see
  CLAUDE.md "Replay system")
- iOS Capacitor build: `npm run ios` (also `npm run ios:deploy`,
  `npm run ios:install`)
- Capacitor Share plugin will need to be added; Filesystem plugin
  already configured per existing Capacitor scripts

---

## Appendix A — How we got here (reasoning trail)

This is the dialogue arc, fork by fork: what the user proposed, what
Claude pushed back on or recommended, and what tipped each decision.
Useful for future sessions where the question "why did we land here?"
matters more than the decision itself — especially if circumstances
change and a decision needs to be revisited.

### Fork 1 — How to fix the overloaded Game Over screen

**User**: "End of game screen is overloaded. Maybe a separate 'Show
stats' button. Other ideas?"

**Claude's reasoning**: Diagnosed the screen as 6 stat cards + 8
destroyed-by-type rows + 4 buttons crammed together — not an
after-action moment, a SQL report. Surfaced three options ranked by
ambition: (1) hero stats + collapsible details, (2) replace 8-row
list with a stacked-bar viz, (3) move full breakdown into the
renamed Upgrade Graph button. Recommended #1+#2 combined.

**Tipping point**: User picked **#3** — the most aggressive option —
because it slots naturally into a larger vision they were already
forming about playtest replays and shareable runs. The Game Over
screen becomes pure hero numbers + actions; everything analytic
moves to a dedicated surface.

**Why this matters going forward**: The "Run Recap" surface is now
load-bearing for every downstream feature. If it sucks, the share
links suck, the leaderboard sucks, the AI inspection has nothing
beautiful to point people at. That's why it's Phase 1 with no
infrastructure attached.

### Fork 2 — Is the recap reconstructible from a replay?

**User**: Asked whether the recap can be reconstructed from replay
data so that uploaded runs can be analyzed later, both visually and
by AI.

**Claude's reasoning**: Walked the user through the seam: replays
are _inputs + seed + actions_, not derived statistics. To get the
recap you re-run the sim. Two flavors:

- In-app at end of run → stats are already in memory, just snapshot
- Server-side later → headless re-run extracts whatever signals
  you want, _including new ones you didn't know you wanted at
  upload time_

**Tipping point**: The "add metrics retroactively" property convinced
both sides this was the right architectural seam. Replay = source of
truth, summary = fast-path snapshot. Send both at upload.

**Why this matters going forward**: This is why Phase 2 schema
stores both the structured summary (queryable) and the replay blob
(re-derivable). Don't drop the blob to save bytes — it's the
optionality that justifies the whole system.

### Fork 3 — The viral share-link idea

**User**: "We can even expand it later to share-with-friends link —
short link, friend clicks, replay plays in browser, friend plays the
game themselves."

**Claude's reasoning**: Got genuinely enthusiastic because (a) the
viral mechanic is the strongest possible justification for the whole
upload pipeline, and (b) it re-frames the consent story from "we
collect data" (compliance theatre) to "share my run" (per-action
opt-in nobody can object to). Pointed out the web build already
exists, the replay system is already browser-native, and
`window.__loadReplay()` already accepts JSON — making this ~80%
plumbing, not new game code.

**Tipping point**: The re-framing of consent. Share-as-upload turns
the privacy story from a fight into a feature. Auto-stream
telemetry becomes a secondary opt-in layered on the same infra,
rather than the primary thing users must agree to.

**Why this matters going forward**: This is why the build order
puts share-link (Phase 3) before auto-stream (Phase 4) — even
though the auto-stream is technically simpler. Share-link is the
user-visible feature that justifies everything else.

### Fork 4 — Two-tier consent model

**User**: "For friends and family it could be 'opt in to share all
game sessions from the device.' Wider could be 'share a single
session.'"

**Claude's reasoning**: Agreed immediately — it maps cleanly to the
trust ladder. But pushed back hard on the operational obligations
of auto-stream: per-install random ID, optional friendly self-
naming, "Recent uploads" list with working delete-from-server
button, offline queue, persistent "auto-share is on" indicator,
rate caps. Also issued an honest warning: auto-stream is theatre if
the dev doesn't actually look at the data.

**Tipping point**: User's instinct on the tiering was correct;
Claude's contribution was filling in the "what we owe the friend"
hygiene that prevents the feature from being a trust-burner.

**Why this matters going forward**: The audit / delete-from-server
endpoint is a Phase 4 requirement, not a nice-to-have. So is the
offline upload queue — without it we lose the rage-quit sessions,
which are the most diagnostic ones we'll receive.

### Fork 5 — Single build vs two TestFlight tracks

**User**: Discussed alongside Fork 4.

**Claude's reasoning**: Pushed for **single build with settings
toggle (default OFF)** over two separate TestFlight tracks.
Reasoning: build matrices are where indie ops projects die, and you
will eventually push the wrong config to the wrong audience.

**Status**: Leaning toward single build with toggle, but flagged as
an open question (see §13) to revisit when Phase 4 lands.

### Fork 6 — Install-iOS CTA and web parity

**User**: "Web is comparable. Slightly different controls. We can
show 'Install iOS' button in the title screen too."

**Claude's reasoning**: Agreed but warned that platform-blind CTAs
are worse than no CTAs. Suggested platform detection at boot, so
iOS Safari sees the install link, desktop sees a QR code, already-
Capacitor users see nothing. Also surfaced PWA as a sleeper option:
the Capacitor wrap already uses the web build, so a `manifest.json`

- service worker makes the web version installable to home screen
  — bypasses TestFlight for friction-free trial. Flagged that CTAs
  should fire _after_ the friend has played a wave, not before.

**Tipping point**: User and Claude aligned on the value of CTA but
Claude added the timing and platform-awareness rules. PWA was added
as a free hedge to Phase 1 even though it pays off in Phase 3.

### Fork 7 — Own infra vs CloudKit

**User**: "Should I use my own infra to store data? How does Apple
feel about it? Can I use Apple infra?"

**Claude's reasoning**: Answered the Apple question first — Apple is
indifferent to _where_, very particular about _how_ you disclose
(Privacy Manifest, App Privacy questionnaire, privacy policy URL,
no ATT prompt needed for in-app-only random IDs). Then walked
through CloudKit honestly: real strengths (zero-ops, Apple ID auth
free, generous quota, low review friction) but a fatal mismatch for
_this_ app because the viral share-link flow is web-first and
CloudKit Web Services demands Apple ID sign-in. That would torpedo
the viral loop and not help Android at all.

Pivoted to **Cloudflare Worker + R2 + D1** as the recommendation
because (a) it serves the iOS auto-stream AND the public web replay
fetch from the same backend, (b) free at TestFlight scale, (c) no
egress fees on R2, (d) trivial to query for AI inspection.

**User pushback**: "Great not to maintain server. Not a deal-breaker
though."

**Claude follow-up**: Clarified that Cloudflare Workers + R2 + D1
is **not** "stand up a server." No OS to patch, no scaling to
configure, no uptime to babysit. `wrangler deploy` and walk away.
Closer to CloudKit's ops burden than to a VPS.

**Tipping point**: The viral share-link's incompatibility with
CloudKit's auth model decided it. If the share-link weren't a
requirement, CloudKit would be the better answer.

**Why this matters going forward**: If the share-link feature ever
gets dropped (it shouldn't), CloudKit becomes the correct answer
again. So this decision is contingent on the share-link surviving
the build order.

### Fork 8 — Global scoreboard

**User**: "This might also segue nicely into a global scoreboard."

**Claude's reasoning**: Pointed out that the architecture makes it
_almost free_. The session summary table IS the leaderboard table.
But got excited about the structural superpower most mobile games
can't claim:

> Every submitted score is verifiable. Server re-runs the replay
> headlessly; if final score doesn't match submission, reject it.

And the UX consequence:

> Every leaderboard entry has a watchable replay attached.

Flagged real risks: platform segmentation (mouse aim too easy),
balance changes invalidating cross-build comparability, identity/
display names, time windows. Recommended **deferring the leaderboard
UI** until 20+ unique installs exist — schema is the same, only the
button is deferred.

Also pushed back on the broader trend: scope was inflating from "fix
the game-over screen" to "build a viral platform" while the _game
itself_ was still being tuned (recent commits all Patriot fixes).
Suggested locking the build order.

**Tipping point**: User agreed with the phased order and the defer-
the-leaderboard recommendation. The Daily Challenge framing
(deterministic seed, ghosts work, apples-to-apples comparison)
emerged from this as a more compelling alternative to a generic
all-time leaderboard.

### Fork 9 — Honest pros/cons review

**User**: "Any other thoughts? Pros/cons? Way to build upon?
Something you would change?"

**Claude's reasoning**: Asked specifically for honesty, so delivered:

Unsung pros: deterministic replay system is rare, single arch
serves five features, replay-verified scores are unique in this
genre, retroactive metric derivation, novel "tap leaderboard entry
→ watch replay" UX.

Hidden cons:

- Scope drift — game is still being balanced
- Viral loop assumes share-worthy experience
- Community management tax (moderation, profanity, delete-my-data
  requests)
- AI trend analysis is the most hand-wavy part — will likely never
  beat manual spot-checking for the first 50 sessions
- TestFlight 90-day expiration + tester churn = bursty data
- Replay format is a long-term commitment

Suggested changes: ship recap and stop, defer leaderboard, reframe
"telemetry" as "playtest reports," retention policy from day one,
one-tap emoji feedback instead of text fields.

Fresh ideas surfaced: ghost runs, daily challenge, "watch how you
died" inline, anomaly detection on uploads, frame-tagged replay
annotations.

Philosophical pause: a leaderboard signals "competitive game,"
which is a different identity than the meditative-arcade lineage
Missile Command sits in. Worth deciding deliberately rather than
drifting into it.

**Tipping point**: User agreed with the "What I'd change" block
verbatim. Crucially, they corrected the ghost-runs idea — they
**only make sense with a fixed seed**, which pulls them into Daily
Challenge mode rather than standalone normal play. That's now
captured in §15.

### Fork 10 — This document

**User**: "Write all this in a `.plans` md file. Detailed, like very
detailed. Basically a brain dump."

**Claude's reasoning**: User wanted a single canonical artifact so
context doesn't evaporate between sessions. Organized into 20
sections covering origin → vision → architecture → risks → build
order → next two weeks. Then user asked for _reasoning_ to be added
too, which is this appendix.

**Why this appendix exists**: Decisions without reasoning rot.
Three months from now, if the share-link gets dropped, future-Claude
needs to know "ok, then CloudKit is back on the table" — that
contingency only exists in the reasoning trail, not in the
decisions. Same for "leaderboard signals competitive identity" —
that's not a decision yet, just a flagged tension to revisit.

---

## Appendix B — Things the user explicitly cares about that shaped this

Surfaced for future sessions so they don't get re-litigated:

- **Operational simplicity is a strong preference**, not a hard
  requirement. "I can stand up a server if necessary, but I'd rather
  not." → favors managed/serverless, but won't reject something good
  for being slightly more involved.
- **Honesty with testers matters.** The user gravitated toward
  explicit opt-in even before Claude pushed for it. The two-tier
  consent model was the user's idea, not a Claude suggestion.
- **The user sees the web build as a real distribution channel**, not
  a demo. "Web is comparable." This is why the share-link loop is
  load-bearing and why PWA is worth a free hedge in Phase 1.
- **The user already thinks about future composability.** They
  surfaced the scoreboard themselves while we were still discussing
  share-links. Suggests they'll keep finding adjacent features —
  worth treating the architecture as a platform, not a one-shot.
- **The user accepts honest pushback.** When Claude flagged scope
  drift in Fork 8, the user agreed and asked to lock the build
  order. This is how the "ship Run Recap and stop" rule got
  prioritized.
