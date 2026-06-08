import { createPrivateKey, createPublicKey } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  build,
  buildMarketplace,
  CompileError,
  generateSigningKeys,
  hasMarketplaceManifest,
  importNativePlugin,
  install,
  installMarketplace,
  LOOM_VERSION,
  lint,
  lockDirForScope,
  readLock,
  resolveSourceDir,
  signLock,
  uninstall,
  update,
  verifyArtifacts,
} from "@michaelfromyeg/loom-core";
import { discoverEvals, runEval } from "@michaelfromyeg/loom-eval";
import {
  federate,
  fetchMcpRegistry,
  indexFromPluginDirs,
  publishCheck,
  serializeIndex,
} from "@michaelfromyeg/loom-index";
import type { Scope, Target } from "@michaelfromyeg/loom-schema";
import { defineCommand, runMain } from "citty";
import { renderCliReference } from "./cli-docs";
import { log } from "./logger";
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
    log.error(`\n${err.message}:`);
    printDiagnostics(err.diagnostics);
  } else {
    log.error(`\n${(err as Error).message}`);
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
    log.info(`Scaffolded plugin "${created.name}" in ${created.dir}`);
    for (const f of created.files) log.info(`  + ${f}`);
    log.info(`\nNext: loom validate ${args.dir} && loom build ${args.dir}`);
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
        log.error(`\n${result.id}: invalid`);
        process.exit(1);
      }
      log.data({ id: result.id, valid: true, components: result.plugin.components.length });
      log.info(`${result.id}: valid (${result.plugin.components.length} components)`);
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
      description: "Local dir, or a remote ref (github:/npm:/owner/repo, optional //subdir)",
    },
    out: { type: "string", default: ".loom-out", description: "Output directory" },
    target: { type: "string", description: "Comma-separated targets (default: all registered)" },
  },
  async run({ args }) {
    try {
      const registry = buildRegistry();
      const targets = parseTargets(args.target);
      // A remote ref (github:/git/owner-repo, optionally //subdir) clones into the
      // cache; a local path is used as-is.
      const { dir } = await resolveSourceDir(args.dir, process.cwd());

      // A marketplace.yaml packages many plugins into one catalog.
      if (hasMarketplaceManifest(dir)) {
        const { marketplace, plugins, written } = await buildMarketplace({
          marketplaceDir: dir,
          outDir: args.out,
          registry,
          targets,
        });
        log.data({
          marketplace: marketplace.name,
          plugins: plugins.length,
          out: args.out,
          files: Object.fromEntries(countByTarget(written)),
        });
        log.info(
          `Built marketplace ${marketplace.name} (${plugins.length} plugins) -> ${args.out}/`,
        );
        for (const [t, n] of countByTarget(written)) log.info(`  ${t}: ${n} files`);
        return;
      }

      const { result, written } = await build({
        pluginDir: dir,
        outDir: args.out,
        registry,
        targets,
      });
      if (result.diagnostics.items.length > 0) printDiagnostics(result.diagnostics.items);
      log.data({ id: result.id, out: args.out, files: Object.fromEntries(countByTarget(written)) });
      log.info(`Built ${result.id} -> ${args.out}/`);
      for (const [t, n] of countByTarget(written)) {
        log.info(`  ${t}: ${n} files (catalog at ${args.out}/${t})`);
      }
    } catch (err) {
      fail(err);
    }
  },
});

