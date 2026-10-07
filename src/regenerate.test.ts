import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { buildAndCache, keyInputsFor, type Collected } from "./regenerate.js";
import { computeCacheKey, readCache } from "./cache.js";

let agentDir: string;
let cacheDir: string;

function fixture(name: string): string {
  return readFileSync(new URL(`../fixtures/${name}`, import.meta.url), "utf8");
}

function collectedFixture(): Collected {
  const subHelps: Record<string, string> = {};
  for (const sub of ["install", "remove", "uninstall", "update", "list", "config", "auth", "mcp"]) {
    subHelps[sub] = fixture(`${sub}-help.txt`);
  }
  return { topHelp: fixture("pi-help.txt"), subHelps, piVersion: "9.9.9-test" };
}

beforeAll(() => {
  const root = mkdtempSync(join(tmpdir(), "pi-completion-regen-"));
  agentDir = join(root, "agent");
  cacheDir = join(root, "cache");
  mkdirSync(agentDir, { recursive: true });
  writeFileSync(
    join(agentDir, "models.json"),
    JSON.stringify({ providers: { anthropic: { models: [{ id: "claude-sonnet" }] } } }),
  );
  writeFileSync(join(agentDir, "settings.json"), "{}");
});

afterAll(() => {
  rmSync(join(agentDir, ".."), { recursive: true, force: true });
});

describe("keyInputsFor", () => {
  it("uses file mtimes, 0 for missing files", () => {
    const inputs = keyInputsFor(agentDir, "zsh", "1.0.0");
    expect(inputs.shell).toBe("zsh");
    expect(inputs.piVersion).toBe("1.0.0");
    expect(inputs.settingsMtime).toBeGreaterThan(0);
    expect(inputs.catalogMtimes).toHaveLength(3);
    expect(inputs.catalogMtimes[0]).toBeGreaterThan(0); // models.json exists
    expect(inputs.catalogMtimes[1]).toBe(0); // models-store.json missing
    expect(inputs.catalogMtimes[2]).toBe(0); // models.local.json missing
  });
});

describe("buildAndCache", () => {
  it("generates and caches scripts for both shells under the right keys", () => {
    const collected = collectedFixture();
    const scripts = buildAndCache(collected, ["zsh", "bash"], agentDir, cacheDir);

    expect(scripts.zsh).toContain("--thinking");
    expect(scripts.zsh).toContain("off minimal low medium high xhigh max");
    expect(scripts.zsh).toContain("_pi_cmd_mcp");
    expect(scripts.zsh).toContain("claude-sonnet"); // from catalog in agentDir
    expect(scripts.bash).toContain("complete -F _pi pi");
    expect(scripts.bash).toContain("print-api-key");

    for (const shell of ["zsh", "bash"]) {
      const key = computeCacheKey(keyInputsFor(agentDir, shell, collected.piVersion));
      expect(readCache(cacheDir, shell, key)).toBe(scripts[shell]);
    }
  });

  it("writes one cache file per shell", () => {
    const files = readdirSync(cacheDir).filter((f) => f.endsWith(".sh"));
    expect(files.filter((f) => f.startsWith("zsh-"))).toHaveLength(1);
    expect(files.filter((f) => f.startsWith("bash-"))).toHaveLength(1);
  });
});
