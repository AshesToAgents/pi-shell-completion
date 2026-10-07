#!/usr/bin/env node
/**
 * Refreshes fixtures/*.txt from the real pi CLI.
 * Run after `pi -ne --help` output changes (the drift test will tell you).
 */
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const fixtures = join(root, "fixtures");

function capture(args) {
  const res = spawnSync("pi", args, { encoding: "utf8", timeout: 60_000 });
  if (res.status !== 0) {
    console.error(`pi ${args.join(" ")} failed (exit ${res.status})`);
    process.exit(1);
  }
  return res.stdout;
}

writeFileSync(join(fixtures, "pi-help.txt"), capture(["-ne", "--help"]));
for (const sub of ["install", "remove", "uninstall", "update", "list", "config", "auth", "mcp"]) {
  writeFileSync(join(fixtures, `${sub}-help.txt`), capture([sub, "--help"]));
}
console.log("Fixtures refreshed. Review the diff and re-run: npm test");
