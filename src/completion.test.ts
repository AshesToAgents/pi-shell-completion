import { describe, it, expect } from "vitest";
import { generateZshCompletion, generateBashCompletion } from "./completion.js";

describe("generateZshCompletion", () => {
  it("contains compdef _pi pi", () => {
    const result = generateZshCompletion();
    expect(result).toContain("compdef _pi pi");
  });

  it("contains subcommands", () => {
    const result = generateZshCompletion();
    expect(result).toContain("install:Install a package");
    expect(result).toContain("remove:Remove a package");
    expect(result).toContain("update:Update packages");
  });

  it("contains flag definitions", () => {
    const result = generateZshCompletion();
    expect(result).toContain("--provider");
    expect(result).toContain("--model");
    expect(result).toContain("--thinking");
  });
});

describe("generateBashCompletion", () => {
  it("contains complete -F _pi pi", () => {
    const result = generateBashCompletion();
    expect(result).toContain("complete -F _pi pi");
  });

  it("contains subcommands", () => {
    const result = generateBashCompletion();
    expect(result).toContain("install remove update list config");
  });

  it("contains flag completions", () => {
    const result = generateBashCompletion();
    expect(result).toContain("--provider");
    expect(result).toContain("--thinking");
  });
});
