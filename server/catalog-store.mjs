import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const FILE_MODE = 0o600;
const CATALOG_DIRNAME = "catalog";
const LAYOUT_PREVIEW_DIRNAME = "layout-previews";
const IMAGE_EXTENSION_BY_MIME = new Map([
  ["image/avif", ".avif"],
  ["image/gif", ".gif"],
  ["image/jpeg", ".jpg"],
  ["image/jpg", ".jpg"],
  ["image/png", ".png"],
  ["image/webp", ".webp"],
]);
const ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

function clampText(value, limit = 200) {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, Math.max(1, limit));
}

function nowIso(now = Date.now()) {
  return new Date(now()).toISOString();
}

function normalizeUrl(value) {
  const rawValue = String(value || "").trim();
  if (!rawValue) {
    return "";
  }

  try {
    const url = new URL(rawValue);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : "";
  } catch {
    return "";
  }
}

function normalizeId(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/_/g, "-")
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96);
  return ID_PATTERN.test(normalized) ? normalized : "";
}

function sha256(value) {
  const payload = typeof value === "string" ? value : JSON.stringify(value);
  return createHash("sha256").update(payload).digest("hex");
}

function cloneJson(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function parseDataUrl(dataUrl) {
  const match = String(dataUrl || "").trim().match(/^data:([^;,]+);base64,([a-z0-9+/=]+)$/i);
  if (!match) {
    return null;
  }

  const mimeType = String(match[1] || "").trim().toLowerCase();
  const extension = IMAGE_EXTENSION_BY_MIME.get(mimeType);
  if (!extension) {
    return null;
  }

  try {
    return {
      mimeType,
      extension,
      buffer: Buffer.from(match[2], "base64"),
    };
  } catch {
    return null;
  }
}

function normalizeLayoutManifest(layout = {}, { baseUrl = "", publisher = null, previewAssetName = "" } = {}) {
  if (!layout || typeof layout !== "object" || Array.isArray(layout)) {
    throw new Error("A layout manifest object is required.");
  }

  const id = normalizeId(layout.id);
  const name = clampText(layout.name, 160);
  const version = clampText(layout.version || "0.1.0", 40) || "0.1.0";
  if (!id || !name) {
    throw new Error("A layout requires id and name.");
  }
  if (!layout.layout || typeof layout.layout !== "object" || Array.isArray(layout.layout)) {
    throw new Error("A layout requires layout data.");
  }

  const normalizedBaseUrl = String(baseUrl || "").replace(/\/+$/, "");
  const layoutUrl = normalizedBaseUrl ? `${normalizedBaseUrl}/layouts/${encodeURIComponent(id)}/` : "";
  const previewUrl = normalizedBaseUrl
    ? `${normalizedBaseUrl}/assets/layouts/${encodeURIComponent(previewAssetName || `${id}.svg`)}`
    : "";

  return {
    ...cloneJson(layout),
    id,
    name,
    version,
    ...(layoutUrl ? { homepageUrl: layoutUrl } : {}),
    ...(previewUrl ? { previewUrl } : {}),
    ...(publisher ? { publisher: cloneJson(publisher) } : {}),
  };
}

function normalizeRecipeManifest(recipe = {}, { baseUrl = "", publisher = null } = {}) {
  if (!recipe || typeof recipe !== "object" || Array.isArray(recipe)) {
    throw new Error("A scaffold recipe object is required.");
  }

  const id = normalizeId(recipe.id);
  const name = clampText(recipe.name, 160);
  const version = clampText(recipe.version || "0.1.0", 40) || "0.1.0";
  if (!id || !name) {
    throw new Error("A scaffold recipe requires id and name.");
  }
  if (!Array.isArray(recipe.buildings)) {
    throw new Error("A scaffold recipe requires buildings[].");
  }

  const normalizedBaseUrl = String(baseUrl || "").replace(/\/+$/, "");
  const recipeUrl = normalizedBaseUrl ? `${normalizedBaseUrl}/recipes/${encodeURIComponent(id)}/` : "";
  return {
    ...cloneJson(recipe),
    id,
    name,
    version,
    source: {
      ...(cloneJson(recipe.source) || {}),
      kind: "buildinghub",
      sourceId: "hosted",
      ...(recipeUrl ? { recipeUrl } : {}),
      ...(publisher ? { publisher: cloneJson(publisher) } : {}),
    },
  };
}

async function readJsonIfPresent(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function writeJsonAtomically(filePath, payload) {
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(tempPath, `${JSON.stringify(payload, null, 2)}\n`, { encoding: "utf8", mode: FILE_MODE });
  await rename(tempPath, filePath);
}

function buildLayoutPackageEntry(layout, baseUrl = "") {
  const layoutPath = `${String(baseUrl || "").replace(/\/+$/, "")}/layouts/${encodeURIComponent(layout.id)}/layout.json`;
  const readmePath = `${String(baseUrl || "").replace(/\/+$/, "")}/layouts/${encodeURIComponent(layout.id)}/README.md`;
  const layoutSha256 = sha256(layout);
  return {
    id: layout.id,
    name: layout.name,
    category: layout.category || "Layout",
    latestVersion: layout.version,
    layoutSha256,
    source: {
      layoutPath,
      readmePath,
      ...(layout.repositoryUrl ? { repositoryUrl: layout.repositoryUrl } : {}),
      ...(layout.homepageUrl ? { layoutUrl: layout.homepageUrl } : {}),
    },
    versions: [
      {
        version: layout.version,
        layoutSha256,
        layoutPath,
      },
    ],
  };
}

function buildRecipePackageEntry(recipe, baseUrl = "") {
  const recipePath = `${String(baseUrl || "").replace(/\/+$/, "")}/recipes/${encodeURIComponent(recipe.id)}/recipe.json`;
  const readmePath = `${String(baseUrl || "").replace(/\/+$/, "")}/recipes/${encodeURIComponent(recipe.id)}/README.md`;
  const recipeSha256 = sha256(recipe);
  return {
    id: recipe.id,
    name: recipe.name,
    category: recipe.category || "Scaffold",
    latestVersion: recipe.version,
    recipeSha256,
    source: {
      recipePath,
      readmePath,
      ...(recipe.source?.repositoryUrl ? { repositoryUrl: normalizeUrl(recipe.source.repositoryUrl) } : {}),
      ...(recipe.source?.recipeUrl ? { recipeUrl: normalizeUrl(recipe.source.recipeUrl) } : {}),
    },
    versions: [
      {
        version: recipe.version,
        recipeSha256,
        recipePath,
      },
    ],
  };
}

export class BuildingHubCatalogStore {
  constructor({ dataDir, now = Date.now } = {}) {
    this.dataDir = dataDir || "";
    this.now = typeof now === "function" ? now : Date.now;
    this.catalogDir = this.dataDir ? path.join(this.dataDir, CATALOG_DIRNAME) : "";
    this.layoutsDir = this.catalogDir ? path.join(this.catalogDir, "layouts") : "";
    this.recipesDir = this.catalogDir ? path.join(this.catalogDir, "recipes") : "";
    this.layoutPreviewDir = this.catalogDir ? path.join(this.catalogDir, LAYOUT_PREVIEW_DIRNAME) : "";
  }

  async ensureDirs() {
    if (!this.catalogDir) {
      return;
    }
    await mkdir(this.layoutsDir, { recursive: true });
    await mkdir(this.recipesDir, { recursive: true });
    await mkdir(this.layoutPreviewDir, { recursive: true });
  }

  getLayoutRecordPath(id) {
    return this.layoutsDir ? path.join(this.layoutsDir, `${normalizeId(id)}.json`) : "";
  }

  getRecipeRecordPath(id) {
    return this.recipesDir ? path.join(this.recipesDir, `${normalizeId(id)}.json`) : "";
  }

  getLayoutPreviewPath(assetName) {
    return this.layoutPreviewDir ? path.join(this.layoutPreviewDir, path.basename(assetName || "")) : "";
  }

  async getLayout(id) {
    const record = await readJsonIfPresent(this.getLayoutRecordPath(id));
    return record && record.kind === "layout" ? record : null;
  }

  async getRecipe(id) {
    const record = await readJsonIfPresent(this.getRecipeRecordPath(id));
    return record && record.kind === "recipe" ? record : null;
  }

  async listLayouts() {
    if (!this.layoutsDir) {
      return [];
    }

    await this.ensureDirs();
    const entries = await readdir(this.layoutsDir).catch(() => []);
    const layouts = [];
    for (const entry of entries) {
      if (!entry.endsWith(".json")) {
        continue;
      }
      const record = await readJsonIfPresent(path.join(this.layoutsDir, entry));
      if (record?.kind === "layout" && record.layout) {
        layouts.push(record);
      }
    }
    return layouts.sort((left, right) => String(left.layout?.name || "").localeCompare(String(right.layout?.name || "")));
  }

  async listRecipes() {
    if (!this.recipesDir) {
      return [];
    }

    await this.ensureDirs();
    const entries = await readdir(this.recipesDir).catch(() => []);
    const recipes = [];
    for (const entry of entries) {
      if (!entry.endsWith(".json")) {
        continue;
      }
      const record = await readJsonIfPresent(path.join(this.recipesDir, entry));
      if (record?.kind === "recipe" && record.recipe) {
        recipes.push(record);
      }
    }
    return recipes.sort((left, right) => String(left.recipe?.name || "").localeCompare(String(right.recipe?.name || "")));
  }

  async readLayoutPreview(assetName) {
    const previewPath = this.getLayoutPreviewPath(assetName);
    if (!previewPath) {
      return null;
    }

    try {
      return await readFile(previewPath);
    } catch (error) {
      if (error?.code === "ENOENT") {
        return null;
      }
      throw error;
    }
  }

  async upsertLayout({ userId, layout, publisher = null, baseUrl = "", previewDataUrl = "" } = {}) {
    if (!userId) {
      throw new Error("A BuildingHub user is required to publish a layout.");
    }

    await this.ensureDirs();
    const parsedPreview = previewDataUrl ? parseDataUrl(previewDataUrl) : null;
    if (previewDataUrl && !parsedPreview) {
      throw new Error("Layout preview image must be a supported base64 data URL.");
    }

    const layoutId = normalizeId(layout?.id);
    const existing = layoutId ? await this.getLayout(layoutId) : null;
    if (existing?.userId && existing.userId !== userId) {
      const conflict = new Error("That BuildingHub layout id is already owned by another account.");
      conflict.statusCode = 409;
      throw conflict;
    }

    const previewAssetName = parsedPreview ? `${layoutId}${parsedPreview.extension}` : (existing?.previewAssetName || "");
    const normalizedLayout = normalizeLayoutManifest(layout, {
      baseUrl,
      publisher,
      previewAssetName,
    });
    const nowAt = nowIso(this.now);
    const nextRecord = {
      kind: "layout",
      id: normalizedLayout.id,
      userId,
      layout: normalizedLayout,
      previewAssetName,
      previewContentType: parsedPreview?.mimeType || existing?.previewContentType || "",
      createdAt: existing?.createdAt || nowAt,
      updatedAt: nowAt,
    };

    if (parsedPreview?.buffer) {
      const previousAssetName = existing?.previewAssetName || "";
      if (previousAssetName && previousAssetName !== previewAssetName) {
        await rm(this.getLayoutPreviewPath(previousAssetName), { force: true }).catch(() => {});
      }
      await writeFile(this.getLayoutPreviewPath(previewAssetName), parsedPreview.buffer);
    }

    await writeJsonAtomically(this.getLayoutRecordPath(normalizedLayout.id), nextRecord);
    return cloneJson(nextRecord);
  }

  async upsertRecipe({ userId, recipe, publisher = null, baseUrl = "" } = {}) {
    if (!userId) {
      throw new Error("A BuildingHub user is required to publish a scaffold recipe.");
    }

    await this.ensureDirs();
    const recipeId = normalizeId(recipe?.id);
    const existing = recipeId ? await this.getRecipe(recipeId) : null;
    if (existing?.userId && existing.userId !== userId) {
      const conflict = new Error("That BuildingHub scaffold recipe id is already owned by another account.");
      conflict.statusCode = 409;
      throw conflict;
    }

    const normalizedRecipe = normalizeRecipeManifest(recipe, { baseUrl, publisher });
    const nowAt = nowIso(this.now);
    const nextRecord = {
      kind: "recipe",
      id: normalizedRecipe.id,
      userId,
      recipe: normalizedRecipe,
      createdAt: existing?.createdAt || nowAt,
      updatedAt: nowAt,
    };
    await writeJsonAtomically(this.getRecipeRecordPath(normalizedRecipe.id), nextRecord);
    return cloneJson(nextRecord);
  }

  buildRegistryEntries({ layouts = [], recipes = [], baseUrl = "" } = {}) {
    return {
      layouts: layouts.map((entry) => cloneJson(entry.layout)).filter(Boolean),
      layoutPackages: layouts.map((entry) => buildLayoutPackageEntry(entry.layout, baseUrl)),
      recipes: recipes.map((entry) => cloneJson(entry.recipe)).filter(Boolean),
      recipePackages: recipes.map((entry) => buildRecipePackageEntry(entry.recipe, baseUrl)),
    };
  }
}
