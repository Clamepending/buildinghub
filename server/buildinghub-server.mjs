import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BuildingHubAccountStore } from "./account-store.mjs";
import { BuildingHubCatalogStore } from "./catalog-store.mjs";
import { renderLayoutPreviewSvg } from "../lib/buildinghub.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.resolve(__dirname, "..");
const DEFAULT_SITE_DIR = path.join(DEFAULT_ROOT, "site");
const DEFAULT_DATA_DIR = path.join(DEFAULT_ROOT, ".buildinghub-data");
const COOKIE_NAME = "buildinghub_session";
const SESSION_COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
const GITHUB_ACCESS_TOKEN_URL = "https://github.com/login/oauth/access_token";
const GITHUB_USER_URL = "https://api.github.com/user";
const GITHUB_OAUTH_SCOPE = "read:user";
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
const STATIC_MIME_TYPES = new Map([
  [".avif", "image/avif"],
  [".css", "text/css; charset=utf-8"],
  [".gif", "image/gif"],
  [".html", "text/html; charset=utf-8"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".js", "application/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".webp", "image/webp"],
]);

function clampText(value, limit = 200) {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, Math.max(1, limit));
}

function normalizeBaseUrl(value) {
  const rawValue = String(value || "").trim().replace(/\/+$/, "");
  if (!rawValue) {
    return "";
  }

  try {
    const url = new URL(rawValue);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString().replace(/\/+$/, "") : "";
  } catch {
    return "";
  }
}

function normalizeCallbackBaseUrl(host, port) {
  const normalizedHost = String(host || "127.0.0.1").trim();
  const callbackHost = normalizedHost === "0.0.0.0" || normalizedHost === "::" ? "127.0.0.1" : normalizedHost;
  return normalizeBaseUrl(`http://${callbackHost}:${port}`);
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

function isLoopbackHostname(hostname = "") {
  const normalized = String(hostname || "").trim().toLowerCase();
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1";
}

function parseCookieHeader(value = "") {
  const cookies = new Map();
  String(value || "")
    .split(";")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .forEach((entry) => {
      const separatorIndex = entry.indexOf("=");
      if (separatorIndex <= 0) {
        return;
      }
      const key = entry.slice(0, separatorIndex).trim();
      const cookieValue = entry.slice(separatorIndex + 1).trim();
      cookies.set(key, decodeURIComponent(cookieValue));
    });
  return cookies;
}

function buildSetCookie(value, { maxAgeSeconds = SESSION_COOKIE_MAX_AGE_SECONDS } = {}) {
  return [
    `${COOKIE_NAME}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.max(0, Math.round(maxAgeSeconds))}`,
  ].join("; ");
}

function getMimeType(filePath) {
  return STATIC_MIME_TYPES.get(path.extname(filePath).toLowerCase()) || "application/octet-stream";
}

function sendJson(response, statusCode, payload) {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(`${JSON.stringify(payload, null, 2)}\n`);
}

function sendHtml(response, statusCode, body) {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "text/html; charset=utf-8");
  response.end(body);
}

function sendText(response, statusCode, body, contentType = "text/plain; charset=utf-8") {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", contentType);
  response.end(body);
}

function redirect(response, location) {
  response.statusCode = 302;
  response.setHeader("Location", location);
  response.end();
}

