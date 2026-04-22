import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readBuildingManifests } from "./validate-buildings.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const buildings = await readBuildingManifests();
const registry = {
  manifestVersion: 1,
  generatedAt: new Date().toISOString(),
  name: "Vibe Research BuildingHub",
  buildings,
};

await writeFile(path.join(root, "registry.json"), `${JSON.stringify(registry, null, 2)}\n`, "utf8");
process.stdout.write(`wrote registry.json with ${buildings.length} buildings\n`);
