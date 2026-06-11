/* ============================================================
   STARFALL shared rule constants — imported by BOTH the browser
   client and the Node server. Pure data: no THREE, no DOM, no
   side effects. This is the single source of truth for gameplay
   numbers; neither side may keep a private copy.
   ============================================================ */

/* ---- building ---- */
export const MAX_STRUCT = 400;     // placed-structure cap per world
export const GRID = 4;             // free-place grid resolution
export const SNAP_R = 3.2;         // max distance from aim to a socket to snap
export const BP_MAX = 60;          // max pieces in one blueprint

/* ---- combat / protection ---- */
export const HP_MAX = 100;         // player max health
export const SPAWN_PROT = 4;       // seconds of spawn protection
export const SAFE_R = 32;          // PvP-free / critter-free radius around a Colony Beacon
export const GREN_R = 6, GREN_DMG = 70, GREN_FUSE = 3;
export const SHIELD_LIFE = 20, SHIELD_CD = 22;       // deployable shield wall
export const TURRET_R = 25, TURRET_DMG = 8, TURRET_CD = 1.0;
export const METEOR_DMG = 35;      // structure damage per meteor impact
export const HITS_PER_SHOWER = 6;  // max structure hits per meteor shower

/* ---- world / time ---- */
export const WORLD_R = 380;        // playable world radius
export const SEA_Y = 0;            // sea level on water planets (Pelagos)
export const CYCLE_S = 600;        // seconds for a full day/night cycle (shared clock)

/* ---- survival rates (canonical values; Phase 2 wires server validation to these) ---- */
export const O2_DRAIN = 1.15;          // per second, walking
export const O2_DRAIN_SPRINT = 1.8;    // per second, sprinting
export const O2_JET_MULT = 1.4;        // multiplier while jetpacking
export const O2_DRAIN_SUBMERGED = 4.6; // per second, under water
export const O2_REFILL = 28;           // per second near ship/relay/beacon
export const EVA_O2_DRAIN = 2.6;       // per second in orbital EVA
export const EVA_O2_REFILL = 30;       // per second near the parked ship in EVA
export const CARRY_BASE = 300;         // base resource carry capacity
export const CARRY_PER_CRATE = 150;    // bonus per live storage crate

/* ---- mining ---- */
export const MINE_RANGE = 5.2;     // max distance to lock a node
export const MINE_TIME = 1.4;      // seconds to fully mine a node
export const MINE_RESPAWN_S = 180; // node respawn time (server uses ms)

/* ---- critters ---- */
export const CRIT_CAP = 12;        // max concurrent critters per planet

/* ---- orbital station ---- */
export const STATION_MAX = 60;         // max station pieces per world
export const STATION_MIN_PIECES = 10;  // min pieces (plus all types) to power the station
export const CORE_R = 7;               // station core radius
export const EVA_SPEED = 14;           // EVA 6DOF movement speed
export const STATION_REACH = 15;       // EVA aim reach for placing pieces
export const STATION_SNAP = 13;        // max distance to a station socket to snap
