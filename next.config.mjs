import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  webpack(config, { webpack }) {
    config.resolve.alias["@huggingface/transformers"] = path.join(rootDir, "node_modules/@huggingface/transformers/dist/transformers.web.js");
    config.resolve.alias["onnxruntime-common"] = path.join(rootDir, "node_modules/onnxruntime-common/dist/esm/index.js");
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
