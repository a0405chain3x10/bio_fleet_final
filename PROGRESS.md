# Progress
Current: done (M1–M10)

Done
- M1: shared (types, messages, rng, grid+corridors+BFS cache, presets), world, A* planner. Tests: A* vs Dijkstra, validation, single robot.
- M2: agent/safety.ts two-phase rule; property test 200 seeds x 10k ticks x 2–20 agents incl. random kills = 0 collisions.
- M3: agent core (CBAA, slots, peers, failure detection), SimBus, Inline/Worker runtimes; boundary + determinism tests.
- M4: BaselineAgent, scenarios S1–S4 + F1–F4, runner/csv/bench. Baseline table: results/baseline-m4.md.

- M5: INTENT, passing order, head-on yielding, corridor locks, intent-aware costs, station queueing. All S1–S4 + faults complete, 0 collisions.
- M6: re-auction (>30% ETA, 20 s hysteresis), charging slots, BLOCKED, failure reopen. Tests: CBAA unit + F3/F4.
- M7: progress monitor, PROBE cycles + bay retreat, congestion-aware bids. Dense-20 max stuck 11.4 s.
- M8: EdgeLearner (EWMA + SGD density/flow), LEARN gossip, heat telemetry, ablation (learned≈static, see DECISIONS).

- M9: UI (canvas renderer, cards, metrics, virtual log, controls, editor, experiments tab w/ Chart.js ±std + CSV), README, perf gate (S4-20: 1.7 s). Target met on all rows; results/final.md.

- M10: pure-TS HMAC-SHA256 (== WebCrypto) signing/verification, rogue robot fault (F5), Node UDP agent runner.

Next
- Optional: real UDP multi-robot discovery, WebCrypto key provisioning UI.

Open issues
- Baseline gridlocks at S3 single gap in 5/10 seeds (inherent to stop-and-wait; reported, not fixed).
- scripts/inspect.ts: debug dump of one run (node scripts/inspect.ts S4 10 baseline <seed> <fault>).
