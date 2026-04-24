const state = {
  authAvailable: null,
  registry: null,
  session: null,
  tab: "buildings",
  query: "",
};

const accountPanel = document.querySelector("#account-panel");
const cards = document.querySelector("#cards");
const summary = document.querySelector("#summary");
const search = document.querySelector("#search");
const catalog = document.querySelector(".catalog");
const CENTRAL_REPO_URL = "https://github.com/Clamepending/buildinghub";

function text(value) {
  return String(value ?? "");
}

function matches(entry, query) {
  return searchScore(entry, query) > 0;
}

function searchScore(entry, query) {
  const normalizedQuery = text(query).trim().toLowerCase();
  if (!normalizedQuery) {
    return 1;
  }

  const id = text(entry.id).toLowerCase();
  const name = text(entry.name).toLowerCase();
  const category = text(entry.category).toLowerCase();
  const status = text(entry.status).toLowerCase();
  const source = text(entry.source).toLowerCase();
  const direct = [id, name];
  const tags = [
    ...(Array.isArray(entry.tags) ? entry.tags : []),
    ...(Array.isArray(entry.keywords) ? entry.keywords : []),
    ...(Array.isArray(entry.requiredBuildings) ? entry.requiredBuildings : []),
  ].map((value) => text(value).toLowerCase());
  const nested = [...collectSearchText(entry), ...collectPackageFacets(entry)].join(" ").toLowerCase();

  if (direct.some((value) => value === normalizedQuery)) {
    return 120;
  }
  if (direct.some((value) => value.startsWith(normalizedQuery))) {
    return 100;
  }
  if (direct.some((value) => value.includes(normalizedQuery))) {
    return 86;
  }
  if ([category, status, source].some((value) => value.includes(normalizedQuery))) {
    return 58;
  }
  if (tags.some((value) => value.includes(normalizedQuery))) {
    return 50;
  }
  return nested.includes(normalizedQuery) ? 18 : 0;
}

function collectPackageFacets(entry) {
  const facets = [];
  const footprint = entry?.footprint || {};
  if (Number(footprint.width) > 0 && Number(footprint.height) > 0) {
    facets.push("footprint", "lot", `${Number(footprint.width)}x${Number(footprint.height)}`, `${Number(footprint.width)}x${Number(footprint.height)} lot`);
  }
  if (Array.isArray(entry?.tools) && entry.tools.length) {
    facets.push("tool", "tools", `${entry.tools.length} tools`);
  }
  if (Array.isArray(entry?.endpoints) && entry.endpoints.length) {
    facets.push("endpoint", "endpoints", `${entry.endpoints.length} endpoints`);
  }
  if (entry?.repo?.url || entry?.repositoryUrl) {
    facets.push("repo", "repository", "source repo");
  }
  if (entry?.media?.thumbnail) {
    facets.push("thumbnail", "media");
  }
  if (Array.isArray(entry?.buildings) && entry.buildings.length) {
    facets.push("scaffold", "recipe", `${entry.buildings.length} buildings`);
  }
  if (entry?.communication?.dm?.enabled) {
    facets.push("dm", "agent communication", "messages");
  }
  if (entry?.sandbox?.provider) {
    facets.push("sandbox", entry.sandbox.provider);
  }
  return facets;
}

function collectSearchText(value, output = []) {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    output.push(String(value));
    return output;
  }
  if (Array.isArray(value)) {
    value.forEach((entry) => collectSearchText(entry, output));
    return output;
  }
  if (value && typeof value === "object") {
    Object.values(value).forEach((entry) => collectSearchText(entry, output));
  }
  return output;
}

