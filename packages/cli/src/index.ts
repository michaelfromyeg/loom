import { createPrivateKey, createPublicKey } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  build,
  buildMarketplace,
  CompileError,
  generateSigningKeys,
  hasMarketplaceManifest,
  install,
  LOOM_VERSION,
  lint,
  readLock,
  signLock,
  update,
  verifyArtifacts,
} from "@loom/core";
import { discoverEvals, runEval } from "@loom/eval";
import {
  federate,
  fetchMcpRegistry,
  indexFromPluginDirs,
  publishCheck,
  serializeIndex,
} from "@loom/index";
import type { Scope, Target } from "@loom/schema";
import { defineCommand, runMain } from "citty";
import { renderCliReference } from "./cli-docs";
import { allDrivers, buildRegistry, parseList, parseTargets } from "./registry";
import { printDiagnostics, printEvalReport, printTrustSummary } from "./report";
import { scaffoldPlugin } from "./scaffold";

/** Filter requested targets to harnesses actually present on this machine. */
async function detectPresent(
  requested: Target[],
): Promise<{ present: Target[]; missing: Target[] }> {
  const drivers = allDrivers();
  const present: Target[] = [];
  const missing: Target[] = [];
  for (const t of requested) {
    if (await drivers[t]?.available()) present.push(t);
    else missing.push(t);
  }
  return { present, missing };
}

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
  async run({ args }) {
    try {
      const registry = buildRegistry();
      const targets = parseTargets(args.target);

      // A marketplace.yaml packages many plugins into one catalog.
      if (hasMarketplaceManifest(args.dir)) {
        const { marketplace, plugins, written } = await buildMarketplace({
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

      const { result, written } = await build({
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
    all: {
      type: "boolean",
      description: "Install to requested targets even if the harness is not detected",
    },
    managed: {
      type: "string",
      description: "Managed mode: only allow these namespaces (comma-separated allowlist)",
    },
    cwd: { type: "string", description: "Project root for project-scope placement (default: cwd)" },
  },
  async run({ args }) {
    try {
      const registry = buildRegistry();
      const scope = (args.scope === "user" ? "user" : "project") as Scope;
      const requested = parseTargets(args.target) ?? registry.targets;
      const allow = parseList(args.managed);

      // Skip targets whose harness isn't on this machine, and say so (spec §9.2).
      let targets = requested;
      if (!args.all) {
        const { present, missing } = await detectPresent(requested);
        for (const t of missing) console.log(`  skipped ${t}: harness not detected`);
        if (present.length === 0) {
          console.error("No requested harness is installed. Use --all to place anyway.");
          process.exit(1);
        }
        targets = present;
      }

      const result = await install({
        pluginDir: args.dir,
        scope,
        cwd: args.cwd ?? process.cwd(),
        registry,
        targets,
        only: parseList(args.only),
        ...(allow ? { managed: { allowNamespaces: allow } } : {}),
      });
      printTrustSummary(result.result);
      console.log(
        `Installed ${result.lockfile.plugin.id}@${result.lockfile.plugin.version} (${scope})`,
      );
      console.log(`  ${result.lockfile.artifacts.length} artifacts placed`);
      if (result.secrets.resolved.length > 0) {
        const missing = result.secrets.resolved.filter((r) => r.source === "missing");
        console.log(
          `  config: ${result.secrets.resolved.length} declared` +
            (result.secrets.path ? ` -> ${result.secrets.path} (gitignored)` : "") +
            (missing.length > 0 ? `; missing: ${missing.map((m) => m.env).join(", ")}` : ""),
        );
      }
      console.log(`  lockfile: ${result.lockPath}`);
    } catch (err) {
      fail(err);
    }
  },
});

const updateCmd = defineCommand({
  meta: {
    name: "update",
    description: "Re-resolve refs, recompile, and re-place only artifacts whose hash changed",
  },
  args: {
    dir: { type: "positional", required: false, default: ".", description: "Plugin directory" },
    scope: { type: "string", default: "project", description: "user | project" },
    target: { type: "string", description: "Comma-separated targets (default: all registered)" },
    cwd: { type: "string", description: "Project root for project-scope placement (default: cwd)" },
  },
  async run({ args }) {
    try {
      const scope = (args.scope === "user" ? "user" : "project") as Scope;
      // Default to the targets already in the lockfile, so update matches what
      // install placed (not every registered adapter).
      const lock = readLock(args.dir);
      const lockedTargets = lock
        ? ([...new Set(lock.artifacts.map((a) => a.target))] as Target[])
        : undefined;
      const result = await update({
        pluginDir: args.dir,
        scope,
        cwd: args.cwd ?? process.cwd(),
        registry: buildRegistry(),
        targets: parseTargets(args.target) ?? lockedTargets,
      });
      console.log(
        `Updated ${result.lockfile.plugin.id}: ${result.changed.length} artifact(s) changed`,
      );
      for (const p of result.changed) console.log(`  ~ ${p}`);
    } catch (err) {
      fail(err);
    }
  },
});

const evalCmd = defineCommand({
  meta: {
    name: "eval",
    description: "Run a component's evals against the real harnesses (reports UNTESTED honestly)",
  },
  args: {
    dir: { type: "positional", required: false, default: ".", description: "Plugin directory" },
    component: { type: "string", description: "Only eval this component leaf name" },
    harness: { type: "string", description: "Restrict to these harnesses (comma-separated)" },
  },
  async run({ args }) {
    try {
      const registry = buildRegistry();
      const drivers = allDrivers();
      const discovered = discoverEvals(args.dir).filter(
        (d) => !args.component || d.componentLeaf === args.component,
      );
      if (discovered.length === 0) {
        console.log("No evals found (a component adds them with an `evals:` file).");
        return;
      }
      const onlyHarness = parseTargets(args.harness);
      let anyFail = false;
      for (const d of discovered) {
        const evalFile = onlyHarness
          ? {
              ...d.evalFile,
              harnesses: d.evalFile.harnesses.filter((h) => onlyHarness.includes(h)),
            }
          : d.evalFile;
        const report = await runEval({
          evalFile,
          pluginDir: args.dir,
          componentLeaf: d.componentLeaf,
          registry,
          drivers,
        });
        printEvalReport(report);
        if (report.harnesses.some((h) => h.status === "tested" && !h.pass)) anyFail = true;
      }
      if (anyFail) process.exit(1);
    } catch (err) {
      fail(err);
    }
  },
});

const publishCmd = defineCommand({
  meta: {
    name: "publish",
    description: "Run the deterministic publish gate (static valid + trace/output evals)",
  },
  args: {
    dir: { type: "positional", required: false, default: ".", description: "Plugin directory" },
    snapshot: {
      type: "boolean",
      description: "Snapshot eval scores into evals/.baselines/ for the next release",
    },
  },
  async run({ args }) {
    try {
      const res = await publishCheck(args.dir, {
        registry: buildRegistry(),
        drivers: allDrivers(),
        snapshot: Boolean(args.snapshot),
      });
      console.log(`Publish check: ${res.id}@${res.version}`);
      if (res.diagnostics.length > 0) printDiagnostics(res.diagnostics);
      console.log(`  valid: ${res.validPassed ? "yes" : "NO"}`);
      console.log(`  scan: ${res.scan.clean ? "clean" : `${res.scan.findings.length} finding(s)`}`);
      console.log(`  badges: ${res.badges.join(", ") || "none"}`);
      console.log(`  harness coverage: ${res.harnessCoverage.join(", ") || "none"}`);
      for (const r of res.evalReports) printEvalReport(r);
      if (!res.ok) {
        console.error("\nPublish BLOCKED: the deterministic tier failed.");
        process.exit(1);
      }
      console.log("\nPublish gate passed.");
    } catch (err) {
      fail(err);
    }
  },
});

const signCmd = defineCommand({
  meta: {
    name: "sign",
    description:
      "Sign loom.lock's artifact set (ed25519) -> loom.sig + loom.pub (the signed badge)",
  },
  args: {
    dir: {
      type: "positional",
      required: false,
      default: ".",
      description: "Plugin dir with loom.lock",
    },
  },
  run({ args }) {
    try {
      const lock = readLock(args.dir);
      if (!lock) {
        console.error("no loom.lock found (run `loom install` first)");
        process.exit(1);
      }
      const loomDir = join(args.dir, ".loom");
      mkdirSync(loomDir, { recursive: true });
      writeFileSync(join(loomDir, ".gitignore"), "*\n");
      const keyPath = join(loomDir, "signing.key");

      let privateKey: ReturnType<typeof createPrivateKey>;
      if (existsSync(keyPath)) {
        privateKey = createPrivateKey(readFileSync(keyPath));
      } else {
        const keys = generateSigningKeys();
        privateKey = keys.privateKey;
        writeFileSync(keyPath, keys.privateKey.export({ type: "pkcs8", format: "pem" }));
        writeFileSync(
          join(args.dir, "loom.pub"),
          keys.publicKey.export({ type: "spki", format: "pem" }),
        );
      }
      writeFileSync(join(args.dir, "loom.sig"), `${signLock(lock, privateKey)}\n`);
      console.log(
        `Signed ${lock.artifacts.length} artifacts -> loom.sig (key kept in .loom/, public key in loom.pub)`,
      );
    } catch (err) {
      fail(err);
    }
  },
});

const verifyCmd = defineCommand({
  meta: {
    name: "verify",
    description: "Verify loom.sig against loom.lock and the on-disk artifacts",
  },
  args: {
    dir: {
      type: "positional",
      required: false,
      default: ".",
      description: "Plugin dir with loom.lock",
    },
  },
  run({ args }) {
    try {
      const lock = readLock(args.dir);
      if (!lock) {
        console.error("no loom.lock found");
        process.exit(1);
      }
      const sig = readFileSync(join(args.dir, "loom.sig"), "utf8").trim();
      const publicKey = createPublicKey(readFileSync(join(args.dir, "loom.pub")));
      const res = verifyArtifacts(lock, publicKey, sig);
      console.log(`signature: ${res.signatureValid ? "valid" : "INVALID"}`);
      console.log(`tampered artifacts: ${res.tampered.length}`);
      for (const p of res.tampered) console.log(`  ! ${p}`);
      if (!res.signatureValid || res.tampered.length > 0) process.exit(1);
      console.log("signed badge verified.");
    } catch (err) {
      fail(err);
    }
  },
});

const indexCmd = defineCommand({
  meta: {
    name: "index",
    description: "Build a metadata index from plugin dirs (optionally federating the MCP Registry)",
  },
  args: {
    dir: { type: "positional", required: false, default: ".", description: "Plugin directories" },
    out: { type: "string", default: "index.json", description: "Output index file" },
    federate: { type: "boolean", description: "Ingest the MCP Registry (GET /v0.1/servers)" },
  },
  async run({ args }) {
    try {
      // citty puts every positional in `_`; default to the current dir when none.
      const positionals = (args._ as string[] | undefined) ?? [];
      const dirs = positionals.length > 0 ? positionals : ["."];
      let index = await indexFromPluginDirs(dirs);
      if (args.federate) {
        const servers = await fetchMcpRegistry({ limit: 30 });
        index = federate(index, servers, new Date().toISOString());
      }
      writeFileSync(args.out, serializeIndex(index));
      const fed = args.federate ? `, federated ${index.federated?.length ?? 0} source(s)` : "";
      console.log(`Wrote index (${index.plugins.length} plugins${fed}) -> ${args.out}`);
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
    update: updateCmd,
    eval: evalCmd,
    publish: publishCmd,
    sign: signCmd,
    verify: verifyCmd,
    index: indexCmd,
    docs: docsCmd,
  },
});

runMain(main);
