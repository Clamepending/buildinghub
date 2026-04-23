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
  validateManifest,
  validateLayoutManifest,
} from "../lib/buildinghub.mjs";

async function createFixtureRoot() {
  const root = await mkdtemp(path.join(os.tmpdir(), "buildinghub-test-"));
  await mkdir(path.join(root, "buildings", "example"), { recursive: true });
  await mkdir(path.join(root, "layouts", "main-street"), { recursive: true });
  await mkdir(path.join(root, "templates", "basic-building"), { recursive: true });
  const manifest = {
    id: "example",
    name: "Example",
    version: "0.1.0",
    category: "Community",
    description: "A manifest-only test building.",
    trust: "manifest-only",
    access: {
      label: "External service",
      detail: "Requires external setup.",
    },
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
    assert.equal(registry.buildings[0].id, "example");
    assert.equal(registry.layouts[0].id, "main-street");
    assert.equal(registry.packages[0].id, "example");
    assert.equal(registry.layoutPackages[0].id, "main-street");
    assert.equal(registry.packages[0].latestVersion, "0.1.0");
    assert.match(registry.packages[0].manifestSha256, /^[a-f0-9]{64}$/);
    assert.match(registry.layoutPackages[0].layoutSha256, /^[a-f0-9]{64}$/);
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
    assert.match(preview, /Main Street Agent Town layout preview/);
    assert.match(preview, /#b99a5f/);
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
