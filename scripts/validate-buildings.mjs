import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const buildingsRoot = path.join(root, "buildings");
const idPattern = /^[a-z0-9][a-z0-9-]*$/;
const capabilityTypes = new Set(["mcp", "helper-command", "env", "webhook", "oauth", "api"]);
const trustLevels = new Set(["manifest-only", "helper-command", "mcp"]);

function fail(message) {
  throw new Error(message);
}

function assertString(manifest, key) {
  if (!String(manifest[key] || "").trim()) {
    fail(`${manifest.id || "building"}: ${key} is required`);
  }
}

function assertUrl(manifest, key) {
  const value = String(manifest[key] || "").trim();
  if (!value) {
    return;
  }
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    fail(`${manifest.id}: ${key} must be http(s)`);
  }
}

function validateManifest(manifest, dirname) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    fail(`${dirname}: manifest must be an object`);
  }

  assertString(manifest, "id");
  assertString(manifest, "name");
  assertString(manifest, "category");
  assertString(manifest, "description");

  if (!idPattern.test(manifest.id)) {
    fail(`${manifest.id}: id must match ${idPattern}`);
  }
  if (manifest.id !== dirname) {
    fail(`${manifest.id}: directory name must match id (${dirname})`);
  }
  if (manifest.trust && !trustLevels.has(manifest.trust)) {
    fail(`${manifest.id}: unsupported trust level ${manifest.trust}`);
  }

  assertUrl(manifest, "repositoryUrl");
  assertUrl(manifest, "docsUrl");

  for (const capability of Array.isArray(manifest.capabilities) ? manifest.capabilities : []) {
    if (!capabilityTypes.has(capability.type)) {
      fail(`${manifest.id}: unsupported capability type ${capability.type}`);
    }
    if (!String(capability.name || "").trim()) {
      fail(`${manifest.id}: capability name is required`);
    }
  }

  const onboarding = manifest.onboarding || {};
  if (!Array.isArray(onboarding.steps) || onboarding.steps.length === 0) {
    fail(`${manifest.id}: onboarding.steps must include at least one step`);
  }
}

export async function readBuildingManifests() {
  const entries = await readdir(buildingsRoot, { withFileTypes: true });
  const manifests = [];
  const seen = new Set();

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const filePath = path.join(buildingsRoot, entry.name, "building.json");
    const stats = await stat(filePath);
    if (!stats.isFile()) {
      fail(`${entry.name}: missing building.json`);
    }

    const manifest = JSON.parse(await readFile(filePath, "utf8"));
    validateManifest(manifest, entry.name);
    if (seen.has(manifest.id)) {
      fail(`${manifest.id}: duplicate id`);
    }
    seen.add(manifest.id);
    manifests.push(manifest);
  }

  return manifests.sort((left, right) => left.id.localeCompare(right.id));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const manifests = await readBuildingManifests();
  process.stdout.write(`validated ${manifests.length} BuildingHub manifests\n`);
}