const installCmd = defineCommand({
  meta: {
    name: "install",
    description: "Compile + place a plugin (or a whole marketplace) into harness scopes",
  },
  args: {
    dir: {
      type: "positional",
      required: false,
      default: ".",
      description: "Local dir, or a remote ref (github:/npm:/owner/repo, optional //subdir)",
    },
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
        for (const t of missing) log.info(`  skipped ${t}: harness not detected`);
        if (present.length === 0) {
          log.error("No requested harness is installed. Use --all to place anyway.");
          process.exit(1);
        }
        targets = present;
      }

      // A remote ref (github:/git/npm/owner-repo, optionally //subdir) is fetched
      // into the cache; a local path is used as-is.
      const { dir } = await resolveSourceDir(args.dir, process.cwd());

      // A marketplace.yaml installs all of its plugins across the targets at once.
      if (hasMarketplaceManifest(dir)) {
        const mp = await installMarketplace({
          marketplaceDir: dir,
          scope,
          cwd: args.cwd ?? process.cwd(),
          registry,
          targets,
          ...(allow ? { managed: { allowNamespaces: allow } } : {}),
        });
        log.data({
          marketplace: mp.marketplace.name,
          plugins: mp.installs.map((i) => i.result.id),
          scope,
          lockfile: mp.lockPath,
        });
        log.info(
          `Installed marketplace ${mp.marketplace.name} (${mp.installs.length} plugins, ${scope})`,
        );
        for (const i of mp.installs) {
          log.info(
            `  ${i.result.id}@${i.result.fb.plugin.version}: ${i.entry.artifacts.length} artifacts`,
          );
        }
        log.info(`  lockfile: ${mp.lockPath}`);
        return;
      }

      const result = await install({
        pluginDir: dir,
        scope,
        cwd: args.cwd ?? process.cwd(),
        registry,
        targets,
        only: parseList(args.only),
        ...(allow ? { managed: { allowNamespaces: allow } } : {}),
      });
      printTrustSummary(result.result);
      log.data({
        id: result.result.id,
        version: result.result.fb.plugin.version,
        scope,
        artifacts: result.entry.artifacts.length,
        lockfile: result.lockPath,
      });
      log.info(`Installed ${result.result.id}@${result.result.fb.plugin.version} (${scope})`);
      log.info(`  ${result.entry.artifacts.length} artifacts placed`);
      if (result.secrets.resolved.length > 0) {
        const missing = result.secrets.resolved.filter((r) => r.source === "missing");
        log.info(
          `  config: ${result.secrets.resolved.length} declared` +
            (result.secrets.path ? ` -> ${result.secrets.path} (gitignored)` : "") +
            (missing.length > 0 ? `; missing: ${missing.map((m) => m.env).join(", ")}` : ""),
        );
      }
      log.info(`  lockfile: ${result.lockPath}`);
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
      const cwd = args.cwd ?? process.cwd();
      // Default to the targets already in the target lockfile, so update matches
      // what install placed (not every registered adapter).
      const lock = readLock(lockDirForScope(scope, cwd));
      const lockedTargets = lock
        ? ([...new Set(lock.artifacts.map((a) => a.target))] as Target[])
        : undefined;
      const result = await update({
        pluginDir: args.dir,
        scope,
        cwd,
        registry: buildRegistry(),
        targets: parseTargets(args.target) ?? lockedTargets,
      });
      log.data({ id: result.id, changed: result.changed });
      log.info(`Updated ${result.id}: ${result.changed.length} artifact(s) changed`);
      for (const p of result.changed) log.info(`  ~ ${p}`);
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
        log.info("No evals found (a component adds them with an `evals:` file).");
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
      log.data({
        id: res.id,
        version: res.version,
        ok: res.ok,
        valid: res.validPassed,
        scanClean: res.scan.clean,
        badges: res.badges,
        harnessCoverage: res.harnessCoverage,
      });
      log.info(`Publish check: ${res.id}@${res.version}`);
      if (res.diagnostics.length > 0) printDiagnostics(res.diagnostics);
      log.info(`  valid: ${res.validPassed ? "yes" : "NO"}`);
      log.info(`  scan: ${res.scan.clean ? "clean" : `${res.scan.findings.length} finding(s)`}`);
      log.info(`  badges: ${res.badges.join(", ") || "none"}`);
      log.info(`  harness coverage: ${res.harnessCoverage.join(", ") || "none"}`);
      for (const r of res.evalReports) printEvalReport(r);
      if (!res.ok) {
        log.error("\nPublish BLOCKED: the deterministic tier failed.");
        process.exit(1);
      }
      log.info("\nPublish gate passed.");
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
        log.error("no loom.lock found (run `loom install` first)");
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
      log.info(
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
        log.error("no loom.lock found");
        process.exit(1);
      }
      const sig = readFileSync(join(args.dir, "loom.sig"), "utf8").trim();
      const publicKey = createPublicKey(readFileSync(join(args.dir, "loom.pub")));
      const res = verifyArtifacts(lock, publicKey, sig);
      log.data({ signatureValid: res.signatureValid, tampered: res.tampered });
      log.info(`signature: ${res.signatureValid ? "valid" : "INVALID"}`);
      log.info(`tampered artifacts: ${res.tampered.length}`);
      for (const p of res.tampered) log.info(`  ! ${p}`);
      if (!res.signatureValid || res.tampered.length > 0) process.exit(1);
      log.info("signed badge verified.");
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
      log.data({
        plugins: index.plugins.length,
        federated: index.federated?.length ?? 0,
        out: args.out,
      });
      log.info(`Wrote index (${index.plugins.length} plugins${fed}) -> ${args.out}`);
    } catch (err) {
      fail(err);
    }
  },
});

