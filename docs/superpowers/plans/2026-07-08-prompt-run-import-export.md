# Prompt-run Import/Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user export the current prompt run to a versioned `.json` file and import such a file back into the workbench.

**Architecture:** All file logic lives in a new pure module `src/lib/run-file.ts` (serialize, parse, filename) that reuses the existing `parsePromptRun` validator. The workbench component does only DOM glue: a download anchor for export and a hidden file input for import, with a `window.confirm` guard and errors surfaced through the existing `runMessage` banner.

**Tech Stack:** TypeScript (strict), Next.js 14, React 18, vitest (new dev dependency for unit tests).

## Global Constraints

- Do NOT modify `src/lib/prompt-run.ts`. Its `parsePromptRun` is reused as-is.
- No backend changes (nothing under `services/`).
- Import path alias: `@/*` maps to `./src/*` (from `tsconfig.json`).
- Envelope constants are fixed: `app === "sophon"`, `schemaVersion === 1`.
- Error strings are user-facing copy; use them verbatim as written in the tasks.
- Header icon buttons must reuse the existing `<Button variant="sophon" size="icon">` pattern.

---

### Task 1: Test tooling + `serializeRun` and `exportFilename`

**Files:**
- Create: `vitest.config.ts`
- Modify: `package.json` (add `vitest` devDependency + `test` script)
- Create: `src/lib/run-file.ts`
- Test: `src/lib/run-file.test.ts`

**Interfaces:**
- Consumes: `PromptRun` and `parsePromptRun` from `src/lib/prompt-run.ts`.
- Produces:
  - `RUN_FILE_APP = "sophon"`, `RUN_FILE_SCHEMA_VERSION = 1`
  - `type RunExport = { schemaVersion: 1; exportedAt: string; app: "sophon"; run: PromptRun }`
  - `serializeRun(run: PromptRun): string`
  - `exportFilename(run: PromptRun): string`

- [ ] **Step 1: Add vitest and test script to package.json**

In `package.json`, add to `"scripts"`:

```json
    "test": "vitest run",
    "test:watch": "vitest"
```

Add to `"devDependencies"` (keep alphabetical order):

```json
    "vitest": "^2.1.8"
```

Then install:

```bash
npm install
```

Expected: `vitest` appears in `node_modules/.bin/`.

- [ ] **Step 2: Create vitest config with the `@` alias**

Create `vitest.config.ts`:

```ts
import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": resolve(__dirname, "src")
    }
  },
  test: {
    environment: "node"
  }
});
```

- [ ] **Step 3: Write the failing test for serialize + filename**

Create `src/lib/run-file.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { PromptRun } from "@/lib/prompt-run";
import { exportFilename, serializeRun } from "@/lib/run-file";

function sampleRun(overrides: Partial<PromptRun> = {}): PromptRun {
  return {
    id: "run-1",
    title: "Capital of France",
    prompt: "The capital of France is",
    model: "gpt2-small",
    source: "transformerlens",
    tokens: [
      { index: 0, text: "The" },
      { index: 1, text: " capital" }
    ],
    layers: [
      {
        layer: 0,
        residualNorm: [1, 2],
        attribution: [0.1, 0.2],
        logitConfidence: [0.3, 0.4],
        topFeature: [],
        attention: []
      }
    ],
    finalPredictions: [{ token: " Paris", probability: 0.9 }],
    ...overrides
  };
}

describe("serializeRun", () => {
  it("wraps the run in a versioned envelope", () => {
    const parsed = JSON.parse(serializeRun(sampleRun()));
    expect(parsed.app).toBe("sophon");
    expect(parsed.schemaVersion).toBe(1);
    expect(typeof parsed.exportedAt).toBe("string");
    expect(parsed.run.id).toBe("run-1");
  });
});

describe("exportFilename", () => {
  it("slugifies the title and appends the date", () => {
    const name = exportFilename(sampleRun());
    expect(name).toMatch(/^sophon-capital-of-france-\d{4}-\d{2}-\d{2}\.json$/);
  });

  it("falls back to 'run' for a symbol-only title", () => {
    const name = exportFilename(sampleRun({ title: "!!!" }));
    expect(name).toMatch(/^sophon-run-\d{4}-\d{2}-\d{2}\.json$/);
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `npm run test`
Expected: FAIL — cannot resolve `@/lib/run-file` (module not created yet).

- [ ] **Step 5: Implement serialize + filename**

Create `src/lib/run-file.ts`:

```ts
import { parsePromptRun, PromptRun } from "@/lib/prompt-run";

