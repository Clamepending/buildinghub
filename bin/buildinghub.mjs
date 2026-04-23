#!/usr/bin/env node
import path from "node:path";
import {
  BUILDINGHUB_VERSION,
  DEFAULT_ROOT,
  buildRegistry,
  buildSite,
  initBuilding,
  packAllBuildings,
  packBuilding,
  readBuildingManifests,
  readLayoutManifests,
  readRecipeManifests,
} from "../lib/buildinghub.mjs";

function usage() {
  return `BuildingHub ${BUILDINGHUB_VERSION}

Usage:
  buildinghub validate [--root <path>]
  buildinghub build [--root <path>]
  buildinghub site [--root <path>]
  buildinghub list [--root <path>]
  buildinghub pack <id|--all> [--root <path>] [--out <path>]
  buildinghub init <id> [--name <name>] [--root <path>]
  buildinghub publish <id> [--root <path>]
  buildinghub doctor [--root <path>]

BuildingHub is manifest-only by default. The CLI packages metadata for review; it does not
publish executable code or install helper commands.
`;
}

function parseArgs(argv) {
  const args = [...argv];
  const command = args.shift() || "help";
  const options = {
    positional: [],
    root: DEFAULT_ROOT,
  };

  while (args.length) {
    const arg = args.shift();
    if (arg === "--root") {
      options.root = path.resolve(args.shift() || "");
    } else if (arg === "--out") {
      options.outDir = path.resolve(args.shift() || "");
    } else if (arg === "--name") {
      options.name = args.shift() || "";
    } else if (arg === "--all") {
      options.all = true;
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else {
      options.positional.push(arg);
    }
  }

  return { command, options };
}

function requireId(options, command) {
  const id = options.positional[0];
  if (!id) {
    throw new Error(`${command}: missing building id`);
  }
  return id;
}

async function run() {
  const { command, options } = parseArgs(process.argv.slice(2));
  if (options.help || command === "help") {
    process.stdout.write(usage());
    return;
  }

  if (command === "validate") {
    const entries = await readBuildingManifests({ root: options.root });
    const layouts = await readLayoutManifests({ root: options.root });
    const recipes = await readRecipeManifests({ root: options.root });
    process.stdout.write(`validated ${entries.length} BuildingHub manifests, ${layouts.length} layouts, and ${recipes.length} scaffolds\n`);
    return;
  }

  if (command === "build") {
    const { registry } = await buildRegistry({ root: options.root });
    process.stdout.write(`wrote registry.json with ${registry.packageCount} buildings, ${registry.layoutCount} layouts, and ${registry.recipeCount} scaffolds\n`);
    return;
  }

  if (command === "site") {
    const { registry, siteDir } = await buildSite({ root: options.root });
    process.stdout.write(`prepared ${siteDir} with ${registry.packageCount} buildings, ${registry.layoutCount} layouts, and ${registry.recipeCount} scaffolds\n`);
    return;
  }

  if (command === "list") {
    const entries = await readBuildingManifests({ root: options.root });
    for (const { manifest } of entries) {
      process.stdout.write(`${manifest.id}\t${manifest.version}\t${manifest.trust || "manifest-only"}\t${manifest.name}\n`);
    }
    const layouts = await readLayoutManifests({ root: options.root });
    for (const { layout } of layouts) {
      process.stdout.write(`${layout.id}\t${layout.version}\tlayout\t${layout.name}\n`);
    }
    const recipes = await readRecipeManifests({ root: options.root });
    for (const { recipe } of recipes) {
      process.stdout.write(`${recipe.id}\t${recipe.version}\tscaffold\t${recipe.name}\n`);
    }
    return;
  }

  if (command === "pack") {
    const outDir = options.outDir || path.join(options.root, "dist");
    const bundles = options.all || options.positional[0] === "--all"
      ? await packAllBuildings({ root: options.root, outDir })
      : [await packBuilding(requireId(options, "pack"), { root: options.root, outDir })];
    for (const bundle of bundles) {
      process.stdout.write(`packed ${bundle.id}@${bundle.version} ${bundle.bundlePath}\n`);
    }
    return;
  }

  if (command === "init") {
    const id = requireId(options, "init");
    const result = await initBuilding(id, { root: options.root, name: options.name });
    process.stdout.write(`created ${result.manifestPath}\n`);
    return;
  }

  if (command === "publish") {
    const id = requireId(options, "publish");
    await buildRegistry({ root: options.root });
    const bundle = await packBuilding(id, { root: options.root, outDir: path.join(options.root, "dist") });
    process.stdout.write(
      [
        `prepared ${bundle.id}@${bundle.version}`,
        `bundle: ${bundle.bundlePath}`,
        `sha256: ${bundle.bundleSha256}`,
        "next: open a PR with the building manifest, README, regenerated registry.json, and review notes.",
        "",
      ].join("\n"),
    );
    return;
  }

  if (command === "doctor") {
    const entries = await readBuildingManifests({ root: options.root });
    const layouts = await readLayoutManifests({ root: options.root });
    const recipes = await readRecipeManifests({ root: options.root });
    const { registry } = await buildRegistry({ root: options.root, write: false });
    process.stdout.write(
      [
        `root: ${options.root}`,
        `cli: buildinghub/${BUILDINGHUB_VERSION}`,
        `buildings: ${entries.length}`,
        `layouts: ${layouts.length}`,
        `scaffolds: ${recipes.length}`,
        `registry packages: ${registry.packageCount}`,
        `registry layout packages: ${registry.layoutCount}`,
        `registry scaffold packages: ${registry.recipeCount}`,
        "safety: manifest-only loader, no executable package lane enabled",
        "",
      ].join("\n"),
    );
    return;
  }

  throw new Error(`Unknown command: ${command}\n\n${usage()}`);
}

run().catch((error) => {
  process.stderr.write(`${error.message || error}\n`);
  process.exitCode = 1;
});
