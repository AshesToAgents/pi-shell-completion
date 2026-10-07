/**
 * Parsers that turn `pi --help` / `pi <subcommand> --help` text into a
 * structured spec for completion generation.
 *
 * Parsing is conservative: anything unrecognized is either skipped or kept
 * as a plain flag without enum/file metadata, so help-text drift degrades
 * completion quality instead of breaking it.
 */

export interface ParsedFlag {
  /** Long form including dashes, e.g. "--provider" */
  name: string;
  /** Short form including dash, e.g. "-p" */
  short?: string;
  /** Value placeholder without brackets, e.g. "name" from "<name>" */
  arg?: string;
  /** True for "[search]"-style optional values */
  optionalArg?: boolean;
  description: string;
  /** Enum values parsed from the description, e.g. thinking levels */
  enumValues?: string[];
  /** True when the value should complete from the filesystem */
  fileCompletion?: boolean;
  /** True when the flag can be given multiple times */
  repeatable?: boolean;
}

export interface ParsedCommand {
  name: string;
  /** Positional args as written in help, e.g. "<source> [-l]" */
  argspec?: string;
  description?: string;
  /** Flags that apply to this subcommand (scoped sections + usage lines) */
  flags: ParsedFlag[];
}

export interface ParsedHelp {
  commands: ParsedCommand[];
  flags: ParsedFlag[];
  toolNames: string[];
}

export interface ParsedSubcommandHelp {
  usageLines: string[];
  /** Flags from the plain "Options:" section (apply to the command itself) */
  flags: ParsedFlag[];
  /** Nested subcommands with their flags, if any */
  subcommands: ParsedCommand[];
}

const FLAG_LINE =
  /^ {2}(-{1,2}[a-zA-Z][a-zA-Z0-9-]*)(?:, (-{1,2}[a-zA-Z][a-zA-Z0-9-]*))?(?: <([^>]+)>)?(?: \[([a-zA-Z][a-zA-Z0-9-]*)\])?(?: +(.+))?$/;
const CONTINUATION = /^ {4,}\S/;

function isOptionsHeader(line: string): boolean {
  return line === "Options:" || line === "Extension CLI Flags:";
}

function parseFlagLine(line: string): ParsedFlag | null {
  const m = line.match(FLAG_LINE);
  if (!m) return null;
  let name = m[1];
  let short = m[2];
  // Normalize: name should be the long form
  if (name && short && !name.startsWith("--")) {
    [name, short] = [short, name];
  }
  const flag: ParsedFlag = {
    name,
    short,
    description: m[5] ?? "",
    fileCompletion: false,
    repeatable: false,
  };
  if (m[3] !== undefined) flag.arg = m[3];
  if (m[4] !== undefined) {
    flag.arg = m[4];
    flag.optionalArg = true;
  }
  return flag;
}

function finalizeFlag(flag: ParsedFlag): void {
  flag.enumValues = extractEnum(flag.description);
  if (flag.arg) {
    const arg = flag.arg.toLowerCase();
    if (["file", "path", "dir", "directory"].includes(arg)) {
      flag.fileCompletion = true;
    }
  }
  if (/can be used multiple times/.test(flag.description)) {
    flag.repeatable = true;
  }
}

/**
 * Extract enum values from a description like
 * "Set thinking level: off, minimal, low, medium, high, xhigh, max" or
 * "Output mode: text (default), json, or rpc" or
 * "codemode (default), deferred, direct, or hidden".
 * Returns undefined when the text does not look like a clean enum list.
 */
function extractEnum(description: string): string[] | undefined {
  const candidates: string[] = [];
  const colon = description.lastIndexOf(": ");
  if (colon !== -1) candidates.push(description.slice(colon + 2));
  candidates.push(description);
  for (const candidate of candidates) {
    const values = tryEnumList(candidate);
    if (values) return values;
  }
  return undefined;
}

function tryEnumList(text: string): string[] | undefined {
  const parts = text.split(",").flatMap((p) => p.split(" or "));
  const cleaned: string[] = [];
  for (let part of parts) {
    part = part.trim().replace(/\(default\)/g, "").trim();
    if (!part) continue;
    if (!/^[a-z][a-z0-9-]*$/.test(part)) return undefined;
    cleaned.push(part);
  }
  if (cleaned.length < 2) return undefined;
  return [...new Set(cleaned)];
}

function parseCommandLine(line: string, hasPiPrefix: boolean): ParsedCommand | null {
  const prefix = hasPiPrefix ? "pi " : "";
  const re = new RegExp(`^ {2}${prefix}([a-z][a-z0-9-]*)(.*?)(?: {2,}(.+))?$`);
  const m = line.match(re);
  if (!m) return null;
  return {
    name: m[1],
    argspec: m[2]?.trim() || undefined,
    description: m[3],
    flags: [],
  };
}

/** Extract flags mentioned in a usage line, e.g. "[--provider <provider>] [--json]" */
function flagsFromUsage(rest: string): ParsedFlag[] {
  const flags: ParsedFlag[] = [];
  const re = /(--[a-z][a-z0-9-]*)(?: <([a-zA-Z|/][^>\s]*)>)?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(rest)) !== null) {
    const flag: ParsedFlag = {
      name: m[1],
      description: "",
      fileCompletion: false,
      repeatable: false,
    };
    if (m[2]) flag.arg = m[2];
    finalizeFlag(flag);
    flags.push(flag);
  }
  return flags;
}

