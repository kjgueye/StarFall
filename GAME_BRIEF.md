# ASTRAVOX (formerly Starfall) — Technical & Design Brief

*A complete handoff document for working with an AI assistant to extend the game.*

---

## 1. What Astravox is

> Renamed from "Starfall" (display name + `astravox_*` localStorage keys only).
> Infrastructure identifiers — the GitHub repo, Railway service, and
> `starfall-production` deploy URLs — intentionally keep the old name.

A first-person 3D sci-fi **build & explore** game. You mine resources on alien planets,
unlock tiers of upgrades, extend how far you can travel (oxygen, jetpack, ship speed),
reach new planets with rarer resources, and build a thriving base. Light survival
pressure (oxygen running out, meteor showers damaging structures), plus an **optional
combat layer** (craftable weapons, PvP, sentry turrets, passive wildlife to hunt) added
in later updates. It supports **1–4 player online co-op**.

> **Note:** sections 1–4 describe the original release. The game has since grown
> substantially — see **§5b (Combat & vehicles)** and **§5c (Horizon: critters,
> heavy weapons, ocean world + Tier 5, orbital station)** for everything added since,
> including the 4th planet, the 5-tier progression, the EVA mode, and the full message
> protocol. The save format is now **v6**.

Live versions:
- Railway (runs the multiplayer server + game): https://starfall-production.up.railway.app
- GitHub Pages mirror (static, connects to Railway for co-op): https://kjgueye.github.io/StarFall/
- Repo: https://github.com/kjgueye/StarFall (branch `main`)

---

## 2. Tech stack & how it's written

> **⚠ FOUNDATION MIGRATION (branch `server-migration`) — supersedes parts of this brief.**
> The game is being converted to a Tier-A persistent online architecture. Done so far:
> - **Phase 1:** Vite build step. The client now lives in `src/game.js` (ES modules), built to
>   `dist/`; `index.html` is the Vite entry. All gameplay rules/data live in **`shared/`**
>   (`constants/catalog/tiers/world/rules.js`) imported by BOTH client and server.
>   The "single self-contained index.html" constraint below is obsolete.
> - **Phase 2:** **Server-authoritative simulation.** In co-op the server owns per-player
>   resources/tier/weapons/ammo/medkits/HP/O2/fuel and validates every intent (build costs,
>   tier gates, mining range vs the shared node layout, weapon ownership/ammo/cooldowns/range,
>   safe zones, spawn protection, turrets, grenade AoE, deaths/loot). Clients send intents and
>   render; grants arrive as `prog` snapshots. Solo offline play is unchanged (`NET.active`
>   gates everything). See the protocol comment atop `server.js` and `test/authority.mjs`.
> - **Next:** Phase 3 Postgres persistence + guest identity; Phase 4 owner moderation;
>   Phase 5 hardening.


