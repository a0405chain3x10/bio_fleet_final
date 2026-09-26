# Deviations log
One line each: problem → alternative → invariant preserved → cost.

- UI (renderer, editor) built in one pass after M3 instead of inside M1 → avoids rewriting it as agent telemetry evolves → none (features) → M1 acceptance is headless-only.
- `@types/node` added as dev dependency → needed to typecheck Node bench/perf entry points → none → types only, no runtime code.
- Bench/perf run with Node's built-in TS type stripping (`node file.ts`) instead of a runner package → no extra dependency → none → code must use erasable TS syntax only.
