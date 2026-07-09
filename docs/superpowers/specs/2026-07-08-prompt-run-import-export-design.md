# Prompt-run import/export — design

Date: 2026-07-08
Status: approved design, pending implementation plan

## Goal

Let a user save the current prompt run to a `.json` file and load a
previously saved file back into the workbench. This makes analysis
sessions persistable and shareable. It implements the roadmap item
"Add prompt-run JSON import/export".

Scope is the **current run only**. No saved-run library, no
localStorage, no multi-run picker — those belong to the separate
roadmap item "saved analysis sessions".

## Non-goals

- Persisting runs across page reloads.
- Managing more than one run at a time.
- Editing run data after import.
- Server-side storage.

## File format

Exported files wrap the run in a versioned envelope so imports can
detect shape drift and carry provenance:

```ts
type RunExport = {
  schemaVersion: 1;
  exportedAt: string; // ISO 8601
  app: "sophon";
  run: PromptRun;     // existing type from src/lib/prompt-run.ts
};
```

Rationale for the envelope over a raw `PromptRun`: the `PromptRun`
shape is expected to grow (roadmap adds activation patching, real SAE
fields, etc.). A version tag lets import warn or reject on mismatch
instead of silently loading a partial run, and provenance fields help
when files are shared between people or app versions.

## New module: `src/lib/run-file.ts`

Pure functions, no React, no DOM. Unit-testable in isolation.

```ts
const RUN_FILE_APP = "sophon";
const RUN_FILE_SCHEMA_VERSION = 1;

export function serializeRun(run: PromptRun): string;
```
Builds the `RunExport` envelope with a fresh `exportedAt` and returns
`JSON.stringify(envelope, null, 2)`.

```ts
export function exportFilename(run: PromptRun): string;
```
Returns `sophon-<title-slug>-<YYYY-MM-DD>.json`. Slug: lowercase the
title, replace non-alphanumeric runs with `-`, trim leading/trailing
`-`, cap length (e.g. 40 chars). Fall back to `run` if the slug is
empty.

```ts
export type ParseRunFileResult =
  | { ok: true; run: PromptRun }
  | { ok: false; error: string };

export function parseRunFile(text: string): ParseRunFileResult;
```
Steps, each producing a specific human-readable `error` on failure:
1. `JSON.parse(text)` in try/catch → "This file is not valid JSON."
2. Value is an object with `app === "sophon"` → "This is not a Sophon
   run file."
3. `schemaVersion === 1` → "This file was made by a different version
   of Sophon and cannot be opened." (any other/absent version)
4. `parsePromptRun(envelope.run)` (reuse existing validator) returns
   non-null → "This Sophon file is missing or has invalid run data."
5. Success → `{ ok: true, run }`.

## Workbench wiring — `src/components/sophon-workbench.tsx`

State/glue only; all logic lives in `run-file.ts`.

**Export handler** (`exportRun`)
- Guarded by `if (!run) return;`.
- `const text = serializeRun(run);`
- Create `Blob([text], { type: "application/json" })`, object URL, a
  temporary `<a>` with `download = exportFilename(run)`, click it,
  then revoke the URL and remove the node.

**Import handler**
- A hidden `<input type="file" accept="application/json">` with a
  `ref`. The Import button calls `inputRef.current?.click()`.
- On `change`: read the first file via `file.text()`.
  - If a run is already loaded, call `window.confirm("Loading a file
    replaces the current run. Continue?")` first; abort if declined.
    (No dialog component exists in the project; native confirm keeps
    scope tight.)
  - `const result = parseRunFile(text);`
  - On `ok`: `setCurrentRun(result.run)` and reset view state exactly
    like a successful `executeRun`, using the imported run
    (`result.run`) — `setSelectedHead("all")` and `setSelection({
    layer: Math.min(8, result.run.layers.length - 1), token:
    Math.max(0, result.run.tokens.length - 1) })`. Clear `runMessage`.
  - On failure: `setRunMessage(result.error)`.
  - Reset the input value so the same file can be re-selected.

The confirm gate and selection-reset logic are the only behavioral
subtleties; everything else is mechanical.

## UI

Two icon buttons added to the existing header button row
(`src/components/sophon-workbench.tsx`, the group next to the reset
and Run buttons), reusing `variant="sophon"` / `size="icon"`:

- **Export** — lucide `Download` icon, `title="Export run"`,
  `disabled={!run}`.
- **Import** — lucide `Upload` icon, `title="Import run"`, always
  enabled. Triggers the hidden file input.

Order in the row: Import, Export, reset, Run (Run stays rightmost as
the primary action). The hidden file input is rendered but visually
hidden.

Errors reuse the existing `runMessage` state and its banner in
`PromptDock`. No new error surface.

## Testing

Add **vitest** as a dev dependency with a minimal config and a
`"test": "vitest run"` script.

`src/lib/run-file.test.ts`:
- Round-trip: `parseRunFile(serializeRun(sample)).run` deep-equals the
  sample run.
- `serializeRun` output has `schemaVersion`, `app`, `exportedAt`, and
  `run`.
- `exportFilename` slugifies titles, handles empty/symbol-only titles,
  and ends with the date + `.json`.
- `parseRunFile` failure modes, each returns the expected error:
  non-JSON text, valid JSON but not an object, wrong `app`, wrong
  `schemaVersion`, missing `run`, structurally invalid `run`.

A small `PromptRun` fixture (one or two tokens, one layer) lives in
the test file.

## Files touched

- `src/lib/run-file.ts` — new, all logic.
- `src/lib/run-file.test.ts` — new, unit tests.
- `src/components/sophon-workbench.tsx` — buttons, hidden input,
  export/import handlers.
- `package.json` — vitest dev dep + `test` script.
- vitest config (`vitest.config.ts` or config block) — new.

No backend changes. No changes to `prompt-run.ts` (its
`parsePromptRun` is reused as-is).
