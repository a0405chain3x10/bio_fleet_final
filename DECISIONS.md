# Deviations log
One line each: problem → alternative → invariant preserved → cost.

- UI (renderer, editor) built in one pass after M3 instead of inside M1 → avoids rewriting it as agent telemetry evolves → none (features) → M1 acceptance is headless-only.
- `@types/node` added as dev dependency → needed to typecheck Node bench/perf entry points → none → types only, no runtime code.
- Bench/perf run with Node's built-in TS type stripping (`node file.ts`) instead of a runner package → no extra dependency → none → code must use erasable TS syntax only.
- Baseline "random back-off" read as physical when head-on is *sensed* (blocker's LED signals my cell): step to a random free neighbour, else wait → without it the spec'd baseline deadlocks forever in every head-on → none (strengthens baseline, still comm-free) → baseline is harder to beat.
- Baseline temp-block of the occupied cell lasts 5 s, then it returns to the static shortest path → otherwise both robots of a head-on commit to the same detour and livelock → none → none.
- Pickup/dropoff stations are pass-through aisle cells, not dead-end pockets → pockets create unresolvable head-ons for every pick → none → map realism.
- Sensor reports the second cell a robot physically covers while between cells (`to`), independent of its LED → a robot killed mid-move turns its LED off and hid its target cell (found by F4: collisions) → safety → property test now also kills/revives robots mid-move.
- Failure detection: silence counts only for peers last seen ≤10 cells away, and only while I still hear someone; presumed-failed cells are a soft planning cost (300 ticks), hard obstacles only when sensed → with range-limited radio, silence ≠ failure (false positives blocked stations forever) → safety unaffected (sensing) → slower reaction to real failures far away.
- Also communication-free failure detection: a sensed robot frozen with LED off and silent > 3 s is presumed failed → F4 when no heartbeat history exists → none → none.
- F4 victim = a robot driving on plain floor (prefer one carrying) → a robot dying on a station blocks that station physically forever → none → scenario choice; carried parcel is re-issued at its pickup (WMS replacement).
- Pick failure (parcel already taken) marks the task as owned by unknown instead of re-bidding → stale CBAA views caused infinite pick retries → none → none.
- Default radio range 20 cells (Euclidean) → with 12 cells, robots at the far end never heard station adverts → none → documented assumption.
- Added `DONE` message type (task delivered) → stations and peers need completion to stop re-advertising → none → +1 msg per task.
