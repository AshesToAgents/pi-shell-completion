import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { parseHelp, parseSubcommandHelp } from "./help-parser.js";
import { collectHelpSync, SUBCOMMAND_HINTS } from "./regenerate.js";

/**
 * Drift tripwire: compares the committed fixtures against the REAL pi CLI.
 * When pi's flags/subcommands change, this fails and tells you to refresh
 * fixtures. Extension-registered flags vary per install, so the top-level
 * comparison uses `pi -ne --help` (extensions disabled) for determinism.
 */

function fixture(name: string): string {
  return readFileSync(new URL(`../fixtures/${name}`, import.meta.url), "utf8");
}

function piAvailable(): boolean {
  return spawnSync("pi", ["--version"], { encoding: "utf8" }).status === 0;
}

describe("fixtures match the real pi CLI", () => {
  it.skipIf(!piAvailable())(
    "top-level help has not drifted",
    { timeout: 120_000 },
    () => {
      const real = spawnSync("pi", ["-ne", "--help"], { encoding: "utf8", timeout: 60_000 });
      expect(real.status).toBe(0);
      const realFlags = parseHelp(real.stdout).flags.map((f) => f.name).sort();
      const fixtureFlags = parseHelp(fixture("pi-help.txt")).flags.map((f) => f.name).sort();

      const missingInFixture = realFlags.filter((f) => !fixtureFlags.includes(f));
      const staleInFixture = fixtureFlags.filter((f) => !realFlags.includes(f));
      expect(
        { missingInFixture, staleInFixture },
        "pi's CLI has changed — run `npm run update-fixtures` and review the parser tests",
      ).toEqual({ missingInFixture: [], staleInFixture: [] });

      const realCommands = parseHelp(real.stdout).commands.map((c) => c.name).sort();
      const fixtureCommands = parseHelp(fixture("pi-help.txt")).commands.map((c) => c.name).sort();
      expect(realCommands).toEqual(fixtureCommands);
    },
  );

  it.skipIf(!piAvailable())(
    "subcommand help has not drifted",
    { timeout: 180_000 },
    () => {
      const collected = collectHelpSync();
      for (const sub of SUBCOMMAND_HINTS) {
        const realFlags = parseSubcommandHelp(collected.subHelps[sub], sub)
          .flags.map((f) => f.name)
          .sort();
        const fixtureFlags = parseSubcommandHelp(fixture(`${sub}-help.txt`), sub)
          .flags.map((f) => f.name)
          .sort();
        expect(
          { sub, realFlags, fixtureFlags },
          `pi ${sub} --help has changed — run \`npm run update-fixtures\``,
        ).toEqual({ sub, realFlags: fixtureFlags, fixtureFlags: realFlags });
      }
    },
  );
});
