import { createHash } from "node:crypto";
import { access, cp, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const BUILDINGHUB_VERSION = "0.2.0";
export const DEFAULT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const DEFAULT_REGISTRY_FILENAME = "registry.json";

const BUILDING_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const ENV_NAME_PATTERN = /^[A-Z][A-Z0-9_]*$/;
const SIMPLE_COMMAND_PATTERN = /^[a-zA-Z0-9._-]+$/;
const SEMVER_PATTERN = /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/;
const CAPABILITY_TYPES = new Set(["mcp", "helper-command", "env", "webhook", "oauth", "api"]);
const TRUST_LEVELS = new Set(["manifest-only", "helper-command", "mcp"]);
const DISALLOWED_TOP_LEVEL_FIELDS = new Set(["install", "ui", "specialTownPlace", "setupSelector"]);
const SUSPICIOUS_PATTERNS = [
  /\bcurl\b[\s\S]{0,80}\|\s*(?:sh|bash|zsh)\b/i,
  /\bwget\b[\s\S]{0,80}\|\s*(?:sh|bash|zsh)\b/i,
  /\brm\s+-rf\b/i,
  /\bsudo\b/i,
  /\beval\s*\(/i,
  /\bbase64\s+-d\b/i,
  /\bchmod\s+\+x\b/i,
];

function rootPaths(root = DEFAULT_ROOT) {
  return {
    buildingsRoot: path.join(root, "buildings"),
    layoutsRoot: path.join(root, "layouts"),
    registryPath: path.join(root, DEFAULT_REGISTRY_FILENAME),
    root,
  };
}

function fail(message) {
  throw new Error(message);
}

function normalizeVersion(value) {
  const version = String(value || "").trim();
  return version || "";
}

function assertString(manifest, key) {
  if (!String(manifest[key] || "").trim()) {
    fail(`${manifest.id || "building"}: ${key} is required`);
  }
}

function assertVersion(manifest) {
  const version = normalizeVersion(manifest.version);
  if (!version) {
    fail(`${manifest.id}: version is required`);
  }
  if (!SEMVER_PATTERN.test(version)) {
    fail(`${manifest.id}: version must be semver-like, for example 0.1.0`);
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

function collectStrings(value, output = []) {
  if (typeof value === "string") {
    output.push(value);
    return output;
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      collectStrings(entry, output);
    }
    return output;
  }

  if (value && typeof value === "object") {
    for (const entry of Object.values(value)) {
      collectStrings(entry, output);
    }
  }

  return output;
}

function assertManifestIsDeclarative(manifest) {
  for (const field of DISALLOWED_TOP_LEVEL_FIELDS) {
    if (Object.hasOwn(manifest, field)) {
      fail(`${manifest.id}: ${field} is not allowed in BuildingHub manifests`);
    }
  }

  if (manifest.visual?.specialTownPlace) {
    fail(`${manifest.id}: visual.specialTownPlace is not allowed in community manifests`);
  }

  if (manifest.onboarding?.setupSelector) {
    fail(`${manifest.id}: onboarding.setupSelector is not allowed in community manifests`);
  }

  const text = collectStrings(manifest).join("\n");
  for (const pattern of SUSPICIOUS_PATTERNS) {
    if (pattern.test(text)) {
      fail(`${manifest.id}: manifest contains suspicious executable shell text (${pattern})`);
    }
  }
}

function validateCapability(manifest, capability) {
  if (!capability || typeof capability !== "object" || Array.isArray(capability)) {
    fail(`${manifest.id}: capabilities entries must be objects`);
  }

  if (!CAPABILITY_TYPES.has(capability.type)) {
    fail(`${manifest.id}: unsupported capability type ${capability.type}`);
  }
  if (!String(capability.name || "").trim()) {
    fail(`${manifest.id}: capability name is required`);
  }

  if (capability.type === "env" && !ENV_NAME_PATTERN.test(String(capability.name || ""))) {
    fail(`${manifest.id}: env capability ${capability.name} must look like an environment variable name`);
  }

  if (capability.type === "helper-command") {
    const command = String(capability.command || capability.name || "").trim();
    if (!SIMPLE_COMMAND_PATTERN.test(command)) {
      fail(`${manifest.id}: helper-command must name a command, not a shell snippet`);
    }
  }
}

export function validateManifest(manifest, dirname) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    fail(`${dirname}: manifest must be an object`);
  }

  assertString(manifest, "id");
  assertString(manifest, "name");
  assertString(manifest, "category");
  assertString(manifest, "description");
  assertVersion(manifest);
  assertManifestIsDeclarative(manifest);

  if (!BUILDING_ID_PATTERN.test(manifest.id)) {
    fail(`${manifest.id}: id must match ${BUILDING_ID_PATTERN}`);
  }
  if (manifest.id !== dirname) {
    fail(`${manifest.id}: directory name must match id (${dirname})`);
  }
  if (manifest.trust && !TRUST_LEVELS.has(manifest.trust)) {
    fail(`${manifest.id}: unsupported trust level ${manifest.trust}`);
  }

  assertUrl(manifest, "repositoryUrl");
  assertUrl(manifest, "docsUrl");
  assertUrl(manifest, "homepageUrl");

  for (const capability of Array.isArray(manifest.capabilities) ? manifest.capabilities : []) {
    validateCapability(manifest, capability);
  }

  const onboarding = manifest.onboarding || {};
  if (!Array.isArray(onboarding.steps) || onboarding.steps.length === 0) {
    fail(`${manifest.id}: onboarding.steps must include at least one step`);
  }
}

function validateLayoutDecoration(layout, decoration, index) {
  if (!decoration || typeof decoration !== "object" || Array.isArray(decoration)) {
    fail(`${layout.id}: layout.decorations[${index}] must be an object`);
  }

  const itemId = String(decoration.itemId || "").trim();
  if (!BUILDING_ID_PATTERN.test(itemId)) {
    fail(`${layout.id}: layout.decorations[${index}].itemId must match ${BUILDING_ID_PATTERN}`);
  }

  for (const key of ["x", "y"]) {
    const value = Number(decoration[key]);
    if (!Number.isFinite(value) || value < 0 || value > 2000) {
      fail(`${layout.id}: layout.decorations[${index}].${key} must be a finite map coordinate`);
    }
  }

  if (decoration.rotation !== undefined && ![0, 1].includes(Number(decoration.rotation))) {
    fail(`${layout.id}: layout.decorations[${index}].rotation must be 0 or 1`);
  }
}

function validateLayoutFunctionalPlacement(layout, buildingId, placement) {
  if (!BUILDING_ID_PATTERN.test(buildingId)) {
    fail(`${layout.id}: functional building id ${buildingId} must match ${BUILDING_ID_PATTERN}`);
  }
  if (!placement || typeof placement !== "object" || Array.isArray(placement)) {
    fail(`${layout.id}: layout.functional.${buildingId} must be an object`);
  }
  for (const key of ["x", "y"]) {
    const value = Number(placement[key]);
    if (!Number.isFinite(value) || value < 0 || value > 2000) {
      fail(`${layout.id}: layout.functional.${buildingId}.${key} must be a finite map coordinate`);
    }
  }
  if (placement.rotation !== undefined && ![0, 1].includes(Number(placement.rotation))) {
    fail(`${layout.id}: layout.functional.${buildingId}.rotation must be 0 or 1`);
  }
}

export function validateLayoutManifest(layout, dirname) {
  if (!layout || typeof layout !== "object" || Array.isArray(layout)) {
    fail(`${dirname}: layout must be an object`);
  }

  assertString(layout, "id");
  assertString(layout, "name");
  assertString(layout, "description");
  assertVersion(layout);
  assertManifestIsDeclarative(layout);

  if (!BUILDING_ID_PATTERN.test(layout.id)) {
    fail(`${layout.id}: id must match ${BUILDING_ID_PATTERN}`);
  }
  if (layout.id !== dirname) {
    fail(`${layout.id}: directory name must match id (${dirname})`);
  }
  assertUrl(layout, "repositoryUrl");
  assertUrl(layout, "homepageUrl");
  assertUrl(layout, "previewUrl");

  const blueprint = layout.layout || {};
  if (!blueprint || typeof blueprint !== "object" || Array.isArray(blueprint)) {
    fail(`${layout.id}: layout must contain a layout object`);
  }

  const decorations = Array.isArray(blueprint.decorations) ? blueprint.decorations : [];
  if (!decorations.length) {
    fail(`${layout.id}: layout.decorations must include at least one decoration`);
  }
  decorations.forEach((decoration, index) => validateLayoutDecoration(layout, decoration, index));

  const functional = blueprint.functional || {};
  if (functional && (typeof functional !== "object" || Array.isArray(functional))) {
    fail(`${layout.id}: layout.functional must be an object when present`);
  }
  for (const [buildingId, placement] of Object.entries(functional || {})) {
    validateLayoutFunctionalPlacement(layout, buildingId, placement);
  }

  for (const buildingId of Array.isArray(layout.requiredBuildings) ? layout.requiredBuildings : []) {
    if (!BUILDING_ID_PATTERN.test(String(buildingId || ""))) {
      fail(`${layout.id}: requiredBuildings entries must match ${BUILDING_ID_PATTERN}`);
    }
  }
}

export async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

function sortJsonValue(value) {
  if (Array.isArray(value)) {
    return value.map(sortJsonValue);
  }
  if (value && typeof value === "object") {
    const sorted = {};
    for (const key of Object.keys(value).sort()) {
      sorted[key] = sortJsonValue(value[key]);
    }
    return sorted;
  }
  return value;
}

export function stableJson(value) {
  return JSON.stringify(sortJsonValue(value));
}

export function sha256(value) {
  const text = typeof value === "string" ? value : stableJson(value);
  return createHash("sha256").update(text).digest("hex");
}

export async function readBuildingManifests({ root = DEFAULT_ROOT } = {}) {
  const { buildingsRoot } = rootPaths(root);
  const entries = await readdir(buildingsRoot, { withFileTypes: true });
  const manifests = [];
  const seen = new Set();

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const manifestPath = path.join(buildingsRoot, entry.name, "building.json");
    const stats = await stat(manifestPath);
    if (!stats.isFile()) {
      fail(`${entry.name}: missing building.json`);
    }

    const manifest = await readJson(manifestPath);
    validateManifest(manifest, entry.name);
    if (seen.has(manifest.id)) {
      fail(`${manifest.id}: duplicate id`);
    }
    seen.add(manifest.id);
    manifests.push({
      manifest,
      manifestPath,
      readmePath: path.join(buildingsRoot, entry.name, "README.md"),
    });
  }

  return manifests.sort((left, right) => left.manifest.id.localeCompare(right.manifest.id));
}

