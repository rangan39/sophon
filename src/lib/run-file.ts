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
