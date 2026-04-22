import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readBuildingManifests } from "./validate-buildings.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const registryPath = path.join(root, "registry.json");
const buildings = await readBuildingManifests();

function comparableRegistry(registry) {
  return JSON.stringify(
    {
      ...registry,
      generatedAt: "",
    },
    null,
    2,
  );
}

let generatedAt = new Date().toISOString();
const registry = {
  manifestVersion: 1,
  generatedAt,
  name: "Vibe Research BuildingHub",
  buildings,
};

try {
  const existing = JSON.parse(await readFile(registryPath, "utf8"));
  if (comparableRegistry(existing) === comparableRegistry(registry) && existing.generatedAt) {
    generatedAt = existing.generatedAt;
    registry.generatedAt = generatedAt;
  }
} catch {
  // Missing or malformed registries are replaced by a fresh generated file.
}

await writeFile(registryPath, `${JSON.stringify(registry, null, 2)}\n`, "utf8");
process.stdout.write(`wrote registry.json with ${buildings.length} buildings\n`);
