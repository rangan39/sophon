import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), geolocation=(), microphone=(), payment=(), usb=()" }
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  outputFileTracingRoot: rootDir,
  poweredByHeader: false,
  reactStrictMode: true,
  async headers() {
    return [
      { source: "/(.*)", headers: securityHeaders },
      {
        source: "/models/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=86400, stale-while-revalidate=604800" }]
      }
    ];
  },
  webpack(config, { webpack }) {
    config.resolve.alias["@huggingface/transformers"] = path.join(rootDir, "node_modules/@huggingface/transformers/dist/transformers.web.js");
    config.resolve.alias["onnxruntime-common"] = path.join(rootDir, "node_modules/onnxruntime-common/dist/esm/index.js");
    // ORT ships an already-minified WebGPU module that can overwhelm a second minification pass.
    config.plugins.push({
      apply(compiler) {
        compiler.hooks.thisCompilation.tap("SkipOrtWebgpuBundleMinify", (compilation) => {
          compilation.hooks.processAssets.tap(
            {
              name: "SkipOrtWebgpuBundleMinify",
              stage: webpack.Compilation.PROCESS_ASSETS_STAGE_OPTIMIZE_SIZE - 1
            },
            () => {
              for (const asset of compilation.getAssets()) {
                if (!/ort\.webgpu\.bundle\.min\.[\w-]+\.mjs$/.test(asset.name)) continue;
                compilation.updateAsset(asset.name, asset.source, {
                  ...asset.info,
                  minimized: true
                });
              }
            }
          );
        });
      }
    });
    return config;
  }
};

export default nextConfig;
