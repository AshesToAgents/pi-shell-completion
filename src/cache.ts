/**
 * Cache for generated completion scripts, keyed on pi version and the
 * mtimes of the inputs that affect generation (model catalogs, settings).
 */
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

export interface CacheKeyInputs {
  shell: string;
  piVersion: string;
  catalogMtimes: number[];
  settingsMtime: number;
}

export function computeCacheKey(inputs: CacheKeyInputs): string {
  const raw = JSON.stringify([
    inputs.shell,
    inputs.piVersion,
    inputs.catalogMtimes,
    inputs.settingsMtime,
  ]);
  return createHash("sha1").update(raw).digest("hex").slice(0, 16);
}

function cachePath(cacheDir: string, shell: string, key: string): string {
  return join(cacheDir, `${shell}-${key}.sh`);
}

export function readCache(cacheDir: string, shell: string, key: string): string | null {
  const file = cachePath(cacheDir, shell, key);
  if (!existsSync(file)) return null;
  try {
    return readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

/** Atomic write (tmp + rename); prunes other cache files for the same shell. */
export function writeCache(
  cacheDir: string,
  key: string,
  shell: string,
  content: string,
): void {
  mkdirSync(cacheDir, { recursive: true });
  const file = cachePath(cacheDir, shell, key);
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, content, "utf8");
  renameSync(tmp, file);
  // Prune older cache files for this shell
  try {
    for (const f of readdirSync(cacheDir)) {
      if (f.startsWith(`${shell}-`) && f.endsWith(".sh") && f !== `${shell}-${key}.sh`) {
        unlinkSync(join(cacheDir, f));
      }
    }
  } catch {
    // best effort
  }
}

/** Newest cache content for a shell, ignoring the given current key. */
export function newestStaleCache(
  cacheDir: string,
  shell: string,
  currentKey: string,
): string | null {
  try {
    const entries = readdirSync(cacheDir)
      .filter(
        (f) => f.startsWith(`${shell}-`) && f.endsWith(".sh") && f !== `${shell}-${currentKey}.sh`,
      )
      .map((f) => {
        const full = join(cacheDir, f);
        return { full, mtime: statSync(full).mtimeMs };
      })
      .sort((a, b) => b.mtime - a.mtime);
    for (const { full } of entries) {
      try {
        return readFileSync(full, "utf8");
      } catch {
        // try next
      }
    }
  } catch {
    // no cache dir
  }
  return null;
}
