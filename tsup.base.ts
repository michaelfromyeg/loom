import type { Options } from "tsup";

/** Shared tsup options for every Weft package. Workspace deps stay external. */
export function weftTsup(overrides: Options = {}): Options {
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
