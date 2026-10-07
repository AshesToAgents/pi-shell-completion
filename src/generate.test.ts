import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { parseHelp, parseSubcommandHelp, type ParsedHelp, type ParsedSubcommandHelp } from "./help-parser.js";
import { buildSpec, generateZshCompletion, generateBashCompletion } from "./generate.js";
import type { CatalogData } from "./models-catalog.js";

function fixture(name: string): string {
  return readFileSync(new URL(`../fixtures/${name}`, import.meta.url), "utf8");
}

const SUBCOMMANDS = ["install", "remove", "uninstall", "update", "list", "config", "auth", "mcp"];

const catalog: CatalogData = {
  providers: ["anthropic", "openai", "zai"],
  models: ["anthropic/claude-sonnet", "claude-sonnet", "openai/gpt-4o", "gpt-4o", "zai/glm-5.3", "glm-5.3"],
};

function buildTestSpec() {
  const top = parseHelp(fixture("pi-help.txt"));
  const subs: Record<string, ParsedSubcommandHelp> = {};
  for (const sub of SUBCOMMANDS) {
    subs[sub] = parseSubcommandHelp(fixture(`${sub}-help.txt`), sub);
  }
  return { top, subs };
}

const { top, subs } = buildTestSpec();
const spec = buildSpec(top, subs, catalog);
const zsh = generateZshCompletion(spec);
const bash = generateBashCompletion(spec);

describe("spec building", () => {
  it("keeps all top-level flags including previously-missing ones", () => {
    const names = spec.flags.map((f) => f.name);
    for (const flag of [
      "--session-id",
      "--fork",
      "--name",
      "--no-builtin-tools",
      "--exclude-tools",
      "--use-theme",
      "--no-context-files",
      "--tui-mode",
      "--approve",
      "--no-approve",
      "--offline",
    ]) {
      expect(names, `missing ${flag}`).toContain(flag);
    }
  });

  it("adds the extension's own --completion flag", () => {
    const completion = spec.flags.find((f) => f.name === "--completion")!;
    expect(completion.enumValues).toEqual(["bash", "zsh"]);
  });

  it("maps provider/model/tools flags to live sources", () => {
    const byName = new Map(spec.flags.map((f) => [f.name, f]));
    expect(byName.get("--provider")!.enumValues).toEqual(catalog.providers);
    expect(byName.get("--model")!.enumValues).toEqual(catalog.models);
    expect(byName.get("--models")!.enumValues).toEqual(catalog.models);
    expect(byName.get("--tools")!.enumValues).toEqual(spec.toolNames);
    expect(byName.get("--exclude-tools")!.enumValues).toEqual(spec.toolNames);
  });

  it("carries subcommands with their flags and nested subcommands", () => {
    const byName = new Map(spec.commands.map((c) => [c.name, c]));
    expect([...byName.keys()]).toEqual(SUBCOMMANDS);

    const install = byName.get("install")!;
    expect(install.flags.map((f) => f.name)).toContain("--local");

    const mcp = byName.get("mcp")!;
    const add = mcp.subcommands!.find((s) => s.name === "add")!;
    expect(add.flags.map((f) => f.name)).toContain("--url");

    const auth = byName.get("auth")!;
    expect(auth.subcommands!.map((s) => s.name)).toEqual([
      "print-api-key",
      "print-bearer-token",
      "check",
    ]);
  });

  it("marks package-source positionals on install/remove/uninstall/update", () => {
    for (const name of ["install", "remove", "uninstall", "update"]) {
      const cmd = spec.commands.find((c) => c.name === name)!;
      expect(cmd.positional, name).toBe("package-source");
    }
  });

  it("keeps subcommand names even when their help was not collected yet", () => {
    const interim = buildSpec(top, {}, null);
    expect(interim.commands.map((c) => c.name)).toEqual(SUBCOMMANDS);
    expect(interim.commands.every((c) => c.flags.length === 0)).toBe(true);
    const zshInterim = generateZshCompletion(interim);
    expect(zshInterim).toContain("'install:");
    expect(zshInterim).toContain("compdef _pi pi");
  });
});

describe("zsh generation", () => {
  it("registers the completer", () => {
    expect(zsh).toContain("compdef _pi pi");
  });

  it("contains every top-level flag", () => {
    for (const flag of spec.flags) {
      expect(zsh, `missing ${flag.name}`).toContain(flag.name);
    }
  });

  it("contains enum value lists", () => {
    expect(zsh).toContain("off minimal low medium high xhigh max");
    expect(zsh).toContain("text json rpc");
    expect(zsh).toContain("fullscreen regular");
  });

  it("completes providers and models from the catalog", () => {
    expect(zsh).toContain("anthropic openai zai");
    expect(zsh).toContain("anthropic/claude-sonnet");
    expect(zsh).toContain("gpt-4o");
  });

  it("generates per-subcommand handlers including nested ones", () => {
    expect(zsh).toContain("_pi_cmd_install");
    expect(zsh).toContain("_pi_cmd_mcp");
    expect(zsh).toContain("_pi_cmd_auth");
    expect(zsh).toMatch(/print-api-key/);
    expect(zsh).toMatch(/bearer-token-env-var/);
  });

  it("offers package source schemes for install positionals", () => {
    expect(zsh).toContain("npm:");
    expect(zsh).toContain("ssh:");
  });

  it("is syntactically valid zsh", () => {
    try {
      execFileSync("zsh", ["-n"], { input: zsh, stdio: ["pipe", "ignore", "ignore"] });
    } catch {
      throw new Error("generated zsh script failed syntax check");
    }
  });
});

describe("bash generation", () => {
  it("registers the completer", () => {
    expect(bash).toContain("complete -F _pi pi");
  });

  it("contains every top-level flag", () => {
    for (const flag of spec.flags) {
      expect(bash, `missing ${flag.name}`).toContain(flag.name);
    }
  });

  it("contains enum value lists", () => {
    expect(bash).toContain("off minimal low medium high xhigh max");
    expect(bash).toContain("text json rpc");
  });

  it("completes providers and models from the catalog", () => {
    expect(bash).toContain("anthropic openai zai");
    expect(bash).toContain("anthropic/claude-sonnet");
  });

  it("dispatches per subcommand including nested auth/mcp handling", () => {
    expect(bash).toContain("install)");
    expect(bash).toContain("_pi_cmd_auth");
    expect(bash).toContain("_pi_cmd_mcp");
    expect(bash).toContain("print-api-key");
  });

  it("is syntactically valid bash", () => {
    execFileSync("bash", ["-n"], { input: bash, stdio: ["pipe", "ignore", "ignore"] });
  });
});
