import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, extname, join, relative } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = join(root, "src");
const sourceFiles = walk(sourceRoot).filter((file) => [".css", ".ts", ".tsx"].includes(extname(file)));

test("keeps production source below the negative-code budget", () => {
  const physicalLines = sourceFiles.reduce((total, file) => total + readFileSync(file, "utf8").split("\n").length, 0);
  assert.ok(physicalLines <= 2_500, `Production source is ${physicalLines} lines; budget is 2,500.`);
});

test("keeps deleted runtime and UI stacks out of production source", () => {
  const source = sourceFiles.map((file) => readFileSync(file, "utf8")).join("\n");
  for (const banned of ["@radix-ui/", "class-variance-authority", "next/dynamic", "onnxruntime-web", "runLocalModel"]) {
    assert.equal(source.includes(banned), false, `Deleted production path returned: ${banned}`);
  }
  assert.equal(source.match(/pipeline\("text-generation"/g)?.length, 1, "There must be one text-generation engine.");
});

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  }).sort((left, right) => relative(root, left).localeCompare(relative(root, right)));
}
