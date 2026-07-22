#!/usr/bin/env node
import { chromium } from "playwright";

const url = process.env.SOPHON_SMOKE_URL ?? process.argv[2] ?? "http://localhost:3000";
const prompt = process.env.SOPHON_SMOKE_PROMPT ?? process.argv[3] ?? "The proof is";
const modelId = process.env.SOPHON_SMOKE_MODEL ?? "tiny-aya-global";
const timeoutMs = Number(process.env.SOPHON_SMOKE_TIMEOUT_MS ?? 30 * 60_000);

let browser;
let page;
const browserMessages = [];

try {
  browser = await chromium.launch({
    headless: true,
    args: [
      "--enable-unsafe-webgpu",
      "--enable-features=Vulkan",
      "--ignore-gpu-blocklist",
      "--disable-dev-shm-usage"
    ]
  });

  page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on("console", (message) => {
    browserMessages.push(`${message.type()}: ${message.text()}`);
  });

  page.on("pageerror", (error) => {
    browserMessages.push(`pageerror: ${error.message}`);
  });

  console.log(`Opening ${url}`);
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });

  console.log(`Selecting model: ${modelId}`);
  const modelCard = page.locator(`[data-model-surface="desktop"][data-model-id="${modelId}"]`);
  await modelCard.click();
  await page.getByText("Model ready", { exact: true }).waitFor({ state: "visible", timeout: timeoutMs });

  console.log(`Running prompt: ${JSON.stringify(prompt)}`);
  await page.getByPlaceholder("Ask the local model anything...").fill(prompt);
  await page.getByRole("button", { name: "Send message" }).click();

  const result = await waitForPromptResult(page, prompt, timeoutMs);
  console.log(result);
} catch (error) {
  const screenshotPath = "/tmp/sophon-smoke-prompt-failure.png";
  await page?.screenshot({ path: screenshotPath, fullPage: true }).catch(() => undefined);
  console.error(error instanceof Error ? error.message : String(error));
  if (browserMessages.length > 0) {
    console.error("\nBrowser messages:");
    console.error(browserMessages.slice(-25).join("\n"));
  }
  console.error(`\nScreenshot: ${screenshotPath}`);
  process.exitCode = 1;
} finally {
  await browser?.close();
}

async function waitForPromptResult(page, prompt, timeoutMs) {
  const startedAt = Date.now();
  const userMessage = page.getByText(prompt, { exact: true });
  const metrics = page.getByText(/\d+(?:\.\d+)? tok\/s/).last();
  const knownFailurePatterns = [
    /WebGPU unavailable/i,
    /model worker failed/i,
    /requires webgpu/i,
    /Inference failed/i
  ];

  while (Date.now() - startedAt < timeoutMs) {
    if (await userMessage.isVisible().catch(() => false) && await metrics.isVisible().catch(() => false)) {
      const metricText = await metrics.textContent();
      return `Prompt run completed for ${JSON.stringify(prompt)}.${metricText ? `\n${metricText.trim()}` : ""}`;
    }

    const bodyText = await page.locator("body").textContent().catch(() => "");
    const failure = knownFailurePatterns.find((pattern) => pattern.test(bodyText ?? ""));
    if (failure) {
      throw new Error(`Prompt run failed: ${extractRelevantText(bodyText ?? "", failure)}`);
    }

    await page.waitForTimeout(500);
  }

  throw new Error(`Timed out after ${timeoutMs}ms waiting for prompt run to complete.`);
}

function extractRelevantText(text, pattern) {
  const normalized = text.replace(/\s+/g, " ").trim();
  const match = normalized.match(pattern);
  if (!match || match.index === undefined) return normalized.slice(0, 500);
  return normalized.slice(Math.max(0, match.index - 120), match.index + 360);
}
