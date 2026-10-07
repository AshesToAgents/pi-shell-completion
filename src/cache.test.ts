import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  computeCacheKey,
  readCache,
  writeCache,
  newestStaleCache,
} from "./cache.js";

let dir: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "pi-completion-cache-"));
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

const baseInputs = {
  shell: "zsh",
  piVersion: "1.0.0",
  catalogMtimes: [100, 200, 0],
  settingsMtime: 300,
};

describe("computeCacheKey", () => {
  it("is deterministic for identical inputs", () => {
    expect(computeCacheKey(baseInputs)).toBe(computeCacheKey({ ...baseInputs }));
  });

  it("changes with pi version", () => {
    expect(computeCacheKey(baseInputs)).not.toBe(
      computeCacheKey({ ...baseInputs, piVersion: "1.1.0" }),
    );
  });

  it("changes with catalog mtimes", () => {
    expect(computeCacheKey(baseInputs)).not.toBe(
      computeCacheKey({ ...baseInputs, catalogMtimes: [101, 200, 0] }),
    );
  });

  it("changes with settings mtime", () => {
    expect(computeCacheKey(baseInputs)).not.toBe(
      computeCacheKey({ ...baseInputs, settingsMtime: 301 }),
    );
  });

  it("changes with shell", () => {
    expect(computeCacheKey(baseInputs)).not.toBe(
      computeCacheKey({ ...baseInputs, shell: "bash" }),
    );
  });
});

describe("read/writeCache", () => {
  it("roundtrips content", () => {
    writeCache(dir, "key1", "zsh", "# script v1");
    expect(readCache(dir, "zsh", "key1")).toBe("# script v1");
  });

  it("returns null for missing keys", () => {
    expect(readCache(dir, "zsh", "does-not-exist")).toBeNull();
  });

  it("leaves no temp files behind", () => {
    writeCache(dir, "key2", "zsh", "# script v2");
    const files = readdirSync(dir);
    expect(files.some((f) => f.includes(".tmp"))).toBe(false);
  });

  it("prunes older cache files for the same shell", () => {
    writeCache(dir, "key3", "zsh", "# old zsh");
    writeCache(dir, "key4", "bash", "# bash");
    writeCache(dir, "key5", "zsh", "# new zsh");
    const files = readdirSync(dir);
    expect(files.some((f) => f.includes("key3"))).toBe(false);
    expect(files.some((f) => f.includes("key5"))).toBe(true);
    // other shells are untouched
    expect(files.some((f) => f.includes("key4"))).toBe(true);
  });
});

describe("newestStaleCache", () => {
  it("returns the newest cache for the shell, excluding the current key", () => {
    const sub = join(dir, "stale-test");
    rmSync(sub, { recursive: true, force: true });
    writeCache(sub, "kb", "bash", "# bash");
    writeCache(sub, "k2", "zsh", "# two"); // prunes k1 for zsh

    expect(newestStaleCache(sub, "zsh", "missing-key")).toBe("# two");
    expect(newestStaleCache(sub, "zsh", "k2")).toBeNull(); // only zsh file is current
    expect(newestStaleCache(sub, "bash", "missing")).toBe("# bash");
  });

  it("returns null when nothing exists", () => {
    expect(newestStaleCache(join(dir, "empty-dir"), "zsh", "kx")).toBeNull();
  });
});
