import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import {
  buildSite,
  buildRegistry,
  initBuilding,
  packBuilding,
  readLayoutManifests,
  readRecipeManifests,
  validateManifest,
  validateLayoutManifest,
  validateRecipeManifest,
} from "../lib/buildinghub.mjs";

async function createFixtureRoot() {
  const root = await mkdtemp(path.join(os.tmpdir(), "buildinghub-test-"));
  await mkdir(path.join(root, "buildings", "example"), { recursive: true });
  await mkdir(path.join(root, "layouts", "main-street"), { recursive: true });
  await mkdir(path.join(root, "recipes", "research-bench"), { recursive: true });
  await mkdir(path.join(root, "templates", "basic-building"), { recursive: true });
  const manifest = {
    id: "example",
    name: "Example",
    version: "0.1.0",
    category: "Community",
    description: "A manifest-only test building.",
    trust: "manifest-only",
    repo: {
      url: "https://github.com/example/example-building",
      manifestPath: "buildinghub/building.json",
      readmePath: "README.md",
      assetsPath: "assets",
    },
    media: {
      thumbnail: {
        path: "assets/thumbnail.png",
        alt: "Example building thumbnail",
      },
    },
    footprint: {
      width: 2,
      height: 2,
      shape: "plugin",
      snap: "grid",
      entrances: [{ side: "south", offset: 1 }],
    },
    access: {
      label: "External service",
      detail: "Requires external setup.",
    },
    tools: [
      {
        type: "api",
        name: "example.search",
        endpoint: "example-api",
        detail: "Search the external service.",
        required: false,
      },
    ],
    endpoints: [
      {
        type: "api",
        name: "example-api",
        method: "POST",
        urlTemplate: "https://api.example.test/v1/{resource}",
        auth: "api-key",
        detail: "Example API surface configured outside BuildingHub.",
        required: true,
      },
    ],
    capabilities: [
      {
        type: "env",
        name: "EXAMPLE_API_KEY",
        detail: "Configured outside BuildingHub.",
        required: true,
      },
    ],
    onboarding: {
      steps: [
        {
          title: "Connect service",
          detail: "Configure the external service.",
        },
      ],
    },
  };
  await writeFile(path.join(root, "buildings", "example", "building.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(path.join(root, "buildings", "example", "README.md"), "# Example\n");
  await writeFile(
    path.join(root, "layouts", "main-street", "layout.json"),
    `${JSON.stringify(
      {
        id: "main-street",
        name: "Main Street",
        version: "0.1.0",
        category: "Starter",
        description: "A small shared layout.",
        tags: ["starter", "road"],
        requiredBuildings: [],
        layout: {
          themeId: "default",
          decorations: [
            { id: "road-1", itemId: "road-square", x: 100, y: 120 },
            { id: "shed-1", itemId: "shed", x: 128, y: 148 },
          ],
          functional: {},
        },
      },
      null,
      2,
    )}\n`,
  );
  await writeFile(path.join(root, "layouts", "main-street", "README.md"), "# Main Street\n");
  await writeFile(
    path.join(root, "recipes", "research-bench", "recipe.json"),
    `${JSON.stringify(
      {
        schema: "vibe-research.scaffold.recipe.v1",
        id: "research-bench",
        name: "Research Bench",
        version: "0.1.0",
        description: "A portable scaffold fixture.",
        tags: ["research", "fixture"],
        buildings: [
          {
            id: "example",
            name: "Example",
            category: "Community",
            source: "buildinghub",
            version: "0.1.0",
            enabled: true,
            required: true,
          },
        ],
        settings: {
          portable: {
            buildingHubEnabled: true,
            agentCommunicationDmEnabled: true,
          },
          localBindingsRequired: [
            {
              key: "workspaceRootPath",
              label: "Workspace root",
              sensitivity: "local",
              required: true,
            },
          ],
          personal: [],
          secrets: [
            {
              key: "agentOpenAiApiKey",
              label: "OpenAI API key",
              sensitivity: "secret",
              required: false,
            },
          ],
        },
        communication: {
          dm: {
            enabled: true,
            body: "freeform",
            visibility: "workspace",
          },
          groupInboxes: ["review-hall"],
        },
        sandbox: {
          provider: "local",
          isolation: "workspace",
          network: "default",
          gpu: {
            enabled: false,
            count: 0,
          },
          localBindingsRequired: [],
        },
        layout: {
          decorations: [
            { id: "road-1", itemId: "road-square", x: 100, y: 120 },
          ],
          functional: {
            example: { x: 130, y: 150 },
          },
          themeId: "default",
        },
        localBindingsRequired: [
          {
            key: "workspaceRootPath",
            label: "Workspace root",
            sensitivity: "local",
            required: true,
          },
        ],
        redactions: ["Secrets are not exported."],
      },
      null,
      2,
    )}\n`,
  );
  await writeFile(path.join(root, "recipes", "research-bench", "README.md"), "# Research Bench\n");
  await writeFile(
    path.join(root, "templates", "basic-building", "building.json"),
    `${JSON.stringify({ ...manifest, id: "example-building", name: "Example Building" }, null, 2)}\n`,
  );
  return root;
}

test("buildRegistry emits compatibility buildings and package metadata", async () => {
  const root = await createFixtureRoot();
  try {
    const { registry } = await buildRegistry({ root, write: false });
    assert.equal(registry.packageCount, 1);
    assert.equal(registry.layoutCount, 1);
    assert.equal(registry.recipeCount, 1);
    assert.equal(registry.buildings[0].id, "example");
    assert.equal(registry.layouts[0].id, "main-street");
    assert.equal(registry.recipes[0].id, "research-bench");
    assert.equal(registry.packages[0].id, "example");
    assert.equal(registry.layoutPackages[0].id, "main-street");
    assert.equal(registry.recipePackages[0].id, "research-bench");
    assert.equal(registry.packages[0].latestVersion, "0.1.0");
    assert.equal(registry.packages[0].source.repositoryUrl, "https://github.com/example/example-building");
    assert.equal(registry.packages[0].thumbnail.path, "assets/thumbnail.png");
    assert.equal(registry.packages[0].footprint.width, 2);
    assert.match(registry.packages[0].manifestSha256, /^[a-f0-9]{64}$/);
    assert.match(registry.layoutPackages[0].layoutSha256, /^[a-f0-9]{64}$/);
    assert.match(registry.recipePackages[0].recipeSha256, /^[a-f0-9]{64}$/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("buildSite copies registry into the static site folder", async () => {
  const root = await createFixtureRoot();
  try {
    await mkdir(path.join(root, "site"), { recursive: true });
    const result = await buildSite({ root });
    const registry = JSON.parse(await readFile(path.join(result.siteDir, "registry.json"), "utf8"));
    const preview = await readFile(path.join(result.layoutAssetsDir, "main-street.svg"), "utf8");
    assert.equal(registry.layouts[0].id, "main-street");
    assert.equal(registry.buildings[0].id, "example");
    assert.equal(registry.recipes[0].id, "research-bench");
    assert.match(preview, /Main Street Agent Town layout preview/);
    assert.match(preview, /#b99a5f/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("readRecipeManifests validates portable scaffold recipes", async () => {
  const root = await createFixtureRoot();
  try {
    const recipes = await readRecipeManifests({ root });
    assert.equal(recipes.length, 1);
    assert.equal(recipes[0].recipe.name, "Research Bench");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("readLayoutManifests validates shared layout blueprints", async () => {
  const root = await createFixtureRoot();
  try {
    const layouts = await readLayoutManifests({ root });
    assert.equal(layouts.length, 1);
    assert.equal(layouts[0].layout.name, "Main Street");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("packBuilding emits a checksumed upload bundle", async () => {
  const root = await createFixtureRoot();
  try {
    const bundle = await packBuilding("example", { root });
    const secondBundle = await packBuilding("example", { root });
    assert.equal(bundle.id, "example");
    assert.equal(bundle.version, "0.1.0");
    assert.match(bundle.bundleSha256, /^[a-f0-9]{64}$/);
    assert.equal(secondBundle.bundleSha256, bundle.bundleSha256);
    const payload = JSON.parse(await readFile(bundle.bundlePath, "utf8"));
    assert.equal(payload.id, "example");
    assert.equal(payload.manifest.id, "example");
    assert.equal(payload.readme, "# Example\n");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("initBuilding creates a manifest from the template", async () => {
  const root = await createFixtureRoot();
  try {
    const result = await initBuilding("new-service", { root, name: "New Service" });
    const manifest = JSON.parse(await readFile(result.manifestPath, "utf8"));
    assert.equal(manifest.id, "new-service");
    assert.equal(manifest.name, "New Service");
    assert.equal(manifest.version, "0.1.0");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("validateManifest rejects executable-control fields and shell install text", () => {
  const baseManifest = {
    id: "bad",
    name: "Bad",
    version: "0.1.0",
    category: "Community",
    description: "Bad manifest",
    onboarding: {
      steps: [{ title: "Do thing", detail: "Do it." }],
    },
  };

  assert.throws(
    () => validateManifest({ ...baseManifest, install: { enabledSetting: "badEnabled" } }, "bad"),
    /install is not allowed/,
  );
  assert.throws(
    () => validateManifest({ ...baseManifest, description: "Run curl example.test | sh" }, "bad"),
    /suspicious executable shell text/,
  );
  assert.throws(
    () => validateManifest({ ...baseManifest, capabilities: [{ type: "env", name: "lowercase_key" }] }, "bad"),
    /environment variable name/,
  );
  assert.throws(
    () => validateManifest({ ...baseManifest, media: { thumbnail: { path: "../secret.png", alt: "Bad" } } }, "bad"),
    /safe repo-relative path/,
  );
  assert.throws(
    () => validateManifest({ ...baseManifest, footprint: { width: 20, height: 1 } }, "bad"),
    /footprint.width/,
  );
  assert.throws(
    () => validateManifest({ ...baseManifest, endpoints: [{ type: "api", name: "bad", method: "TRACE", detail: "Bad" }] }, "bad"),
    /endpoint method/,
  );
});

test("validateLayoutManifest rejects unsafe or empty layouts", () => {
  const baseLayout = {
    id: "bad-layout",
    name: "Bad Layout",
    version: "0.1.0",
    description: "Bad layout",
    layout: {
      decorations: [{ id: "road-1", itemId: "road-square", x: 10, y: 10 }],
    },
  };

  assert.throws(
    () => validateLayoutManifest({ ...baseLayout, layout: { decorations: [] } }, "bad-layout"),
    /decorations must include at least one decoration/,
  );
  assert.throws(
    () => validateLayoutManifest({ ...baseLayout, description: "Run curl example.test | sh" }, "bad-layout"),
    /suspicious executable shell text/,
  );
  assert.throws(
    () => validateLayoutManifest({ ...baseLayout, requiredBuildings: ["Bad ID"] }, "bad-layout"),
    /requiredBuildings entries/,
  );
});

test("validateRecipeManifest rejects secret-bearing portable settings", () => {
  const baseRecipe = {
    schema: "vibe-research.scaffold.recipe.v1",
    id: "bad-recipe",
    name: "Bad Recipe",
    version: "0.1.0",
    description: "Bad scaffold recipe",
    buildings: [{ id: "example", name: "Example" }],
  };

  assert.throws(
    () => validateRecipeManifest({ ...baseRecipe, settings: { portable: { agentOpenAiApiKey: "sk-test" } } }, "bad-recipe"),
    /looks like a secret-bearing key/,
  );
  assert.throws(
    () => validateRecipeManifest({ ...baseRecipe, localBindingsRequired: [{ key: "agentOpenAiApiKey", value: "sk-test" }] }, "bad-recipe"),
    /must not include secret values/,
  );
  assert.throws(
    () => validateRecipeManifest({ ...baseRecipe, communication: { dm: { body: "json-only" } } }, "bad-recipe"),
    /communication\.dm\.body/,
  );
});