- **Language:** Plain JavaScript (ES2020), no TypeScript, **no build step**, no framework.
- **3D engine:** [Three.js](https://threejs.org) **r158**, loaded from cdnjs as a UMD `<script>` (global `THREE`). No imports/modules.
- **Client = ONE file:** `index.html` (~4,700 lines). All HTML, CSS, and JavaScript are inline in this single self-contained file. There are **no external assets** — every 3D model is built from Three.js primitives (boxes, cylinders, spheres, cones), every texture/sound is generated in code.
- **Server = `server.js`** (~520 lines, Node.js). Uses only the `ws` npm package for WebSockets plus Node built-ins. It serves `index.html` over HTTP **and** runs the co-op protocol, so one process does both. `package.json` + `railpack.json` configure the Railway (Node) deploy.
- **Audio:** Procedural via the Web Audio API (`SND` object) — no sound files; tones are synthesized for mining, placing, klaxons, tier-ups, etc.
- **Persistence:** Browser `localStorage` (single-player saves are versioned JSON; multiplayer stores per-player progress + a host world snapshot). No database.
- **Rendering performance:** Heavy use of `THREE.InstancedMesh` (all structures, crystals, rocks, flora render as instanced batches), shared geometries/materials, a fixed particle pool, and fog-based distance culling. Targets 60fps desktop, playable on mid-range phones.

**Important constraint for any AI assistant:** the whole game must stay a single
self-contained `index.html` that works when opened as a static file. Use Three.js
primitives/materials only — no external models, textures, or fonts. Keep additions
gated so single-player still works fully offline (see the `NET.active` pattern below).

---

## 3. How the game works (player's view)

### Two modes
- **Space mode:** You pilot a ship through an open star field with a sun, asteroids, and 3 planets. Mouse/drag to steer, W/S (or on-screen ▲▼) to thrust forward/back. Fly close to a planet → "LAND" prompt → short fade transition → surface mode.
- **Surface mode:** First-person on foot on a large procedural planet. Walk (WASD/joystick), look (mouse/right-side drag), jump (Space), sprint (Shift, Tier 2+), jetpack (hold Space, Tier 3+). Mine, build, repair. Near your ship, "LAUNCH" returns you to space.

### The 3 planets
| Planet | Resource | Notes |
|--------|----------|-------|
| **Rust** (red rocky) | Ferrite | Starter world |
| **Glacius** (icy blue) | Cryo-crystal | Second world |
| **Verdant** (alien green) | Biolume (rarest) | **Locked until Tier 3** — shown in space wrapped in a purple "signal interference" shield that drops with a cinematic camera pan when you reach Tier 3 |

Each planet has its own seeded procedural terrain, color palette, fog, sky tint, rocks, flora, and ~46 glowing resource-crystal nodes.

### Core loop
Mine resource nodes (walk up, hold E ~1.4s, node respawns after ~3 min) → spend resources to **unlock tiers** and **build/buy structures** → tiers extend your reach and unlock better buildings → reach Verdant → mine Biolume → build the **Colony Beacon** (Tier 4) which triggers a victory celebration, then play continues as a sandbox.

### Oxygen (exploration tension)
O2 drains when you're on foot away from safety; it refills near your **ship**, **O2 Relays**, or the **Beacon**. Chaining relays outward lets you explore further — it feels like building infrastructure. O2 hitting zero = screen warning → blackout → respawn at your ship with **nothing lost** (pressure, not punishment). HUD has an O2 bar that flashes red under 25%.

### Meteor showers (building tension)
Periodically (every few minutes), a 20-second klaxon warning + reddening sky, then meteors rain down near your base. They damage placed structures (each has HP; damaged ones smoke/spark). Defenses: the free **Repair Tool** (hold E on a damaged structure, costs 2 Ferrite) and the **Shield Generator** (Tier 2 structure projecting a visible energy dome that blocks meteors). Damage is capped per shower (max 6 hits), the Beacon is immune, and storage crates can't be fully destroyed — so hours of progress can never be wiped.

### Tiers (the progression hook)
- **Tier 1 (start):** Basic suit (100 O2) & ship. Build: floor, wall, ramp, light pole, storage crate, O2 relay.
- **Tier 2** (costs Ferrite + Cryo-crystal): Shield Generator, window wall, door, dome roof. Suit gains sprint + larger O2 tank (160).
- **Tier 3** (bigger cost): Jetpack (hold jump to fly, fuel meter), ship speed +75%, **Verdant unlocks** with the cutscene.
- **Tier 4** (costs all 3 resources incl. Biolume): **Colony Beacon** → victory, sandbox continues.
- **Decorations** (any tier, bought with resources): flag, planter, holo-sign, red/green/blue lamps, table, antenna.

### Building
Open the build menu (B / on-screen BUILD), pick a piece → a translucent green/red "ghost" follows your aim, snapped to a grid → click/PLACE to build, R rotates, X removes (aim at a placed piece). Structures are solid — you collide with walls, can walk up ramps, jump onto crates, and doors slide open as you approach. Cap of 400 placed pieces. Removing refunds half the cost. Storage crates raise your carry cap.

### Saving
Single-player auto-saves to localStorage every 30s and on tab close (structures, resources, tier, upgrades, player/ship position). Start screen offers **Continue** vs **New Game**. Settings menu has **Export Save** (copies a base64 code to clipboard) and **Import Save** (paste a code). The save format is versioned and falls back to New Game if a save can't be parsed.

### Controls
- **Desktop:** WASD move, mouse look (pointer lock), E interact/mine, click place, X/right-click remove, Space jump (hold = jetpack at T3), Shift sprint, B build menu, T tier menu. Ship: W/S thrust, mouse steer.
- **Mobile (auto-detected touch):** left virtual joystick, drag right half to look, large semi-transparent buttons for Jump/Jetpack, Mine, Place, Remove, Build, and Land/Launch + ▲▼ thrust in space.

### Multiplayer co-op (1–4 players)
Title screen has **Host Co-op** / **Join Co-op**. Host gets a 5-character room code; friends enter it + a name. The world is **shared** (you see each other as astronaut avatars with name tags / ships in space; structures, mining, and meteor showers are synchronized) but **resources, tier, oxygen, and fuel are per-player**. Solo play and a "room of one" both work. Worlds persist via the host's browser snapshot; "Host Previous World" restores it. Single-player remains fully offline.

---

## 4. How the code is organized (`index.html`)

It's one big `<script>`. Major sections, roughly in order:

1. **Utilities** — `clamp`, `lerp`, `smooth`, seeded RNG (`mulberry32`), value noise (`vnoise`, `fbm`) for terrain, `$` = getElementById.
2. **`SND`** — Web Audio procedural sound object (`SND.mine()`, `SND.tierUp()`, etc.).
3. **Data tables (the easiest things to extend):**
   - `PLANETS` — per-planet config: seed, radius, position, colors, fog, resource type, etc.
   - `TIERS` — array of tier definitions (cost + perks text).
   - `CAT` — the **catalog** of every buildable/decorative structure: name, icon, tier requirement, cost, HP, and a `parts[]` list describing the primitive meshes that make up the model (geometry key, material key, offset, scale, rotation). Special flags like `o2r` (oxygen radius), `shieldR`, `capUp` (storage), `noKill`, `decor`, `glow`.
   - `MAX_STRUCT` (400), `GRID` (4).
4. **`S`** — the global game-state object (mode, planet, tier, `res` resources, `structures[]` array, o2, fuel, beacon, positions). This is what gets saved.
5. **`NET`** — the multiplayer client module. **Every multiplayer behavior is gated behind `if (NET.active)`**; with no connection the code path is identical to single-player. `netHandle(msg)` dispatches server messages.
6. **Save/load** — `buildSaveObj`, `parseSave` (validates every field), `saveGame`, `exportSave`/`importSave`.
7. **Renderer/scenes** — one `WebGLRenderer`, a `spaceScene` and a `surfScene`, shared `GEO` (geometries) and `MAT` (materials) dictionaries, a glow-sprite helper, and a fixed **particle pool** (`spawnBurst`, `updateParticles`).
8. **Space scene** — stars, sun, asteroids, planet spheres, the Verdant shield, and `buildShip()` (primitive-built ship reused on surfaces).
9. **Remote players** — `buildAvatar`, `addRemote`/`removeRemote`, interpolation in `updateRemotes` (co-op only).
10. **Surface scene** — `buildSurface(planetKey)` rebuilds terrain + props + nodes for a planet; `terrainH(x,z,planet)` is the deterministic height function.
11. **Structures** — `structMeshes` (instanced meshes per part), `refreshStructures()` rebuilds instances from `S.structures`, `collidePlayer()`, `groundYAt()`, `updateDoors()`, and the shared `applyPlaced/applyRemoved/applyHp/applyNodeDead` helpers used by both solo and networked paths.
12. **Mining** — `findMineTarget`, `updateMining`.
13. **Building** — `selectBuild`, `updateGhost`, `placeStructure`, `removeStructure`, `updateRepair`.
14. **Meteors** — `meteorState` machine, `spawnMeteorAt`, `meteorImpact`, shield checks.
15. **HUD/menus** — DOM-based panels (`renderBuildGrid`, `renderTierList`), toasts, prompts.
16. **Input** — keyboard, mouse/pointer-lock, and the mobile joystick + buttons.
17. **Mode transitions** — `enterSurface`/`enterSpace`, `doLand`/`doLaunch`, `doBlackout`, the Verdant cutscene.
18. **Update functions** — `updateSpace(dt)`, `updateSurface(dt)`, `updateCutscene(dt)`.
19. **Start/boot** — start screen wiring, co-op setup, and the main `loop()` (requestAnimationFrame, dispatches by `S.mode`, clamps delta time).

A debug hook `window.__SF` exposes `{S, CAT, PLANETS, surf, player, NET, remotes, ship, ...}` for testing in the browser console.

### Patterns to follow when adding features
- **New buildable item:** add an entry to `CAT` (copy an existing one's shape). It auto-appears in the build menu and works with placement, collision, saving, and multiplayer. Give it a `tier`, `cost`, `hp`, and `parts[]`.
- **New planet:** add to `PLANETS`; `buildSurface` and the space view are data-driven from it.
- **New tier perk / upgrade:** edit `TIERS` and the `unlockTier()` function.
- **Anything multiplayer-affecting:** wrap the networked branch in `if (NET.active)` and add a message type to both `server.js` and `netHandle()` so solo stays untouched.
- **Models:** assemble from `GEO`/`MAT` primitives like existing `parts[]` and `buildShip`/`buildAvatar`.

---

## 5. The server (`server.js`)

Authoritative for the shared world only: room membership (4-player cap, 5-char codes), the structure list (server assigns IDs + tracks HP), resource-node respawn timers, meteor shower scheduling **and damage resolution**, and beacon uniqueness. Clients keep their own resources/tier/O2/fuel. Messages are small JSON frames over one WebSocket per player (`host`, `join`, `pu` player-update, `place`, `remove`, `repair`, `mine` from client; `welcome`, `placed`, `removed`, `hp`, `destroyed`, `nodeDead/Alive`, `meteor*`, `pjoin/pleave`, `err` from server). Test knobs: `PORT`, `METEOR_FAST`, `RESPAWN_MS` env vars.

---

## 5b. Combat & vehicles update (save v2)

- **Health & combat**: players have HP (100) with a HUD bar. Weapons live in hotbar slots (keys 1-4 / taps): slot 0 mining tool, 1 Energy Blade (melee), 2 Blaster Pistol (Light Cells), 3 Pulse Rifle (Heavy Cells). First-person viewmodels; `WEAPONS`/`CRAFT` tables drive stats and recipes. Fire = left-click / `mAct` button.
- **Armory** (Tier 2 structure, `interact:'armory'`): craft menu (`renderCraftGrid`/`craft`) for weapons (one-time), ammo, and Med-Packs (`useMed`, +50 HP). Open with E when nearby.
- **Death/loot**: weapon death drops a server-owned loot container (`lootBoxes`, claimed by proximity), respawn at base with 4s spawn protection (`player.invuln`). O2 blackout still drops nothing.
- **Safe zone**: no PvP within `SAFE_R` of a Colony Beacon (visible green ground ring); turrets idle there too. `inSafeZone()`.
- **Sentry Turret** (Tier 3, `owned:true`): tracks/shoots nearest non-owner player (`updateTurrets`/`turretTarget`); owner stored in structure data; cap 8. Damage is victim-applied.
- **Rover** (Tier 2, `dynamic:true`): drivable buggy rendered as its own group (`roverMeshes`/`buildRover`), not instanced. `enterRover`/`updateRover`/`exitRover`; server arbitrates the seat (`roverSeat`/`roverMove`).
- **Avatar animation**: remote astronauts have pivoted limbs (`animateAvatar`), held weapons, and a spawn shimmer; synced via the `pu` `wp`/`iv`/`dr`/`sw` fields.
- **Chat / compass / minimap** (Phase 5): `addChat`/`openChat` (MP only, escaped + sanitized), `renderCompass`, `drawMinimap` (M / MAP button). Compass + minimap work in solo.
- **Furniture**: bed, chair, holo console (animated screen), shelf, rug, ceiling light, locker, railing — all in `CAT` as decor.
- **New net messages**: `fire`, `died`, `lootClaim/lootSpawn/lootGone/lootGot`, `chat`/`sys`, `roverSeat/roverSeatClear/roverMove` — see the protocol comment atop `server.js`. Damage is client-authoritative; loot/seats/turret-owner are server-authoritative.
- **Save**: bumped to v2 with graceful v1 migration (combat fields default). `SAVE_VER`, `parseSave` accepts v1 and v2.

## 5c. Horizon update (save v6) — 7 phases

A large multi-phase expansion. Save is now **v6**; `parseSave` migrates v1–v5 (every new field defaults). All multiplayer behavior stays gated on `NET.active`; the server is authoritative only for shared-world objects (clock, critters, station, loot, nodes, seats).

- **P1 — Building socket/snap system.** Pieces define 3D-ish sockets in `CAT.<piece>.sockets` (`{p:[x,y,z], rots, accept}`). The ghost snaps to the nearest valid socket (`findSnap`/`occupiedAt`, rewritten `updateGhost`), `R` cycles socket orientations, `G`/`#mFree` toggles free-place. Fixes dome-on-wall, flush corners, rotated joins, multi-story homes.
- **P2 — Building content & tools.** New pieces (foundation, pillar S/M/L, half-wall, half-floor, angled roof + corner, beam) with sockets/colliders. **Paint tool** — 12 colours via per-instance `InstancedMesh.instanceColor` (`st.col`, saved, `paint` message). **Blueprints** — drag-select → save (localStorage, 60-piece cap), stamp the full ghost footprint, export/import codes.
- **P3 — Day/night cycle.** Shared ~10-min cycle (`dayClock`, `CYCLE_S`, `applyDayNight`, `todNow`); sky/fog/light lerp, `surfStars` at night. Server owns `worldClock` (sends `tod` in welcome + a `clock` broadcast).
- **P4 — Critters & hunting.** Passive fauna from primitives (skitterer/grazer/floater/hopper/skimmer — `CRITTERS`/`CRIT_BY_PLANET`), wander + flee, never attack. Defeating them drops **Chitin** (`S.res.ch`), used in cheaper Med-Pack + ammo recipes. Solo simulates locally; server owns spawns/positions (`critSnap` snapshots, `critHit` → `critDead`). Cap 12/planet, excluded from the Beacon safe zone.
- **P5 — Heavy weapons** (Armory, tier-gated): **Plasma Grenade** (throw-arc + 3s-fuse AoE, no structure damage), **Deployable Shield** (thrown energy wall that blocks ranged shots 20s — `shieldWalls`/`shotBlocked`), **Lance Beam** (T4 hitscan sniper, scope FOV zoom, 3 Heavy Cells/shot), **Inferno Thrower** (T5 flame cone, burns new Fuel ammo). Hotbar scaled to 8 slots (keys 1-8, `Q` cycle, wraps on mobile). `nade`/`shield` relayed; lance/inferno reuse `fire` (wp 4/5).
- **P6 — Ocean world Pelagos + Tier 5.** 4th planet (`PLANETS.pelagos`, `water:true`): `terrainHWater` archipelago above an animated water plane (`updateWater`), `SEA_Y=0`. New resource **Abyssal Pearl** (`pe`), nodes on outer islands. Water mechanics: wading slows, deep water sinks + drains O₂ 4× + vignette. **Tier 5** unlocks Pelagos (signal-shield cutscene like Verdant — now generalized to `SHIELDED`/`shieldGroups`/`startShieldCutscene`), the **Rover Hover Module** (skim water at T5), O₂ tank 160→240, and the Inferno recipe. `skimmer` water-critter.
- **P7 — Orbital Station endgame.** A **Station Core** appears in orbit near Rust at Tier 5 (`STATION_POS`, `stationCore`). Flying near → **DOCK** → **EVA mode** (`S.mode='eva'`): jetpack 6DOF flight around the core, O₂ drains away from the parked ship. **Station pieces** (`STATION`: corridor/habitat/solar/dome/dock/comms) snap to a 3D socket graph (`stationSockets`, quaternion-aligned via `socketQuat`, `R` rolls). Placing all 6 types + ≥10 pieces powers it: **ASTRAVOX STATION ONLINE** celebration (once) + persistent glow. Server stores pieces (`stationPlace`/`stationRemove` → `stationPlaced`/`stationRemoved`) and the online flag, both in welcome.

**Net messages added across Horizon** (full list lives in the protocol comment atop `server.js`):
`paint`, `clock`, `critSnap`/`critHit`/`critDead`, `nade`, `shield`, `stationPlace`/`stationRemove`/`stationPlaced`/`stationRemoved`. Damage stays client-authoritative (each victim self-applies); critters/station/nodes/clock are server-authoritative.

## 6. Current feature list (what exists today)

- Full space flight + landing/launch transitions; 3 planets with distinct biomes.
- First-person movement, jump, sprint, jetpack with fuel, structure collision (walls block, ramps walkable, crates climbable, auto-sliding doors), can't fall through terrain or leave bounds.
- Mining 3 resources with respawning nodes; carry cap raised by storage crates.
- 13 functional structures + 8 decorations, grid-snapped ghost placement, rotate, remove with refund, 400-piece cap.
- Oxygen survival with relay-chaining and no-loss blackout/respawn.
- Meteor showers with warnings, structure HP/damage, repair tool, shield-dome defense, damage caps.
- 4-tier progression with unlock celebrations, jetpack, ship speed boost, the Verdant unlock cutscene, and a Colony Beacon victory that continues as sandbox.
- Clean cyan/white HUD, first-person tool/hands, visor frame, particle effects (mining, meteors, thrusters, tier-ups), procedural audio.
- Versioned localStorage saves with Continue/New Game and export/import codes.
- Full desktop + mobile/touch control schemes.
- 1–4 player online co-op with room codes, shared world, per-player progression, avatars, persistence, and reconnect.

---

## 7. Ideas worth exploring (a starting menu, not a plan)

Gameplay depth: vehicles/rovers, day-night cycle, weather, hazards beyond meteors, more planets/biomes, crafting chains, power/electricity grids, farming Biolume, automation (miners/conveyors), quests or a story thread, achievements.
Building: snapping/blueprints, copy-paste, paint/colors, larger/multi-tile structures, interiors with pressurization.
Co-op: voice/text chat, shared objectives, roles, trading, drop-in persistence on the server.
Polish & feel: better ship handling, camera options, photo mode, settings (sensitivity, FOV, quality), minimap/compass, music.
Tech: server-side world persistence (currently host-snapshot only), spectator mode, performance/LOD passes, mobile UI refinements.

When you bring an idea to Claude, mention: keep it one self-contained `index.html`,
Three.js primitives only, gate any multiplayer change behind `NET.active`, and extend
the data tables (`CAT`, `PLANETS`, `TIERS`) wherever possible rather than hard-coding.
```
```
