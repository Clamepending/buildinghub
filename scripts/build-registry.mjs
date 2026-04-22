import { buildRegistry } from "../lib/buildinghub.mjs";

const { registry } = await buildRegistry();
process.stdout.write(`wrote registry.json with ${registry.packageCount} buildings\n`);
