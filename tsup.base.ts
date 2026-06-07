import type { Options } from "tsup";

/** Shared tsup options for every Loom package. Workspace deps stay external. */
export function loomTsup(overrides: Options = {}): Options {
  return {
    entry: ["src/index.ts"],
    format: ["esm"],
    target: "node20",
    platform: "node",
    dts: true,
    sourcemap: true,
    clean: true,
    treeshake: true,
    splitting: false,
    ...overrides,
  };
}