export const RUN_FILE_APP = "sophon";
export const RUN_FILE_SCHEMA_VERSION = 1;

export type RunExport = {
  schemaVersion: typeof RUN_FILE_SCHEMA_VERSION;
  exportedAt: string;
  app: typeof RUN_FILE_APP;
  run: PromptRun;
};

export function serializeRun(run: PromptRun): string {
  const envelope: RunExport = {
    schemaVersion: RUN_FILE_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    app: RUN_FILE_APP,
    run
  };
  return JSON.stringify(envelope, null, 2);
}

export function exportFilename(run: PromptRun): string {
  const slug = run.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  const base = slug || "run";
  const date = new Date().toISOString().slice(0, 10);
  return `sophon-${base}-${date}.json`;
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npm run test`
Expected: PASS (3 tests in `serializeRun` / `exportFilename`).

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json vitest.config.ts src/lib/run-file.ts src/lib/run-file.test.ts
git commit -m "feat: add run serialization and export filename with vitest"
```

---

### Task 2: `parseRunFile` — validation and round-trip

**Files:**
- Modify: `src/lib/run-file.ts`
- Test: `src/lib/run-file.test.ts`

**Interfaces:**
- Consumes: `parsePromptRun` (from `prompt-run.ts`), `RunExport`, `serializeRun`, constants from Task 1.
- Produces:
  - `type ParseRunFileResult = { ok: true; run: PromptRun } | { ok: false; error: string }`
  - `parseRunFile(text: string): ParseRunFileResult`

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/run-file.test.ts` (add `parseRunFile` to the existing import from `@/lib/run-file`):

```ts
import { parseRunFile } from "@/lib/run-file";

describe("parseRunFile", () => {
  it("round-trips a serialized run", () => {
    const run = sampleRun();
    const result = parseRunFile(serializeRun(run));
    expect(result).toEqual({ ok: true, run });
  });

  it("rejects non-JSON text", () => {
    const result = parseRunFile("not json {");
    expect(result).toEqual({ ok: false, error: "This file is not valid JSON." });
  });

  it("rejects JSON that is not an object", () => {
    const result = parseRunFile("42");
    expect(result).toEqual({ ok: false, error: "This is not a Sophon run file." });
  });

  it("rejects a wrong app tag", () => {
    const result = parseRunFile(JSON.stringify({ app: "other", schemaVersion: 1, run: sampleRun() }));
    expect(result).toEqual({ ok: false, error: "This is not a Sophon run file." });
  });

  it("rejects a mismatched schema version", () => {
    const result = parseRunFile(JSON.stringify({ app: "sophon", schemaVersion: 2, run: sampleRun() }));
    expect(result).toEqual({
      ok: false,
      error: "This file was made by a different version of Sophon and cannot be opened."
    });
  });

  it("rejects a missing run", () => {
    const result = parseRunFile(JSON.stringify({ app: "sophon", schemaVersion: 1 }));
    expect(result).toEqual({ ok: false, error: "This Sophon file is missing or has invalid run data." });
  });

  it("rejects a structurally invalid run", () => {
    const result = parseRunFile(
      JSON.stringify({ app: "sophon", schemaVersion: 1, run: { id: "x", title: "y" } })
    );
    expect(result).toEqual({ ok: false, error: "This Sophon file is missing or has invalid run data." });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test`
Expected: FAIL — `parseRunFile` is not exported.

- [ ] **Step 3: Implement `parseRunFile`**

Append to `src/lib/run-file.ts`:

```ts
export type ParseRunFileResult =
  | { ok: true; run: PromptRun }
  | { ok: false; error: string };

export function parseRunFile(text: string): ParseRunFileResult {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { ok: false, error: "This file is not valid JSON." };
  }

  if (!value || typeof value !== "object" || (value as RunExport).app !== RUN_FILE_APP) {
    return { ok: false, error: "This is not a Sophon run file." };
  }

  if ((value as RunExport).schemaVersion !== RUN_FILE_SCHEMA_VERSION) {
    return {
      ok: false,
      error: "This file was made by a different version of Sophon and cannot be opened."
    };
  }

  const run = parsePromptRun((value as RunExport).run);
  if (!run) {
    return { ok: false, error: "This Sophon file is missing or has invalid run data." };
  }

  return { ok: true, run };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test`
Expected: PASS (all `serializeRun` / `exportFilename` / `parseRunFile` tests green).

- [ ] **Step 5: Commit**

```bash
git add src/lib/run-file.ts src/lib/run-file.test.ts
git commit -m "feat: add versioned run file parsing with validation"
```

---

### Task 3: Workbench import/export UI wiring

**Files:**
- Modify: `src/components/sophon-workbench.tsx`

**Interfaces:**
- Consumes: `serializeRun`, `exportFilename`, `parseRunFile` from `src/lib/run-file.ts`; existing `currentRun`, `setCurrentRun`, `setSelection`, `setSelectedHead`, `setRunMessage` state in the component.
- Produces: no exports; user-facing Import/Export buttons.

- [ ] **Step 1: Add imports**

In `src/components/sophon-workbench.tsx`:

Add `Download` and `Upload` to the existing `lucide-react` import block (line 3-10):

```tsx
import {
  ChevronDown,
  ChevronUp,
  Download,
  LocateFixed,
  Play,
  SquareSigma,
  SlidersHorizontal,
  Upload
} from "lucide-react";
```

Change the React import (line 11) to include `useRef` and the `ChangeEvent` type:

```tsx
import { ChangeEvent, useRef, useState } from "react";
```

Add the run-file import after the `interp-client` import (line 19):

```tsx
import { exportFilename, parseRunFile, serializeRun } from "@/lib/run-file";
```

- [ ] **Step 2: Add the file input ref**

After the `detailMode` state line (line 40), add:

```tsx
  const fileInputRef = useRef<HTMLInputElement>(null);
```

- [ ] **Step 3: Add the export and import handlers**

After the `executeRun` function (after line 76, before `return`), add:

```tsx
  function exportRun() {
    if (!run) return;
    const blob = new Blob([serializeRun(run)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = exportFilename(run);
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  async function handleImportFile(event: ChangeEvent<HTMLInputElement>) {
    const input = event.target;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    if (currentRun && !window.confirm("Loading a file replaces the current run. Continue?")) {
      return;
    }

    const text = await file.text();
    const result = parseRunFile(text);

    if (result.ok) {
      setCurrentRun(result.run);
      setSelectedHead("all");
      setSelection({
        layer: Math.min(8, result.run.layers.length - 1),
        token: Math.max(0, result.run.tokens.length - 1)
      });
      setRunMessage(null);
    } else {
      setRunMessage(result.error);
    }
  }
```

`ChangeEvent` comes from the `react` import updated in Step 1.

- [ ] **Step 4: Add the hidden input and the two buttons to the header**

In the header button group (`<div className="flex shrink-0 gap-2">`, line 141), insert BEFORE the reset `LocateFixed` button:

```tsx
            <input
              accept="application/json"
              className="hidden"
              onChange={handleImportFile}
              ref={fileInputRef}
              type="file"
            />
            <Button
              onClick={() => fileInputRef.current?.click()}
              size="icon"
              title="Import run"
              type="button"
              variant="sophon"
            >
              <Upload className="size-4" />
            </Button>
            <Button
              disabled={!run}
              onClick={exportRun}
              size="icon"
              title="Export run"
              type="button"
              variant="sophon"
            >
              <Download className="size-4" />
            </Button>
```

- [ ] **Step 5: Typecheck / build**

Run: `npm run build`
Expected: build succeeds with no TypeScript errors.

- [ ] **Step 6: Manual verification**

Run: `npm run dev`, open `http://localhost:3000`.

1. With no run loaded: Export button is disabled; Import button is enabled.
2. Run a prompt (needs the interp backend), then click Export → a `sophon-<slug>-<date>.json` file downloads.
3. Reload the page (state clears). Click Import, choose the downloaded file → the run loads, the scene renders, and no confirm appears (no run was loaded).
4. With a run already loaded, click Import and choose a file → a confirm dialog appears; Cancel keeps the current run, OK replaces it.
5. Import a non-JSON file (e.g. rename any `.txt` to `.json`) → the prompt-dock banner shows "This file is not valid JSON."

- [ ] **Step 7: Commit**

```bash
git add src/components/sophon-workbench.tsx
git commit -m "feat: add import/export buttons to the workbench header"
```

---

## Notes for the implementer

- Run tests with `npm run test` (one-shot) at each verification step.
- The interp backend is only needed to *produce* a run for manual export testing; the import path and all unit tests work without it.
- Keep error copy exactly as written — the tests assert on the strings.