export async function readLayoutManifests({ root = DEFAULT_ROOT } = {}) {
  const { layoutsRoot } = rootPaths(root);
  let entries = [];
  try {
    entries = await readdir(layoutsRoot, { withFileTypes: true });
  } catch {
    return [];
  }

  const layouts = [];
  const seen = new Set();
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const layoutPath = path.join(layoutsRoot, entry.name, "layout.json");
    const stats = await stat(layoutPath);
    if (!stats.isFile()) {
      fail(`${entry.name}: missing layout.json`);
    }

    const layout = await readJson(layoutPath);
    validateLayoutManifest(layout, entry.name);
    if (seen.has(layout.id)) {
      fail(`${layout.id}: duplicate layout id`);
    }
    seen.add(layout.id);
    layouts.push({
      layout,
      layoutPath,
      readmePath: path.join(layoutsRoot, entry.name, "README.md"),
    });
  }

  return layouts.sort((left, right) => left.layout.id.localeCompare(right.layout.id));
}

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

function createPackageEntry({ manifest, manifestPath, readmePath, root }) {
  const manifestSha256 = sha256(manifest);
  const relativeManifestPath = path.relative(root, manifestPath);
  const relativeReadmePath = path.relative(root, readmePath);

  return {
    id: manifest.id,
    name: manifest.name,
    category: manifest.category,
    trust: manifest.trust || "manifest-only",
    latestVersion: manifest.version,
    manifestSha256,
    source: {
      manifestPath: relativeManifestPath,
      readmePath: relativeReadmePath,
    },
    versions: [
      {
        version: manifest.version,
        manifestSha256,
        manifestPath: relativeManifestPath,
      },
    ],
  };
}

