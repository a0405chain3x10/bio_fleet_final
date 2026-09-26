# Progress
Current: M3 (agents + transport)

Done
- M1: shared (types, messages, rng, grid+corridors+BFS cache, presets), world (World, physics, sensors, collisions, faults, validation), A* planner. Tests: A* vs reference Dijkstra, validation, single robot pick→drop.
- M2: agent/safety.ts two-phase rule; property test 200 seeds x 10k ticks x 2–20 agents = 0 collisions (12 s).

Next
- M3 contracts, SimBus, runtimes, heartbeat peer table.

Open issues
- none
