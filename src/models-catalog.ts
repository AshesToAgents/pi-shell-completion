/**
 * Reads pi's model catalogs (~/.pi/agent/models*.json) to provide live
 * provider and model completions. Never reads or emits credential fields.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

export interface CatalogData {
  /** Sorted, deduplicated provider names */
  providers: string[];
  /** Model ids as both "provider/id" and bare "id" forms, deduplicated */
  models: string[];
}

interface RawProvider {
  models?: Array<{ id?: string }>;
}

/** Extract provider->model-ids from either catalog shape */
function extractProviders(data: unknown): Map<string, string[]> {
  const result = new Map<string, string[]>();
  if (!data || typeof data !== "object") return result;
  const container =
    "providers" in (data as Record<string, unknown>)
      ? (data as Record<string, unknown>).providers
      : data;
  if (!container || typeof container !== "object") return result;
  for (const [name, value] of Object.entries(container as Record<string, unknown>)) {
    const provider = value as RawProvider;
    if (!provider || typeof provider !== "object" || !Array.isArray(provider.models)) continue;
    const ids = provider.models
      .map((m) => m?.id)
      .filter((id): id is string => typeof id === "string");
    if (ids.length > 0) result.set(name, ids);
  }
  return result;
}

export function readCatalogs(agentDir: string): CatalogData | null {
  const providers = new Map<string, string[]>();
  let sawAnyFile = false;

  for (const file of ["models.json", "models-store.json", "models.local.json"]) {
    let text: string;
    try {
      text = readFileSync(join(agentDir, file), "utf8");
    } catch {
      continue; // missing file
    }
    try {
      for (const [name, ids] of extractProviders(JSON.parse(text))) {
        const existing = providers.get(name) ?? [];
        providers.set(name, [...existing, ...ids]);
        sawAnyFile = true;
      }
    } catch {
      // malformed JSON: skip this file
    }
  }

  if (!sawAnyFile) return null;

  const providerNames = [...providers.keys()].sort();
  const models = new Set<string>();
  for (const [provider, ids] of providers) {
    for (const id of new Set(ids)) {
      models.add(`${provider}/${id}`);
      models.add(id);
    }
  }

  return {
    providers: providerNames,
    models: [...models].sort(),
  };
}
