import { createHash } from "node:crypto";
import { access, cp, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const BUILDINGHUB_VERSION = "0.2.0";
export const DEFAULT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const DEFAULT_REGISTRY_FILENAME = "registry.json";

const BUILDING_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const PREVIEW_WIDTH = 960;
const PREVIEW_HEIGHT = 540;
const ENV_NAME_PATTERN = /^[A-Z][A-Z0-9_]*$/;
const SIMPLE_COMMAND_PATTERN = /^[a-zA-Z0-9._-]+$/;
const SEMVER_PATTERN = /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/;
const CAPABILITY_TYPES = new Set(["mcp", "helper-command", "env", "webhook", "oauth", "api"]);
const TOOL_TYPES = new Set(["mcp-tool", "helper-command", "api", "webhook", "oauth-scope", "env"]);
const ENDPOINT_TYPES = new Set(["api", "webhook", "oauth", "mcp", "docs", "local"]);
const ENDPOINT_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);
const ENDPOINT_AUTHS = new Set(["none", "api-key", "oauth", "mcp", "custom"]);
const FOOTPRINT_SNAPS = new Set(["grid", "free"]);
const FOOTPRINT_ENTRANCE_SIDES = new Set(["north", "east", "south", "west"]);
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
    recipesRoot: path.join(root, "recipes"),
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

  assertHttpUrlValue(manifest, key, value);
}

function assertHttpUrlValue(manifest, key, value) {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    fail(`${manifest.id}: ${key} must be http(s)`);
  }
}

