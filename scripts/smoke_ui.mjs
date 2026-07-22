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
  const modelLibrary = activePage.getByRole("complementary", { name: "Model library", exact: true });
  const modelRadios = modelLibrary.getByRole("radio");
  const sendButton = activePage.getByRole("button", { name: "Send message", exact: true });
  const storageStatus = activePage.getByTestId("browser-storage");
  await assertVisible(heading, "Sophon heading");
  await assertVisible(textarea, "labeled prompt textarea");
  assert.equal(await textarea.getAttribute("placeholder"), "Ask the local model anything...");
  await assertVisible(modelLibrary, "desktop model library");
  await assertVisible(storageStatus, "browser storage status");
  await activePage.waitForFunction(() => document.querySelector('[data-testid="browser-storage"]')?.getAttribute("data-state") === "ready", undefined, { timeout: timeoutMs });
  assert.match((await storageStatus.textContent()) ?? "", /^\s*Browser storage · .+ \/ .+ · (Persistent|Best effort)\s*$/);
  assert.equal(await modelRadios.count(), 4, "Model library must expose exactly four native radio controls.");
  assert.equal(await sendButton.isDisabled(), true, "Send must be disabled for an empty prompt.");

  await activePage.waitForFunction(() => {
    const radios = document.querySelectorAll('[data-model-surface="desktop"] input[type="radio"]');
    return radios.length === 4 && [...radios].every((radio) => !/(Checking WebGPU|Downloading)/.test(radio.getAttribute("aria-label") ?? ""));
  }, undefined, { timeout: timeoutMs });
  const models = await modelRadios.evaluateAll((nodes) => nodes.map((radio) => ({
    checked: radio.checked,
    disabled: radio.disabled,
    label: radio.getAttribute("aria-label") ?? "",
    value: radio.value
  })));
  assert.deepEqual(models.map((model) => model.value), ["tiny-aya-global", "tiny-aya-earth", "tiny-aya-fire", "tiny-aya-water"]);
  assert.ok(models.every((model) => /\.( Available| Requires WebGPU)\.$/.test(model.label)), "Every model radio must expose availability.");
  assert.ok(models.every((model) => /non-commercial/.test(model.label)), "Every Tiny Aya model must disclose its non-commercial license.");
  assert.ok(models.some((model) => !model.disabled), "At least one model must be compatible with the smoke-test browser.");
  assert.ok(models.every((model) => !model.checked), "No model should be selected before an explicit user choice.");
  await textarea.fill("UI smoke check");
  assert.equal(await sendButton.isDisabled(), true, "Send must remain disabled until a model is selected.");
  await textarea.fill("");
  assert.equal(await sendButton.isDisabled(), true, "Send must disable again when the prompt is cleared.");
  const toggleModels = modelLibrary.locator('button[aria-controls="model-library-desktop"]');
  assert.equal(await toggleModels.getAttribute("aria-label"), "Collapse model library");
  await toggleModels.click();
  assert.equal(await modelLibrary.getAttribute("data-state"), "collapsed");
  assert.equal(await toggleModels.getAttribute("aria-expanded"), "false");
  await activePage.waitForFunction(() => (document.querySelector("#model-library-desktop")?.getBoundingClientRect().width ?? Infinity) <= 80, undefined, { timeout: timeoutMs });
  assert.ok((await modelLibrary.boundingBox())?.width <= 80, "Collapsed model rail must remain compact.");
  await modelLibrary.getByRole("button", { name: "Expand model library", exact: true }).click();
  assert.equal(await modelLibrary.getAttribute("data-state"), "expanded");
  console.log("✓ Desktop semantics and composer gating pass");

  await activePage.setViewportSize({ width: 320, height: 800 });
  await assertVisible(textarea, "mobile prompt textarea");
  const mobileTrigger = activePage.getByRole("button", { name: "Open model library", exact: true });
  await assertVisible(mobileTrigger, "mobile model-library trigger");
  await mobileTrigger.click();
  const mobileDialog = activePage.getByRole("dialog", { name: "Model library", exact: true });
  await assertVisible(mobileDialog, "mobile model-library sheet");
  assert.equal(await mobileTrigger.getAttribute("aria-expanded"), "true");
  assert.equal(await mobileDialog.getByRole("radio").count(), 4, "Mobile sheet must expose the same four models.");
  await assertWithinViewport(activePage.getByTestId("mobile-model-sheet"), 320, "mobile model-library sheet");
  await activePage.keyboard.press("Escape");
  await mobileDialog.waitFor({ state: "hidden", timeout: timeoutMs });
  assert.equal(await mobileTrigger.getAttribute("aria-expanded"), "false");
  assert.equal(await mobileTrigger.evaluate((element) => document.activeElement === element), true, "Closing the mobile sheet must restore trigger focus.");
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
  const preloadModels = activePage.getByRole("complementary", { name: "Model library", exact: true });
  const preloadGlobal = preloadModels.locator('[data-model-id="tiny-aya-global"]');
  const preloadSend = activePage.getByRole("button", { name: "Send message", exact: true });
  await preloadGlobal.waitFor({ state: "visible", timeout: timeoutMs });
  await activePage.waitForFunction(() => {
    const radios = [...document.querySelectorAll('[data-model-surface="desktop"] input[type="radio"]')];
    return radios.some((radio) => radio.value === "tiny-aya-global" && radio.getAttribute("aria-label")?.endsWith("Available.") && !radio.disabled) && radios.every((radio) => !radio.checked);
  }, undefined, { timeout: timeoutMs });
  await preloadGlobal.click();
  const requestedModelUrl = await Promise.race([modelRequest, new Promise((_, reject) => { modelRequestTimeout = setTimeout(() => reject(new Error("Tiny Aya preload did not request its pinned repository.")), timeoutMs); })]);
  clearTimeout(modelRequestTimeout);
  assert.match(requestedModelUrl, /7fff1be9627e40f0d89c33f406882bdafb56ec90/);
  const loadingSelection = await preloadGlobal.getByRole("radio").evaluate((radio) => ({ checked: radio.checked, label: radio.getAttribute("aria-label"), value: radio.value }));
  assert.deepEqual(loadingSelection, { checked: true, label: "Tiny Aya Global 3.35B · non-commercial. Downloading.", value: "tiny-aya-global" });
  const progressBar = activePage.getByRole("progressbar", { name: "Loading Tiny Aya Global 3.35B · non-commercial", exact: true });
  await assertVisible(progressBar, "model download progress bar");
  assert.equal(await progressBar.getAttribute("aria-valuenow"), null, "Progress must remain indeterminate until byte totals arrive.");
  assert.equal(await preloadModels.locator('[data-model-id="tiny-aya-earth"] input').isEnabled(), true, "Other model radios must remain enabled so another selection can cancel the download.");
  await activePage.getByRole("textbox", { name: "Message Sophon", exact: true }).fill("Preload gate");
  assert.equal(await preloadSend.isDisabled(), true, "Send must remain disabled while the selected model downloads.");
  await blockedModelRoute.abort("blockedbyclient");
  await activePage.locator("#prompt-error").waitFor({ state: "visible", timeout: timeoutMs });
  await progressBar.waitFor({ state: "detached", timeout: timeoutMs });
  assert.equal(await preloadSend.isEnabled(), true, "A failed preload must leave generation available for an explicit retry.");
  await preloadContext.close();
  console.log("✓ Sidebar selection starts the pinned download and gates generation");

  const progressContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await progressContext.addInitScript(() => {
    const requests = [];
    Object.defineProperty(window, "__sophonWorkerRequests", { value: requests });
    Object.defineProperty(window, "__storagePersistCalls", { value: 0, writable: true });
    try {
      Object.defineProperty(navigator.storage, "persist", { configurable: true, value: async () => { window.__storagePersistCalls += 1; return true; } });
    } catch {}
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
          window.__setDownloadProgress = (progress) => this.respond({ type: "log", requestId: request.requestId, event: { level: "info", message: "Loading model", phase: "download", progress } });
          window.__finishPreload = () => this.respond({ type: "complete", requestId: request.requestId, result: { ok: true } });
        });
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
  const progressGlobal = activePage.locator('[data-model-surface="desktop"][data-model-id="tiny-aya-global"]');
  await activePage.waitForFunction(() => document.querySelector('[data-model-surface="desktop"] input[value="tiny-aya-global"]')?.getAttribute("aria-label")?.endsWith("Available."), undefined, { timeout: timeoutMs });
  assert.equal((await activePage.evaluate(() => window.__sophonWorkerRequests)).some((request) => request.type === "preload"), false, "Capability probing must not preload a model.");
  await progressGlobal.click();
  await activePage.waitForFunction(() => window.__storagePersistCalls === 1, undefined, { timeout: timeoutMs });
  await activePage.waitForFunction(() => window.__sophonWorkerRequests?.some((request) => request.type === "preload" && request.modelId === "tiny-aya-global"), undefined, { timeout: timeoutMs });
  const determinateProgress = activePage.getByRole("progressbar", { name: "Loading Tiny Aya Global 3.35B · non-commercial", exact: true });
  await assertVisible(determinateProgress, "determinate model download progress bar");
  assert.equal(await determinateProgress.getAttribute("aria-valuenow"), "25");
  assert.equal(await determinateProgress.getAttribute("aria-valuetext"), "25 B of 100 B loaded");
  await activePage.evaluate(() => window.__setDownloadProgress({ loaded: 50, total: 100, stage: "resume", resumedBytes: 25, networkBytes: 25, bytesPerSecond: 20, etaMs: 2500 }));
  await activePage.getByText("Resuming model · 50%", { exact: true }).waitFor({ state: "visible", timeout: timeoutMs });
  assert.equal(await determinateProgress.getAttribute("aria-valuetext"), "50 B of 100 B loaded, including 25 B resumed");
  assert.match(await progressGlobal.getByRole("radio").getAttribute("aria-label") ?? "", /\. Resuming 50%\.$/);
  await activePage.evaluate(() => window.__setDownloadProgress({ loaded: 80, total: 100, stage: "verify" }));
  await activePage.getByText("Verifying model · 80%", { exact: true }).waitFor({ state: "visible", timeout: timeoutMs });
  assert.equal(await determinateProgress.getAttribute("aria-valuetext"), "80 B of 100 B verified");
  await activePage.evaluate(() => window.__setDownloadProgress({ loaded: 100, total: 100, stage: "cache" }));
  await activePage.getByText("Loading cached model · 100%", { exact: true }).waitFor({ state: "visible", timeout: timeoutMs });
  assert.equal(await determinateProgress.getAttribute("aria-valuetext"), "100 B of 100 B loaded from cache");
  assert.equal((await activePage.evaluate(() => window.__sophonWorkerRequests)).some((request) => request.type === "generate"), false);
  await activePage.evaluate(() => window.__finishPreload());
  await determinateProgress.waitFor({ state: "detached", timeout: timeoutMs });
  await activePage.getByText("Model ready", { exact: true }).waitFor({ state: "visible", timeout: timeoutMs });
  await progressContext.close();
  console.log("✓ Aggregate byte progress renders determinate state and clears at readiness");

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
