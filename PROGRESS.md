# Progress
Current: M5 (coordination)

Done
- M1: shared (types, messages, rng, grid+corridors+BFS cache, presets), world, A* planner. Tests: A* vs Dijkstra, validation, single robot.
- M2: agent/safety.ts two-phase rule; property test 200 seeds x 10k ticks x 2–20 agents incl. random kills = 0 collisions.
- M3: agent core (CBAA, slots, peers, failure detection), SimBus, Inline/Worker runtimes; boundary + determinism tests.
- M4: BaselineAgent, scenarios S1–S4 + F1–F4, runner/csv/bench. Baseline table: results/baseline-m4.md.

Next
- M5 INTENT, passing order, head-on yielding, corridor locks in BioFleetAgent.

Open issues
- Baseline gridlocks at S3 single gap in 5/10 seeds (inherent to stop-and-wait; reported, not fixed).
- scripts/inspect.ts: debug dump of one run (node scripts/inspect.ts S4 10 baseline <seed> <fault>).