function renderMessagePage({ title, message, actionHref = "/", actionLabel = "Back to BuildingHub" } = {}) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title || "BuildingHub")}</title>
  <style>
    :root { font-family: "Inter", "Segoe UI", sans-serif; color-scheme: light; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #f5efe6; color: #1f1b16; }
    main { width: min(560px, calc(100% - 32px)); padding: 24px; border-radius: 18px; background: #fffaf4; border: 1px solid #e7d8c4; }
    h1 { margin: 0 0 12px; font-size: 1.15rem; }
    p { margin: 0; line-height: 1.5; color: #5e5245; }
    a { display: inline-flex; margin-top: 16px; color: #7c3f00; font-weight: 700; text-decoration: none; }
  </style>
</head>
<body>
  <main>
    <h1>${escapeHtml(title || "BuildingHub")}</h1>
    <p>${escapeHtml(message || "The requested action could not be completed.")}</p>
    <a href="${escapeHtml(actionHref)}">${escapeHtml(actionLabel)}</a>
  </main>
</body>
</html>`;
}

function renderProfilePage(profile = {}) {
  const publications = Array.isArray(profile.publications) ? profile.publications : [];
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(profile.name || profile.login || "BuildingHub User")} | BuildingHub</title>
  <style>
    :root { font-family: "Inter", "Segoe UI", sans-serif; color-scheme: light; }
    body { margin: 0; background: #f5efe6; color: #1f1b16; }
    main { width: min(900px, calc(100% - 32px)); margin: 0 auto; padding: 40px 0 72px; }
    a { color: #7c3f00; text-decoration: none; }
    .hero { display: grid; gap: 10px; padding: 24px; border: 1px solid #e5d6c4; border-radius: 20px; background: #fffaf4; }
    .eyebrow { text-transform: uppercase; letter-spacing: .16em; font-size: .72rem; color: #8d745e; margin: 0; }
    h1 { margin: 0; font-size: clamp(2rem, 4vw, 3.2rem); }
    .meta { color: #6b5b4d; display: flex; flex-wrap: wrap; gap: 12px; }
    ul { list-style: none; margin: 24px 0 0; padding: 0; display: grid; gap: 14px; }
    li { padding: 18px; border-radius: 16px; background: #fffaf4; border: 1px solid #e5d6c4; }
    .kind { text-transform: uppercase; letter-spacing: .14em; font-size: .72rem; color: #8d745e; }
  </style>
</head>
<body>
  <main>
    <section class="hero">
      <p class="eyebrow">BuildingHub publisher</p>
      <h1>${escapeHtml(profile.name || profile.login || "BuildingHub User")}</h1>
      <div class="meta">
        ${profile.login ? `<span>@${escapeHtml(profile.login)}</span>` : ""}
        ${profile.githubLogin ? `<span>GitHub: @${escapeHtml(profile.githubLogin)}</span>` : ""}
        ${profile.githubProfileUrl ? `<a href="${escapeHtml(profile.githubProfileUrl)}" target="_blank" rel="noreferrer">GitHub profile</a>` : ""}
      </div>
    </section>
    <ul>
      ${publications.length
        ? publications.map((publication) => `
            <li>
              <div class="kind">${escapeHtml(publication.kind)}</div>
              <h2><a href="${escapeHtml(publication.url)}">${escapeHtml(publication.name)}</a></h2>
              ${publication.sourceUrl ? `<p><a href="${escapeHtml(publication.sourceUrl)}">Source</a></p>` : ""}
            </li>
          `).join("")
        : `<li><h2>No publications yet</h2><p>This account has not published any BuildingHub items yet.</p></li>`}
    </ul>
  </main>
</body>
</html>`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function getPublisherLabel(publisher = {}) {
  if (!publisher || typeof publisher !== "object") {
    return "";
  }

  return publisher.login ? `@${publisher.login}` : String(publisher.name || "").trim();
}

function renderPublisherHtml(publisher = {}) {
  const label = getPublisherLabel(publisher);
  if (!label) {
    return "";
  }
  return publisher.profileUrl
    ? `<a href="${escapeHtml(publisher.profileUrl)}">${escapeHtml(label)}</a>`
    : escapeHtml(label);
}

function renderPublisherMarkdown(publisher = {}) {
  const label = getPublisherLabel(publisher);
  if (!label) {
    return "";
  }
  return publisher.profileUrl ? `[${label}](${publisher.profileUrl})` : label;
}

function mergeEntriesById(baseEntries = [], dynamicEntries = []) {
  const order = [];
  const entries = new Map();

  for (const entry of Array.isArray(baseEntries) ? baseEntries : []) {
    const id = String(entry?.id || "").trim();
    if (!id) {
      continue;
    }
    if (!entries.has(id)) {
      order.push(id);
    }
    entries.set(id, entry);
  }

  for (const entry of Array.isArray(dynamicEntries) ? dynamicEntries : []) {
    const id = String(entry?.id || "").trim();
    if (!id) {
      continue;
    }
    if (!entries.has(id)) {
      order.push(id);
    }
    entries.set(id, entry);
  }

  return order.map((id) => entries.get(id)).filter(Boolean);
}

async function readStaticRegistry(root, siteDir) {
  const candidates = [
    path.join(root, "registry.json"),
    path.join(siteDir, "registry.json"),
  ];

  for (const candidate of candidates) {
    try {
      return JSON.parse(await readFile(candidate, "utf8"));
    } catch (error) {
      if (error?.code !== "ENOENT") {
        throw error;
      }
    }
  }

  return {
    registryVersion: 1,
    manifestVersion: 1,
    name: "Vibe Research BuildingHub",
    packages: [],
    layoutPackages: [],
    recipePackages: [],
    buildings: [],
    layouts: [],
    recipes: [],
  };
}

function buildMergedRegistry(staticRegistry = {}, dynamicRegistry = {}) {
  const buildings = Array.isArray(staticRegistry.buildings) ? staticRegistry.buildings : [];
  const packages = Array.isArray(staticRegistry.packages) ? staticRegistry.packages : [];
  const layouts = mergeEntriesById(staticRegistry.layouts, dynamicRegistry.layouts);
  const layoutPackages = mergeEntriesById(staticRegistry.layoutPackages, dynamicRegistry.layoutPackages);
  const recipes = mergeEntriesById(staticRegistry.recipes, dynamicRegistry.recipes);
  const recipePackages = mergeEntriesById(staticRegistry.recipePackages, dynamicRegistry.recipePackages);

  return {
    ...staticRegistry,
    generatedAt: new Date().toISOString(),
    generatedBy: "buildinghub/server",
    packageCount: packages.length,
    layoutCount: layouts.length,
    recipeCount: recipes.length,
    packages,
    layoutPackages,
    recipePackages,
    buildings,
    layouts,
    recipes,
  };
}

function renderLayoutReadme(layout = {}) {
  const publisherLine = layout.publisher ? `- Published by: ${renderPublisherMarkdown(layout.publisher)}` : "";
  const links = [
    layout.homepageUrl ? `- Share page: ${layout.homepageUrl}` : "",
    layout.repositoryUrl ? `- Source: ${layout.repositoryUrl}` : "",
    publisherLine,
  ].filter(Boolean).join("\n");

  return `# ${layout.name}

${layout.description || "A shared Agent Town base layout."}

## Layout

- Theme: ${layout.layout?.themeId || "default"}
- Cosmetic pieces: ${Array.isArray(layout.layout?.decorations) ? layout.layout.decorations.length : 0}
- Functional buildings: ${Object.keys(layout.layout?.functional || {}).length}

${links ? `## Links\n\n${links}\n` : ""}`;
}

function renderRecipeReadme(recipe = {}) {
  const publisher = recipe.source?.publisher || {};
  const publisherLine = getPublisherLabel(publisher) ? `- Published by: ${renderPublisherMarkdown(publisher)}` : "";
  const links = [
    recipe.source?.recipeUrl ? `- Share page: ${recipe.source.recipeUrl}` : "",
    recipe.source?.repositoryUrl ? `- Source: ${recipe.source.repositoryUrl}` : "",
    publisherLine,
  ].filter(Boolean).join("\n");

  return `# ${recipe.name}

${recipe.description || "A shared Vibe Research scaffold recipe."}

## Scaffold

- Schema: \`${escapeHtml(recipe.schema || "vibe-research.scaffold.recipe.v1")}\`
- Buildings: ${Array.isArray(recipe.buildings) ? recipe.buildings.length : 0}
- Functional buildings in layout: ${Object.keys(recipe.layout?.functional || {}).length}
- Cosmetic pieces in layout: ${Array.isArray(recipe.layout?.decorations) ? recipe.layout.decorations.length : 0}

${links ? `## Links\n\n${links}\n` : ""}`;
}

function renderLayoutPage(layout = {}, { previewUrl = "" } = {}) {
  const title = `${layout.name || layout.id} - BuildingHub`;
  const publisherHtml = renderPublisherHtml(layout.publisher || {});
  const functionalCount = Object.keys(layout.layout?.functional || {}).length;
  const cosmeticCount = Array.isArray(layout.layout?.decorations) ? layout.layout.decorations.length : 0;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(layout.description || "Shared Agent Town layout")}" />
  <meta property="og:type" content="website" />
  <meta property="og:title" content="${escapeHtml(title)}" />
  <meta property="og:description" content="${escapeHtml(layout.description || "Shared Agent Town layout")}" />
  ${previewUrl ? `<meta property="og:image" content="${escapeHtml(previewUrl)}" />` : ""}
  <style>
    :root { font-family: "Inter", "Segoe UI", sans-serif; color-scheme: light; }
    body { margin: 0; background: #f5efe6; color: #1f1b16; }
    main { width: min(980px, calc(100% - 32px)); margin: 0 auto; padding: 32px 0 56px; display: grid; gap: 18px; }
    .preview { width: 100%; border-radius: 18px; border: 1px solid #e5d6c4; background: #fffaf4; overflow: hidden; }
    .preview img { display: block; width: 100%; height: auto; aspect-ratio: 16 / 9; object-fit: cover; }
    .meta { display: flex; flex-wrap: wrap; gap: 8px; }
    .meta span { padding: 8px 10px; border: 1px solid #e5d6c4; border-radius: 999px; background: #fffaf4; color: #6b5b4d; font-size: .86rem; }
    h1 { margin: 0; font-size: clamp(2.3rem, 6vw, 4.8rem); line-height: .94; }
    p { margin: 0; max-width: 72ch; color: #5e5245; line-height: 1.6; }
    .actions { display: flex; flex-wrap: wrap; gap: 10px; }
    .button { display: inline-flex; align-items: center; justify-content: center; min-height: 42px; padding: 0 14px; border-radius: 10px; border: 1px solid #d9c7b1; background: #9ce05e; color: #1f1b16; font-weight: 800; text-decoration: none; }
    .button.secondary { background: #fffaf4; }
  </style>
</head>
<body>
  <main>
    <div class="preview">
      <img src="${escapeHtml(previewUrl)}" alt="${escapeHtml(`${layout.name || layout.id} preview`)}" />
    </div>
    <div class="meta">
      <span>${escapeHtml(`${cosmeticCount} cosmetic`)}</span>
      <span>${escapeHtml(`${functionalCount} functional`)}</span>
      <span>${escapeHtml(`theme ${layout.layout?.themeId || "default"}`)}</span>
    </div>
    <h1>${escapeHtml(layout.name || layout.id || "Layout")}</h1>
    ${publisherHtml ? `<div>Published by ${publisherHtml}</div>` : ""}
    <p>${escapeHtml(layout.description || "A shared Agent Town layout.")}</p>
    <div class="actions">
      <a class="button" href="/">Browse BuildingHub</a>
      ${layout.repositoryUrl ? `<a class="button secondary" href="${escapeHtml(layout.repositoryUrl)}">View source</a>` : ""}
    </div>
  </main>
</body>
</html>`;
}

function renderRecipePage(recipe = {}) {
  const publisherHtml = renderPublisherHtml(recipe.source?.publisher || {});
  const buildingCount = Array.isArray(recipe.buildings) ? recipe.buildings.length : 0;
  const functionalCount = Object.keys(recipe.layout?.functional || {}).length;
  const cosmeticCount = Array.isArray(recipe.layout?.decorations) ? recipe.layout.decorations.length : 0;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(`${recipe.name || recipe.id} - BuildingHub`)}</title>
  <meta name="description" content="${escapeHtml(recipe.description || "Shared Vibe Research scaffold recipe")}" />
  <style>
    :root { font-family: "Inter", "Segoe UI", sans-serif; color-scheme: light; }
    body { margin: 0; background: #f5efe6; color: #1f1b16; }
    main { width: min(980px, calc(100% - 32px)); margin: 0 auto; padding: 36px 0 56px; display: grid; gap: 18px; }
    .meta { display: flex; flex-wrap: wrap; gap: 8px; }
    .meta span { padding: 8px 10px; border: 1px solid #e5d6c4; border-radius: 999px; background: #fffaf4; color: #6b5b4d; font-size: .86rem; }
    h1 { margin: 0; font-size: clamp(2.3rem, 6vw, 4.8rem); line-height: .94; max-width: 12ch; }
    p { margin: 0; max-width: 72ch; color: #5e5245; line-height: 1.6; }
    .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 10px; }
    .stat { min-height: 84px; padding: 16px; border: 1px solid #e5d6c4; border-radius: 16px; background: #fffaf4; }
    .stat strong { display: block; font-size: 1.8rem; line-height: 1; }
    .stat span { display: block; margin-top: 8px; color: #6b5b4d; }
    .actions { display: flex; flex-wrap: wrap; gap: 10px; }
    .button { display: inline-flex; align-items: center; justify-content: center; min-height: 42px; padding: 0 14px; border-radius: 10px; border: 1px solid #d9c7b1; background: #9ce05e; color: #1f1b16; font-weight: 800; text-decoration: none; }
    .button.secondary { background: #fffaf4; }
  </style>
</head>
<body>
  <main>
    <div class="meta">
      <span>${escapeHtml(recipe.version || "0.1.0")}</span>
      <span>${escapeHtml(recipe.schema || "vibe-research.scaffold.recipe.v1")}</span>
    </div>
    <h1>${escapeHtml(recipe.name || recipe.id || "Scaffold recipe")}</h1>
    ${publisherHtml ? `<div>Published by ${publisherHtml}</div>` : ""}
    <p>${escapeHtml(recipe.description || "A shared Vibe Research scaffold recipe.")}</p>
    <section class="stats" aria-label="Scaffold recipe contents">
      <div class="stat"><strong>${buildingCount}</strong><span>buildings captured</span></div>
      <div class="stat"><strong>${functionalCount}</strong><span>functional placements</span></div>
      <div class="stat"><strong>${cosmeticCount}</strong><span>cosmetic placements</span></div>
    </section>
    <div class="actions">
      <a class="button" href="/">Browse BuildingHub</a>
      ${recipe.source?.repositoryUrl ? `<a class="button secondary" href="${escapeHtml(recipe.source.repositoryUrl)}">View source</a>` : ""}
    </div>
  </main>
</body>
</html>`;
}

async function readRequestJson(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) {
    return {};
  }
  return JSON.parse(raw);
}

async function exchangeGitHubCode({
  clientId,
  clientSecret,
  code,
  redirectUri,
  fetchImpl = globalThis.fetch,
}) {
  if (typeof fetchImpl !== "function") {
    throw new Error("fetch is not available for GitHub OAuth.");
  }

  const tokenResponse = await fetchImpl(GITHUB_ACCESS_TOKEN_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "buildinghub",
    },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
    }).toString(),
  });
  const tokenPayload = JSON.parse(await tokenResponse.text().catch(() => "{}"));
  if (!tokenResponse.ok || !tokenPayload.access_token) {
    throw new Error(tokenPayload.error_description || tokenPayload.error || tokenPayload.message || "GitHub token exchange failed.");
  }

  const userResponse = await fetchImpl(GITHUB_USER_URL, {
    method: "GET",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${tokenPayload.access_token}`,
      "User-Agent": "buildinghub",
    },
  });
  const userPayload = JSON.parse(await userResponse.text().catch(() => "{}"));
  if (!userResponse.ok || !userPayload.login) {
    throw new Error(userPayload.message || "GitHub user lookup failed.");
  }

  return {
    id: String(userPayload.id || "").trim(),
    login: String(userPayload.login || "").trim(),
    name: String(userPayload.name || userPayload.login || "").trim(),
    profileUrl: String(userPayload.html_url || "").trim(),
    avatarUrl: String(userPayload.avatar_url || "").trim(),
  };
}

function getBearerToken(request) {
  const header = String(request.headers.authorization || "").trim();
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

function getSafeStaticPath(siteDir, pathname) {
  const decodedPath = decodeURIComponent(pathname || "/");
  const nextPath = decodedPath === "/" ? "/index.html" : decodedPath;
  const candidate = path.resolve(siteDir, `.${nextPath}`);
  return candidate.startsWith(path.resolve(siteDir)) ? candidate : "";
}

export async function createBuildingHubServer({
  root = DEFAULT_ROOT,
  siteDir = DEFAULT_SITE_DIR,
  dataDir = process.env.BUILDINGHUB_DATA_DIR || DEFAULT_DATA_DIR,
  host = process.env.BUILDINGHUB_HOST || (process.env.RENDER ? "0.0.0.0" : "127.0.0.1"),
  port = Number(process.env.PORT || process.env.BUILDINGHUB_PORT || 4787),
  publicBaseUrl = process.env.BUILDINGHUB_PUBLIC_BASE_URL || process.env.RENDER_EXTERNAL_URL || "",
  env = process.env,
  fetchImpl = globalThis.fetch,
  allowedReturnOrigins = null,
} = {}) {
  const accountStore = new BuildingHubAccountStore({ dataDir });
  await accountStore.load();
  const catalogStore = new BuildingHubCatalogStore({ dataDir });
  await catalogStore.ensureDirs();

  const resolvedAllowedOrigins = Array.isArray(allowedReturnOrigins)
    ? allowedReturnOrigins.map((entry) => normalizeBaseUrl(entry)).filter(Boolean)
    : String(env.BUILDINGHUB_ALLOWED_RETURN_ORIGINS || "")
      .split(",")
      .map((entry) => normalizeBaseUrl(entry))
      .filter(Boolean);
  const oauthStates = new Map();
  let baseUrl = normalizeBaseUrl(publicBaseUrl);

  function pruneOauthStates() {
    const now = Date.now();
    for (const [stateToken, entry] of oauthStates.entries()) {
      if (!entry || now - Number(entry.createdAt || 0) > OAUTH_STATE_TTL_MS) {
        oauthStates.delete(stateToken);
      }
    }
  }

  function isAllowedReturnToUrl(candidate) {
    const normalizedCandidate = normalizeUrl(candidate);
    if (!normalizedCandidate) {
      return false;
    }

    try {
      const url = new URL(normalizedCandidate);
      if (baseUrl && url.origin === new URL(baseUrl).origin) {
        return true;
      }
      if (isLoopbackHostname(url.hostname)) {
        return true;
      }
      return resolvedAllowedOrigins.includes(normalizeBaseUrl(url.origin));
    } catch {
      return false;
    }
  }

  async function getAuthenticatedUser(request, { allowSession = true, allowBearer = true } = {}) {
    if (allowBearer) {
      const token = getBearerToken(request);
      if (token) {
        const user = await accountStore.authenticateApiToken(token);
        if (user) {
          return user;
        }
      }
    }

    if (allowSession) {
      const cookies = parseCookieHeader(request.headers.cookie || "");
      const sessionId = cookies.get(COOKIE_NAME);
      if (sessionId) {
        const user = await accountStore.authenticateSession(sessionId);
        if (user) {
          return user;
        }
      }
    }

    return null;
  }

  async function getMergedRegistry() {
    const staticRegistry = await readStaticRegistry(root, siteDir);
    const dynamicEntries = catalogStore.buildRegistryEntries({
      layouts: await catalogStore.listLayouts(),
      recipes: await catalogStore.listRecipes(),
      baseUrl,
    });
    return buildMergedRegistry(staticRegistry, dynamicEntries);
  }

  async function serveCatalogLayoutAsset(response, assetName) {
    const normalizedAssetName = path.basename(String(assetName || ""));
    const assetId = normalizedAssetName.replace(/\.[^.]+$/, "");
    const layoutRecord = await catalogStore.getLayout(assetId);
    if (!layoutRecord?.layout) {
      return false;
    }

    const requestedExtension = path.extname(normalizedAssetName).toLowerCase();
    if (requestedExtension === ".svg") {
      response.statusCode = 200;
      response.setHeader("Content-Type", "image/svg+xml");
      response.end(renderLayoutPreviewSvg(layoutRecord.layout));
      return true;
    }

    if (layoutRecord.previewAssetName === normalizedAssetName) {
      const preview = await catalogStore.readLayoutPreview(normalizedAssetName);
      if (preview) {
        response.statusCode = 200;
        response.setHeader("Content-Type", layoutRecord.previewContentType || getMimeType(normalizedAssetName));
        response.end(preview);
        return true;
      }
    }

    return false;
  }

  async function serveStatic(request, response, pathname) {
    const filePath = getSafeStaticPath(siteDir, pathname);
    if (!filePath) {
      sendJson(response, 404, { error: "Not found." });
      return;
    }

    let fileStats;
    try {
      fileStats = await stat(filePath);
    } catch {
      sendJson(response, 404, { error: "Not found." });
      return;
    }

    if (!fileStats.isFile()) {
      sendJson(response, 404, { error: "Not found." });
      return;
    }

    response.statusCode = 200;
    response.setHeader("Content-Type", getMimeType(filePath));
    response.end(await readFile(filePath));
  }

  const server = createServer(async (request, response) => {
    try {
      pruneOauthStates();
      const url = new URL(request.url || "/", "http://buildinghub.local");
      const pathname = url.pathname || "/";

      if (request.method === "GET" && pathname === "/healthz") {
        sendJson(response, 200, {
          ok: true,
          service: "buildinghub",
          baseUrl,
          dataDir,
        });
        return;
      }

      if (request.method === "GET" && pathname === "/auth/github/start") {
        const clientId = String(env.BUILDINGHUB_GITHUB_OAUTH_CLIENT_ID || env.GITHUB_OAUTH_CLIENT_ID || "").trim();
        const returnTo = normalizeUrl(url.searchParams.get("return_to") || "");
        const tokenLabel = clampText(url.searchParams.get("token_label") || "Vibe Research", 120) || "Vibe Research";

        if (!clientId) {
          sendHtml(response, 400, renderMessagePage({
            title: "GitHub OAuth Not Configured",
            message: "Set BUILDINGHUB_GITHUB_OAUTH_CLIENT_ID and BUILDINGHUB_GITHUB_OAUTH_CLIENT_SECRET before signing in.",
          }));
          return;
        }

        if (returnTo && !isAllowedReturnToUrl(returnTo)) {
          sendJson(response, 400, { error: "The requested return_to URL is not allowed." });
          return;
        }

        const stateToken = randomUUID();
        oauthStates.set(stateToken, {
          createdAt: Date.now(),
          returnTo,
          tokenLabel,
        });

        const callbackUrl = `${baseUrl}/auth/github/callback`;
        const authUrl = new URL("https://github.com/login/oauth/authorize");
        authUrl.searchParams.set("client_id", clientId);
        authUrl.searchParams.set("redirect_uri", callbackUrl);
        authUrl.searchParams.set("scope", GITHUB_OAUTH_SCOPE);
        authUrl.searchParams.set("state", stateToken);
        redirect(response, authUrl.toString());
        return;
      }

      if (request.method === "GET" && pathname === "/auth/github/callback") {
        const clientId = String(env.BUILDINGHUB_GITHUB_OAUTH_CLIENT_ID || env.GITHUB_OAUTH_CLIENT_ID || "").trim();
        const clientSecret = String(env.BUILDINGHUB_GITHUB_OAUTH_CLIENT_SECRET || env.GITHUB_OAUTH_CLIENT_SECRET || "").trim();
        const stateToken = String(url.searchParams.get("state") || "").trim();
        const code = String(url.searchParams.get("code") || "").trim();
        const oauthError = String(url.searchParams.get("error") || "").trim();
        const stateEntry = stateToken ? oauthStates.get(stateToken) : null;
        if (stateToken) {
          oauthStates.delete(stateToken);
        }

        if (!stateEntry) {
          sendHtml(response, 400, renderMessagePage({
            title: "Session Expired",
            message: "The GitHub sign-in session expired. Start again from BuildingHub.",
          }));
          return;
        }
        if (oauthError) {
          sendHtml(response, 400, renderMessagePage({
            title: "GitHub Sign-in Failed",
            message: `GitHub denied access: ${oauthError}.`,
          }));
          return;
        }
        if (!clientId || !clientSecret || !code) {
          sendHtml(response, 400, renderMessagePage({
            title: "GitHub Sign-in Failed",
            message: "BuildingHub could not finish GitHub sign-in because the OAuth request was incomplete.",
          }));
          return;
        }

        const profile = await exchangeGitHubCode({
          clientId,
          clientSecret,
          code,
          redirectUri: `${baseUrl}/auth/github/callback`,
          fetchImpl,
        });
        const user = await accountStore.upsertGitHubUser(profile);
        const session = await accountStore.createSession(user.id);
        response.setHeader("Set-Cookie", buildSetCookie(session.id));

        if (stateEntry.returnTo) {
          try {
            const returnToUrl = new URL(stateEntry.returnTo);
            if (returnToUrl.origin === new URL(baseUrl).origin) {
              redirect(response, stateEntry.returnTo);
              return;
            }
          } catch {
            // Fall through to grant exchange redirect.
          }

          const grant = await accountStore.createGrant(user.id, {
            redirectUri: stateEntry.returnTo,
            label: stateEntry.tokenLabel,
          });
          const redirectUrl = new URL(stateEntry.returnTo);
          redirectUrl.searchParams.set("buildinghub_grant", grant);
          redirect(response, redirectUrl.toString());
          return;
        }

        redirect(response, "/");
        return;
      }

      if (request.method === "GET" && pathname === "/registry.json") {
        sendJson(response, 200, await getMergedRegistry());
        return;
      }

      if (request.method === "GET" && pathname === "/api/session") {
        const user = await getAuthenticatedUser(request, { allowSession: true, allowBearer: true });
        sendJson(response, 200, {
          authenticated: Boolean(user),
          account: accountStore.buildPublicAccount(user, baseUrl),
        });
        return;
      }

      if (request.method === "POST" && pathname === "/api/session/logout") {
        const cookies = parseCookieHeader(request.headers.cookie || "");
        const sessionId = cookies.get(COOKIE_NAME);
        if (sessionId) {
          await accountStore.deleteSession(sessionId);
        }
        response.setHeader("Set-Cookie", buildSetCookie("", { maxAgeSeconds: 0 }));
        sendJson(response, 200, { ok: true });
        return;
      }

      if (request.method === "POST" && pathname === "/api/auth/exchange") {
        const body = await readRequestJson(request);
        const grant = String(body.grant || "").trim();
        const redirectUri = normalizeUrl(body.redirectUri || "");
        const consumed = await accountStore.consumeGrant(grant, { redirectUri });
        if (!consumed?.accessToken || !consumed?.user) {
          sendJson(response, 400, { error: "BuildingHub grant is invalid or expired." });
          return;
        }
        sendJson(response, 200, {
          ok: true,
          accessToken: consumed.accessToken,
          account: accountStore.buildPublicAccount(consumed.user, baseUrl),
        });
        return;
      }

      if (request.method === "GET" && pathname === "/api/account") {
        const user = await getAuthenticatedUser(request, { allowSession: false, allowBearer: true });
        if (!user) {
          sendJson(response, 401, { error: "BuildingHub account token is missing or invalid." });
          return;
        }
        sendJson(response, 200, {
          ok: true,
          account: accountStore.buildPublicAccount(user, baseUrl),
        });
        return;
      }

      if (request.method === "POST" && pathname === "/api/tokens/revoke") {
        const token = getBearerToken(request);
        if (!token) {
          sendJson(response, 401, { error: "Bearer token required." });
          return;
        }
        await accountStore.revokeApiToken(token);
        sendJson(response, 200, { ok: true });
        return;
      }

      if (request.method === "POST" && pathname === "/api/publications") {
        const user = await getAuthenticatedUser(request, { allowSession: false, allowBearer: true });
        if (!user) {
          sendJson(response, 401, { error: "BuildingHub account token is missing or invalid." });
          return;
        }
        const body = await readRequestJson(request);
        const publication = await accountStore.upsertPublication(user.id, body.publication || body);
        sendJson(response, 201, {
          ok: true,
          publication,
          account: accountStore.buildPublicAccount(user, baseUrl),
        });
        return;
      }

      if (request.method === "POST" && pathname === "/api/layouts") {
        const user = await getAuthenticatedUser(request, { allowSession: false, allowBearer: true });
        if (!user) {
          sendJson(response, 401, { error: "BuildingHub account token is missing or invalid." });
          return;
        }

        const body = await readRequestJson(request);
        const publisher = accountStore.buildPublicAccount(user, baseUrl);
        const record = await catalogStore.upsertLayout({
          userId: user.id,
          layout: body.layout || body.manifest || body,
          publisher,
          baseUrl,
          previewDataUrl: body.previewDataUrl || "",
        });
        await accountStore.upsertPublication(user.id, {
          kind: "layout",
          id: record.layout.id,
          name: record.layout.name,
          url: record.layout.homepageUrl,
          sourceUrl: record.layout.repositoryUrl || body.sourceUrl || "",
          commitUrl: body.commitUrl || "",
        });

        sendJson(response, 201, {
          ok: true,
          layoutId: record.layout.id,
          layoutUrl: record.layout.homepageUrl,
          previewUrl: record.layout.previewUrl,
          repositoryUrl: record.layout.repositoryUrl || "",
          commit: "",
          commitUrl: body.commitUrl || "",
          branch: "",
          pushed: false,
          publisher,
          publishedAt: record.updatedAt,
          publishedVia: "api",
          recordedByBuildingHub: true,
          sourceId: "hosted",
          status: "published",
        });
        return;
      }

      if (request.method === "POST" && pathname === "/api/recipes") {
        const user = await getAuthenticatedUser(request, { allowSession: false, allowBearer: true });
        if (!user) {
          sendJson(response, 401, { error: "BuildingHub account token is missing or invalid." });
          return;
        }

        const body = await readRequestJson(request);
        const publisher = accountStore.buildPublicAccount(user, baseUrl);
        const record = await catalogStore.upsertRecipe({
          userId: user.id,
          recipe: body.recipe || body.manifest || body,
          publisher,
          baseUrl,
        });
        await accountStore.upsertPublication(user.id, {
          kind: "recipe",
          id: record.recipe.id,
          name: record.recipe.name,
          url: record.recipe.source?.recipeUrl,
          sourceUrl: record.recipe.source?.repositoryUrl || body.sourceUrl || "",
          commitUrl: body.commitUrl || "",
        });

        sendJson(response, 201, {
          ok: true,
          recipeId: record.recipe.id,
          recipeUrl: record.recipe.source?.recipeUrl || "",
          repositoryUrl: record.recipe.source?.repositoryUrl || "",
          commit: "",
          commitUrl: body.commitUrl || "",
          branch: "",
          pushed: false,
          publisher,
          publishedAt: record.updatedAt,
          publishedVia: "api",
          recordedByBuildingHub: true,
          sourceId: "hosted",
          status: "published",
        });
        return;
      }

      if (request.method === "GET" && pathname.startsWith("/api/users/")) {
        const login = decodeURIComponent(pathname.slice("/api/users/".length));
        const user = accountStore.getUserByLogin(login);
        if (!user) {
          sendJson(response, 404, { error: "BuildingHub user not found." });
          return;
        }
        sendJson(response, 200, {
          ok: true,
          profile: {
            ...accountStore.buildPublicAccount(user, baseUrl),
            publications: accountStore.listPublicationsForUser(user.id),
          },
        });
        return;
      }

      if (request.method === "GET" && pathname.startsWith("/u/")) {
        const login = decodeURIComponent(pathname.slice("/u/".length));
        const user = accountStore.getUserByLogin(login);
        if (!user) {
          sendHtml(response, 404, renderMessagePage({
            title: "Publisher Not Found",
            message: "That BuildingHub publisher profile does not exist yet.",
          }));
          return;
        }
        sendHtml(response, 200, renderProfilePage({
          ...accountStore.buildPublicAccount(user, baseUrl),
          publications: accountStore.listPublicationsForUser(user.id),
        }));
        return;
      }

      if (request.method === "GET" && pathname.startsWith("/assets/layouts/")) {
        const assetName = decodeURIComponent(pathname.slice("/assets/layouts/".length));
        if (await serveCatalogLayoutAsset(response, assetName)) {
          return;
        }
      }

      const layoutJsonMatch = pathname.match(/^\/layouts\/([^/]+)\/layout\.json$/);
      if (request.method === "GET" && layoutJsonMatch) {
        const layoutRecord = await catalogStore.getLayout(decodeURIComponent(layoutJsonMatch[1]));
        if (!layoutRecord?.layout) {
          sendJson(response, 404, { error: "BuildingHub layout not found." });
          return;
        }
        sendJson(response, 200, layoutRecord.layout);
        return;
      }

      const layoutReadmeMatch = pathname.match(/^\/layouts\/([^/]+)\/README\.md$/);
      if (request.method === "GET" && layoutReadmeMatch) {
        const layoutRecord = await catalogStore.getLayout(decodeURIComponent(layoutReadmeMatch[1]));
        if (!layoutRecord?.layout) {
          sendText(response, 404, "BuildingHub layout not found.\n");
          return;
        }
        sendText(response, 200, `${renderLayoutReadme(layoutRecord.layout)}\n`, "text/markdown; charset=utf-8");
        return;
      }

      const recipeJsonMatch = pathname.match(/^\/recipes\/([^/]+)\/recipe\.json$/);
      if (request.method === "GET" && recipeJsonMatch) {
        const recipeRecord = await catalogStore.getRecipe(decodeURIComponent(recipeJsonMatch[1]));
        if (!recipeRecord?.recipe) {
          sendJson(response, 404, { error: "BuildingHub recipe not found." });
          return;
        }
        sendJson(response, 200, recipeRecord.recipe);
        return;
      }

      const recipeReadmeMatch = pathname.match(/^\/recipes\/([^/]+)\/README\.md$/);
      if (request.method === "GET" && recipeReadmeMatch) {
        const recipeRecord = await catalogStore.getRecipe(decodeURIComponent(recipeReadmeMatch[1]));
        if (!recipeRecord?.recipe) {
          sendText(response, 404, "BuildingHub recipe not found.\n");
          return;
        }
        sendText(response, 200, `${renderRecipeReadme(recipeRecord.recipe)}\n`, "text/markdown; charset=utf-8");
        return;
      }

      const layoutPageMatch = pathname.match(/^\/layouts\/([^/]+)\/?$/);
      if (request.method === "GET" && layoutPageMatch) {
        const layoutRecord = await catalogStore.getLayout(decodeURIComponent(layoutPageMatch[1]));
        if (!layoutRecord?.layout) {
          sendHtml(response, 404, renderMessagePage({
            title: "Layout Not Found",
            message: "That BuildingHub layout does not exist yet.",
          }));
          return;
        }
        if (!pathname.endsWith("/")) {
          redirect(response, `${pathname}/`);
          return;
        }
        sendHtml(response, 200, renderLayoutPage(layoutRecord.layout, {
          previewUrl: layoutRecord.layout.previewUrl || `${baseUrl}/assets/layouts/${encodeURIComponent(layoutRecord.layout.id)}.svg`,
        }));
        return;
      }

      const recipePageMatch = pathname.match(/^\/recipes\/([^/]+)\/?$/);
      if (request.method === "GET" && recipePageMatch) {
        const recipeRecord = await catalogStore.getRecipe(decodeURIComponent(recipePageMatch[1]));
        if (!recipeRecord?.recipe) {
          sendHtml(response, 404, renderMessagePage({
            title: "Recipe Not Found",
            message: "That BuildingHub scaffold recipe does not exist yet.",
          }));
          return;
        }
        if (!pathname.endsWith("/")) {
          redirect(response, `${pathname}/`);
          return;
        }
        sendHtml(response, 200, renderRecipePage(recipeRecord.recipe));
        return;
      }

      if (request.method === "GET") {
        await serveStatic(request, response, pathname);
        return;
      }

      sendJson(response, 404, { error: "Not found." });
    } catch (error) {
      sendJson(response, Number(error?.statusCode) || 500, {
        error: error?.message || "BuildingHub request failed.",
      });
    }
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve();
    });
  });

  if (!baseUrl) {
    const address = server.address();
    const actualPort = typeof address === "object" && address ? address.port : port;
    baseUrl = normalizeCallbackBaseUrl(host, actualPort);
  }

  return {
    accountStore,
    baseUrl,
    close: async () => {
      await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    },
    server,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const instance = await createBuildingHubServer();
  process.stdout.write(`BuildingHub server running at ${instance.baseUrl}\n`);
}
