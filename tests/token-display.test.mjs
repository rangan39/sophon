import assert from "node:assert/strict";
import test from "node:test";
import { decodeTokenPieces, groupTokenPieces, markActiveContext } from "../src/lib/token-display.ts";

test("preserves tokenizer IDs and visible whitespace in token pieces", () => {
  const vocabulary = new Map([[10, "signal"], [20, " arrived"], [30, "\n"]]);
  const tokens = decodeTokenPieces([10, 20, 30], ([id]) => vocabulary.get(id) ?? "");

  assert.deepEqual(tokens, [
    { id: 10, text: "signal" },
    { id: 20, text: " arrived" },
    { id: 30, text: "\n" }
  ]);
});

test("marks only tokens retained by the active context window", () => {
  const tokens = markActiveContext([
    { id: 1, text: "old" },
    { id: 2, text: " context" },
    { id: 3, text: " active" }
  ], 2);

  assert.deepEqual(tokens.map((token) => token.inContext), [false, false, true]);
});

test("groups subword pieces without changing the rendered text", () => {
  const tokens = [
    { id: 1, text: "cos" },
    { id: 2, text: "mic" },
    { id: 3, text: " molasses" },
    { id: 4, text: ":" }
  ];
  const groups = groupTokenPieces(tokens);

  assert.equal(groups.map((group) => group.text).join(""), "cosmic molasses:");
  assert.deepEqual(groups.map((group) => group.tokenIds), [[1, 2], [3, 4]]);
});
