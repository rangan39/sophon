#!/usr/bin/env node
import assert from "node:assert/strict";
import { chromium } from "playwright";

const url = process.env.SOPHON_SMOKE_URL ?? "http://localhost:3000";
const timeoutMs = Number(process.env.SOPHON_SMOKE_TIMEOUT_MS ?? 30_000);
const runtimeErrors = [];
let browser;
let activePage;

try {
  assert.ok(Number.isFinite(timeoutMs) && timeoutMs > 0, "SOPHON_SMOKE_TIMEOUT_MS must be a positive number.");
  browser = await chromium.launch({
    headless: true,
    args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan", "--ignore-gpu-blocklist", "--disable-dev-shm-usage"]
  });

  const serverContext = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 1440, height: 900 } });
  activePage = await serverContext.newPage();
  await openPage(activePage);
  await assertVisible(activePage.getByRole("status").filter({ hasText: "Loading inference console" }), "SSR loading shell");
  assert.equal(await activePage.locator("h1", { hasText: "SOPHON" }).count(), 1, "SSR response must contain the workbench shell.");
  await serverContext.close();
  console.log("✓ Server-rendered fallback and workbench shell exist without JavaScript");

  const desktopContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  activePage = await desktopContext.newPage();
  captureRuntimeErrors(activePage);
  await openPage(activePage);

  const heading = activePage.getByRole("heading", { name: "SOPHON", exact: true });
  const textarea = activePage.getByRole("textbox", { name: "Message Sophon", exact: true });
  const modelSelect = activePage.getByRole("combobox", { name: /^Choose model\./ });
  const runtimeControls = activePage.getByRole("group", { name: "Runtime controls", exact: true });
  const sendButton = activePage.getByRole("button", { name: "Send message", exact: true });
  const storageStatus = activePage.getByTestId("browser-storage");
  await assertVisible(heading, "Sophon heading");
  await assertVisible(textarea, "labeled prompt textarea");
  assert.equal(await textarea.getAttribute("placeholder"), "Ask the local model anything...");
  await assertVisible(modelSelect, "model selector");
  await assertVisible(runtimeControls, "unified runtime control rail");
  const modelTypography = await runtimeControls.evaluate((rail) => {
    const model = rail.querySelector("select");
    const status = rail.querySelector(":scope > div > span:not([aria-hidden])");
    return { modelSize: getComputedStyle(model).fontSize, statusSize: getComputedStyle(status).fontSize, modelShadow: getComputedStyle(model).textShadow, text: rail.textContent };
  });
  assert.equal(modelTypography.modelSize, modelTypography.statusSize, "Model and runtime status labels must share one type scale.");
  assert.notEqual(modelTypography.modelShadow, "none", "The selected model must carry the orange signal glow.");
  assert.doesNotMatch(modelTypography.text ?? "", /μ/, "The model selector must not include a decorative icon.");
  await assertVisible(storageStatus, "browser storage status");
  await activePage.waitForFunction(() => document.querySelector('[data-testid="browser-storage"]')?.getAttribute("data-state") === "ready", undefined, { timeout: timeoutMs });
  assert.match((await storageStatus.textContent()) ?? "", /^\s*Browser storage · .+ \/ .+ · (Persistent|Best effort)\s*$/);
  assert.equal(await modelSelect.evaluate((element) => element.tagName), "SELECT", "Model control must use a native select.");
  assert.equal(await sendButton.isDisabled(), true, "Send must be disabled for an empty prompt.");

  await activePage.waitForFunction(() => {
    const options = document.querySelectorAll('select[aria-label^="Choose model"] option');
    return options.length > 0 && [...options].every((option) => !/(checking compatibility|downloading)/.test(option.textContent ?? ""));
  }, undefined, { timeout: timeoutMs });
  const options = await modelSelect.locator("option").evaluateAll((nodes) => nodes.map((option) => ({
    disabled: option.disabled,
    label: option.textContent?.trim() ?? "",
    value: option.value
  })));
  assert.ok(options.every((option) => /(verified|experimental|unavailable)$/.test(option.label)), "Every model option must expose availability.");
  assert.ok(options.some((option) => option.value === "tiny-aya-global" && /non-commercial · experimental$/.test(option.label)), "Tiny Aya must disclose its license and experimental status without downloading it.");
  const supportedOption = options.find((option) => !option.disabled);
  assert.ok(supportedOption, "At least one model must be compatible with the smoke-test browser.");
  await modelSelect.selectOption(supportedOption.value);
  await textarea.fill("UI smoke check");
  assert.equal(await sendButton.isEnabled(), true, "Send must become enabled when the prompt and runtime are ready.");
  await textarea.fill("");
  assert.equal(await sendButton.isDisabled(), true, "Send must disable again when the prompt is cleared.");
  console.log("✓ Desktop semantics and composer gating pass");

  await activePage.setViewportSize({ width: 320, height: 800 });
  await assertVisible(textarea, "mobile prompt textarea");
  await assertVisible(modelSelect, "mobile model selector");
  await assertWithinViewport(modelSelect, 320, "mobile model selector");
  await assertWithinViewport(runtimeControls, 320, "mobile runtime control rail");
  await assertWithinViewport(storageStatus, 320, "mobile browser storage status");
  const widths = await activePage.evaluate(() => ({
    body: document.body.scrollWidth,
    document: document.documentElement.scrollWidth,
    viewport: window.innerWidth
  }));
  assert.ok(Math.max(widths.body, widths.document) <= widths.viewport + 1, `Mobile page overflows horizontally: ${JSON.stringify(widths)}`);
  console.log("✓ 320px mobile reflow has no horizontal overflow");

  await activePage.waitForTimeout(100);
  if (runtimeErrors.length > 0) throw new Error("Runtime browser errors were detected.");
  await desktopContext.close();

  const preloadContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  let blockedModelRoute;
  let modelRequestTimeout;
  let resolveModelRequest;
  const modelRequest = new Promise((resolve) => { resolveModelRequest = resolve; });
  await preloadContext.route("https://**/*", (route) => {
    const requestUrl = route.request().url();
    if (requestUrl.includes("onnx-community/tiny-aya-global-ONNX")) {
      blockedModelRoute = route;
      resolveModelRequest(requestUrl);
      return;
    }
    void route.abort("blockedbyclient");
  });
  activePage = await preloadContext.newPage();
  await openPage(activePage);
  const preloadSelect = activePage.locator('select[aria-label^="Choose model"]');
  const preloadSend = activePage.getByRole("button", { name: "Send message", exact: true });
  await preloadSelect.waitFor({ state: "visible", timeout: timeoutMs });
  await activePage.waitForFunction(() => [...document.querySelectorAll('select option')].some((option) => option.value === "tiny-aya-global" && option.textContent?.endsWith("experimental") && !option.disabled) && document.querySelector('select')?.value === "tiny-gpt2", undefined, { timeout: timeoutMs });
  await preloadSelect.selectOption("tiny-aya-global");
  const requestedModelUrl = await Promise.race([modelRequest, new Promise((_, reject) => { modelRequestTimeout = setTimeout(() => reject(new Error("Tiny Aya preload did not request its pinned repository.")), timeoutMs); })]);
  clearTimeout(modelRequestTimeout);
  assert.match(requestedModelUrl, /7fff1be9627e40f0d89c33f406882bdafb56ec90/);
  const loadingSelection = await preloadSelect.evaluate((select) => ({ label: select.selectedOptions[0]?.textContent?.trim(), value: select.value }));
  assert.deepEqual(loadingSelection, { label: "Tiny Aya Global 3.35B · non-commercial · downloading", value: "tiny-aya-global" });
  const progressBar = activePage.getByRole("progressbar", { name: "Loading Tiny Aya Global 3.35B · non-commercial", exact: true });
  await assertVisible(progressBar, "model download progress bar");
  assert.equal(await progressBar.getAttribute("aria-valuenow"), null, "Progress must remain indeterminate until byte totals arrive.");
  assert.equal(await preloadSelect.isEnabled(), true, "The model selector must remain enabled so another selection can cancel the download.");
  await activePage.getByRole("textbox", { name: "Message Sophon", exact: true }).fill("Preload gate");
  assert.equal(await preloadSend.isDisabled(), true, "Send must remain disabled while the selected model downloads.");
  await blockedModelRoute.abort("blockedbyclient");
  await activePage.locator("#prompt-error").waitFor({ state: "visible", timeout: timeoutMs });
  await progressBar.waitFor({ state: "detached", timeout: timeoutMs });
  assert.equal(await preloadSend.isEnabled(), true, "A failed preload must leave generation available for an explicit retry.");
  await preloadContext.close();
  console.log("✓ Dropdown selection starts the pinned download and gates generation");

  const progressContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await progressContext.addInitScript(() => {
    const requests = [];
    Object.defineProperty(window, "__sophonWorkerRequests", { value: requests });
    class FakeWorker {
      constructor() {
        this.onmessage = null;
        this.terminated = false;
      }
      postMessage(request) {
        requests.push(request);
        if (request.type === "capabilities") queueMicrotask(() => this.respond({ type: "complete", requestId: request.requestId, result: { webgpu: true, wasm: true, crossOriginIsolated: false } }));
        if (request.type === "preload") queueMicrotask(() => {
          this.respond({ type: "log", requestId: request.requestId, event: { level: "info", message: "Loading model", phase: "download", progress: { loaded: 25, total: 100 } } });
          if (request.modelId === "tiny-gpt2") this.respond({ type: "complete", requestId: request.requestId, result: { ok: true } });
          else window.__finishPreload = () => this.respond({ type: "complete", requestId: request.requestId, result: { ok: true } });
        });
        if (request.type === "generate") queueMicrotask(() => this.respond({
          type: "complete",
          requestId: request.requestId,
          result: { ok: true, result: {
            generatedText: "Sharper token controls.",
            inputTokens: [{ id: 1, text: "Show", inContext: true }, { id: 2, text: " tokens", inContext: true }],
            generatedTokens: [{ id: 3, text: "Sharper" }, { id: 4, text: " controls." }],
            outputTokenCount: 2,
            metrics: { provider: "webgpu", modelLoadMs: 0, endToEndMs: 12, ttftMs: 4, decodeMs: 8, decodeTokensPerSecond: 125, timePerOutputTokenMs: 8, p95InterTokenLatencyMs: 8, promptTokenCount: 2, contextTokenCount: 2, truncatedInputTokens: 0, outputTokenCount: 2 }
          } }
        }));
      }
      respond(data) {
        if (!this.terminated) this.onmessage?.({ data });
      }
      terminate() {
        this.terminated = true;
      }
    }
    Object.defineProperty(window, "Worker", { configurable: true, value: FakeWorker });
  });
  activePage = await progressContext.newPage();
  await openPage(activePage);
  const progressSelect = activePage.locator('select[aria-label^="Choose model"]');
  await activePage.waitForFunction(() => [...document.querySelectorAll('select option')].some((option) => option.value === "tiny-aya-global" && option.textContent?.endsWith("experimental")), undefined, { timeout: timeoutMs });
  await progressSelect.selectOption("tiny-aya-global");
  await activePage.waitForFunction(() => window.__sophonWorkerRequests?.some((request) => request.type === "preload" && request.modelId === "tiny-aya-global"), undefined, { timeout: timeoutMs });
  const determinateProgress = activePage.getByRole("progressbar", { name: "Loading Tiny Aya Global 3.35B · non-commercial", exact: true });
  await assertVisible(determinateProgress, "determinate model download progress bar");
  assert.equal(await determinateProgress.getAttribute("aria-valuenow"), "25");
  assert.equal(await determinateProgress.getAttribute("aria-valuetext"), "25 B of 100 B loaded");
  assert.equal((await activePage.evaluate(() => window.__sophonWorkerRequests)).some((request) => request.type === "generate"), false);
  await activePage.evaluate(() => window.__finishPreload());
  await determinateProgress.waitFor({ state: "detached", timeout: timeoutMs });
  await activePage.getByRole("img", { name: "Model ready", exact: true }).waitFor({ state: "visible", timeout: timeoutMs });
  await activePage.getByRole("textbox", { name: "Message Sophon", exact: true }).fill("Show tokens");
  await activePage.getByRole("button", { name: "Send message", exact: true }).click();
  await activePage.waitForFunction(() => document.querySelectorAll('[aria-label="Message display granularity"]').length === 2, undefined, { timeout: timeoutMs });
  const modeLayout = await activePage.getByRole("group", { name: "Message display granularity", exact: true }).evaluateAll((groups) => groups.map((group) => {
    const box = group.getBoundingClientRect();
    return { height: box.height, width: box.width, alignment: getComputedStyle(group.parentElement).justifyContent, insideBubble: Boolean(group.closest('[data-slot="bubble-content"]')), labels: [...group.querySelectorAll("button")].map((button) => button.textContent?.trim()) };
  }));
  assert.equal(modeLayout.length, 2);
  assert.ok(modeLayout.every(({ height, width, alignment, insideBubble, labels }) => insideBubble && alignment === "flex-start" && height <= 28 && width < 150 && labels.join("|") === "text|tokens|words"), `Token mode controls must be compact and left-aligned inside their bubbles: ${JSON.stringify(modeLayout)}`);
  if (process.env.SOPHON_SMOKE_SCREENSHOT_PATH) await activePage.screenshot({ path: process.env.SOPHON_SMOKE_SCREENSHOT_PATH, fullPage: true });
  await progressContext.close();
  console.log("✓ Aggregate download progress and compact in-bubble token controls render correctly");

  const fallbackContext = await browser.newContext({ viewport: { width: 320, height: 800 } });
  await fallbackContext.addInitScript(() => Object.defineProperty(Navigator.prototype, "storage", { configurable: true, get: () => undefined }));
  activePage = await fallbackContext.newPage();
  captureRuntimeErrors(activePage);
  await openPage(activePage);
  const fallbackStorage = activePage.getByTestId("browser-storage");
  await assertVisible(fallbackStorage, "unavailable browser storage status");
  await activePage.waitForFunction(() => document.querySelector('[data-testid="browser-storage"]')?.getAttribute("data-state") === "unavailable", undefined, { timeout: timeoutMs });
  assert.match((await fallbackStorage.textContent()) ?? "", /Browser storage · Unavailable/);
  if (runtimeErrors.length > 0) throw new Error("Runtime browser errors were detected.");
  await fallbackContext.close();
  console.log("✓ Browser storage fallback handles unsupported browsers");
  console.log(`UI smoke test passed: ${url}`);
} catch (error) {
  const screenshotPath = "/tmp/sophon-smoke-ui-failure.png";
  await activePage?.screenshot({ path: screenshotPath, fullPage: true }).catch(() => undefined);
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  if (runtimeErrors.length > 0) console.error(`\nRuntime browser errors:\n${runtimeErrors.join("\n")}`);
  console.error(`\nScreenshot: ${screenshotPath}`);
  process.exitCode = 1;
} finally {
  await browser?.close().catch(() => undefined);
}

async function openPage(page) {
  const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
  assert.ok(response?.ok(), `Expected a successful response from ${url}, received ${response?.status() ?? "no response"}.`);
}

async function assertVisible(locator, label) {
  await locator.waitFor({ state: "visible", timeout: timeoutMs });
  assert.equal(await locator.count(), 1, `Expected exactly one ${label}.`);
  assert.equal(await locator.isVisible(), true, `Expected ${label} to be visible.`);
}

async function assertWithinViewport(locator, viewportWidth, label) {
  const box = await locator.boundingBox();
  assert.ok(box && box.x >= -1 && box.x + box.width <= viewportWidth + 1, `${label} is outside the ${viewportWidth}px viewport: ${JSON.stringify(box)}`);
}

function captureRuntimeErrors(page) {
  page.on("console", (message) => {
    if (message.type() === "error") runtimeErrors.push(`console: ${message.text()}`);
  });
  page.on("pageerror", (error) => runtimeErrors.push(`pageerror: ${error.message}`));
}
