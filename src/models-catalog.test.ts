import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readCatalogs } from "./models-catalog.js";

let dir: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "pi-completion-catalog-"));
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

function write(file: string, content: string) {
  writeFileSync(join(dir, file), content);
}

describe("readCatalogs", () => {
  it("merges providers and models from all three catalog files", () => {
    write(
      "models.json",
      JSON.stringify({
        providers: {
          anthropic: { models: [{ id: "claude-sonnet" }] },
        },
      }),
    );
    write(
      "models-store.json",
      JSON.stringify({
        openai: { models: [{ id: "gpt-4o" }, { id: "gpt-4o-mini" }] },
      }),
    );
    write(
      "models.local.json",
      JSON.stringify({
        providers: {
          ollama: { models: [{ id: "llama3" }] },
        },
      }),
    );

    const catalog = readCatalogs(dir)!;
    expect(catalog.providers).toContain("anthropic");
    expect(catalog.providers).toContain("openai");
    expect(catalog.providers).toContain("ollama");
    expect(catalog.models).toContain("anthropic/claude-sonnet");
    expect(catalog.models).toContain("openai/gpt-4o");
    expect(catalog.models).toContain("ollama/llama3");
  });

  it("offers bare model ids alongside provider-prefixed ids", () => {
    write("models.json", JSON.stringify({ providers: { anthropic: { models: [{ id: "claude-sonnet" }] } } }));
    write("models-store.json", "{}");
    write("models.local.json", "{}");

    const catalog = readCatalogs(dir)!;
    expect(catalog.models).toContain("claude-sonnet");
    expect(catalog.models).toContain("anthropic/claude-sonnet");
  });

  it("deduplicates providers and models across files", () => {
    write(
      "models.json",
      JSON.stringify({ providers: { anthropic: { models: [{ id: "claude-sonnet" }] } } }),
    );
    write(
      "models.local.json",
      JSON.stringify({ providers: { anthropic: { models: [{ id: "claude-sonnet" }, { id: "claude-haiku" }] } } }),
    );
    write("models-store.json", "{}");

    const catalog = readCatalogs(dir)!;
    expect(catalog.providers.filter((p) => p === "anthropic")).toHaveLength(1);
    expect(catalog.models.filter((m) => m === "anthropic/claude-sonnet")).toHaveLength(1);
  });

  it("tolerates missing files", () => {
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    write("models.json", JSON.stringify({ providers: { zai: { models: [{ id: "glm" }] } } }));

    const catalog = readCatalogs(dir)!;
    expect(catalog.providers).toEqual(["zai"]);
  });

  it("tolerates malformed JSON by skipping the file", () => {
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    write("models.json", "{ not valid json");
    write("models-store.json", JSON.stringify({ openai: { models: [{ id: "gpt-4o" }] } }));

    const catalog = readCatalogs(dir)!;
    expect(catalog.providers).toEqual(["openai"]);
  });

  it("returns null when nothing readable exists", () => {
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    expect(readCatalogs(dir)).toBeNull();
  });
});