function escapeHtml(value) {
  return text(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttribute(value) {
  return escapeHtml(value);
}

async function copyJson(value) {
  const json = JSON.stringify(value, null, 2);
  try {
    await navigator.clipboard.writeText(json);
  } catch {
    window.prompt("Copy JSON", json);
  }
}

function renderTags(tags) {
  return tags.map((tag) => `<span class="pill">${escapeHtml(tag)}</span>`).join("");
}

function getDisplayTags(tags, limit = 6) {
  const readable = tags.filter((tag) => {
    const value = text(tag);
    return value.length <= 24 && !/^[A-Z0-9_]{12,}$/.test(value);
  });
  return (readable.length ? readable : tags).slice(0, limit);
}

function normalizeClassName(value) {
  return text(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "building";
}

function getRepoUrl(building) {
  return text(building.repo?.url || building.repositoryUrl).trim();
}

function getRegistrySnapshotUrl(entry, type = "building") {
  const folder = type === "layout" ? "layouts" : type === "scaffold" || type === "recipe" ? "recipes" : "buildings";
  return `${CENTRAL_REPO_URL}/tree/main/${folder}/${encodeURIComponent(entry.id)}`;
}

function getManifestSourceUrl(entry, type = "building") {
  const folder = type === "layout" ? "layouts" : type === "scaffold" || type === "recipe" ? "recipes" : "buildings";
  const filename = type === "layout" ? "layout.json" : type === "scaffold" || type === "recipe" ? "recipe.json" : "building.json";
  return `${CENTRAL_REPO_URL}/blob/main/${folder}/${encodeURIComponent(entry.id)}/${filename}`;
}

function getThumbnailUrl(building) {
  const url = text(building.media?.thumbnail?.url).trim();
  return /^https?:\/\//i.test(url) ? url : "";
}

function countLabel(count, singular, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function renderExternalLink(url, label, extraClass = "") {
  const href = text(url).trim();
  if (!href) {
    return "";
  }
  return `<a class="copy ${escapeAttribute(extraClass)}" href="${escapeAttribute(href)}" target="_blank" rel="noreferrer">${escapeHtml(label)}</a>`;
}

function renderAccountPanel() {
  if (!accountPanel) {
    return;
  }

  if (state.authAvailable === false) {
    accountPanel.innerHTML = `
      <div class="account-shell">
        <div class="account-copy">
          <strong>Hosted auth unavailable</strong>
          <span>Static preview mode does not expose BuildingHub accounts.</span>
        </div>
      </div>
    `;
    return;
  }

  const account = state.session?.account && typeof state.session.account === "object" ? state.session.account : null;
  if (state.session?.authenticated && account) {
    const label = account.login ? `@${account.login}` : text(account.name).trim() || "BuildingHub account";
    accountPanel.innerHTML = `
      <div class="account-shell">
        <div class="account-copy">
          <strong>${escapeHtml(label)}</strong>
          <span>${escapeHtml(account.githubLogin ? `Connected with GitHub @${account.githubLogin}` : "Signed in to BuildingHub")}</span>
        </div>
        <div class="account-actions">
          ${account.profileUrl ? `<a class="copy hero-link" href="${escapeAttribute(account.profileUrl)}">Profile</a>` : ""}
          <button class="copy hero-link" type="button" data-account-logout>Log out</button>
        </div>
      </div>
    `;
    return;
  }

  const authUrl = new URL("/auth/github/start", window.location.origin);
  authUrl.searchParams.set("return_to", window.location.href);
  authUrl.searchParams.set("token_label", "BuildingHub web");
  accountPanel.innerHTML = `
    <div class="account-shell">
      <div class="account-copy">
        <strong>BuildingHub accounts</strong>
        <span>Sign in with GitHub to get a persistent BuildingHub publisher profile.</span>
      </div>
      <div class="account-actions">
        <a class="copy hero-link" href="${escapeAttribute(authUrl.toString())}">Sign in with GitHub</a>
      </div>
    </div>
  `;
}

function renderBuildingVisual(building, sizeClass = "") {
  const shape = normalizeClassName(building.visual?.shape || building.icon || "plugin");
  const thumbnailUrl = getThumbnailUrl(building);
  return thumbnailUrl
    ? `<div class="building-mark has-thumbnail ${escapeAttribute(sizeClass)}"><img src="${escapeAttribute(thumbnailUrl)}" alt="${escapeAttribute(building.media.thumbnail.alt || `${building.name} thumbnail`)}" loading="lazy" /></div>`
    : `<div class="building-mark building-shape-${escapeAttribute(shape)} ${escapeAttribute(sizeClass)}" aria-hidden="true">
        <span class="building-mark-grid"></span>
        <span class="building-mark-shadow"></span>
        <span class="building-mark-roof"></span>
        <span class="building-mark-body">
          <span class="building-mark-window"></span>
          <span class="building-mark-window"></span>
          <span class="building-mark-door"></span>
        </span>
        <span class="building-mark-sign">${escapeHtml(building.category || "Building")}</span>
      </div>`;
}

function renderListPanel(title, entries, renderEntry, emptyText) {
  const list = Array.isArray(entries) ? entries : [];
  return `
    <section class="detail-panel">
      <h3>${escapeHtml(title)}</h3>
      ${list.length
        ? `<div class="interface-list">${list.map(renderEntry).join("")}</div>`
        : `<p>${escapeHtml(emptyText)}</p>`}
    </section>
  `;
}

function renderKeyValue(label, value) {
  const shown = text(value).trim();
  if (!shown) {
    return "";
  }
  return `
    <div class="kv-row">
      <dt>${escapeHtml(label)}</dt>
      <dd>${escapeHtml(shown)}</dd>
    </div>
  `;
}

function renderPills(values) {
  return values
    .filter((value) => text(value).trim())
    .map((value) => `<span class="pill">${escapeHtml(value)}</span>`)
    .join("");
}

function renderLayoutCard(layout) {
  const tags = getDisplayTags(Array.isArray(layout.tags) ? layout.tags : []);
  const decorations = Array.isArray(layout.layout?.decorations) ? layout.layout.decorations : [];
  const functionalCount = Object.keys(layout.layout?.functional || {}).length;
  const shot = `./assets/layouts/${encodeURIComponent(layout.id)}.svg`;
  return `
    <article class="card is-clickable" tabindex="0" data-card-href="#/layouts/${escapeAttribute(layout.id)}" aria-label="Open ${escapeAttribute(layout.name)} layout page">
      <div class="preview-shell">
        <img class="layout-shot" src="${escapeHtml(shot)}" alt="${escapeHtml(layout.name)} Agent Town layout screenshot" loading="lazy" />
      </div>
      <div class="meta">
        <span class="pill is-accent">${escapeHtml(layout.category || "Layout")}</span>
        <span class="pill">${escapeHtml(`${decorations.length} pieces`)}</span>
        <span class="pill">${escapeHtml(`${functionalCount} buildings`)}</span>
        <span class="pill">${escapeHtml(layout.version || "0.1.0")}</span>
      </div>
      <h2><a href="#/layouts/${escapeAttribute(layout.id)}">${escapeHtml(layout.name)}</a></h2>
      <p>${escapeHtml(layout.description)}</p>
      <div class="tags">${renderTags(tags)}</div>
      <div class="actions">
        <a class="copy" href="#/layouts/${escapeAttribute(layout.id)}">Open page</a>
        <button class="copy" type="button" data-copy-layout="${escapeHtml(layout.id)}">Copy blueprint</button>
      </div>
    </article>
  `;
}

function renderScaffoldVisual(recipe, sizeClass = "") {
  const requiredCount = Array.isArray(recipe.buildings)
    ? recipe.buildings.filter((building) => building.required !== false).length
    : 0;
  return `
    <div class="building-mark building-shape-campus ${escapeAttribute(sizeClass)}" aria-hidden="true">
      <span class="building-mark-grid"></span>
      <span class="building-mark-shadow"></span>
      <span class="building-mark-roof"></span>
      <span class="building-mark-body">
        <span class="building-mark-window"></span>
        <span class="building-mark-window"></span>
        <span class="building-mark-door"></span>
      </span>
      <span class="building-mark-sign">${escapeHtml(requiredCount ? `${requiredCount} bldgs` : "Scaffold")}</span>
    </div>
  `;
}

function renderScaffoldCard(recipe) {
  const tags = getDisplayTags(Array.isArray(recipe.tags) ? recipe.tags : []);
  const buildingCount = Array.isArray(recipe.buildings) ? recipe.buildings.length : 0;
  const bindingCount = Array.isArray(recipe.localBindingsRequired) ? recipe.localBindingsRequired.length : 0;
  const hasLayout = Boolean(recipe.layout);
  const dmLabel = recipe.communication?.dm?.enabled ? "DMs on" : "DMs off";
  return `
    <article class="card is-clickable" tabindex="0" data-card-href="#/scaffolds/${escapeAttribute(recipe.id)}" aria-label="Open ${escapeAttribute(recipe.name)} scaffold page">
      ${renderScaffoldVisual(recipe)}
      <div class="meta">
        <span class="pill is-accent">${escapeHtml(recipe.category || "Scaffold")}</span>
        <span class="pill">${escapeHtml(countLabel(buildingCount, "building"))}</span>
        ${bindingCount ? `<span class="pill">${escapeHtml(countLabel(bindingCount, "binding"))}</span>` : ""}
        ${hasLayout ? `<span class="pill">layout</span>` : ""}
        <span class="pill">${escapeHtml(dmLabel)}</span>
        <span class="pill">${escapeHtml(recipe.version || "0.1.0")}</span>
      </div>
      <h2><a href="#/scaffolds/${escapeAttribute(recipe.id)}">${escapeHtml(recipe.name)}</a></h2>
      <p>${escapeHtml(recipe.description)}</p>
      <div class="tags">${renderTags(tags)}</div>
      <div class="actions">
        <a class="copy" href="#/scaffolds/${escapeAttribute(recipe.id)}">Open page</a>
        <button class="copy" type="button" data-copy-scaffold="${escapeHtml(recipe.id)}">Copy recipe</button>
      </div>
    </article>
  `;
}

function renderBuildingCard(building) {
  const tags = getDisplayTags(Array.isArray(building.keywords) ? building.keywords : []);
  const repoUrl = getRepoUrl(building);
  const docsUrl = text(building.docsUrl).trim();
  const footprint = building.footprint || {};
  const footprintLabel = Number(footprint.width) > 0 && Number(footprint.height) > 0
    ? `${Number(footprint.width)}x${Number(footprint.height)} lot`
    : "";
  const toolCount = Array.isArray(building.tools) ? building.tools.length : 0;
  const endpointCount = Array.isArray(building.endpoints) ? building.endpoints.length : 0;
  return `
    <article class="card is-clickable" tabindex="0" data-card-href="#/buildings/${escapeAttribute(building.id)}" aria-label="Open ${escapeAttribute(building.name)} building page">
      ${renderBuildingVisual(building)}
      <div class="meta">
        <span class="pill is-accent">${escapeHtml(building.category || "Building")}</span>
        <span class="pill">${escapeHtml(building.trust || "manifest-only")}</span>
        ${footprintLabel ? `<span class="pill">${escapeHtml(footprintLabel)}</span>` : ""}
        ${toolCount ? `<span class="pill">${escapeHtml(countLabel(toolCount, "tool"))}</span>` : ""}
        ${endpointCount ? `<span class="pill">${escapeHtml(countLabel(endpointCount, "endpoint"))}</span>` : ""}
        <span class="pill">${escapeHtml(building.version || "0.1.0")}</span>
      </div>
      <h2><a href="#/buildings/${escapeAttribute(building.id)}">${escapeHtml(building.name)}</a></h2>
      <p>${escapeHtml(building.description)}</p>
      <div class="tags">${renderTags(tags)}</div>
      <div class="actions">
        <a class="copy" href="#/buildings/${escapeAttribute(building.id)}">Open page</a>
        <button class="copy" type="button" data-copy-building="${escapeHtml(building.id)}">Copy manifest</button>
        ${repoUrl ? `<a class="copy" href="${escapeHtml(repoUrl)}" target="_blank" rel="noreferrer">Repo</a>` : ""}
        ${docsUrl ? `<a class="copy" href="${escapeHtml(docsUrl)}" target="_blank" rel="noreferrer">Docs</a>` : ""}
      </div>
    </article>
  `;
}

function parseRoute() {
  const parts = location.hash.replace(/^#\/?/, "").split("/").filter(Boolean).map(decodeURIComponent);
  if ((parts[0] === "scaffolds" || parts[0] === "recipes") && parts[1]) {
    return { view: "scaffold", id: parts[1], tab: "scaffolds" };
  }
  if (parts[0] === "layouts" && parts[1]) {
    return { view: "layout", id: parts[1], tab: "layouts" };
  }
  if (parts[0] === "buildings" && parts[1]) {
    return { view: "building", id: parts[1], tab: "buildings" };
  }
  if (parts[0] === "layouts") {
    return { view: "catalog", tab: "layouts" };
  }
  if (parts[0] === "scaffolds" || parts[0] === "recipes") {
    return { view: "catalog", tab: "scaffolds" };
  }
  return { view: "catalog", tab: "buildings" };
}

function setTitle(title) {
  document.title = title ? `${title} - BuildingHub` : "BuildingHub";
}

function renderNotFound(route) {
  catalog.classList.add("is-detail");
  summary.innerHTML = `<a class="copy back-link" href="#/${escapeAttribute(route.tab)}">Back to catalog</a>`;
  cards.innerHTML = `
    <article class="detail">
      <h2>Page not found</h2>
      <p>The requested ${escapeHtml(route.view)} could not be found in this registry.</p>
    </article>
  `;
  setTitle("Not found");
}

function renderBuildingDetail(building) {
  const repoUrl = getRepoUrl(building);
  const docsUrl = text(building.docsUrl).trim();
  const homepageUrl = text(building.homepageUrl).trim();
  const footprint = building.footprint || {};
  const onboardingSteps = Array.isArray(building.onboarding?.steps) ? building.onboarding.steps : [];
  const variables = Array.isArray(building.onboarding?.variables) ? building.onboarding.variables : [];
  const useCases = Array.isArray(building.agentGuide?.useCases) ? building.agentGuide.useCases : [];
  const sourceLabel = repoUrl ? "Package repo" : "Registry snapshot";
  const sourceUrl = repoUrl || getRegistrySnapshotUrl(building, "building");
  const footprintText = Number(footprint.width) > 0 && Number(footprint.height) > 0
    ? `${Number(footprint.width)} x ${Number(footprint.height)} ${footprint.shape || "lot"}`
    : "Not specified";

  catalog.classList.add("is-detail");
  summary.innerHTML = `<a class="copy back-link" href="#/buildings">Back to catalog</a>`;
  cards.innerHTML = `
    <article class="detail">
      <section class="detail-hero">
        ${renderBuildingVisual(building, "is-large")}
        <div class="detail-heading">
          <div class="meta">
            <span class="pill is-accent">${escapeHtml(building.category || "Building")}</span>
            <span class="pill">${escapeHtml(building.trust || "manifest-only")}</span>
            <span class="pill">${escapeHtml(building.version || "0.1.0")}</span>
            <span class="pill">${escapeHtml(footprintText)}</span>
          </div>
          <h2>${escapeHtml(building.name)}</h2>
          <p>${escapeHtml(building.description)}</p>
          <div class="actions detail-actions">
            <button class="copy" type="button" data-copy-building="${escapeAttribute(building.id)}">Copy manifest</button>
            ${renderExternalLink(sourceUrl, sourceLabel)}
            ${repoUrl ? renderExternalLink(getRegistrySnapshotUrl(building, "building"), "Registry snapshot") : ""}
            ${renderExternalLink(getManifestSourceUrl(building, "building"), "Manifest JSON")}
            ${renderExternalLink(docsUrl, "Docs")}
            ${renderExternalLink(homepageUrl, "Homepage")}
          </div>
        </div>
      </section>

      <section class="detail-grid">
        <section class="detail-panel">
          <h3>Source</h3>
          <dl class="kv">
            ${renderKeyValue("GitHub", sourceUrl)}
            ${repoUrl ? renderKeyValue("Registry snapshot", getRegistrySnapshotUrl(building, "building")) : renderKeyValue("Package repo", "Pending repo-first migration")}
            ${renderKeyValue("Manifest path", building.repo?.manifestPath || `buildings/${building.id}/building.json`)}
            ${renderKeyValue("README path", building.repo?.readmePath || `buildings/${building.id}/README.md`)}
          </dl>
        </section>

        <section class="detail-panel">
          <h3>Town lot</h3>
          <dl class="kv">
            ${renderKeyValue("Footprint", footprintText)}
            ${renderKeyValue("Snap", footprint.snap || "grid")}
            ${renderKeyValue("Entrance", Array.isArray(footprint.entrances) && footprint.entrances[0] ? `${footprint.entrances[0].side} @ ${footprint.entrances[0].offset ?? ""}` : "")}
          </dl>
        </section>

        <section class="detail-panel">
          <h3>Access</h3>
          <dl class="kv">
            ${renderKeyValue("Label", building.access?.label)}
            ${renderKeyValue("Detail", building.access?.detail)}
          </dl>
        </section>

        <section class="detail-panel">
          <h3>Setup variables</h3>
          ${variables.length
            ? `<div class="interface-list">${variables.map((entry) => `
                <section class="interface-row">
                  <h4>${escapeHtml(entry.label || entry.value || "Variable")}</h4>
                  <p>${escapeHtml(entry.value || "")}</p>
                  <div class="meta">${renderPills([entry.required ? "required" : "optional", entry.secret ? "secret" : "not secret"])}</div>
                </section>
              `).join("")}</div>`
            : "<p>No setup variables listed.</p>"}
        </section>
      </section>

      ${renderListPanel("Tools", building.tools, (tool) => `
        <section class="interface-row">
          <h4>${escapeHtml(tool.name || "Tool")}</h4>
          <p>${escapeHtml(tool.detail || "")}</p>
          <div class="meta">${renderPills([tool.type, tool.command ? `command: ${tool.command}` : "", tool.endpoint ? `endpoint: ${tool.endpoint}` : "", tool.required ? "required" : "optional"])}</div>
        </section>
      `, "No concrete tools are listed yet.")}

      ${renderListPanel("Endpoints", building.endpoints, (endpoint) => `
        <section class="interface-row">
          <h4>${escapeHtml(endpoint.name || "Endpoint")}</h4>
          <p>${escapeHtml(endpoint.detail || "")}</p>
          <div class="meta">${renderPills([endpoint.type, endpoint.method, endpoint.auth, endpoint.required ? "required" : "optional"])}</div>
          ${endpoint.url ? renderExternalLink(endpoint.url, "Open endpoint", "inline-link") : ""}
          ${endpoint.urlTemplate ? `<code>${escapeHtml(endpoint.urlTemplate)}</code>` : ""}
        </section>
      `, "No concrete endpoints are listed yet.")}

      ${renderListPanel("Onboarding", onboardingSteps, (step, index) => `
        <section class="interface-row">
          <h4>${escapeHtml(`${index + 1}. ${step.title || "Step"}`)}</h4>
          <p>${escapeHtml(step.detail || "")}</p>
        </section>
      `, "No onboarding steps are listed.")}

      ${useCases.length ? renderListPanel("Agent use cases", useCases, (useCase) => `
        <section class="interface-row">
          <p>${escapeHtml(useCase)}</p>
        </section>
      `, "") : ""}
    </article>
  `;
  setTitle(building.name);
}

function renderLayoutDetail(layout) {
  const decorations = Array.isArray(layout.layout?.decorations) ? layout.layout.decorations : [];
  const functional = Object.keys(layout.layout?.functional || {});
  const shot = `./assets/layouts/${encodeURIComponent(layout.id)}.svg`;
  catalog.classList.add("is-detail");
  summary.innerHTML = `<a class="copy back-link" href="#/layouts">Back to layouts</a>`;
  cards.innerHTML = `
    <article class="detail">
      <section class="detail-hero">
        <div class="preview-shell detail-preview">
          <img class="layout-shot" src="${escapeAttribute(shot)}" alt="${escapeAttribute(layout.name)} Agent Town layout screenshot" loading="lazy" />
        </div>
        <div class="detail-heading">
          <div class="meta">
            <span class="pill is-accent">${escapeHtml(layout.category || "Layout")}</span>
            <span class="pill">${escapeHtml(`${decorations.length} pieces`)}</span>
            <span class="pill">${escapeHtml(`${functional.length} buildings`)}</span>
            <span class="pill">${escapeHtml(layout.version || "0.1.0")}</span>
          </div>
          <h2>${escapeHtml(layout.name)}</h2>
          <p>${escapeHtml(layout.description)}</p>
          <div class="actions detail-actions">
            <button class="copy" type="button" data-copy-layout="${escapeAttribute(layout.id)}">Copy blueprint</button>
            ${renderExternalLink(getRegistrySnapshotUrl(layout, "layout"), "Registry snapshot")}
            ${renderExternalLink(getManifestSourceUrl(layout, "layout"), "Layout JSON")}
          </div>
        </div>
      </section>

      <section class="detail-grid">
        <section class="detail-panel">
          <h3>Layout source</h3>
          <dl class="kv">
            ${renderKeyValue("GitHub", getRegistrySnapshotUrl(layout, "layout"))}
            ${renderKeyValue("Layout path", `layouts/${layout.id}/layout.json`)}
            ${renderKeyValue("Theme", layout.layout?.themeId || "default")}
          </dl>
        </section>
        <section class="detail-panel">
          <h3>Requirements</h3>
          <div class="tags">${renderTags(Array.isArray(layout.requiredBuildings) ? layout.requiredBuildings : []) || "<p>No required buildings.</p>"}</div>
        </section>
      </section>

      ${renderListPanel("Decorations", decorations, (decoration) => `
        <section class="interface-row">
          <h4>${escapeHtml(decoration.id || decoration.itemId || "Decoration")}</h4>
          <div class="meta">${renderPills([decoration.itemId, `x: ${decoration.x}`, `y: ${decoration.y}`])}</div>
        </section>
      `, "No decorations are listed.")}
    </article>
  `;
  setTitle(layout.name);
}

function renderScaffoldDetail(recipe) {
  const buildings = Array.isArray(recipe.buildings) ? recipe.buildings : [];
  const requiredBuildings = buildings.filter((building) => building.required !== false);
  const localBindings = Array.isArray(recipe.localBindingsRequired) ? recipe.localBindingsRequired : [];
  const redactions = Array.isArray(recipe.redactions) ? recipe.redactions : [];
  const groupInboxes = Array.isArray(recipe.communication?.groupInboxes) ? recipe.communication.groupInboxes : [];
  const layout = recipe.layout || {};
  const decorations = Array.isArray(layout.decorations) ? layout.decorations : [];
  const functional = Object.keys(layout.functional || {});

  catalog.classList.add("is-detail");
  summary.innerHTML = `<a class="copy back-link" href="#/scaffolds">Back to scaffolds</a>`;
  cards.innerHTML = `
    <article class="detail">
      <section class="detail-hero">
        ${renderScaffoldVisual(recipe, "is-large")}
        <div class="detail-heading">
          <div class="meta">
            <span class="pill is-accent">${escapeHtml(recipe.category || "Scaffold")}</span>
            <span class="pill">${escapeHtml(countLabel(buildings.length, "building"))}</span>
            <span class="pill">${escapeHtml(countLabel(localBindings.length, "local binding"))}</span>
            <span class="pill">${escapeHtml(recipe.communication?.dm?.enabled ? "DMs enabled" : "DMs disabled")}</span>
            <span class="pill">${escapeHtml(recipe.version || "0.1.0")}</span>
          </div>
          <h2>${escapeHtml(recipe.name)}</h2>
          <p>${escapeHtml(recipe.description)}</p>
          <div class="actions detail-actions">
            <button class="copy" type="button" data-copy-scaffold="${escapeAttribute(recipe.id)}">Copy recipe</button>
            ${renderExternalLink(getRegistrySnapshotUrl(recipe, "scaffold"), "Registry snapshot")}
            ${renderExternalLink(getManifestSourceUrl(recipe, "scaffold"), "Recipe JSON")}
            ${renderExternalLink(recipe.source?.recipeUrl, "Published page")}
            ${renderExternalLink(recipe.source?.repositoryUrl, "Source repo")}
          </div>
        </div>
      </section>

      <section class="detail-grid">
        <section class="detail-panel">
          <h3>Communication</h3>
          <dl class="kv">
            ${renderKeyValue("DM body", recipe.communication?.dm?.body || "freeform")}
            ${renderKeyValue("Visibility", recipe.communication?.dm?.visibility || "workspace")}
            ${renderKeyValue("Requires related object", recipe.communication?.dm?.requireRelatedObject ? "yes" : "no")}
            ${renderKeyValue("Group inboxes", groupInboxes.join(", "))}
          </dl>
        </section>
        <section class="detail-panel">
          <h3>Sandbox</h3>
          <dl class="kv">
            ${renderKeyValue("Provider", recipe.sandbox?.provider || "local")}
            ${renderKeyValue("Isolation", recipe.sandbox?.isolation || "workspace")}
            ${renderKeyValue("Network", recipe.sandbox?.network || "default")}
            ${renderKeyValue("GPU", recipe.sandbox?.gpu?.enabled ? `${recipe.sandbox.gpu.count || 1} ${recipe.sandbox.gpu.provider || "GPU"}` : "not required")}
          </dl>
        </section>
        <section class="detail-panel">
          <h3>Layout</h3>
          <dl class="kv">
            ${renderKeyValue("Theme", layout.themeId || "")}
            ${renderKeyValue("Decorations", decorations.length ? String(decorations.length) : "")}
            ${renderKeyValue("Functional buildings", functional.length ? String(functional.length) : "")}
          </dl>
        </section>
        <section class="detail-panel">
          <h3>Local bindings</h3>
          <div class="tags">${renderTags(localBindings.map((binding) => `${binding.key}${binding.required ? " required" : ""}`)) || "<p>No local bindings listed.</p>"}</div>
        </section>
      </section>

      ${renderListPanel("Buildings", requiredBuildings, (building) => `
        <section class="interface-row">
          <h4>${escapeHtml(building.name || building.id)}</h4>
          <p>${escapeHtml(building.category || building.source || "")}</p>
          <div class="meta">${renderPills([building.id, building.source, building.version, building.enabled ? "enabled" : "", building.required === false ? "optional" : "required"])}</div>
        </section>
      `, "No required buildings are listed.")}

      ${redactions.length ? renderListPanel("Redactions", redactions, (entry) => `
        <section class="interface-row">
          <p>${escapeHtml(entry)}</p>
        </section>
      `, "") : ""}
    </article>
  `;
  setTitle(recipe.name);
}

function setActiveTab(tab) {
  state.tab = tab;
  document.querySelectorAll("[data-tab]").forEach((button) => {
    const active = button.getAttribute("data-tab") === tab;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", active ? "true" : "false");
  });
}

function render() {
  const registry = state.registry || {};
  const route = parseRoute();
  state.tab = route.tab;
  setActiveTab(route.tab);

  if (route.view === "building") {
    const building = (registry.buildings || []).find((candidate) => candidate.id === route.id);
    if (building) {
      renderBuildingDetail(building);
    } else {
      renderNotFound(route);
    }
    return;
  }

  if (route.view === "layout") {
    const layout = (registry.layouts || []).find((candidate) => candidate.id === route.id);
    if (layout) {
      renderLayoutDetail(layout);
    } else {
      renderNotFound(route);
    }
    return;
  }

  if (route.view === "scaffold") {
    const recipe = (registry.recipes || []).find((candidate) => candidate.id === route.id);
    if (recipe) {
      renderScaffoldDetail(recipe);
    } else {
      renderNotFound(route);
    }
    return;
  }

  catalog.classList.remove("is-detail");
  setTitle("");
  const entries = state.tab === "layouts"
    ? (Array.isArray(registry.layouts) ? registry.layouts : [])
    : state.tab === "scaffolds"
      ? (Array.isArray(registry.recipes) ? registry.recipes : [])
      : (Array.isArray(registry.buildings) ? registry.buildings : []);
  const filtered = entries
    .map((entry, index) => ({ entry, index, score: searchScore(entry, state.query) }))
    .filter((result) => result.score > 0)
    .sort((left, right) => (
      right.score - left.score
      || text(left.entry.name).localeCompare(text(right.entry.name))
      || left.index - right.index
    ))
    .map((result) => result.entry);
  const totalLayouts = Array.isArray(registry.layouts) ? registry.layouts.length : 0;
  const totalBuildings = Array.isArray(registry.buildings) ? registry.buildings.length : 0;
  const totalScaffolds = Array.isArray(registry.recipes) ? registry.recipes.length : 0;
  const activeLabel = state.tab === "scaffolds"
    ? countLabel(filtered.length, "scaffold")
    : state.tab === "layouts"
      ? countLabel(filtered.length, "layout")
      : countLabel(filtered.length, "building");
  summary.textContent = `${activeLabel} shown · ${countLabel(totalBuildings, "building")} · ${countLabel(totalLayouts, "layout")} · ${countLabel(totalScaffolds, "scaffold")}`;
  cards.innerHTML = filtered.length
    ? filtered.map((entry) => state.tab === "layouts" ? renderLayoutCard(entry) : state.tab === "scaffolds" ? renderScaffoldCard(entry) : renderBuildingCard(entry)).join("")
    : `<article class="card empty-card"><h2>No matches</h2><p>Try a broader search.</p></article>`;
}

document.querySelectorAll("[data-tab]").forEach((button) => {
  button.addEventListener("click", () => {
    const tab = button.getAttribute("data-tab") || "layouts";
    state.tab = tab;
    location.hash = `#/${tab}`;
  });
});

cards.addEventListener("click", (event) => {
  const copyLayoutButton = event.target.closest("[data-copy-layout]");
  if (copyLayoutButton) {
    const layout = (state.registry?.layouts || []).find((candidate) => candidate.id === copyLayoutButton.getAttribute("data-copy-layout"));
    if (layout) {
      void copyJson(layout.layout || layout);
    }
    return;
  }

  const copyBuildingButton = event.target.closest("[data-copy-building]");
  if (copyBuildingButton) {
    const building = (state.registry?.buildings || []).find((candidate) => candidate.id === copyBuildingButton.getAttribute("data-copy-building"));
    if (building) {
      void copyJson(building);
    }
    return;
  }

  const copyScaffoldButton = event.target.closest("[data-copy-scaffold]");
  if (copyScaffoldButton) {
    const recipe = (state.registry?.recipes || []).find((candidate) => candidate.id === copyScaffoldButton.getAttribute("data-copy-scaffold"));
    if (recipe) {
      void copyJson(recipe);
    }
    return;
  }

  if (event.target.closest("a, button, input, textarea, select")) {
    return;
  }

  const card = event.target.closest("[data-card-href]");
  if (card) {
    location.hash = card.getAttribute("data-card-href");
  }
});

cards.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") {
    return;
  }
  if (event.target.closest("a, button, input, textarea, select")) {
    return;
  }
  const card = event.target.closest("[data-card-href]");
  if (card) {
    event.preventDefault();
    location.hash = card.getAttribute("data-card-href");
  }
});

accountPanel?.addEventListener("click", async (event) => {
  const logoutButton = event.target.closest("[data-account-logout]");
  if (!logoutButton) {
    return;
  }

  try {
    logoutButton.disabled = true;
    const response = await fetch("/api/session/logout", {
      method: "POST",
    });
    if (!response.ok) {
      throw new Error(`Logout failed (${response.status}).`);
    }
    state.session = { authenticated: false, account: null };
    renderAccountPanel();
  } catch (error) {
    window.alert(error.message || String(error));
  } finally {
    logoutButton.disabled = false;
  }
});

search.addEventListener("input", () => {
  state.query = search.value;
  render();
});

window.addEventListener("hashchange", render);

try {
  const response = await fetch("/api/session", { cache: "no-store" });
  if (response.ok) {
    state.authAvailable = true;
    state.session = await response.json();
  } else {
    state.authAvailable = false;
    state.session = { authenticated: false, account: null };
  }
} catch {
  state.authAvailable = false;
  state.session = { authenticated: false, account: null };
}

renderAccountPanel();

try {
  const response = await fetch("./registry.json", { cache: "no-store" });
  state.registry = await response.json();
  render();
} catch (error) {
  summary.textContent = `Could not load registry.json: ${error.message || error}`;
}
