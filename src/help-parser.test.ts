import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { parseHelp, parseSubcommandHelp } from "./help-parser.js";

function fixture(name: string): string {
  return readFileSync(new URL(`../fixtures/${name}`, import.meta.url), "utf8");
}

describe("parseHelp (top-level)", () => {
  const help = parseHelp(fixture("pi-help.txt"));

  it("extracts all current long flags", () => {
    const names = help.flags.map((f) => f.name);
    // Flags that were missing from the old hand-maintained completion
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
      "--provider",
      "--model",
      "--thinking",
      "--mode",
      "--export",
    ]) {
      expect(names, `missing ${flag}`).toContain(flag);
    }
  });

  it("extracts short forms, including multi-letter ones", () => {
    const byName = new Map(help.flags.map((f) => [f.name, f]));
    expect(byName.get("--print")?.short).toBe("-p");
    expect(byName.get("--no-tools")?.short).toBe("-nt");
    expect(byName.get("--no-builtin-tools")?.short).toBe("-nbt");
    expect(byName.get("--exclude-tools")?.short).toBe("-xt");
    expect(byName.get("--no-context-files")?.short).toBe("-nc");
    expect(byName.get("--approve")?.short).toBe("-a");
    expect(byName.get("--no-approve")?.short).toBe("-na");
    expect(byName.get("--name")?.short).toBe("-n");
  });

  it("captures value placeholders", () => {
    const byName = new Map(help.flags.map((f) => [f.name, f]));
    expect(byName.get("--provider")?.arg).toBe("name");
    expect(byName.get("--session-dir")?.arg).toBe("dir");
    expect(byName.get("--model")?.arg).toBe("pattern");
  });

  it("marks optional args", () => {
    const byName = new Map(help.flags.map((f) => [f.name, f]));
    expect(byName.get("--list-models")?.arg).toBe("search");
    expect(byName.get("--list-models")?.optionalArg).toBe(true);
  });

  it("parses enum values from descriptions", () => {
    const byName = new Map(help.flags.map((f) => [f.name, f]));
    expect(byName.get("--thinking")?.enumValues).toEqual([
      "off",
      "minimal",
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
    ]);
    expect(byName.get("--mode")?.enumValues).toEqual(["text", "json", "rpc"]);
    expect(byName.get("--tui-mode")?.enumValues).toEqual(["fullscreen", "regular"]);
  });

  it("does not misparse non-enum descriptions as enums", () => {
    const byName = new Map(help.flags.map((f) => [f.name, f]));
    expect(byName.get("--provider")?.enumValues).toBeUndefined();
    expect(byName.get("--export")?.enumValues).toBeUndefined();
    expect(byName.get("--fork")?.enumValues).toBeUndefined();
  });

  it("joins wrapped description continuation lines", () => {
    const byName = new Map(help.flags.map((f) => [f.name, f]));
    expect(byName.get("--models")?.description).toContain("Supports globs");
    expect(byName.get("--tools")?.description).toContain("extension, and custom tools");
  });

  it("detects repeatable flags", () => {
    const byName = new Map(help.flags.map((f) => [f.name, f]));
    expect(byName.get("--append-system-prompt")?.repeatable).toBe(true);
    expect(byName.get("--extension")?.repeatable).toBe(true);
    expect(byName.get("--skill")?.repeatable).toBe(true);
    expect(byName.get("--provider")?.repeatable).toBe(false);
  });

  it("extracts subcommands from the Commands section", () => {
    expect(help.commands.map((c) => c.name)).toEqual([
      "install",
      "remove",
      "uninstall",
      "update",
      "list",
      "config",
      "auth",
      "mcp",
    ]);
  });

  it("captures subcommand arg specs and descriptions", () => {
    const install = help.commands.find((c) => c.name === "install")!;
    expect(install.argspec).toBe("<source> [-l]");
    expect(install.description).toMatch(/Install extension source/);
  });

  it("extracts built-in tool names", () => {
    expect(help.toolNames).toEqual([
      "read",
      "bash",
      "powershell",
      "edit",
      "write",
      "grep",
      "find",
      "ls",
    ]);
  });

  it("skips the bare -- end-of-options marker", () => {
    expect(help.flags.map((f) => f.name)).not.toContain("--");
  });

  it("marks file-like args for file completion", () => {
    const byName = new Map(help.flags.map((f) => [f.name, f]));
    expect(byName.get("--export")?.fileCompletion).toBe(true);
    expect(byName.get("--session-dir")?.fileCompletion).toBe(true);
    expect(byName.get("--skill")?.fileCompletion).toBe(true);
    expect(byName.get("--theme")?.fileCompletion).toBe(true);
    expect(byName.get("--provider")?.fileCompletion).toBe(false);
  });
});

