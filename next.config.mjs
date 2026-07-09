import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  webpack(config) {
    config.resolve.alias["@huggingface/transformers"] = path.join(rootDir, "node_modules/@huggingface/transformers/dist/transformers.web.js");
    config.optimization.minimize = false;
    return config;
  }
};

export default nextConfig;
