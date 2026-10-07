/**
 * Builds a completion spec from parsed help text + model catalogs and
 * emits bash/zsh completion scripts. All content is derived from the spec,
 * so scripts regenerate correctly whenever pi's CLI changes.
 */
import type { ParsedHelp, ParsedSubcommandHelp } from "./help-parser.js";
import type { CatalogData } from "./models-catalog.js";

export interface FlagSpec {
  name: string;
  short?: string;
  arg?: string;
  optionalArg?: boolean;
  description: string;
  enumValues?: string[];
  fileCompletion?: boolean;
  repeatable?: boolean;
}

export interface CommandSpec {
  name: string;
  description?: string;
  flags: FlagSpec[];
  subcommands?: CommandSpec[];
  positional?: "package-source";
  /** Bare literals for the first positional, e.g. "self pi" for update */
  positionalLiterals?: string[];
}

export interface CompletionSpec {
  flags: FlagSpec[];
  commands: CommandSpec[];
  toolNames: string[];
}

const PACKAGE_SOURCE_SCHEMES = [
  "npm:",
  "git:",
  "git:github.com/",
  "https://github.com/",
  "ssh://git@github.com/",
  "./",
];

/** Words that are safe to embed in both shells' word lists */
function safeWord(w: string): boolean {
  return /^[A-Za-z0-9_./:@=-]+$/.test(w);
}

function safeEnum(values: string[] | undefined): string[] | undefined {
  if (!values) return undefined;
  const filtered = values.filter(safeWord);
  return filtered.length > 0 ? filtered : undefined;
}

function flagFromParsed(f: import("./help-parser.js").ParsedFlag): FlagSpec {
  return {
    name: f.name,
    short: f.short,
    arg: f.arg,
    optionalArg: f.optionalArg,
    description: f.description,
    enumValues: safeEnum(f.enumValues),
    fileCompletion: f.fileCompletion,
    repeatable: f.repeatable,
  };
}

function commandSpecFromParsed(
  parsed: ParsedSubcommandHelp,
  argspecHint?: string,
): CommandSpec {
  const spec: CommandSpec = {
    name: "",
    flags: parsed.flags.map(flagFromParsed),
  };
  const argspec = argspecHint ?? parsed.usageLines[0]?.replace(/^pi \S+\s*/, "");
  if (parsed.subcommands.length > 0) {
    spec.subcommands = parsed.subcommands.map((s) => ({
      name: s.name,
      description: s.description,
      flags: s.flags.map(flagFromParsed),
    }));
  } else if (argspec?.includes("<source>")) {
    spec.positional = "package-source";
  }
  return spec;
}

export function buildSpec(
  top: ParsedHelp,
  subs: Record<string, ParsedSubcommandHelp>,
  catalog: CatalogData | null,
): CompletionSpec {
  const toolNames = top.toolNames;

  const flags: FlagSpec[] = top.flags.map(flagFromParsed);
  const byName = new Map(flags.map((f) => [f.name, f]));

  // Live catalog overrides
  if (catalog) {
    const providerFlag = byName.get("--provider");
    if (providerFlag) providerFlag.enumValues = catalog.providers;
    for (const name of ["--model", "--models"]) {
      const f = byName.get(name);
      if (f) f.enumValues = catalog.models;
    }
  }
  if (toolNames.length > 0) {
    for (const name of ["--tools", "--exclude-tools"]) {
      const f = byName.get(name);
      if (f) f.enumValues = toolNames;
    }
  }

  // This extension's own flag, not present in pi's help
  flags.push({
    name: "--completion",
    arg: "shell",
    description: "Output shell completion script (from pi-shell-completion extension)",
    enumValues: ["bash", "zsh"],
    fileCompletion: false,
    repeatable: false,
  });

  const commands: CommandSpec[] = [];
  const emptySubs: ParsedSubcommandHelp = { usageLines: [], flags: [], subcommands: [] };
  for (const cmd of top.commands) {
    const parsed = subs[cmd.name] ?? emptySubs;
    const spec = commandSpecFromParsed(parsed, cmd.argspec);
    spec.name = cmd.name;
    spec.description = cmd.description;
    if (spec.positional === "package-source" || /source/.test(cmd.argspec ?? "")) {
      spec.positional = "package-source";
      // "pi update [source|self|pi]" — offer bare aliases too
      const literals = cmd.argspec?.match(/\[([a-z]+(?:\|[a-z]+)+)\]/);
      if (literals) spec.positionalLiterals = literals[1].split("|");
    }
    commands.push(spec);
  }

  return { flags, commands, toolNames };
}

/* ------------------------------- zsh ------------------------------- */

