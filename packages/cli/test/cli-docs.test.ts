import { defineCommand } from "citty";
import { describe, expect, it } from "vitest";
import { renderCliReference } from "../src/cli-docs";

describe("CLI reference generator", () => {
  it("renders every subcommand and its options from the command tree", async () => {
    const main = defineCommand({
      meta: { name: "loom", description: "Author once." },
      subCommands: {
        build: defineCommand({
          meta: { name: "build", description: "Compile a plugin" },
          args: { out: { type: "string", description: "Output directory" } },
        }),
        install: defineCommand({
          meta: { name: "install", description: "Place a plugin into a scope" },
        }),
      },
    });

    const md = await renderCliReference(main);
    expect(md).toContain("# Loom CLI reference");
    expect(md).toContain("## `loom build`");
    expect(md).toContain("## `loom install`");
    expect(md).toContain("Compile a plugin");
    expect(md).toContain("Output directory");
  });
});
