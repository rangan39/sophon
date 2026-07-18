export async function resolve(specifier, context, nextResolve) {
  if (specifier === "@huggingface/transformers") {
    return { shortCircuit: true, url: new URL("./fake-transformers.mjs", import.meta.url).href };
  }
  if (specifier.startsWith("@/")) {
    const sourcePath = `${specifier.slice(2)}.ts`;
    return nextResolve(new URL(`../src/${sourcePath}`, import.meta.url).href, context);
  }
  return nextResolve(specifier, context);
}