describe("parseSubcommandHelp", () => {
  it("parses install flags with short-first format", () => {
    const spec = parseSubcommandHelp(fixture("install-help.txt"), "install");
    const byName = new Map(spec.flags.map((f) => [f.name, f]));
    expect(byName.get("--local")?.short).toBe("-l");
    expect(byName.get("--approve")?.short).toBe("-a");
    expect(byName.get("--no-approve")?.short).toBe("-na");
    expect(spec.usageLines[0]).toBe("pi install <source> [-l] [--approve|--no-approve]");
  });

  it("derives auth subcommands from usage lines with per-subcommand flags", () => {
    const spec = parseSubcommandHelp(fixture("auth-help.txt"), "auth");
    expect(spec.subcommands.map((s) => s.name)).toEqual([
      "print-api-key",
      "print-bearer-token",
      "check",
    ]);
    const check = spec.subcommands.find((s) => s.name === "check")!;
    expect(check.flags.map((f) => f.name)).toEqual([
      "--provider",
      "--model",
      "--json",
      "--credentials",
      "--no-refresh",
    ]);
    const bearer = spec.subcommands.find((s) => s.name === "print-bearer-token")!;
    expect(bearer.flags.map((f) => f.name)).toContain("--min-expiry");
  });

  it("parses mcp subcommands, scoped flag sections, and wrapped descriptions", () => {
    const spec = parseSubcommandHelp(fixture("mcp-help.txt"), "mcp");
    expect(spec.subcommands.map((s) => s.name)).toEqual([
      "add",
      "remove",
      "list",
      "login",
      "logout",
    ]);

    // "Options for add and remove:" applies to both
    const add = spec.subcommands.find((s) => s.name === "add")!;
    const remove = spec.subcommands.find((s) => s.name === "remove")!;
    for (const [sub, label] of [
      [add, "add"],
      [remove, "remove"],
    ] as const) {
      const names = sub.flags.map((f) => f.name);
      expect(names, label).toContain("--local");
    }

    // "Options for add:" only to add
    const addNames = add.flags.map((f) => f.name);
    for (const flag of [
      "--url",
      "--env",
      "--cwd",
      "--header",
      "--bearer-token-env-var",
      "--oauth-client-id",
      "--exposure",
      "--description",
    ]) {
      expect(addNames, `add missing ${flag}`).toContain(flag);
    }
    expect(remove.flags.map((f) => f.name)).not.toContain("--url");

    // Flag with description on the following line
    const btev = add.flags.find((f) => f.name === "--bearer-token-env-var")!;
    expect(btev.arg).toBe("NAME");
    expect(btev.description).toContain("Authorization: Bearer");

    // Usage-line flags land on the right subcommand
    const list = spec.subcommands.find((s) => s.name === "list")!;
    expect(list.flags.map((f) => f.name)).toContain("--json");
    const login = spec.subcommands.find((s) => s.name === "login")!;
    const timeout = login.flags.find((f) => f.name === "--timeout")!;
    expect(timeout.arg).toBe("seconds");
  });

  it("parses update flags including --force and target arg spec", () => {
    const spec = parseSubcommandHelp(fixture("update-help.txt"), "update");
    const names = spec.flags.map((f) => f.name);
    for (const flag of ["--self", "--extensions", "--models", "--all", "--extension", "--force", "--approve", "--no-approve"]) {
      expect(names, `missing ${flag}`).toContain(flag);
    }
    expect(spec.usageLines[0].startsWith("pi update [source|self|pi]")).toBe(true);
    expect(spec.usageLines[0]).toContain("[--force]");
  });
});
