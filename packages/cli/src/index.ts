import { writeFileSync } from "node:fs";
import {
  build,
  buildMarketplace,
  CompileError,
  hasMarketplaceManifest,
  install,
  LOOM_VERSION,
  lint,
} from "@loom/core";
import type { Scope } from "@loom/schema";
import { defineCommand, runMain } from "citty";
import { renderCliReference } from "./cli-docs";
import { buildRegistry, parseList, parseTargets } from "./registry";
import { printDiagnostics, printTrustSummary } from "./report";
import { scaffoldPlugin } from "./scaffold";

function countByTarget(written: { target: string }[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const w of written) counts.set(w.target, (counts.get(w.target) ?? 0) + 1);
  return counts;
}

function fail(err: unknown): never {
  if (err instanceof CompileError) {
    console.error(`\n${err.message}:`);
    printDiagnostics(err.diagnostics);
  } else {
    console.error(`\n${(err as Error).message}`);
  }
  process.exit(1);
}

const initCmd = defineCommand({
  meta: { name: "init", description: "Scaffold a new plugin (loom.yaml + a sample skill)" },
  args: {
    dir: { type: "positional", required: false, default: ".", description: "Target directory" },
    name: { type: "string", description: "Plugin name (kebab-case)" },
    namespace: { type: "string", description: "Reverse-DNS namespace, e.g. com.acme" },
  },
  run({ args }) {
    const created = scaffoldPlugin({
      dir: args.dir,
      name: args.name,
      namespace: args.namespace,
    });
    console.log(`Scaffolded plugin "${created.name}" in ${created.dir}`);
    for (const f of created.files) console.log(`  + ${f}`);
    console.log(`\nNext: loom validate ${args.dir} && loom build ${args.dir}`);
  },
});

const validateCmd = defineCommand({
  meta: { name: "validate", description: "Statically validate a plugin (the valid badge)" },
  args: {
    dir: { type: "positional", required: false, default: ".", description: "Plugin directory" },
  },
  run({ args }) {
    try {
      const result = lint(args.dir);
      const { items, hasErrors } = result.diagnostics;
      if (items.length > 0) printDiagnostics(items);
      if (hasErrors) {
        console.error(`\n${result.id}: invalid`);
        process.exit(1);
      }
      console.log(`${result.id}: valid (${result.plugin.components.length} components)`);
    } catch (err) {
      fail(err);
    }
  },
});

const buildCmd = defineCommand({
  meta: {
    name: "build",
    description: "Compile a plugin (or a marketplace of plugins) to harness manifests",
  },
  args: {
    dir: {
      type: "positional",
      required: false,
      default: ".",
      description: "Plugin or marketplace directory",
    },
    out: { type: "string", default: ".loom-out", description: "Output directory" },
    target: { type: "string", description: "Comma-separated targets (default: all registered)" },
  },
  run({ args }) {
    try {
      const registry = buildRegistry();
      const targets = parseTargets(args.target);

      // A marketplace.yaml packages many plugins into one catalog.
      if (hasMarketplaceManifest(args.dir)) {
        const { marketplace, plugins, written } = buildMarketplace({
          marketplaceDir: args.dir,
          outDir: args.out,
          registry,
          targets,
        });
        console.log(
          `Built marketplace ${marketplace.name} (${plugins.length} plugins) -> ${args.out}/`,
        );
        for (const [t, n] of countByTarget(written)) console.log(`  ${t}: ${n} files`);
        return;
      }

      const { result, written } = build({
        pluginDir: args.dir,
        outDir: args.out,
        registry,
        targets,
      });
      if (result.diagnostics.items.length > 0) printDiagnostics(result.diagnostics.items);
      console.log(`Built ${result.id} -> ${args.out}/`);
      for (const [t, n] of countByTarget(written)) {
        console.log(`  ${t}: ${n} files (catalog at ${args.out}/${t})`);
      }
    } catch (err) {
      fail(err);
    }
  },
});

const installCmd = defineCommand({
  meta: {
    name: "install",
    description: "Compile + place a plugin into a harness scope, write loom.lock",
  },
  args: {
    dir: { type: "positional", required: false, default: ".", description: "Plugin directory" },
    scope: { type: "string", default: "project", description: "user | project" },
    target: { type: "string", description: "Comma-separated targets (default: all registered)" },
    only: {
      type: "string",
      description: "Comma-separated component names to install piecemeal (e.g. one skill)",
    },
    cwd: { type: "string", description: "Project root for project-scope placement (default: cwd)" },
  },
  async run({ args }) {
    try {
      const registry = buildRegistry();
      const scope = (args.scope === "user" ? "user" : "project") as Scope;
      const result = await install({
        pluginDir: args.dir,
        scope,
        cwd: args.cwd ?? process.cwd(),
        registry,
        targets: parseTargets(args.target),
        only: parseList(args.only),
      });
      printTrustSummary(result.result);
      console.log(
        `Installed ${result.lockfile.plugin.id}@${result.lockfile.plugin.version} (${scope})`,
      );
      console.log(`  ${result.lockfile.artifacts.length} artifacts placed`);
      console.log(`  lockfile: ${result.lockPath}`);
    } catch (err) {
      fail(err);
    }
  },
});

const docsCmd = defineCommand({
  meta: {
    name: "docs",
    description: "Print the full CLI reference (a CLI map), generated from the command tree",
  },
  args: {
    out: {
      type: "string",
      description: "Write the Markdown reference to this file instead of stdout",
    },
  },
  async run({ args }) {
    const md = await renderCliReference(main);
    if (args.out) {
      writeFileSync(args.out, md);
      console.log(`Wrote CLI reference to ${args.out}`);
    } else {
      process.stdout.write(md);
    }
  },
});

const main = defineCommand({
  meta: {
    name: "loom",
    version: LOOM_VERSION,
    description: "Author once, compile to every coding-agent harness.",
  },
  subCommands: {
    init: initCmd,
    validate: validateCmd,
    build: buildCmd,
    install: installCmd,
    docs: docsCmd,
  },
});

runMain(main);
