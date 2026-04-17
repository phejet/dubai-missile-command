# Upgrades, Shop, And Progression

This subsystem spans:

- `src/game-sim-upgrades.ts`
- `src/game-sim-shop.ts`
- `src/upgrade-graph.ts`
- `src/ui.ts` progression/shop rendering

## Core Model

There are two layers:

- upgrade families such as `wildHornets`, `ironBeam`, and `launcherKit`
- upgrade nodes inside those families, each with rank, cost, dependencies, and optional objectives

The graph is defined by `UPGRADE_NODES`.

Each node can require:

- `anyOf`
- `allOf`
- `objectives`

Objectives are meta-run unlock conditions, not same-run conditions.

## Source Of Truth

The real unlock state is:

- `g.ownedUpgradeNodes`

The runtime level summary is:

- `g.upgrades`

`g.upgrades` is derived from owned nodes via `computeUpgradeLevelsFromNodes(...)`, with `burjRepair` handled separately as a consumable level.

## Progression Persistence

Meta progression is stored through:

- `loadUpgradeProgression()`
- `saveUpgradeProgression()`
- storage key `dubai-missile-command.upgrade-progression.v1`

That stored state only tracks completed objective ids, not full run state.

## Buying Upgrades

Main entry points:

- `buyUpgrade(g, request)`
- `buyDraftUpgrade(g, request)`
- `buyBurjRepair(...)` internally

Normal shop flow:

- resolve the requested family/node to a concrete eligible node id
- check cost
- add the node to `ownedUpgradeNodes`
- apply runtime side effects

Draft flow:

- skip score checks
- still resolve to a concrete eligible node id
- still apply side effects

## Side Effects

`applyNodeSideEffects(...)` handles the runtime consequences of buying nodes.

Important effects:

- resync `g.upgrades`
- revive or register defense sites tied to upgrade families
- if `launcherKit` reaches rank 2, surviving launchers jump to 2 HP
- if `emp` is bought or upgraded, charge values are initialized immediately

## Shop Entries

`buildShopEntries(g)` returns the UI-facing list of entries.

Behavior:

- normal mode shows all upgrade nodes
- draft mode shows `g._draftOffers`
- each entry includes owned/locked/disabled/status metadata
- graph lock reasons are reused directly by the shop UI

## Draft Offers

`draftPick3(g)`:

- gets currently eligible nodes only
- chooses up to 3 using the seeded RNG already active for the run
- returns node ids, not family ids

Draft mode therefore offers concrete graph nodes, not abstract family levels.

## Repairs

Repair helpers exist in `game-sim-shop.ts`:

- `repairSite(...)`
- `repairLauncher(...)`
- `repairCost(wave)`

They are important for headless tooling and replay support, even though the current shop entry builder is focused on upgrade nodes.

## Wave Transition On Shop Close

`closeShop(g)` does much more than hide the UI.

It:

- restores destroyed launchers and sites
- clears in-flight support entities between waves
- resets upgrade timers
- refills EMP
- increments the wave
- generates the next spawn schedule
- refills launcher ammo based on current upgrade levels
- resets launcher reload timers
- switches `g.state` back to `"playing"`

This is the authoritative between-wave reset path.

## Upgrade Graph View Model

`src/upgrade-graph.ts` converts progression + owned nodes into a graph view model.

Important concepts:

- node states: `owned`, `available`, `locked`, `metaLocked`
- fixed default layout by family cluster
- viewport helpers for fit, clamp, pan, and zoom
- markup rendering functions produce HTML/SVG strings, not React components

The graph is used both in the runtime progression panel and in the editor.

## Gotchas

- `burjRepair` is not modeled as a normal graph node family path in the same way as permanent unlocks.
- `ownedUpgradeNodes` should be treated as authoritative; `g.upgrades` alone is not enough to reconstruct the graph.
- Draft offers are node ids, so bot and UI code must handle family-vs-node resolution carefully.
- Shop close is a gameplay transition, not just a UI cleanup step.
