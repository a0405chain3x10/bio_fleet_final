# BioFleet v2 — Decentralized AMR Fleet Coordination (web simulation)

Smart India Hackathon 2026 · PS 26123 (BEL) · *Edge-AI Based Distributed Fleet Coordination for AMRs in Smart Warehouses*

3–20 simulated AMRs share a warehouse with **no central planner**. Each robot runs the same agent code, sees only its own odometry, battery, a 2-cell onboard sensor and its radio inbox, and talks peer-to-peer over a lossy, range-limited simulated radio.

```bash
npm install
npm run dev     # interactive simulation + experiments tab (offline, no backend)
npm test        # 24 tests, includes the 200-seed safety property test (~15 s)
npm run bench   # 420 headless runs → results/bench-*.csv (~3 min)
npm run perf    # S4, 20 robots: ms/tick p50/p95 + wall time (perf gate)
```

## Results (10 seeds per row, `results/final.md`)

| Scenario | Baseline makespan (s) | BioFleet (s) | Change | Collisions (all 420 runs) |
|---|---|---|---|---|
| S1 4-way crossing, 4 robots | 92.3 ± 9.0 | 52.7 ± 1.7 | **−42.9%** | 0 |
| S2 head-on corridor, 2 robots | 203.4 ± 62.9 | 81.5 ± 4.8 | **−60.0%** | 0 |
| S2 head-on corridor, 4 robots | 214.4 ± 26.6 | 97.5 ± 8.5 | **−54.5%** | 0 |
| S3 bottleneck, 6 robots | 746.7 ± 160.0 ¹ | 117.0 ± 12.0 | **−84.3%** ¹ | 0 |
| S4 warehouse, 50 tasks, 3 robots | 900.4 ± 70.4 | 627.3 ± 6.0 | **−30.3%** | 0 |
| S4, 5 robots | 640.6 ± 49.6 | 412.1 ± 15.5 | **−35.7%** | 0 |
| S4, 10 robots | 497.1 ± 60.9 | 238.6 ± 11.3 | **−52.0%** | 0 |
| S4, 20 robots | 376.9 ± 79.3 | 186.1 ± 5.1 | **−50.6%** | 0 |
| S4 dense preset, 20 robots | 2056.8 ± 1228.4 ¹ | 153.6 ± 7.7 | **−92.5%** ¹ | 0 |
| F1 10% packet loss (S4, 10 r) | 471.1 ± 41.0 | 245.7 ± 11.0 | **−47.8%** | 0 |
| F1 30% packet loss | 460.3 ± 46.4 | 250.4 ± 5.7 | **−45.6%** | 0 |
| F2 dead zone over busy intersection | 446.8 ± 40.6 | 250.6 ± 14.6 | **−43.9%** | 0 |
| F3 aisle blocked at t = 30 s | 456.6 ± 41.5 | 254.4 ± 6.6 | **−44.3%** | 0 |
| F4 robot killed mid-task at t = 40 s | 505.1 ± 57.5 | 266.5 ± 17.4 | **−47.2%** | 0 |

¹ The baseline gridlocks (never finishes) in 9/10 S3 seeds and 6/10 dense seeds; its makespan there is the timeout, so these percentages are **lower bounds**. BioFleet completed every task in all 280 of its runs.

- **Target (≥ 20% makespan reduction on S1–S4 with ≥ 5 robots, 0 collisions incl. faults): met.** Every BioFleet row is ≥ 30% faster; 0 collisions across all 420 runs.
- **Edge-AI ablation (learned vs static costs):** within noise. S4: 627 vs 625 (3 r), 412 vs 415 (5 r), 239 vs 239 (10 r), 186 vs 186 (20 r), dense 154 vs 160. Why: the coordination layer (intent-aware costs, corridor locks, congestion-aware bids) already removes most of the delay the model could learn. The traversal-delay signal is sparse (~200 samples per robot per run, mostly zero). See `DECISIONS.md`.
- **Perf (`npm run perf`, Node 22):** S4 with 20 robots finishes in 1.7 s wall (budget 5 s). Tick p50/p95 is 0.84/1.43 ms; the agent step averages 0.04 ms per robot per tick, p95 0.20 ms (budget 2/8 ms). The full 420-run matrix takes 174 s (budget 180 s). The browser renders at 60 FPS with 20 robots and the heatmap on at 1366 × 768. With 20 Web Workers the live sim reaches about 10× real time; the Inline runtime reaches 20×.
- Baseline numbers were first recorded at M4, before any coordination code existed (`results/baseline-m4.md`). The table above uses the same shared core code for both modes, since core fixes (e.g. parking, failure detection) benefit both.

## Architecture

```
            ┌──────────────────────────── World (ground truth only) ───────────────────────────┐
            │ physics & time (100 ms tick) · sensors (2-cell Chebyshev) · collision logger       │
            │ task parcels · fault injection     — never tells a robot where to go —             │
            └───────▲ Observation (odometry, battery, sensed robots/LEDs, obstacles, inbox)      │
                    │                         Action (move/turn/wait/pick/drop, LED, outbox) ▼
   ┌────────────────┴───────────────┐   ┌────────────────────────────────┐
   │ Agent r0 (Worker or Inline)    │   │ Agent r1 … r19  (same code)    │   src/agent/* — pure TS, no DOM,
   │  safety.ts   two-phase LED rule│   │                                │   never imports world/ui/transport
   │  planner.ts  windowed A*       │   │                                │
   │  passingOrder / corridor locks │   │                                │
   │  tasks.ts    CBAA auction      │   │                                │
   │  deadlock.ts PROBE + retreat   │   │                                │
   │  learning.ts edge-cost model   │   │                                │
   └───────────────┬────────────────┘   └───────────────┬────────────────┘
                   └────── Transport (broadcast/send/poll) ──────┘
                           SimBus: seeded latency, loss, range, dead zones, byte counters
   Pickup stations = WMS terminals on the same bus (publish TASK, never assign).
   Dashboard = telemetry sink (reads World + agent telemetry, never sends coordination data).
```