export function parseHelp(text: string): ParsedHelp {
  const lines = text.split("\n");
  const help: ParsedHelp = { commands: [], flags: [], toolNames: [] };
  let section = "";
  let currentFlag: ParsedFlag | null = null;

  for (const line of lines) {
    const trimmed = line.trimEnd();
    if (trimmed === "") {
      currentFlag = null;
      continue;
    }
    if (/^[A-Z]/.test(trimmed) && trimmed.endsWith(":") && !line.startsWith(" ")) {
      section = trimmed;
      currentFlag = null;
      continue;
    }
    if (section === "Commands:") {
      const cmd = parseCommandLine(line, true);
      if (cmd) help.commands.push(cmd);
      continue;
    }
    if (section === "Built-in Tool Names:") {
      const m = line.match(/^ {2}([a-z-]+)\s+- /);
      if (m) help.toolNames.push(m[1]);
      continue;
    }
    if (isOptionsHeader(section)) {
      const flag = parseFlagLine(line);
      if (flag) {
        finalizeFlag(flag);
        help.flags.push(flag);
        currentFlag = flag;
        continue;
      }
      if (currentFlag && CONTINUATION.test(line)) {
        currentFlag.description =
          currentFlag.description === ""
            ? line.trim()
            : `${currentFlag.description} ${line.trim()}`;
        // Re-derive metadata in case the enum/repeatable info spans lines
        currentFlag.enumValues = extractEnum(currentFlag.description);
        currentFlag.repeatable = /can be used multiple times/.test(currentFlag.description);
        continue;
      }
    }
  }
  return help;
}

export function parseSubcommandHelp(text: string, cmd: string): ParsedSubcommandHelp {
  const lines = text.split("\n");
  const result: ParsedSubcommandHelp = { usageLines: [], flags: [], subcommands: [] };
  // name -> command, for enriching/merging
  const byName = new Map<string, ParsedCommand>();
  let section = "";
  let currentFlag: ParsedFlag | null = null;
  // Scoped option pools: "Options for add and remove:" etc.
  let scopeTargets: string[] | null = null;
  let unscopedPool: ParsedFlag[] = [];
  let allScopedFlags: ParsedFlag[] = [];

  const ensure = (name: string): ParsedCommand => {
    let c = byName.get(name);
    if (!c) {
      c = { name, flags: [] };
      byName.set(name, c);
      result.subcommands.push(c);
    }
    return c;
  };

  for (const line of lines) {
    const trimmed = line.trimEnd();
    if (trimmed === "") {
      currentFlag = null;
      continue;
    }
    if (/^[A-Z]/.test(trimmed) && trimmed.endsWith(":") && !line.startsWith(" ")) {
      section = trimmed;
      currentFlag = null;
      scopeTargets = null;
      const scoped = trimmed.match(/^Options for (.+):$/);
      if (scoped) {
        scopeTargets = scoped[1].split(" and ").map((s) => s.trim());
        // Subcommand references may appear before their Commands-section entry
        for (const t of scopeTargets) ensure(t);
      } else if (isOptionsHeader(trimmed)) {
        scopeTargets = [];
      }
      continue;
    }

    if (section === "Usage:") {
      const m = line.match(/^ {2}pi (.+)$/);
      if (m) {
        result.usageLines.push(`pi ${m[1]}`.trimEnd());
        const first = m[1].match(/^[^\s]+/)![0];
        let rest = m[1].slice(first.length);
        if (first === cmd) {
          // "pi auth print-api-key [...]" → subcommand; "pi update [x|y]" → self line
          const next = rest.match(/^\s+([a-z][a-z0-9-]*)/);
          if (next) {
            rest = rest.slice(next[0].length);
            const sub = ensure(next[1]);
            for (const f of flagsFromUsage(rest)) {
              if (!sub.flags.some((x) => x.name === f.name)) sub.flags.push(f);
            }
          }
        }
      }
      continue;
    }

    if (section === "Commands:") {
      const c = parseCommandLine(line, false);
      if (c) {
        const existing = ensure(c.name);
        existing.argspec = c.argspec ?? existing.argspec;
        existing.description = c.description ?? existing.description;
      }
      continue;
    }

    if (/^Options/.test(section) && line.startsWith("  ")) {
      const flag = parseFlagLine(line);
      if (flag) {
        finalizeFlag(flag);
        if (scopeTargets === null) {
          // "Other options:" and similar leftover sections
          unscopedPool.push(flag);
        } else if (scopeTargets.length === 0) {
          result.flags.push(flag);
        } else {
          allScopedFlags.push(flag);
          for (const t of scopeTargets) {
            const sub = ensure(t);
            if (!sub.flags.some((x) => x.name === flag.name)) sub.flags.push(flag);
          }
        }
        currentFlag = flag;
        continue;
      }
      if (currentFlag && CONTINUATION.test(line)) {
        currentFlag.description =
          currentFlag.description === ""
            ? line.trim()
            : `${currentFlag.description} ${line.trim()}`;
        currentFlag.enumValues = extractEnum(currentFlag.description);
        continue;
      }
    }
  }

  // Enrich usage-line flags with full definitions from the option pools
  const pool = [...allScopedFlags, ...unscopedPool];
  for (const sub of result.subcommands) {
    for (let i = 0; i < sub.flags.length; i++) {
      const full = pool.find((f) => f.name === sub.flags[i].name);
      if (full && full.description) {
        sub.flags[i] = full;
      }
    }
    // Flags from "Other options:" that a usage line mentions were already
    // added above; nothing else to do here.
  }

  return result;
}
