import { describe, expect, it } from "vitest";
import { PromptRun } from "@/lib/prompt-run";
import { exportFilename, parseRunFile, serializeRun } from "@/lib/run-file";

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
