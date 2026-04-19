import { execSync } from "node:child_process";
import { createHash } from "node:crypto";

export function getBuildId(): string {
  try {
    const sha = execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
    const diff = execSync("git diff --stat", { encoding: "utf8" }).trim();
    if (!diff) return sha;
    const hash = createHash("md5").update(diff).digest("hex").slice(0, 8);
    return `${sha}+${hash}`;
  } catch {
    return "unknown";
  }
}