function createLayoutPackageEntry({ layout, layoutPath, readmePath, root }) {
  const layoutSha256 = sha256(layout);
  const relativeLayoutPath = path.relative(root, layoutPath);
  const relativeReadmePath = path.relative(root, readmePath);

  return {
    id: layout.id,
    name: layout.name,
    category: layout.category || "Layout",
    latestVersion: layout.version,
    layoutSha256,
    source: {
      layoutPath: relativeLayoutPath,
      readmePath: relativeReadmePath,
    },
    versions: [
      {
        version: layout.version,
        layoutSha256,
        layoutPath: relativeLayoutPath,
      },
    ],
  };
}

export async function buildRegistry({ root = DEFAULT_ROOT, write = true } = {}) {
  const { registryPath } = rootPaths(root);
  const entries = await readBuildingManifests({ root });
  const layoutEntries = await readLayoutManifests({ root });
  const packages = entries.map((entry) => createPackageEntry({ ...entry, root }));
  const layoutPackages = layoutEntries.map((entry) => createLayoutPackageEntry({ ...entry, root }));
  const registry = {
    registryVersion: 1,
    manifestVersion: 1,
    generatedBy: `buildinghub/${BUILDINGHUB_VERSION}`,
    generatedAt: new Date().toISOString(),
    name: "Vibe Research BuildingHub",
    packageCount: packages.length,
    layoutCount: layoutEntries.length,
    packages,
    layoutPackages,
    buildings: entries.map((entry) => entry.manifest),
    layouts: layoutEntries.map((entry) => entry.layout),
  };

  try {
    const existing = await readJson(registryPath);
    if (comparableRegistry(existing) === comparableRegistry(registry) && existing.generatedAt) {
      registry.generatedAt = existing.generatedAt;
    }
  } catch {
    // Missing or malformed registries are replaced by a fresh generated file.
  }

  if (write) {
    await writeFile(registryPath, `${JSON.stringify(registry, null, 2)}\n`, "utf8");
  }

  return { entries, registry, registryPath };
}

