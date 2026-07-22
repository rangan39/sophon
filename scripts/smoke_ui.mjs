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
  const resetButton = activePage.getByRole("button", { name: "Reset conversation", exact: true });
  const attribution = modelLibrary.getByRole("button", { name: "Made in Toronto by Rangan39", exact: true });
  const storageStatus = activePage.getByTestId("browser-storage");
  await assertVisible(heading, "Sophon heading");
  await assertVisible(textarea, "labeled prompt textarea");
  assert.equal(await textarea.getAttribute("placeholder"), "Ask the local model anything...");
  await assertVisible(modelLibrary, "desktop model library");
  await assertVisible(resetButton, "conversation reset control");
  await assertVisible(attribution, "Toronto attribution footer");
  assert.match((await attribution.textContent()) ?? "", /Made in Toronto by Rangan39/i);
  assert.equal(await attribution.getAttribute("aria-haspopup"), "dialog");
  await attribution.click();
  const acknowledgements = activePage.getByRole("dialog", { name: "Acknowledgements", exact: true });
  await assertVisible(acknowledgements, "acknowledgements dialog");
  const acknowledgementsPanel = acknowledgements.getByTestId("acknowledgements-panel");
  assert.equal(await acknowledgementsPanel.evaluate((element) => getComputedStyle(element).animationName), "sophon-dialog-in", "Acknowledgements should enter with the restrained panel transition.");
  assert.equal(await acknowledgementsPanel.evaluate((element) => getComputedStyle(element).animationDuration), "0.12s", "Acknowledgements transition should remain snappy.");
  const technicalAcknowledgements = acknowledgements.getByTestId("acknowledgements-technical");
  const communityAcknowledgements = acknowledgements.getByTestId("acknowledgements-community");
  await assertVisible(acknowledgements.getByRole("heading", { name: "Technical", exact: true }), "technical acknowledgements heading");
  await assertVisible(acknowledgements.getByRole("heading", { name: "Community", exact: true }), "community acknowledgements heading");
  assert.equal(await technicalAcknowledgements.locator("li").count(), 4, "Technical acknowledgements must include all four model/runtime credits.");
  assert.equal(await communityAcknowledgements.locator("li").count(), 3, "Community acknowledgements must include all three organizations.");
  assert.equal(await communityAcknowledgements.getByRole("link", { name: "Radical Ventures", exact: true }).getAttribute("href"), "https://radical.vc/");
  assert.equal(await communityAcknowledgements.getByRole("link", { name: "NEXT Canada", exact: true }).getAttribute("href"), "https://www.nextcanada.com/");
  assert.equal(await communityAcknowledgements.getByRole("link", { name: "Trajectory Labs", exact: true }).getAttribute("href"), "https://www.trajectorylabs.org/");
  assert.equal(await acknowledgements.getByRole("link", { name: "rangan39", exact: true }).getAttribute("href"), "https://github.com/rangan39");
  await activePage.keyboard.press("Escape");
  await acknowledgements.waitFor({ state: "hidden", timeout: timeoutMs });
  assert.equal(await attribution.evaluate((element) => document.activeElement === element), true, "Closing acknowledgements must restore trigger focus.");
  assert.equal(await resetButton.getAttribute("title"), "Reset conversation");
  assert.equal((await resetButton.textContent())?.trim(), "", "Reset control must remain icon-only.");
  assert.equal(await resetButton.isDisabled(), true, "Reset must be disabled for an empty conversation.");
  await assertVisible(storageStatus, "browser storage status");
  await activePage.waitForFunction(() => document.querySelector('[data-testid="browser-storage"]')?.getAttribute("data-state") === "ready", undefined, { timeout: timeoutMs });
  assert.match((await storageStatus.textContent()) ?? "", /^\s*Browser storage · .+ \/ .+ · (Persistent|Best effort)\s*$/);
  assert.equal(await storageStatus.getAttribute("title"), null, "Browser storage must not expose a second native tooltip.");
  await assertVisible(modelLibrary.getByText("4 models", { exact: true }), "plain-language model count");
  await assertVisible(modelLibrary.getByText("3.35B · 4-bit · 8K", { exact: true }), "plain-language model specifications");
  await assertVisible(modelLibrary.getByText("Non-commercial use", { exact: true }), "plain-language model usage label");

  const modelSpecsHint = modelLibrary.locator('[data-info-hint-trigger][aria-label="About model specifications"]');
  const webgpuHint = modelLibrary.locator('[data-info-hint-trigger][aria-label="About WebGPU"]');
  const modelUsageHint = modelLibrary.locator('[data-info-hint-trigger][aria-label="About model usage"]');
  const browserStorageHint = activePage.locator('[data-info-hint-trigger][aria-label="About browser storage"]');
  await assertInfoHintTrigger(modelSpecsHint, "modelSpecs", "model specifications InfoHint");
  await assertInfoHintTrigger(webgpuHint, "webgpu", "WebGPU InfoHint");
  await assertInfoHintTrigger(modelUsageHint, "modelLicense", "model usage InfoHint");
  await assertInfoHintTrigger(browserStorageHint, "browserStorage", "browser storage InfoHint");

  await modelSpecsHint.hover();
  const modelSpecsContent = activePage.locator('[data-slot="tooltip-content"][data-help-id="modelSpecs"]');
  await assertImmediatelyVisible(modelSpecsContent, "hovered model specifications tooltip");
  await assertTooltipContract(modelSpecsHint, modelSpecsContent, "model specifications tooltip");
  await assertCenteredAbove(modelSpecsHint, modelSpecsContent, "model specifications tooltip");
  assert.match((await modelSpecsContent.textContent()) ?? "", /3\.35B.+4-bit \(q4f16\).+8,192-token context window/s);
  await modelSpecsHint.click();
  await modelSpecsContent.waitFor({ state: "hidden", timeout: timeoutMs });
  await heading.hover();
  await modelSpecsHint.dispatchEvent("click");
  await activePage.waitForTimeout(100);
  assert.equal(await modelSpecsContent.isVisible(), false, "Click activation alone must not reveal an InfoHint.");

  await focusWithKeyboard(activePage, browserStorageHint, "browser storage InfoHint");
  assert.equal(await browserStorageHint.evaluate((element) => document.activeElement === element), true, "InfoHint must be keyboard focusable.");
  const browserStorageContent = activePage.locator('[data-slot="tooltip-content"][data-help-id="browserStorage"]');
  await assertImmediatelyVisible(browserStorageContent, "focus-opened browser storage tooltip");
  await assertTooltipContract(browserStorageHint, browserStorageContent, "browser storage tooltip");
  await assertCenteredAbove(browserStorageHint, browserStorageContent, "browser storage tooltip");
  await assertBoxWithinViewport(browserStorageContent, { width: 1440, height: 900 }, "browser storage tooltip");
  assert.match((await browserStorageContent.textContent()) ?? "", /estimated quota.+best effort data may be removed/is);
  await activePage.keyboard.press("Escape");
  await browserStorageContent.waitFor({ state: "hidden", timeout: timeoutMs });
  assert.equal(await browserStorageHint.evaluate((element) => document.activeElement === element), true, "Escape must close an InfoHint without moving trigger focus.");
  await activePage.keyboard.press("Tab");
  await browserStorageContent.waitFor({ state: "hidden", timeout: timeoutMs });
  await focusWithKeyboard(activePage, browserStorageHint, "browser storage InfoHint after blur");
  await assertImmediatelyVisible(browserStorageContent, "refocused browser storage tooltip");
  await activePage.keyboard.press("Tab");
  await browserStorageContent.waitFor({ state: "hidden", timeout: timeoutMs });
  assert.equal(await modelRadios.count(), 4, "Model library must expose exactly four native radio controls.");
  assert.equal(await sendButton.isDisabled(), true, "Send must be disabled for an empty prompt.");

  await activePage.waitForFunction(() => {
    const radios = document.querySelectorAll('[data-model-surface="desktop"] input[type="radio"]');
    return radios.length === 4 && [...radios].every((radio) => !/(Checking browser GPU|Downloading)/.test(radio.getAttribute("aria-label") ?? ""));
  }, undefined, { timeout: timeoutMs });
  const models = await modelRadios.evaluateAll((nodes) => nodes.map((radio) => ({
    checked: radio.checked,
    disabled: radio.disabled,
    label: radio.getAttribute("aria-label") ?? "",
    value: radio.value
  })));
  assert.deepEqual(models.map((model) => model.value), ["tiny-aya-global", "tiny-aya-earth", "tiny-aya-fire", "tiny-aya-water"]);
  assert.ok(models.every((model) => /\.( Ready to download| Browser GPU required)\.$/.test(model.label)), "Every model radio must expose availability.");
  assert.ok(models.every((model) => /non-commercial/.test(model.label)), "Every Tiny Aya model must disclose its non-commercial license.");
  assert.ok(models.some((model) => !model.disabled), "At least one model must be compatible with the smoke-test browser.");
  assert.ok(models.every((model) => !model.checked), "No model should be selected before an explicit user choice.");
  await textarea.fill("UI smoke check");
  assert.equal(await sendButton.isDisabled(), true, "Send must remain disabled until a model is selected.");
  assert.equal(await resetButton.isEnabled(), true, "Reset must enable when the composer contains text.");
  await resetButton.press("Enter");
  assert.equal(await textarea.inputValue(), "", "Reset must clear the composer.");
  assert.equal(await resetButton.isDisabled(), true, "Reset must disable after restoring the empty conversation.");
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
  await assertVisible(resetButton, "mobile conversation reset control");
  await assertWithinViewport(resetButton, 320, "mobile conversation reset control");
  const mobileTrigger = activePage.getByRole("button", { name: "Open model library", exact: true });
  await assertVisible(mobileTrigger, "mobile model-library trigger");
  await mobileTrigger.click();
  const mobileDialog = activePage.getByRole("dialog", { name: "Model library", exact: true });
  await assertVisible(mobileDialog, "mobile model-library sheet");
  assert.equal(await mobileTrigger.getAttribute("aria-expanded"), "true");
  assert.equal(await mobileDialog.getByRole("radio").count(), 4, "Mobile sheet must expose the same four models.");
  await assertWithinViewport(activePage.getByTestId("mobile-model-sheet"), 320, "mobile model-library sheet");
  const mobileSpecsHint = mobileDialog.locator('[data-info-hint-trigger][aria-label="About model specifications"]');
  await assertInfoHintTrigger(mobileSpecsHint, "modelSpecs", "mobile model specifications InfoHint");
  await mobileSpecsHint.hover();
  const mobileSpecsContent = mobileDialog.locator('[data-slot="tooltip-content"][data-help-id="modelSpecs"]');
  await assertImmediatelyVisible(mobileSpecsContent, "mobile model specifications tooltip");
  await assertTooltipContract(mobileSpecsHint, mobileSpecsContent, "mobile model specifications tooltip");
  await assertAbove(mobileSpecsHint, mobileSpecsContent, "mobile model specifications tooltip");
  const mobileSpecsBox = await assertBoxWithinViewport(mobileSpecsContent, { width: 320, height: 800 }, "mobile model specifications tooltip");
  assert.ok(mobileSpecsBox.width <= 281, `Mobile InfoHint must stay within its 280px maximum width: ${JSON.stringify(mobileSpecsBox)}`);
  await mobileSpecsHint.click();
  await mobileSpecsContent.waitFor({ state: "hidden", timeout: timeoutMs });
  const mobileAttribution = mobileDialog.getByRole("button", { name: "Made in Toronto by Rangan39", exact: true });
  await assertVisible(mobileAttribution, "mobile Toronto acknowledgement link");
  await assertWithinViewport(mobileAttribution, 320, "mobile Toronto acknowledgement link");
  await mobileAttribution.click();
  await assertWithinViewport(activePage.getByTestId("acknowledgements-panel"), 320, "mobile acknowledgements dialog");
  await activePage.keyboard.press("Escape");
  await acknowledgements.waitFor({ state: "hidden", timeout: timeoutMs });
  assert.equal(await mobileAttribution.evaluate((element) => document.activeElement === element), true, "Closing mobile acknowledgements must restore trigger focus.");
  await assertVisible(mobileDialog, "mobile model-library sheet after acknowledgements");
  assert.equal(await mobileTrigger.getAttribute("aria-expanded"), "true", "Closing acknowledgements must keep the mobile model library open.");
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

  const touchViewport = { width: 320, height: 800 };
  const touchContext = await browser.newContext({ hasTouch: true, viewport: touchViewport });
  activePage = await touchContext.newPage();
  captureRuntimeErrors(activePage);
  await openPage(activePage);

  const touchStorageHint = activePage.locator('[data-info-hint-trigger][aria-label="About browser storage"]');
  await assertInfoHintTrigger(touchStorageHint, "browserStorage", "touch browser storage InfoHint");
  await touchStorageHint.tap();
  await activePage.waitForTimeout(100);
  await assertNoVisibleInfoHint(activePage, "Tapping a browser storage InfoHint");

  const touchModelsTrigger = activePage.getByRole("button", { name: "Open model library", exact: true });
  await touchModelsTrigger.tap();
  const touchModelsDialog = activePage.getByRole("dialog", { name: "Model library", exact: true });
  await assertVisible(touchModelsDialog, "touch model-library dialog");
  const touchSpecsHint = touchModelsDialog.locator('[data-info-hint-trigger][aria-label="About model specifications"]');
  await assertInfoHintTrigger(touchSpecsHint, "modelSpecs", "touch model specifications InfoHint");
  await touchSpecsHint.tap();
  await activePage.waitForTimeout(100);
  await assertNoVisibleInfoHint(activePage, "Tapping a model specifications InfoHint");
  const touchWidths = await activePage.evaluate(() => ({
    body: document.body.scrollWidth,
    document: document.documentElement.scrollWidth,
    viewport: window.innerWidth
  }));
  assert.ok(Math.max(touchWidths.body, touchWidths.document) <= touchWidths.viewport + 1, `Touch layout overflows horizontally: ${JSON.stringify(touchWidths)}`);
  await assertVisible(touchModelsDialog, "model-library dialog after tapping its InfoHint");
  assert.equal(await touchModelsTrigger.getAttribute("aria-expanded"), "true", "Tapping an InfoHint must leave the mobile model library open.");
  await activePage.keyboard.press("Escape");
  await touchModelsDialog.waitFor({ state: "hidden", timeout: timeoutMs });
  assert.equal(await touchModelsTrigger.getAttribute("aria-expanded"), "false");
  assert.equal(await touchModelsTrigger.evaluate((element) => document.activeElement === element), true, "Closing the touch model library must restore trigger focus.");
  await touchContext.close();
  console.log("✓ InfoHints open immediately on hover/focus, ignore touch activation, and fit at 320px");

  const preloadContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  let blockedModelRoute;
  let rejectModelRequests = false;
  let modelRequestTimeout;
  let resolveModelRequest;
  const modelRequest = new Promise((resolve) => { resolveModelRequest = resolve; });
  await preloadContext.route("https://**/*", (route) => {
    const requestUrl = route.request().url();
    if (requestUrl.includes("onnx-community/tiny-aya-global-ONNX")) {
      resolveModelRequest(requestUrl);
      if (rejectModelRequests) {
        void route.abort("blockedbyclient");
        return;
      }
      blockedModelRoute = route;
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
    return radios.some((radio) => radio.value === "tiny-aya-global" && radio.getAttribute("aria-label")?.endsWith("Ready to download.") && !radio.disabled) && radios.every((radio) => !radio.checked);
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
  rejectModelRequests = true;
  await blockedModelRoute.abort("blockedbyclient");
  await activePage.locator("#prompt-error").waitFor({ state: "visible", timeout: timeoutMs });
  await progressBar.waitFor({ state: "detached", timeout: timeoutMs });
  assert.equal(await preloadSend.isEnabled(), true, "A failed preload must leave generation available for an explicit retry.");
  await preloadContext.close();
  console.log("✓ Sidebar selection starts the pinned download and gates generation");

  const progressContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await progressContext.addInitScript(() => {
    const requests = [];
    const modelBytes = 2_354_413_407;
    const cacheModels = ["tiny-aya-global", "tiny-aya-earth", "tiny-aya-fire", "tiny-aya-water"].map((modelId) => ({ modelId, state: "missing", resumableBytes: 0, verifiedBytes: 0, totalBytes: modelBytes }));
    Object.defineProperty(window, "__sophonWorkerRequests", { value: requests });
    Object.defineProperty(window, "__storagePersistCalls", { value: 0, writable: true });
    Object.defineProperty(window, "confirm", { configurable: true, value: () => true });
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
        if (request.type === "cache-status") queueMicrotask(() => this.respond({ type: "complete", requestId: request.requestId, result: { models: cacheModels.map((model) => ({ ...model })) } }));
        if (request.type === "cancel") queueMicrotask(() => this.respond({ type: "complete", requestId: request.requestId, result: { cancelled: true, targetRequestId: request.targetRequestId } }));
        if (request.type === "delete-cache") queueMicrotask(() => {
          const cache = cacheModels.find((model) => model.modelId === request.modelId);
          if (cache) Object.assign(cache, { state: "missing", resumableBytes: 0, verifiedBytes: 0 });
          this.respond({ type: "complete", requestId: request.requestId, result: { modelId: request.modelId, deleted: true } });
        });
        if (request.type === "generate") queueMicrotask(() => this.respond({
          type: "complete",
          requestId: request.requestId,
          result: {
            ok: true,
            result: {
              generatedText: "Fixture response",
              inputTokens: [
                { id: 101, text: "Token", inContext: false },
                { id: 102, text: " lens", inContext: true },
                { id: 103, text: " fixture", inContext: true }
              ],
              generatedTokens: [
                { id: 201, text: "Fixture" },
                { id: 202, text: " response" }
              ],
              outputTokenCount: 2,
              metrics: {
                provider: "webgpu",
                modelLoadMs: 0,
                endToEndMs: 320,
                ttftMs: 120,
                decodeMs: 200,
                decodeTokensPerSecond: 5,
                timePerOutputTokenMs: 200,
                p95InterTokenLatencyMs: 200,
                promptTokenCount: 3,
                contextTokenCount: 2,
                truncatedInputTokens: 1,
                outputTokenCount: 2
              }
            }
          }
        }));
        if (request.type === "preload") queueMicrotask(() => {
          const cache = cacheModels.find((model) => model.modelId === request.modelId);
          if (cache) Object.assign(cache, { state: "partial", resumableBytes: 64 * 1024 * 1024, verifiedBytes: 0 });
          this.respond({ type: "log", requestId: request.requestId, event: { level: "info", message: "Loading model", phase: "download", progress: { loaded: 25, total: 100 } } });
          window.__setDownloadProgress = (progress) => this.respond({ type: "log", requestId: request.requestId, event: { level: "info", message: "Loading model", phase: "download", progress } });
          window.__finishPreload = () => {
            if (cache) Object.assign(cache, { state: "cached", resumableBytes: modelBytes, verifiedBytes: modelBytes });
            this.respond({ type: "complete", requestId: request.requestId, result: { ok: true } });
          };
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
  await activePage.waitForFunction(() => document.querySelector('[data-model-surface="desktop"] input[value="tiny-aya-global"]')?.getAttribute("aria-label")?.endsWith("Ready to download."), undefined, { timeout: timeoutMs });
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
  const pauseDownload = activePage.getByRole("button", { name: "Pause model download", exact: true });
  await assertVisible(pauseDownload, "model download pause control");
  await pauseDownload.click();
  await determinateProgress.waitFor({ state: "detached", timeout: timeoutMs });
  await activePage.getByText("Tiny Aya Global 3.35B · non-commercial download paused. Verified chunks were kept and will resume when you select it again.", { exact: true }).waitFor({ state: "visible", timeout: timeoutMs });
  await activePage.waitForFunction(() => window.__sophonWorkerRequests?.some((request) => request.type === "cancel" && request.targetRequestId), undefined, { timeout: timeoutMs });
  assert.equal(await progressGlobal.getByRole("radio").isChecked(), false, "Pausing must clear selection so choosing the model resumes it.");
  const partialDelete = activePage.getByRole("button", { name: "Delete downloaded files for Tiny Aya Global 3.35B · non-commercial", exact: true });
  await assertVisible(partialDelete, "partial model deletion control");
  assert.match(await progressGlobal.getByRole("radio").getAttribute("aria-label") ?? "", /64 MB saved/);
  await progressGlobal.click();
  await activePage.waitForFunction(() => window.__sophonWorkerRequests?.filter((request) => request.type === "preload" && request.modelId === "tiny-aya-global").length === 2, undefined, { timeout: timeoutMs });
  await assertVisible(determinateProgress, "resumed model download progress bar");
  await activePage.evaluate(() => window.__setDownloadProgress({ loaded: 80, total: 100, stage: "verify" }));
  await activePage.getByText("Verifying model · 80%", { exact: true }).waitFor({ state: "visible", timeout: timeoutMs });
  assert.equal(await determinateProgress.getAttribute("aria-valuetext"), "80 B of 100 B verified");
  await activePage.evaluate(() => window.__setDownloadProgress({ loaded: 100, total: 100, stage: "cache" }));
  await activePage.getByText("Loading downloaded model · 100%", { exact: true }).waitFor({ state: "visible", timeout: timeoutMs });
  assert.equal(await determinateProgress.getAttribute("aria-valuetext"), "100 B of 100 B loaded from browser storage");
  assert.equal((await activePage.evaluate(() => window.__sophonWorkerRequests)).some((request) => request.type === "generate"), false);
  await activePage.evaluate(() => window.__finishPreload());
  await determinateProgress.waitFor({ state: "detached", timeout: timeoutMs });
  await activePage.getByText("Model ready", { exact: true }).waitFor({ state: "visible", timeout: timeoutMs });

  await activePage.getByRole("textbox", { name: "Message Sophon", exact: true }).fill("Token lens fixture");
  await activePage.getByRole("button", { name: "Send message", exact: true }).click();
  const userFixtureMessage = activePage.getByRole("article", { name: "Message from you", exact: true }).filter({ hasText: "Token lens fixture" });
  const assistantFixtureMessage = activePage.getByRole("article", { name: "Message from Sophon", exact: true }).filter({ hasText: "Fixture response" });
  await assertVisible(userFixtureMessage, "generated fixture user message");
  await assertVisible(assistantFixtureMessage, "generated fixture assistant message");
  await assertVisible(assistantFixtureMessage.getByText("WebGPU · 2/3→2 tokens · 5.0 tokens/s · 120 ms TTFT · 1 earlier tokens omitted", { exact: true }), "plain-language response metrics");

  const metricsHint = assistantFixtureMessage.locator('[data-info-hint-trigger][aria-label="About response metrics"]');
  const userTokenHint = userFixtureMessage.locator('[data-info-hint-trigger][aria-label="About token display"]');
  const assistantTokenHint = assistantFixtureMessage.locator('[data-info-hint-trigger][aria-label="About token display"]');
  await assertInfoHintTrigger(metricsHint, "generationMetrics", "response metrics InfoHint");
  await assertInfoHintTrigger(userTokenHint, "tokenLens", "user token display InfoHint");
  await assertInfoHintTrigger(assistantTokenHint, "tokenLens", "assistant token display InfoHint");

  await focusWithKeyboard(activePage, metricsHint, "response metrics InfoHint");
  const metricsContent = activePage.locator('[data-slot="tooltip-content"][data-help-id="generationMetrics"]');
  await assertImmediatelyVisible(metricsContent, "focus-opened response metrics tooltip");
  await assertTooltipContract(metricsHint, metricsContent, "response metrics tooltip");
  await assertCenteredAbove(metricsHint, metricsContent, "response metrics tooltip");
  assert.match((await metricsContent.textContent()) ?? "", /Input → output.+tokens\/s.+TTFT.+omitted to fit the context/s);
  await activePage.keyboard.press("Escape");
  await metricsContent.waitFor({ state: "hidden", timeout: timeoutMs });
  assert.equal(await metricsHint.evaluate((element) => document.activeElement === element), true, "Escape must dismiss a response metrics tooltip without moving focus.");

  await assistantTokenHint.hover();
  const tokenLensContent = activePage.locator('[data-slot="tooltip-content"][data-help-id="tokenLens"]');
  await assertImmediatelyVisible(tokenLensContent, "hovered token display tooltip");
  await assertTooltipContract(assistantTokenHint, tokenLensContent, "token display tooltip");
  await assertCenteredAbove(assistantTokenHint, tokenLensContent, "token display tooltip");
  assert.match((await tokenLensContent.textContent()) ?? "", /Tokens shows the model pieces and IDs.+Words groups them.+Outside context/s);
  await activePage.getByRole("heading", { name: "SOPHON", exact: true }).hover();
  await tokenLensContent.waitFor({ state: "hidden", timeout: timeoutMs });
  await userFixtureMessage.getByRole("button", { name: "tokens", exact: true }).click();
  await assertVisible(userFixtureMessage.getByRole("toolbar", { name: /3 inspectable token segments/ }), "user token toolbar");
  assert.equal(await userFixtureMessage.locator('[data-context="omitted"]').count(), 1, "The token lens must preserve outside-context state.");
  await assistantFixtureMessage.getByRole("button", { name: "tokens", exact: true }).click();
  await assertVisible(assistantFixtureMessage.getByRole("toolbar", { name: /2 inspectable token segments/ }), "assistant token toolbar");

  const deleteCached = activePage.getByRole("button", { name: "Delete downloaded files for Tiny Aya Global 3.35B · non-commercial", exact: true });
  await assertVisible(deleteCached, "downloaded model deletion control");
  await deleteCached.click();
  await activePage.waitForFunction(() => window.__sophonWorkerRequests?.some((request) => request.type === "delete-cache" && request.modelId === "tiny-aya-global"), undefined, { timeout: timeoutMs });
  await activePage.waitForFunction(() => document.querySelector('[data-model-surface="desktop"] input[value="tiny-aya-global"]')?.getAttribute("aria-label")?.endsWith("Ready to download."), undefined, { timeout: timeoutMs });
  await progressContext.close();
  console.log("✓ Aggregate progress, pause/resume, cache inventory, and deletion controls pass");

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

async function assertInfoHintTrigger(locator, concept, label) {
  await assertVisible(locator, label);
  assert.equal(await locator.evaluate((element) => element.tagName), "SPAN", `${label} must be a non-clickable span.`);
  assert.equal(await locator.getAttribute("tabindex"), "0", `${label} must remain keyboard focusable.`);
  assert.equal(await locator.getAttribute("data-help-id"), concept);
  assert.equal(await locator.getAttribute("aria-haspopup"), null, `${label} must not expose a popover contract.`);
  assert.equal(await locator.getAttribute("aria-expanded"), null, `${label} must not expose expandable state.`);
  assert.equal(await locator.locator('svg[aria-hidden="true"]').count(), 1, `${label} icon must stay out of the accessibility tree.`);
}

async function focusWithKeyboard(page, locator, label) {
  await locator.focus();
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Tab");
  assert.equal(await locator.evaluate((element) => document.activeElement === element), true, `Expected keyboard focus on ${label}.`);
}

async function assertImmediatelyVisible(locator, label) {
  await locator.waitFor({ state: "visible", timeout: 200 });
  assert.equal(await locator.count(), 1, `Expected exactly one ${label}.`);
}

async function assertTooltipContract(trigger, tooltip, label) {
  assert.equal(await tooltip.getAttribute("role"), "tooltip", `${label} must expose tooltip semantics.`);
  assert.equal(await trigger.getAttribute("aria-describedby"), await tooltip.getAttribute("id"), `${label} must describe its trigger.`);
  assert.equal(await trigger.getAttribute("aria-haspopup"), null, `${label} trigger must not expose aria-haspopup.`);
  assert.equal(await trigger.getAttribute("aria-expanded"), null, `${label} trigger must not expose aria-expanded.`);
}

async function assertCenteredAbove(trigger, tooltip, label) {
  const triggerBox = await trigger.boundingBox();
  const tooltipBox = await tooltip.boundingBox();
  assert.ok(triggerBox && tooltipBox, `Expected measurable ${label} geometry.`);
  const triggerCenter = triggerBox.x + triggerBox.width / 2;
  const tooltipCenter = tooltipBox.x + tooltipBox.width / 2;
  assert.ok(Math.abs(triggerCenter - tooltipCenter) <= 2, `${label} is not horizontally centered above its icon: ${JSON.stringify({ triggerBox, tooltipBox })}`);
  assert.ok(tooltipBox.y + tooltipBox.height <= triggerBox.y + 1, `${label} is not above its icon: ${JSON.stringify({ triggerBox, tooltipBox })}`);
}

async function assertAbove(trigger, tooltip, label) {
  const triggerBox = await trigger.boundingBox();
  const tooltipBox = await tooltip.boundingBox();
  assert.ok(triggerBox && tooltipBox, `Expected measurable ${label} geometry.`);
  assert.ok(tooltipBox.y + tooltipBox.height <= triggerBox.y + 1, `${label} is not above its icon: ${JSON.stringify({ triggerBox, tooltipBox })}`);
}

async function assertNoVisibleInfoHint(page, action) {
  const visibleTooltips = page.locator('[data-slot="tooltip-content"]:visible');
  assert.equal(await visibleTooltips.count(), 0, `${action} must not reveal a tooltip.`);
}

async function assertWithinViewport(locator, viewportWidth, label) {
  const box = await locator.boundingBox();
  assert.ok(box && box.x >= -1 && box.x + box.width <= viewportWidth + 1, `${label} is outside the ${viewportWidth}px viewport: ${JSON.stringify(box)}`);
}

async function assertBoxWithinViewport(locator, viewport, label) {
  const box = await locator.boundingBox();
  assert.ok(
    box
      && box.x >= -1
      && box.y >= -1
      && box.x + box.width <= viewport.width + 1
      && box.y + box.height <= viewport.height + 1,
    `${label} is outside the ${viewport.width}×${viewport.height}px viewport: ${JSON.stringify(box)}`
  );
  return box;
}

function captureRuntimeErrors(page) {
  page.on("console", (message) => {
    if (message.type() === "error") runtimeErrors.push(`console: ${message.text()}`);
  });
  page.on("pageerror", (error) => runtimeErrors.push(`pageerror: ${error.message}`));
}
