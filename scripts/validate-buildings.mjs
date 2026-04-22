import { readBuildingManifests } from "../lib/buildinghub.mjs";

if (import.meta.url === `file://${process.argv[1]}`) {
  const manifests = await readBuildingManifests();
  process.stdout.write(`validated ${manifests.length} BuildingHub manifests\n`);
}