function zshEsc(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/[:$[\]`"']/g, (c) => "\\" + c)
    .replace(/\s+/g, " ")
    .trim();
}

function zshTruncate(s: string, max = 100): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd();
}

function zshArgName(flag: FlagSpec): string {
  return (flag.arg ?? "value").replace(/[^a-zA-Z0-9_-]/g, "");
}

function zshFlagEntry(flag: FlagSpec): string {
  const desc = zshEsc(zshTruncate(flag.description.split("\n")[0]));
  const prefix = flag.repeatable ? "*" : "";
  let head: string;
  if (flag.short) {
    const group = flag.repeatable ? "" : `(${flag.short} ${flag.name})`;
    head = `'${prefix}${group}'{${flag.short},${flag.name}}'[${desc}]'`;
  } else {
    head = `'${prefix}${flag.name}[${desc}]'`;
  }
  if (!flag.arg) return head;
  const opt = flag.optionalArg ? ":" : ":";
  if (flag.enumValues) return `${head}${opt}${zshArgName(flag)}:(${flag.enumValues.join(" ")})`;
  if (flag.fileCompletion) return `${head}${opt}${zshArgName(flag)}:_files`;
  return `${head}${opt}${zshArgName(flag)}:'`;
}

export function generateZshCompletion(spec: CompletionSpec): string {
  const subDescriptions = spec.commands
    .map((c) => `    '${c.name}:${zshEsc((c.description ?? "").slice(0, 60))}'`)
    .join("\n");

  const topFlagLines = spec.flags.map((f) => `    ${zshFlagEntry(f)} \\`).join("\n");

  const dispatch = spec.commands
    .map((c) => `        ${c.name}) _pi_cmd_${c.name.replace(/-/g, "_")} ;;`)
    .join("\n");

  function zshCommandFn(cmd: CommandSpec, fnName: string, depth: number): string {
    const parts: string[] = [];
    const argLines = cmd.flags.map((f) => `    ${zshFlagEntry(f)} \\`).join("\n");
    let body = "";
    if (cmd.subcommands && cmd.subcommands.length > 0) {
      const subsDesc = cmd.subcommands
        .map((s) => `    '${s.name}:${zshEsc((s.description ?? "").slice(0, 60))}'`)
        .join("\n");
      const subDispatch = cmd.subcommands
        .map(
          (s) =>
            `        ${s.name}) _pi_cmd_${cmd.name.replace(/-/g, "_")}_${s.name.replace(/-/g, "_")} ;;`,
        )
        .join("\n");
      const subFns = cmd.subcommands
        .map((s) =>
          zshCommandFn(
            s,
            `_pi_cmd_${cmd.name.replace(/-/g, "_")}_${s.name.replace(/-/g, "_")}`,
            depth + 1,
          ),
        )
        .join("\n\n");
      parts.push(subFns);
      body = `  local -a _subs=(
${subsDesc}
  )
  _arguments -C \\
${argLines}
    '1:subcommand:->sub' \\
    '*::arg:->args'

  case "$state" in
    sub)
      _describe -t subcommands '${cmd.name} subcommand' _subs
      ;;
    args)
      case $words[1] in
${subDispatch}
      esac
      ;;
  esac`;
    } else {
      const entries: string[] = cmd.flags.map(zshFlagEntry);
      if (cmd.positional === "package-source") {
        entries.push(`'1:package source:_pi_package_sources${cmd.positionalLiterals?.length ? "_" + cmd.positionalLiterals.join("_") : ""}'`);
      }
      entries.push("'*:args:'");
      const argList = entries.map((e) => `    ${e} \\`).join("\n");
      body = `  _arguments \\
${argList}`;
    }
    parts.push(`${fnName}() {
${body}
}`);
    return parts.filter(Boolean).join("\n\n");
  }

  const commandFns = spec.commands
    .map((c) => zshCommandFn(c, `_pi_cmd_${c.name.replace(/-/g, "_")}`, 0))
    .join("\n\n");

  return `#compdef pi
# Generated by pi-shell-completion from live pi --help output. Do not edit.
${packageSourceHelpers(spec)}
_pi() {
  local curcontext="\$curcontext" state line
  typeset -A opt_args

  local -a subcommands=(
${subDescriptions}
  )

  _arguments -C \\
${topFlagLines}
    '1:command:->cmd' \\
    '*::arg:->args'

  case "\$state" in
    cmd)
      _describe -t subcommands 'pi command' subcommands
      _files
      ;;
    args)
      case \$words[1] in
${dispatch}
        *)
          _files
          ;;
      esac
      ;;
  esac
}

${commandFns}

compdef _pi pi`;
}

function packageSourceHelpers(spec: CompletionSpec): string {
  const variantSet = new Set<string>([""]);
  for (const c of spec.commands) {
    if (c.positional === "package-source" && c.positionalLiterals?.length) {
      variantSet.add(c.positionalLiterals.join("_"));
    }
  }
  const helpers = [...variantSet]
    .map((variant) => {
      const literals = variant ? variant.split("_") : [];
      const words = [...literals, ...PACKAGE_SOURCE_SCHEMES].filter(safeWord);
      return `_pi_package_sources${variant ? "_" + variant : ""}() {
  compadd -S '' -- ${words.map((w) => `'${w}'`).join(" ")}
  _files
}`;
    })
    .join("\n\n");
  return helpers + "\n\n";
}

/* ------------------------------- bash ------------------------------- */

function bashWordList(values: string[]): string {
  return values.filter(safeWord).join(" ");
}

function bashFlagWords(flags: FlagSpec[]): string {
  return flags.flatMap((f) => [f.name, ...(f.short ? [f.short] : [])]).filter(safeWord).join(" ");
}

function bashEnumCases(flags: FlagSpec[], indent: string): string {
  const lines: string[] = [];
  const enumGroups = new Map<string, string[]>();
  const fileFlags: string[] = [];
  for (const f of flags) {
    if (f.enumValues && f.arg) {
      const key = bashWordList(f.enumValues);
      const group = [...(enumGroups.get(key) ?? []), f.name];
      enumGroups.set(key, group);
    } else if (f.fileCompletion) {
      fileFlags.push(f.name);
    }
  }
  for (const [values, names] of enumGroups) {
    lines.push(
      `${indent}${names.join("|")})`,
      `${indent}  COMPREPLY=( $(compgen -W "${values}" -- "\$cur") )`,
      `${indent}  return`,
      `${indent}  ;;`,
    );
  }
  if (fileFlags.length > 0) {
    lines.push(`${indent}${fileFlags.join("|")})`, `${indent}  _filedir`, `${indent}  return`, `${indent}  ;;`);
  }
  return lines.join("\n");
}

function bashCommandFn(cmd: CommandSpec, fnName: string): string {
  const nested = (cmd.subcommands ?? []).map((s) =>
    bashCommandFn(
      s,
      `${fnName}_${s.name.replace(/-/g, "_")}`,
    ),
  );

  let dispatch = "";
  if (cmd.subcommands && cmd.subcommands.length > 0) {
    const arms = cmd.subcommands
      .map(
        (s) =>
          `    ${s.name}) ${fnName}_${s.name.replace(/-/g, "_")} ;;`,
      )
      .join("\n");
    dispatch = `
  case "\${words[2]}" in
${arms}
  esac
  return
`;
  } else {
    const enumCases = bashEnumCases(cmd.flags, "  ");
    const flagWords = bashFlagWords(cmd.flags);
    let positional = "";
    if (cmd.positional === "package-source") {
      const literals = cmd.positionalLiterals ?? [];
      positional = `
  COMPREPLY=( $(compgen -W "${[...literals, ...PACKAGE_SOURCE_SCHEMES].filter(safeWord).join(" ")}" -- "\$cur") )
  _filedir
  return
`;
    } else {
      positional = `
  return
`;
    }
    dispatch = `  case "\$prev" in
${enumCases}  esac

  if [[ "\$cur" == -* ]]; then
    COMPREPLY=( $(compgen -W "${flagWords}" -- "\$cur") )
    return
  fi
${positional}`;
  }

  return `${nested.length > 0 ? nested.join("\n\n") + "\n\n" : ""}${fnName}() {
${dispatch}
}`;
}

export function generateBashCompletion(spec: CompletionSpec): string {
  const commandArms = spec.commands
    .map(
      (c) =>
        `    ${c.name})\n      _pi_cmd_${c.name.replace(/-/g, "_")}\n      return\n      ;;`,
    )
    .join("\n");
  const commandFns = spec.commands
    .map((c) => bashCommandFn(c, `_pi_cmd_${c.name.replace(/-/g, "_")}`))
    .join("\n\n");
  const topEnumCases = bashEnumCases(spec.flags, "    ");
  const topFlagWords = bashFlagWords(spec.flags);
  const subWords = bashWordList(spec.commands.map((c) => c.name));

  return `# bash completion for pi
# Generated by pi-shell-completion from live pi --help output. Do not edit.
_pi() {
  local cur prev words cword
  _init_completion || return

  local cmd="\${words[1]}"

  case "\$cmd" in
${commandArms}
  esac

  case "\$prev" in
${topEnumCases}
  esac

  if [[ "\$cur" == -* ]]; then
    COMPREPLY=( $(compgen -W "${topFlagWords}" -- "\$cur") )
    return
  fi

  COMPREPLY=( $(compgen -W "${subWords}" -- "\$cur") )
}

${commandFns}

complete -F _pi pi`;
}