| Layer | Where | What |
|---|---|---|
| Safety | `agent/safety.ts` | Two-phase indicator protocol, sensor-only |
| Coordination | `agent/Agent.ts`, `passingOrder.ts`, `corridor.ts`, `costs.ts` | INTENT windows (W = 10), priority passing order, head-on yielding, directional corridor locks, station queueing |
| Liveness | `agent/deadlock.ts`, `Agent.ts` | 6 s progress monitor (aging + replan around blockers), Chandy–Misra–Haas PROBE, bay retreat |
| Allocation | `agent/tasks.ts`, `battery.ts` | CBAA with LOCK, RELEASE, re-auction on >30% ETA growth (20 s hysteresis), failure reopen, charger/bay slots |
| Edge AI | `agent/learning.ts` | Online per-edge model with LEARN gossip; feeds A* and bid costs |
| Baseline | `baseline/BaselineAgent.ts` | Same core, CBAA, battery and safety; static A*; wait → 3 s → random 1–3 s back-off → replan with the cell blocked |
| Runtimes | `runtime/` | `WorkerRuntime` (one Web Worker per robot, one postMessage per tick) and `InlineRuntime`, with the same trace for the same seed (tested) |

## Safety argument (why 0 collisions does not depend on the radio)

A robot starts a move only when stationary at a cell centre. A move into target cell *c* at tick *t* needs three things:

1. its own LED already showed *c* in the snapshot of tick *t*;
2. no sensed robot occupies *c*, including a robot physically between cells, which the camera reports as `to`;
3. no sensed robot with a lower fiducial ID signals *c*, and no obstacle is sensed in *c*.

All robots decide on the same snapshot, and actions apply simultaneously.

- **Two robots start moving into the same *c* at tick *t*.** Both LEDs were visible in snapshot *t*. Both robots are adjacent to *c*, so they are within 2 cells (Chebyshev) of each other and see each other. The higher ID waits.
- **A robot entered *c* earlier.** It occupies *c* (and its source cell) until it arrives, and every robot adjacent to *c* senses that.
- **Swaps.** They are impossible: each robot sees the other occupying its target.
- **Failed robots.** A robot that dies mid-move has its LED off but still physically covers both cells, and the sensor reports both.

Messages only change *which* cell a robot wants and *when*; they never enter this check. Packet loss, dead zones and false information only cost efficiency.

Verified by `tests/safety.test.ts`: random maps, 2–20 agents moving randomly under this rule only, random runtime obstacles, random kills and revives, 10,000 ticks × 200 seeds, 0 collisions. A negative control shows that skipping the rule does collide.

## Assumptions

- **Sensor:** 2-cell Chebyshev range. It reads a fiducial ID, heading, the LED intent indicator, and the second cell a robot covers while between cells. Static floor plan (shelves, stations) is prior map knowledge. Runtime obstacles, other robots and failures are only sensed or reported.
- **Radio:** Euclidean range, 20 cells by default; latency is uniform over 1–2 ticks; loss and dead zones are adjustable in the UI. Silence is treated as a failure only for peers last seen within 10 cells, and only while the robot still hears others.
- **Clock-free ordering:** decisions never compare timestamps across robots. Passing order uses the priority *carried in the other robot's message* `(urgency, aging, −id)`, which the owner recomputes only at 5 s epochs. Ties break on fiducial ID. A robot compares only its own stamps with that same sender's later stamps.
- **Message-carried priority:** no robot recomputes another's priority.
- **Tasks:** pickup stations (WMS terminals) publish seeded batches or a continuous rate. They re-advertise a waiting parcel only if they have heard no owner for 5 s. If a robot dies carrying a parcel, the WMS re-issues it at the pickup.

## Known limitations

- The learned cost model gives no measurable gain over static costs in these scenarios (see ablation above).
- With 20 Web Workers the live demo runs about 10× real time. Experiments use Inline in workers.
- The shadow run that computes "% vs baseline" in the live UI replays the start configuration only. Obstacles, dead zones and kills added interactively are not replayed.
- CBAA can still double-assign under partitions. The second robot finds the shelf empty and drops the task (0 duplicate deliveries in all runs), at the cost of a wasted trip.
- A PROBE cycle across a radio gap is not detected. The progress monitor and aging handle it instead.
- The baseline back-off is physical (it steps aside when it *senses* a head-on). Without that, the specified baseline deadlocks on every head-on. This makes the baseline stronger, not weaker.
- M10 stretch: see `DECISIONS.md`/`PROGRESS.md` for status.

## Repository map

`src/shared` (types, messages, grid/corridors/BFS, presets, RNG) · `src/world` (World, physics, sensors, collisions, faults, validation, stations) · `src/agent` · `src/baseline` · `src/transport` · `src/runtime` · `src/experiments` (scenarios, runner, csv, bench, perf) · `src/ui` · `tests` · `scripts` (debug inspectors) · `DECISIONS.md` (every deviation) · `PROGRESS.md`.
