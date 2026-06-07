import { createHash } from "node:crypto";

/** sha256 of compiled output, used for content-addressed update + the signed badge. */
export function sha256(contents: string | Buffer): string {
  return createHash("sha256").update(contents).digest("hex");
}
