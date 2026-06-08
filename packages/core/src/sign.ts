import { createHash, generateKeyPairSync, type KeyObject, sign, verify } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import type { Lockfile } from "@loom/schema";

/**
 * A digest over the lockfile's artifact set (component + target + content hash).
 * Signing this binds a signature to exactly the compiled artifacts (spec §10
 * `signed` badge). Sorting makes it order-independent and deterministic.
 */
export function artifactDigest(lock: Lockfile): Buffer {
  const lines = lock.artifacts.map((a) => `${a.component}\t${a.target}\t${a.hash}`).sort();
  return createHash("sha256").update(lines.join("\n")).digest();
}

/** Ed25519 keypair. Production would use sigstore/cosign keyless signing instead. */
export function generateSigningKeys(): { publicKey: KeyObject; privateKey: KeyObject } {
  return generateKeyPairSync("ed25519");
}

export function signLock(lock: Lockfile, privateKey: KeyObject): string {
  return sign(null, artifactDigest(lock), privateKey).toString("base64");
}

export function verifyLockSignature(
  lock: Lockfile,
  publicKey: KeyObject,
  signature: string,
): boolean {
  try {
    return verify(null, artifactDigest(lock), publicKey, Buffer.from(signature, "base64"));
  } catch {
    return false;
  }
}

export interface VerifyResult {
  signatureValid: boolean;
  /** Recorded artifact paths whose on-disk bytes no longer match the lock hash. */
  tampered: string[];
}

/**
 * Verify a signature AND that every recorded artifact on disk still matches its
 * lockfile hash. The `signed` badge requires both: a valid signature over the
 * digest and no tampered artifacts.
 */
export function verifyArtifacts(
  lock: Lockfile,
  publicKey: KeyObject,
  signature: string,
): VerifyResult {
  const tampered: string[] = [];
  for (const a of lock.artifacts) {
    if (!existsSync(a.path)) {
      tampered.push(a.path);
      continue;
    }
    const actual = createHash("sha256").update(readFileSync(a.path)).digest("hex");
    if (actual !== a.hash) tampered.push(a.path);
  }
  return { signatureValid: verifyLockSignature(lock, publicKey, signature), tampered };
}
