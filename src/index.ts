/**
 * pi-shell-completion extension entry point.
 *
 * Intercepts `pi --completion <shell>` during extension loading and prints a
 * completion script derived from the LIVE CLI (pi --help, subcommand helps,
 * and the local model catalogs), cached on pi version + input mtimes.
 *
 * - Cache hit: instant, zero added shell-startup cost.
 * - Stale (pi upgraded / catalogs refreshed): serves the last script
 *   instantly and refreshes in a detached background process.
 * - First ever run: builds an interim script from a single fast
 *   `pi -ne --help` spawn, then background-refreshes full depth.
 *
 * `pi --completion regenerate [shell]` (spawned detached by this extension)
 * synchronously rebuilds and caches the full scripts.
 *
 * On any normal pi start without --completion, a cheap staleness check
 * pre-warms the cache in the background so shell startup never stalls.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { VERSION, getAgentDir } from "@earendil-works/pi-coding-agent";
import { spawn, spawnSync } from "node:child_process";
import { writeSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, isAbsolute } from "node:path";
import { join } from "node:path";
import { computeCacheKey, readCache, writeCache, newestStaleCache } from "./cache.js";
import { keyInputsFor, collectHelpSync, buildAndCache } from "./regenerate.js";
import { parseHelp } from "./help-parser.js";
import { readCatalogs } from "./models-catalog.js";
import { buildSpec, generateZshCompletion, generateBashCompletion } from "./generate.js";

const SHELLS = ["zsh", "bash"] as const;
type Shell = (typeof SHELLS)[number];

function cacheDirFor(agentDir: string): string {
  return join(agentDir, "cache", "pi-shell-completion");
}

/** pi reroutes console.log/process.stdout.write to stderr (TUI protection);
 * only raw fd-1 writes reach the real stdout that `eval "$(...)"` captures. */
function printToStdout(text: string): void {
  const out = text.endsWith("\n") ? text : text + "\n";
  let written = 0;
  while (written < out.length) {
    written += writeSync(1, out.slice(written));
  }
}

/** When loaded via `-e <path>`, the detached regen child must load the same
 * entry (otherwise it would re-enter whatever extension is installed). */
function selfExtensionArgs(): string[] {
  try {
    const self = fileURLToPath(import.meta.url);
    const argv = process.argv;
    for (let i = 0; i < argv.length; i++) {
      const a = argv[i];
      let value: string | undefined;
      if ((a === "-e" || a === "--extension") && argv[i + 1]) value = argv[i + 1];
      else if (a.startsWith("--extension=")) value = a.slice("--extension=".length);
      if (value) {
        const p = value.startsWith("file:") ? fileURLToPath(value) : value;
        const abs = isAbsolute(p) ? p : resolve(process.cwd(), p);
        if (abs === self) return ["-e", value];
      }
    }
  } catch {
    // fall through
  }
  return [];
}

function spawnDetachedRegen(shell?: Shell): void {
  try {
    const args = [...selfExtensionArgs(), "--completion", "regenerate", ...(shell ? [shell] : [])];
    const child = spawn("pi", args, { detached: true, stdio: "ignore" });
    child.unref();
  } catch {
    // best effort — next shell init will retry
  }
}

function generateScript(shell: Shell, topHelp: string, agentDir: string): string {
  const top = parseHelp(topHelp);
  const catalog = readCatalogs(agentDir);
  const spec = buildSpec(top, {}, catalog);
  return shell === "zsh" ? generateZshCompletion(spec) : generateBashCompletion(spec);
}

/** Synchronous handler for `pi --completion <shell>` (runs during extension load). */
function serveCompletion(shell: Shell): never {
  const agentDir = getAgentDir();
  const cacheDir = cacheDirFor(agentDir);
  const key = computeCacheKey(keyInputsFor(agentDir, shell, VERSION));

  const cached = readCache(cacheDir, shell, key);
  if (cached !== null) {
    printToStdout(cached);
    process.exit(0);
  }

  // Serve the newest stale script instantly; refresh in the background.
  const stale = newestStaleCache(cacheDir, shell, key);
  if (stale !== null) {
    printToStdout(stale);
    spawnDetachedRegen(shell);
    process.exit(0);
  }

  // First ever run: one fast spawn for top-level flags, cached under a
  // distinct interim key (so a failed background refresh still retries),
  // then trigger the full-depth rebuild in the background.
  let interim: string;
  try {
    const res = spawnSync("pi", ["-ne", "--help"], { encoding: "utf8", timeout: 30_000 });
    if (res.status !== 0 || !res.stdout) throw new Error("pi -ne --help failed");
    interim = generateScript(shell, res.stdout, agentDir);
  } catch {
    process.stderr.write("pi-shell-completion: failed to generate an initial script\n");
    process.exit(1);
  }
  writeCache(cacheDir, `${key}-interim`, shell, interim);
  printToStdout(interim);
  spawnDetachedRegen(shell);
  process.exit(0);
}

/** Synchronous full rebuild for `pi --completion regenerate [shell]`. */
function runRegenerate(shell?: Shell): never {
  try {
    const agentDir = getAgentDir();
    const shells: Shell[] = shell ? [shell] : [...SHELLS];
    buildAndCache(collectHelpSync(), shells, agentDir, cacheDirFor(agentDir));
  } catch {
    // best effort — stale caches remain, next init retries
  }
  process.exit(0);
}

export default function completionExtension(_pi: ExtensionAPI): void {
  const idx = process.argv.indexOf("--completion");
  if (idx === -1) {
    // Normal pi session: pre-warm the cache in the background if stale.
    try {
      const agentDir = getAgentDir();
      const cacheDir = cacheDirFor(agentDir);
      const stale = SHELLS.some(
        (sh) =>
          readCache(cacheDir, sh, computeCacheKey(keyInputsFor(agentDir, sh, VERSION))) === null,
      );
      if (stale) spawnDetachedRegen();
    } catch {
      // best effort
    }
    return;
  }

  const sub = process.argv[idx + 1] as Shell | "regenerate" | undefined;
  if (sub === "zsh" || sub === "bash") {
    serveCompletion(sub);
  } else if (sub === "regenerate") {
    const shell = process.argv[idx + 2] as Shell | undefined;
    runRegenerate(shell === "zsh" || shell === "bash" ? shell : undefined);
  } else {
    process.stderr.write(`Unknown shell: ${sub || "(none)"}. Supported: bash, zsh\n`);
    process.exit(1);
  }
}