const importCmd = defineCommand({
  meta: {
    name: "import",
    description: "Reverse-compile an existing native plugin/marketplace into a Loom plugin",
  },
  args: {
    dir: {
      type: "positional",
      required: false,
      default: ".",
      description: "Dir with an existing native plugin or marketplace",
    },
    from: { type: "string", default: "claude", description: "Source harness format" },
    out: { type: "string", default: "imported", description: "Output directory" },
    namespace: {
      type: "string",
      description: "Reverse-DNS namespace to assign (default com.imported)",
    },
  },
  run({ args }) {
    try {
      const adapter = buildRegistry().get(args.from as Target);
      if (!adapter) {
        log.error(`unknown source harness "${args.from}"`);
        process.exit(1);
      }
      const res = importNativePlugin({
        dir: args.dir,
        adapter,
        outDir: args.out,
        ...(args.namespace ? { namespace: args.namespace } : {}),
      });
      log.data({
        kind: res.kind,
        name: res.name,
        manifest: res.manifestPath,
        out: res.outDir,
        ...(res.kind === "plugin" ? { files: res.fileCount } : {}),
      });
      log.info(`Imported ${res.kind} "${res.name}" -> ${res.manifestPath}`);
      if (res.kind === "plugin") log.info(`  ${res.fileCount} component file(s)`);
      log.info(`  next: loom build ${res.outDir}`);
    } catch (err) {
      fail(err);
    }
  },
});

const uninstallCmd = defineCommand({
  meta: {
    name: "uninstall",
    description: "Remove what install placed into this project (read from its loom.lock)",
  },
  args: {
    dir: {
      type: "positional",
      required: false,
      default: ".",
      description: "Install target holding loom.lock (default: derived from --scope)",
    },
    scope: { type: "string", default: "project", description: "user | project" },
    plugin: {
      type: "string",
      description: "Remove only this plugin (id or bare name); default removes all",
    },
  },
  run({ args }) {
    try {
      const scope = (args.scope === "user" ? "user" : "project") as Scope;
      // An explicit dir wins; otherwise read the lock from the scope's target
      // (the project cwd for project scope, ~/.loom for user scope).
      const dir = args.dir === "." ? lockDirForScope(scope, process.cwd()) : args.dir;
      const res = uninstall({ dir, ...(args.plugin ? { plugin: args.plugin } : {}) });
      log.data({ removed: res.removed, plugins: res.plugins });
      log.info(`Uninstalled ${res.plugins.length} plugin(s), ${res.removed.length} artifact(s)`);
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
      log.info(`Wrote CLI reference to ${args.out}`);
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
    uninstall: uninstallCmd,
    update: updateCmd,
    import: importCmd,
    eval: evalCmd,
    publish: publishCmd,
    sign: signCmd,
    verify: verifyCmd,
    index: indexCmd,
    docs: docsCmd,
  },
});

runMain(main);
