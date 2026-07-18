#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";

const budgetBytes = Number(process.env.SOPHON_ROUTE_GZIP_BUDGET ?? 40 * 1024);
const manifestPath = ".next/server/app/page_client-reference-manifest.js";
const source = readFileSync(manifestPath, "utf8");
const marker = '["/page"] = ';
const manifestStart = source.indexOf(marker);
assert.notEqual(manifestStart, -1, `Could not find /page in ${manifestPath}.`);
const manifest = JSON.parse(source.slice(manifestStart + marker.length).replace(/;\s*$/, ""));
const entryFiles = Object.entries(manifest.entryJSFiles)
  .filter(([entry]) => entry.endsWith("/src/app/layout") || entry.endsWith("/src/app/page"))
  .flatMap(([, files]) => files);
const files = [...new Set(entryFiles)];
assert.ok(files.length > 0, "No initial app-route JavaScript was found.");

const bytes = files.reduce((total, file) => total + readFileSync(`.next/${file}`).length, 0);
const gzipBytes = files.reduce((total, file) => total + gzipSync(readFileSync(`.next/${file}`)).length, 0);
console.log(JSON.stringify({ files: files.length, bytes, gzipBytes, budgetBytes }, null, 2));
assert.ok(gzipBytes <= budgetBytes, `Initial route JavaScript is ${gzipBytes} gzip bytes; budget is ${budgetBytes}.`);
