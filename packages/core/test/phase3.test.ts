import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import claudeAdapter from "@michaelfromyeg/weft-adapter-claude";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  AdapterRegistry,
  CompileError,
  checkManagedPolicy,
  generateSigningKeys,
  install,
  signLock,
  verifyArtifacts,
  verifyLockSignature,
} from "../src/index";

const FIXTURE = fileURLToPath(new URL("../../../fixtures/sample-plugin", import.meta.url));
const registry = () => new AdapterRegistry().register(claudeAdapter);

let tmp: string;
beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), "weft-p3-"));
});
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe("signing (the signed badge)", () => {
  it("a signature verifies against untampered artifacts and fails on tamper", async () => {
    const pluginDir = join(tmp, "sign-plugin");
    const sandbox = join(tmp, "sign-sb");
    cpSync(FIXTURE, pluginDir, { recursive: true });
    const { lockfile } = await install({
      pluginDir,
      scope: "project",
      cwd: sandbox,
      registry: registry(),
      now: "t",
    });

    const { publicKey, privateKey } = generateSigningKeys();
    const sig = signLock(lockfile, privateKey);

    // Untampered: signature + on-disk artifacts both verify.
    expect(verifyLockSignature(lockfile, publicKey, sig)).toBe(true);
    expect(verifyArtifacts(lockfile, publicKey, sig)).toEqual({
      signatureValid: true,
      tampered: [],
    });

    // Tamper a recorded hash -> the signature no longer matches the digest.
    const tampered = {
      ...lockfile,
      artifacts: lockfile.artifacts.map((a, i) => (i === 0 ? { ...a, hash: "deadbeef" } : a)),
    };
    expect(verifyLockSignature(tampered, publicKey, sig)).toBe(false);

    // Tamper a placed file on disk -> verifyArtifacts reports it.
    writeFileSync(lockfile.artifacts[0].path, "tampered bytes");
    const v = verifyArtifacts(lockfile, publicKey, sig);
    expect(v.tampered).toContain(lockfile.artifacts[0].path);
  });
});

describe("managed-mode install gating (spec §11)", () => {
  it("permits an allowlisted namespace", () => {
    expect(
      checkManagedPolicy({ allowNamespaces: ["com.acme"] }, { namespace: "com.acme" }),
    ).toBeNull();
  });

  it("blocks a non-allowlisted namespace", () => {
    const reason = checkManagedPolicy(
      { allowNamespaces: ["com.other"] },
      { namespace: "com.acme" },
    );
    expect(reason).toMatch(/not allowlisted/);
  });

  it("blocks missing required badges", () => {
    expect(
      checkManagedPolicy(
        { requireBadges: ["signed"] },
        { namespace: "com.acme", badges: ["valid"] },
      ),
    ).toMatch(/required badge/);
  });

  it("install fails when the namespace is not allowlisted", async () => {
    const pluginDir = join(tmp, "managed-plugin");
    cpSync(FIXTURE, pluginDir, { recursive: true });
    const err = await install({
      pluginDir,
      scope: "project",
      cwd: join(tmp, "managed-sb"),
      registry: registry(),
      managed: { allowNamespaces: ["com.enterprise"] },
    })
      .then(() => null)
      .catch((e) => e as CompileError);
    expect(err).toBeInstanceOf(CompileError);
    expect(err?.diagnostics.some((d) => /not allowlisted/.test(d.message))).toBe(true);
  });
});