function assertOptionalRelativePath(manifest, key, value) {
  const pathValue = String(value || "").trim();
  if (!pathValue) {
    return;
  }
  if (/^https?:\/\//i.test(pathValue)) {
    assertHttpUrlValue(manifest, key, pathValue);
    return;
  }
  if (pathValue.startsWith("/") || pathValue.includes("\\") || pathValue.split("/").includes("..")) {
    fail(`${manifest.id}: ${key} must be a safe repo-relative path`);
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

function validateRepo(manifest) {
  const repo = manifest.repo;
  if (repo === undefined) {
    return;
  }
  if (!repo || typeof repo !== "object" || Array.isArray(repo)) {
    fail(`${manifest.id}: repo must be an object`);
  }
  if (repo.url) {
    assertHttpUrlValue(manifest, "repo.url", String(repo.url).trim());
  }
  for (const key of ["manifestPath", "readmePath", "assetsPath", "packagePath"]) {
    assertOptionalRelativePath(manifest, `repo.${key}`, repo[key]);
  }
  if (repo.commit && !/^[a-f0-9]{7,40}$/i.test(String(repo.commit))) {
    fail(`${manifest.id}: repo.commit must be a git SHA`);
  }
}

function validateMediaAsset(manifest, asset, key) {
  if (!asset || typeof asset !== "object" || Array.isArray(asset)) {
    fail(`${manifest.id}: ${key} must be an object`);
  }
  if (!String(asset.alt || "").trim()) {
    fail(`${manifest.id}: ${key}.alt is required`);
  }
  if (!String(asset.url || "").trim() && !String(asset.path || "").trim()) {
    fail(`${manifest.id}: ${key} must include url or path`);
  }
  if (asset.url) {
    assertHttpUrlValue(manifest, `${key}.url`, String(asset.url).trim());
  }
  if (asset.path) {
    assertOptionalRelativePath(manifest, `${key}.path`, asset.path);
  }
}

function validateMedia(manifest) {
  const media = manifest.media;
  if (media === undefined) {
    return;
  }
  if (!media || typeof media !== "object" || Array.isArray(media)) {
    fail(`${manifest.id}: media must be an object`);
  }
  if (media.thumbnail) {
    validateMediaAsset(manifest, media.thumbnail, "media.thumbnail");
  }
  if (media.screenshots !== undefined) {
    if (!Array.isArray(media.screenshots)) {
      fail(`${manifest.id}: media.screenshots must be an array`);
    }
    media.screenshots.forEach((asset, index) => validateMediaAsset(manifest, asset, `media.screenshots[${index}]`));
  }
}

function validateFootprint(manifest) {
  const footprint = manifest.footprint;
  if (footprint === undefined) {
    return;
  }
  if (!footprint || typeof footprint !== "object" || Array.isArray(footprint)) {
    fail(`${manifest.id}: footprint must be an object`);
  }
  for (const key of ["width", "height"]) {
    if (footprint[key] === undefined) {
      continue;
    }
    const value = Number(footprint[key]);
    if (!Number.isInteger(value) || value < 1 || value > 12) {
      fail(`${manifest.id}: footprint.${key} must be an integer from 1 to 12`);
    }
  }
  if (footprint.snap && !FOOTPRINT_SNAPS.has(String(footprint.snap))) {
    fail(`${manifest.id}: footprint.snap must be grid or free`);
  }
  if (footprint.entrances !== undefined) {
    if (!Array.isArray(footprint.entrances)) {
      fail(`${manifest.id}: footprint.entrances must be an array`);
    }
    footprint.entrances.forEach((entrance, index) => {
      if (!entrance || typeof entrance !== "object" || Array.isArray(entrance)) {
        fail(`${manifest.id}: footprint.entrances[${index}] must be an object`);
      }
      if (!FOOTPRINT_ENTRANCE_SIDES.has(String(entrance.side || ""))) {
        fail(`${manifest.id}: footprint.entrances[${index}].side is invalid`);
      }
      if (entrance.offset !== undefined && !Number.isFinite(Number(entrance.offset))) {
        fail(`${manifest.id}: footprint.entrances[${index}].offset must be a number`);
      }
    });
  }
}

function validateTool(manifest, tool) {
  if (!tool || typeof tool !== "object" || Array.isArray(tool)) {
    fail(`${manifest.id}: tools entries must be objects`);
  }
  if (!TOOL_TYPES.has(tool.type)) {
    fail(`${manifest.id}: unsupported tool type ${tool.type}`);
  }
  if (!String(tool.name || "").trim()) {
    fail(`${manifest.id}: tool name is required`);
  }
  if (!String(tool.detail || "").trim()) {
    fail(`${manifest.id}: tool detail is required`);
  }
  if (tool.type === "env" && !ENV_NAME_PATTERN.test(String(tool.name || ""))) {
    fail(`${manifest.id}: env tool ${tool.name} must look like an environment variable name`);
  }
  if (tool.command !== undefined && !SIMPLE_COMMAND_PATTERN.test(String(tool.command || "").trim())) {
    fail(`${manifest.id}: tool command must name a command, not a shell snippet`);
  }
}

function validateEndpoint(manifest, endpoint) {
  if (!endpoint || typeof endpoint !== "object" || Array.isArray(endpoint)) {
    fail(`${manifest.id}: endpoints entries must be objects`);
  }
  if (!ENDPOINT_TYPES.has(endpoint.type)) {
    fail(`${manifest.id}: unsupported endpoint type ${endpoint.type}`);
  }
  if (!String(endpoint.name || "").trim()) {
    fail(`${manifest.id}: endpoint name is required`);
  }
  if (!String(endpoint.detail || "").trim()) {
    fail(`${manifest.id}: endpoint detail is required`);
  }
  if (endpoint.method !== undefined && !ENDPOINT_METHODS.has(String(endpoint.method))) {
    fail(`${manifest.id}: endpoint method is invalid`);
  }
  if (endpoint.auth !== undefined && !ENDPOINT_AUTHS.has(String(endpoint.auth))) {
    fail(`${manifest.id}: endpoint auth is invalid`);
  }
  if (endpoint.url !== undefined) {
    assertHttpUrlValue(manifest, "endpoint.url", String(endpoint.url).trim());
  }
  if (endpoint.urlTemplate !== undefined && !/^https?:\/\//i.test(String(endpoint.urlTemplate || "").trim())) {
    fail(`${manifest.id}: endpoint.urlTemplate must be http(s)`);
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
  validateRepo(manifest);
  validateMedia(manifest);
  validateFootprint(manifest);

  for (const capability of Array.isArray(manifest.capabilities) ? manifest.capabilities : []) {
    validateCapability(manifest, capability);
  }
  for (const tool of Array.isArray(manifest.tools) ? manifest.tools : []) {
    validateTool(manifest, tool);
  }
  for (const endpoint of Array.isArray(manifest.endpoints) ? manifest.endpoints : []) {
    validateEndpoint(manifest, endpoint);
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

function validateBinding(recipe, binding, key) {
  if (!binding || typeof binding !== "object" || Array.isArray(binding)) {
    fail(`${recipe.id}: ${key} entries must be objects`);
  }
  const bindingKey = String(binding.key || binding.setting || "").trim();
  if (!/^[A-Za-z][A-Za-z0-9_]{0,95}$/.test(bindingKey)) {
    fail(`${recipe.id}: ${key}.key must be a setting-like identifier`);
  }
  const sensitivity = String(binding.sensitivity || "local").trim();
  if (!["local", "personal", "secret", "portable", "unknown"].includes(sensitivity)) {
    fail(`${recipe.id}: ${key}.sensitivity is invalid`);
  }
  if (Object.hasOwn(binding, "value") || Object.hasOwn(binding, "secret") && typeof binding.secret !== "boolean") {
    fail(`${recipe.id}: ${key} entries must not include secret values`);
  }
}

function validateBindingList(recipe, list, key) {
  if (list === undefined) {
    return;
  }
  if (!Array.isArray(list)) {
    fail(`${recipe.id}: ${key} must be an array`);
  }
  list.forEach((binding, index) => validateBinding(recipe, binding, `${key}[${index}]`));
}

function validateRecipeBuildings(recipe) {
  if (!Array.isArray(recipe.buildings) || recipe.buildings.length === 0) {
    fail(`${recipe.id}: buildings must include at least one building`);
  }
  const seen = new Set();
  recipe.buildings.forEach((building, index) => {
    if (!building || typeof building !== "object" || Array.isArray(building)) {
      fail(`${recipe.id}: buildings[${index}] must be an object`);
    }
    const id = String(building.id || "").trim();
    if (!BUILDING_ID_PATTERN.test(id)) {
      fail(`${recipe.id}: buildings[${index}].id must match ${BUILDING_ID_PATTERN}`);
    }
    if (seen.has(id)) {
      fail(`${recipe.id}: duplicate building id ${id}`);
    }
    seen.add(id);
    if (!String(building.name || "").trim()) {
      fail(`${recipe.id}: buildings[${index}].name is required`);
    }
    validateBindingList(recipe, building.localBindingsRequired, `buildings[${index}].localBindingsRequired`);
  });
}

function validateRecipeSettings(recipe) {
  const settings = recipe.settings || {};
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
    fail(`${recipe.id}: settings must be an object`);
  }
  const portable = settings.portable || {};
  if (portable && (typeof portable !== "object" || Array.isArray(portable))) {
    fail(`${recipe.id}: settings.portable must be an object`);
  }
  for (const key of Object.keys(portable || {})) {
    if (/authorization|cookie|token|secret|password|passcode|private[_-]?key|api[_-]?key|credential/i.test(key)) {
      fail(`${recipe.id}: settings.portable.${key} looks like a secret-bearing key`);
    }
  }
  validateBindingList(recipe, settings.localBindingsRequired, "settings.localBindingsRequired");
  validateBindingList(recipe, settings.personal, "settings.personal");
  validateBindingList(recipe, settings.secrets, "settings.secrets");
}

function validateRecipeCommunication(recipe) {
  const communication = recipe.communication || {};
  if (communication && (typeof communication !== "object" || Array.isArray(communication))) {
    fail(`${recipe.id}: communication must be an object`);
  }
  const dm = communication.dm || {};
  if (dm && (typeof dm !== "object" || Array.isArray(dm))) {
    fail(`${recipe.id}: communication.dm must be an object`);
  }
  if (dm.body !== undefined && !["freeform", "typed", "typed-envelope"].includes(String(dm.body))) {
    fail(`${recipe.id}: communication.dm.body is invalid`);
  }
  if (dm.visibility !== undefined && !["workspace", "private", "public"].includes(String(dm.visibility))) {
    fail(`${recipe.id}: communication.dm.visibility is invalid`);
  }
  if (communication.groupInboxes !== undefined && !Array.isArray(communication.groupInboxes)) {
    fail(`${recipe.id}: communication.groupInboxes must be an array`);
  }
}

function validateRecipeLayout(recipe) {
  if (recipe.layout === undefined) {
    return;
  }
  const layout = recipe.layout;
  if (!layout || typeof layout !== "object" || Array.isArray(layout)) {
    fail(`${recipe.id}: layout must be an object`);
  }
  const decorations = Array.isArray(layout.decorations) ? layout.decorations : [];
  decorations.forEach((decoration, index) => validateLayoutDecoration({ id: recipe.id }, decoration, index));
  const functional = layout.functional || {};
  if (functional && (typeof functional !== "object" || Array.isArray(functional))) {
    fail(`${recipe.id}: layout.functional must be an object when present`);
  }
  for (const [buildingId, placement] of Object.entries(functional || {})) {
    validateLayoutFunctionalPlacement({ id: recipe.id }, buildingId, placement);
  }
}

export function validateRecipeManifest(recipe, dirname) {
  if (!recipe || typeof recipe !== "object" || Array.isArray(recipe)) {
    fail(`${dirname}: recipe must be an object`);
  }

  assertString(recipe, "id");
  assertString(recipe, "name");
  assertString(recipe, "description");
  assertVersion(recipe);
  assertManifestIsDeclarative(recipe);

  if (!BUILDING_ID_PATTERN.test(recipe.id)) {
    fail(`${recipe.id}: id must match ${BUILDING_ID_PATTERN}`);
  }
  if (recipe.id !== dirname) {
    fail(`${recipe.id}: directory name must match id (${dirname})`);
  }
  if (recipe.schema && String(recipe.schema) !== "vibe-research.scaffold.recipe.v1") {
    fail(`${recipe.id}: schema must be vibe-research.scaffold.recipe.v1`);
  }

  validateRecipeBuildings(recipe);
  validateRecipeSettings(recipe);
  validateRecipeCommunication(recipe);
  validateRecipeLayout(recipe);
  validateBindingList(recipe, recipe.localBindingsRequired, "localBindingsRequired");
  validateBindingList(recipe, recipe.sandbox?.localBindingsRequired, "sandbox.localBindingsRequired");
  validateBindingList(recipe, recipe.library?.localBindingsRequired, "library.localBindingsRequired");
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

export async function readRecipeManifests({ root = DEFAULT_ROOT } = {}) {
  const { recipesRoot } = rootPaths(root);
  let entries = [];
  try {
    entries = await readdir(recipesRoot, { withFileTypes: true });
  } catch {
    return [];
  }

  const recipes = [];
  const seen = new Set();
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const recipePath = path.join(recipesRoot, entry.name, "recipe.json");
    const stats = await stat(recipePath);
    if (!stats.isFile()) {
      fail(`${entry.name}: missing recipe.json`);
    }

    const recipe = await readJson(recipePath);
    validateRecipeManifest(recipe, entry.name);
    if (seen.has(recipe.id)) {
      fail(`${recipe.id}: duplicate recipe id`);
    }
    seen.add(recipe.id);
    recipes.push({
      recipe,
      recipePath,
      readmePath: path.join(recipesRoot, entry.name, "README.md"),
    });
  }

  return recipes.sort((left, right) => left.recipe.id.localeCompare(right.recipe.id));
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
  const repositoryUrl = String(manifest.repo?.url || manifest.repositoryUrl || "").trim();

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
      ...(repositoryUrl ? { repositoryUrl } : {}),
      ...(manifest.repo?.manifestPath ? { upstreamManifestPath: manifest.repo.manifestPath } : {}),
    },
    ...(manifest.media?.thumbnail ? { thumbnail: manifest.media.thumbnail } : {}),
    ...(manifest.footprint ? { footprint: manifest.footprint } : {}),
    versions: [
      {
        version: manifest.version,
        manifestSha256,
        manifestPath: relativeManifestPath,
        ...(repositoryUrl ? { repositoryUrl } : {}),
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

function createRecipePackageEntry({ recipe, recipePath, readmePath, root }) {
  const recipeSha256 = sha256(recipe);
  const relativeRecipePath = path.relative(root, recipePath);
  const relativeReadmePath = path.relative(root, readmePath);

  return {
    id: recipe.id,
    name: recipe.name,
    category: recipe.category || "Scaffold",
    latestVersion: recipe.version,
    recipeSha256,
    source: {
      recipePath: relativeRecipePath,
      readmePath: relativeReadmePath,
      ...(recipe.source?.repositoryUrl ? { repositoryUrl: recipe.source.repositoryUrl } : {}),
      ...(recipe.source?.recipeUrl ? { recipeUrl: recipe.source.recipeUrl } : {}),
    },
    versions: [
      {
        version: recipe.version,
        recipeSha256,
        recipePath: relativeRecipePath,
      },
    ],
  };
}

function escapeXml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function getLayoutDecorations(layout) {
  return Array.isArray(layout?.layout?.decorations) ? layout.layout.decorations : [];
}

function getPreviewItemSize(itemId, rotation = 0) {
  const base = (() => {
    if (itemId === "shed") {
      return { width: 88, height: 52 };
    }
    if (itemId === "fence-horizontal") {
      return { width: 48, height: 14 };
    }
    if (itemId === "fence-vertical") {
      return { width: 14, height: 48 };
    }
    return { width: 42, height: 42 };
  })();

  return Number(rotation) % 2 === 1
    ? { width: base.height, height: base.width }
    : base;
}

function getPreviewBounds(decorations) {
  if (!decorations.length) {
    return { x: 0, y: 0, width: 240, height: 180 };
  }

  const rects = decorations.map((decoration) => {
    const size = getPreviewItemSize(decoration.itemId, decoration.rotation);
    const x = Number(decoration.x) || 0;
    const y = Number(decoration.y) || 0;
    return { x, y, width: size.width, height: size.height };
  });
  const minX = Math.min(...rects.map((rect) => rect.x));
  const minY = Math.min(...rects.map((rect) => rect.y));
  const maxX = Math.max(...rects.map((rect) => rect.x + rect.width));
  const maxY = Math.max(...rects.map((rect) => rect.y + rect.height));
  return {
    x: minX,
    y: minY,
    width: Math.max(42, maxX - minX),
    height: Math.max(42, maxY - minY),
  };
}

function renderPreviewRoad({ x, y, width, height }) {
  return `
    <g>
      <rect x="${x}" y="${y}" width="${width}" height="${height}" rx="4" fill="#b99a5f"/>
      <path d="M${x + 6} ${y + height / 2}H${x + width - 6}" stroke="#f2d893" stroke-width="3" stroke-linecap="round" stroke-dasharray="8 7" opacity=".72"/>
      <path d="M${x + 1} ${y + 1}H${x + width - 1}V${y + height - 1}H${x + 1}Z" fill="none" stroke="rgba(41,30,17,.34)" stroke-width="2"/>
    </g>
  `;
}

function renderPreviewPlanter({ x, y, width, height }) {
  const centerX = x + width / 2;
  const centerY = y + height / 2;
  return `
    <g>
      <ellipse cx="${centerX}" cy="${centerY + height * 0.22}" rx="${width * 0.36}" ry="${height * 0.18}" fill="#3b261c" opacity=".38"/>
      <rect x="${x + width * 0.24}" y="${y + height * 0.38}" width="${width * 0.52}" height="${height * 0.32}" rx="5" fill="#a5633f"/>
      <ellipse cx="${centerX}" cy="${y + height * 0.38}" rx="${width * 0.32}" ry="${height * 0.16}" fill="#c88455"/>
      <circle cx="${x + width * 0.40}" cy="${y + height * 0.25}" r="${width * 0.16}" fill="#7ac777"/>
      <circle cx="${x + width * 0.58}" cy="${y + height * 0.22}" r="${width * 0.18}" fill="#5eab69"/>
      <circle cx="${x + width * 0.52}" cy="${y + height * 0.11}" r="${width * 0.13}" fill="#a5d97c"/>
    </g>
  `;
}

function renderPreviewFence({ x, y, width, height, itemId }) {
  const horizontal = itemId !== "fence-vertical";
  if (horizontal) {
    return `
      <g>
        <rect x="${x}" y="${y + height * 0.22}" width="${width}" height="${height * 0.22}" rx="2" fill="#dcc78a"/>
        <rect x="${x}" y="${y + height * 0.60}" width="${width}" height="${height * 0.22}" rx="2" fill="#c2a669"/>
        <rect x="${x + 5}" y="${y}" width="5" height="${height}" rx="2" fill="#f0dfaa"/>
        <rect x="${x + width - 10}" y="${y}" width="5" height="${height}" rx="2" fill="#f0dfaa"/>
      </g>
    `;
  }
  return `
    <g>
      <rect x="${x + width * 0.22}" y="${y}" width="${width * 0.22}" height="${height}" rx="2" fill="#dcc78a"/>
      <rect x="${x + width * 0.60}" y="${y}" width="${width * 0.22}" height="${height}" rx="2" fill="#c2a669"/>
      <rect x="${x}" y="${y + 5}" width="${width}" height="5" rx="2" fill="#f0dfaa"/>
      <rect x="${x}" y="${y + height - 10}" width="${width}" height="5" rx="2" fill="#f0dfaa"/>
    </g>
  `;
}

function renderPreviewShed({ x, y, width, height }) {
  return `
    <g>
      <ellipse cx="${x + width * 0.52}" cy="${y + height * 0.92}" rx="${width * 0.42}" ry="${height * 0.12}" fill="#111319" opacity=".42"/>
      <rect x="${x + width * 0.16}" y="${y + height * 0.42}" width="${width * 0.70}" height="${height * 0.44}" rx="6" fill="#735f3e"/>
      <path d="M${x + width * 0.09} ${y + height * 0.46}L${x + width * 0.50} ${y + height * 0.14}L${x + width * 0.91} ${y + height * 0.46}Z" fill="#8f5865"/>
      <path d="M${x + width * 0.20} ${y + height * 0.44}H${x + width * 0.80}" stroke="#f0c978" stroke-width="4" stroke-linecap="round"/>
      <rect x="${x + width * 0.44}" y="${y + height * 0.57}" width="${width * 0.18}" height="${height * 0.29}" rx="3" fill="#3a2e25"/>
      <rect x="${x + width * 0.24}" y="${y + height * 0.56}" width="${width * 0.13}" height="${height * 0.15}" rx="2" fill="#f1d98f"/>
    </g>
  `;
}

function renderPreviewDecoration(decoration, transform) {
  const itemId = String(decoration.itemId || "decor");
  const size = getPreviewItemSize(itemId, decoration.rotation);
  const x = transform.x(Number(decoration.x) || 0);
  const y = transform.y(Number(decoration.y) || 0);
  const width = size.width * transform.scale;
  const height = size.height * transform.scale;
  const args = { x, y, width, height, itemId };
  if (itemId === "road-square") {
    return renderPreviewRoad(args);
  }
  if (itemId === "planter") {
    return renderPreviewPlanter(args);
  }
  if (itemId === "fence-horizontal" || itemId === "fence-vertical") {
    return renderPreviewFence(args);
  }
  if (itemId === "shed") {
    return renderPreviewShed(args);
  }
  return `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="4" fill="#7ac7b7"/>`;
}

function renderLayoutPreviewSvg(layout) {
  const decorations = getLayoutDecorations(layout);
  const bounds = getPreviewBounds(decorations);
  const scene = { x: 48, y: 88, width: PREVIEW_WIDTH - 96, height: PREVIEW_HEIGHT - 124 };
  const scale = Math.min(
    scene.width / (bounds.width + 96),
    scene.height / (bounds.height + 96),
  );
  const scaledWidth = bounds.width * scale;
  const scaledHeight = bounds.height * scale;
  const offsetX = scene.x + (scene.width - scaledWidth) / 2;
  const offsetY = scene.y + (scene.height - scaledHeight) / 2;
  const transform = {
    scale,
    x: (value) => offsetX + (value - bounds.x) * scale,
    y: (value) => offsetY + (value - bounds.y) * scale,
  };
  const name = escapeXml(layout.name || layout.id);
  const category = escapeXml(layout.category || "Layout");

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${PREVIEW_WIDTH}" height="${PREVIEW_HEIGHT}" viewBox="0 0 ${PREVIEW_WIDTH} ${PREVIEW_HEIGHT}" role="img" aria-label="${name} Agent Town layout preview">
  <defs>
    <pattern id="grid-${escapeXml(layout.id)}" width="32" height="32" patternUnits="userSpaceOnUse">
      <path d="M32 0H0V32" fill="none" stroke="rgba(245,241,236,.06)" stroke-width="1"/>
    </pattern>
    <linearGradient id="ground-${escapeXml(layout.id)}" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#173126"/>
      <stop offset=".52" stop-color="#203e31"/>
      <stop offset="1" stop-color="#10251f"/>
    </linearGradient>
  </defs>
  <rect width="960" height="540" fill="#07090d"/>
  <rect x="24" y="24" width="912" height="492" rx="8" fill="#0d0f14" stroke="rgba(245,241,236,.12)"/>
  <rect x="24" y="24" width="912" height="54" rx="8" fill="#151820"/>
  <circle cx="56" cy="51" r="6" fill="#ff8c5f"/>
  <circle cx="78" cy="51" r="6" fill="#f2c66d"/>
  <circle cx="100" cy="51" r="6" fill="#7ac7b7"/>
  <text x="132" y="57" fill="#f5f1ec" font-family="Inter, ui-sans-serif, system-ui" font-size="19" font-weight="800">${name}</text>
  <text x="820" y="57" fill="#a8a3a0" font-family="Inter, ui-sans-serif, system-ui" font-size="15" text-anchor="end">${category}</text>
  <rect x="${scene.x}" y="${scene.y}" width="${scene.width}" height="${scene.height}" rx="8" fill="url(#ground-${escapeXml(layout.id)})" stroke="rgba(245,241,236,.12)"/>
  <rect x="${scene.x}" y="${scene.y}" width="${scene.width}" height="${scene.height}" rx="8" fill="url(#grid-${escapeXml(layout.id)})"/>
  <path d="M${scene.x} ${scene.y + scene.height - 36}C${scene.x + 180} ${scene.y + scene.height - 10} ${scene.x + 326} ${scene.y + scene.height - 76} ${scene.x + 480} ${scene.y + scene.height - 40}S${scene.x + 744} ${scene.y + scene.height - 20} ${scene.x + scene.width} ${scene.y + scene.height - 62}" fill="none" stroke="rgba(122,199,183,.18)" stroke-width="16" stroke-linecap="round"/>
  ${decorations.map((decoration) => renderPreviewDecoration(decoration, transform)).join("\n  ")}
  <rect x="${scene.x}" y="${scene.y}" width="${scene.width}" height="${scene.height}" rx="8" fill="none" stroke="rgba(245,241,236,.13)"/>
</svg>
`;
}

export async function buildRegistry({ root = DEFAULT_ROOT, write = true } = {}) {
  const { registryPath } = rootPaths(root);
  const entries = await readBuildingManifests({ root });
  const layoutEntries = await readLayoutManifests({ root });
  const recipeEntries = await readRecipeManifests({ root });
  const packages = entries.map((entry) => createPackageEntry({ ...entry, root }));
  const layoutPackages = layoutEntries.map((entry) => createLayoutPackageEntry({ ...entry, root }));
  const recipePackages = recipeEntries.map((entry) => createRecipePackageEntry({ ...entry, root }));
  const registry = {
    registryVersion: 1,
    manifestVersion: 1,
    generatedBy: `buildinghub/${BUILDINGHUB_VERSION}`,
    generatedAt: new Date().toISOString(),
    name: "Vibe Research BuildingHub",
    packageCount: packages.length,
    layoutCount: layoutEntries.length,
    recipeCount: recipeEntries.length,
    packages,
    layoutPackages,
    recipePackages,
    buildings: entries.map((entry) => entry.manifest),
    layouts: layoutEntries.map((entry) => entry.layout),
    recipes: recipeEntries.map((entry) => entry.recipe),
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
  const layoutAssetsDir = path.join(siteDir, "assets", "layouts");
  await mkdir(layoutAssetsDir, { recursive: true });
  for (const layout of registry.layouts) {
    await writeFile(
      path.join(layoutAssetsDir, `${layout.id}.svg`),
      renderLayoutPreviewSvg(layout),
      "utf8",
    );
  }
  await writeFile(path.join(siteDir, "registry.json"), `${JSON.stringify(registry, null, 2)}\n`, "utf8");
  return { layoutAssetsDir, registry, siteDir };
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
