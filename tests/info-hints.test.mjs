import assert from "node:assert/strict";
import test from "node:test";
import { INFO_HINTS } from "../src/lib/info-hints.ts";

const EXPECTED_HINTS = {
  modelSpecs: {
    label: "About model specifications",
    title: "Model specifications",
    terms: [/3\.35B/, /4-bit \(q4f16\)/, /8,192-token context window/]
  },
  browserStorage: {
    label: "About browser storage",
    title: "Browser storage",
    terms: [/site usage/, /estimated quota/, /best effort data may be removed/i]
  },
  generationMetrics: {
    label: "About response metrics",
    title: "Response metrics",
    terms: [/Input → output/, /tokens\/s/, /TTFT/, /omitted to fit the context/]
  },
  webgpu: {
    label: "About WebGPU",
    title: "WebGPU",
    terms: [/device’s GPU/, /not sent to an inference server/]
  },
  tokenLens: {
    label: "About token display",
    title: "Token display",
    terms: [/Tokens shows the model pieces and IDs/, /Words groups them/, /Outside context/]
  },
  modelLicense: {
    label: "About model usage",
    title: "Model usage",
    terms: [/non-commercial use/, /CC BY-NC 4\.0/, /Acceptable Use Policy/]
  }
};

test("keeps the approved InfoHint concepts, accessible labels, and explanatory terms together", () => {
  assert.deepEqual(Object.keys(INFO_HINTS), Object.keys(EXPECTED_HINTS));

  const labels = [];
  for (const [concept, expected] of Object.entries(EXPECTED_HINTS)) {
    const hint = INFO_HINTS[concept];
    assert.ok(hint, `Missing InfoHint copy for ${concept}.`);
    assert.equal(hint.label, expected.label);
    assert.equal(hint.title, expected.title);
    assert.match(hint.label, /^About /, `${concept} needs a concept-specific accessible label.`);
    assert.match(hint.description, /\.$/, `${concept} copy should end as a complete sentence.`);
    assert.ok(hint.description.length <= 240, `${concept} copy is too long for a compact infotip.`);
    for (const term of expected.terms) assert.match(hint.description, term);
    labels.push(hint.label);
  }

  assert.equal(new Set(labels).size, labels.length, "Every InfoHint trigger needs a unique accessible name.");
});
