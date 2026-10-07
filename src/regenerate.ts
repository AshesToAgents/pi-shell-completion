/**
 * Collects live CLI help output and builds + caches completion scripts.
 */
import { spawnSync } from "node:child_process";
import { statSync } from "node:fs";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseHelp, parseSubcommandHelp } from "./help-parser.js";
import { readCatalogs } from "./models-catalog.js";
import { buildSpec, generateZshCompletion, generateBashCompletion } from "./generate.js";
import { computeCacheKey, writeCache, type CacheKeyInputs } from "./cache.js";

export interface Collected {
  topHelp: string;
  subHelps: Record<string, string>;
  piVersion: string;
}

export const SUBCOMMAND_HINTS = [
  "install",
  "remove",
  "uninstall",
  "update",
  "list",
  "config",
  "auth",
  "mcp",
];

function runPi(args: string[]): string {
  const res = spawnSync("pi", args, { encoding: "utf8", timeout: 60_000 });
  if (res.status !== 0 || res.error) {
    throw new Error(`pi ${args.join(" ")} failed: ${res.error?.message ?? `exit ${res.status}`}`);
  }
  return res.stdout;
}

/**
 * Collect top-level help, all subcommand helps, and the PATH pi version.
 * Uses a single bash invocation to run all spawns in parallel; falls back
 * to sequential spawns when bash is unavailable.
 */
export function collectHelpSync(): Collected {
  const tmp = mkdtempSync(join(tmpdir(), "pi-completion-collect-"));
  try {
    const commands: string[] = [];
    const files: string[] = [];
    const outputs: Record<string, string> = {};
    const targets: Array<[string, string[]]> = [
      ["version", ["--version"]],
      ["top", ["--help"]],
      ...SUBCOMMAND_HINTS.map((s) => [s, [s, "--help"]] as [string, string[]]),
    ];
    for (const [name, args] of targets) {
      const file = join(tmp, name);
      commands.push(`pi ${args.map((a) => `'${a}'`).join(" ")} > '${file}' 2>/dev/null`);
      files.push(file);
    }
    const script = `${commands.join(" & ")} & wait`;
    const bash = spawnSync("bash", ["-c", script], { encoding: "utf8", timeout: 120_000 });
    if (bash.status !== 0 || bash.error) {
      // Fallback: sequential
      for (const [name, args] of targets) outputs[name] = runPi(args);
    } else {
      for (let i = 0; i < targets.length; i++) {
        outputs[targets[i][0]] = readFileSync(files[i], "utf8");
      }
    }
    const subHelps: Record<string, string> = {};
    for (const s of SUBCOMMAND_HINTS) subHelps[s] = outputs[s];
    return {
      topHelp: outputs.top,
      subHelps,
      piVersion: outputs.version.trim(),
    };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

function mtimeOf(path: string): number {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return 0;
  }
}

export function keyInputsFor(agentDir: string, shell: string, piVersion: string): CacheKeyInputs {
  return {
    shell,
    piVersion,
    catalogMtimes: ["models.json", "models-store.json", "models.local.json"].map((f) =>
      mtimeOf(join(agentDir, f)),
    ),
    settingsMtime: mtimeOf(join(agentDir, "settings.json")),
  };
}

export function buildAndCache(
  collected: Collected,
  shells: string[],
  agentDir: string,
  cacheDir: string,
): Record<string, string> {
  const top = parseHelp(collected.topHelp);
  const subs = Object.fromEntries(
    Object.entries(collected.subHelps).map(([name, text]) => [
      name,
      parseSubcommandHelp(text, name),
    ]),
  );
  const catalog = readCatalogs(agentDir);

  const scripts: Record<string, string> = {};
  for (const shell of shells) {
    const spec = buildSpec(top, subs, catalog);
    const script = shell === "zsh" ? generateZshCompletion(spec) : generateBashCompletion(spec);
    const key = computeCacheKey(keyInputsFor(agentDir, shell, collected.piVersion));
    writeCache(cacheDir, key, shell, script);
    scripts[shell] = script;
  }
  return scripts;
}