async function readOptionalText(filePath) {
  try {
    return await readFile(filePath, "utf8");
  } catch {
    return "";
  }
}

export async function packBuilding(id, { root = DEFAULT_ROOT, outDir = path.join(root, "dist") } = {}) {
  const entries = await readBuildingManifests({ root });
  const selected = entries.find((entry) => entry.manifest.id === id);
  if (!selected) {
    fail(`${id}: building not found`);
  }

  const { manifest, manifestPath, readmePath } = selected;
  const readme = await readOptionalText(readmePath);
  const manifestSha256 = sha256(manifest);
  const bundle = {
    bundleVersion: 1,
    generatedBy: `buildinghub/${BUILDINGHUB_VERSION}`,
    id: manifest.id,
    version: manifest.version,
    manifestSha256,
    source: {
      manifestPath: path.relative(root, manifestPath),
      readmePath: path.relative(root, readmePath),
    },
    manifest,
    readme,
  };

  const packageDir = path.join(outDir, manifest.id, manifest.version);
  await mkdir(packageDir, { recursive: true });
  const bundlePath = path.join(packageDir, `${manifest.id}-${manifest.version}.buildinghub.json`);
  const bundleText = `${JSON.stringify(bundle, null, 2)}\n`;
  const bundleSha256 = sha256(bundleText);
  await writeFile(bundlePath, bundleText, "utf8");
  await writeFile(`${bundlePath}.sha256`, `${bundleSha256}  ${path.basename(bundlePath)}\n`, "utf8");

  return {
    bundlePath,
    bundleSha256,
    id: manifest.id,
    version: manifest.version,
  };
}

export async function packAllBuildings({ root = DEFAULT_ROOT, outDir = path.join(root, "dist") } = {}) {
  const entries = await readBuildingManifests({ root });
  const bundles = [];
  for (const entry of entries) {
    bundles.push(await packBuilding(entry.manifest.id, { root, outDir }));
  }
  return bundles;
}

export async function buildSite({ root = DEFAULT_ROOT } = {}) {
  const { registry } = await buildRegistry({ root });
  const siteDir = path.join(root, "site");
  await mkdir(siteDir, { recursive: true });
  await writeFile(path.join(siteDir, "registry.json"), `${JSON.stringify(registry, null, 2)}\n`, "utf8");
  return { registry, siteDir };
}

function titleFromId(id) {
  return id
    .split("-")
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

export async function initBuilding(id, { root = DEFAULT_ROOT, name = "" } = {}) {
  if (!BUILDING_ID_PATTERN.test(id)) {
    fail(`${id}: id must match ${BUILDING_ID_PATTERN}`);
  }

  const { buildingsRoot } = rootPaths(root);
  const buildingDir = path.join(buildingsRoot, id);
  try {
    await access(buildingDir);
    fail(`${id}: building already exists`);
  } catch (error) {
    if (error.message?.includes("already exists")) {
      throw error;
    }
  }

  await mkdir(buildingDir, { recursive: true });
  const templatePath = path.join(root, "templates", "basic-building", "building.json");
  const manifestPath = path.join(buildingDir, "building.json");
  await cp(templatePath, manifestPath);

  const displayName = name || titleFromId(id);
  const manifest = await readJson(manifestPath);
  manifest.id = id;
  manifest.name = displayName;
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await writeFile(
    path.join(buildingDir, "README.md"),
    `# ${displayName} Building\n\nManifest-only community building for ${displayName}.\n`,
    "utf8",
  );

  return { buildingDir, manifestPath };
}
