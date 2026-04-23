const state = {
  registry: null,
  tab: "buildings",
  query: "",
};

const cards = document.querySelector("#cards");
const summary = document.querySelector("#summary");
const search = document.querySelector("#search");

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
  const nested = collectSearchText(entry).join(" ").toLowerCase();

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

function renderLayoutCard(layout) {
  const tags = getDisplayTags(Array.isArray(layout.tags) ? layout.tags : []);
  const decorations = Array.isArray(layout.layout?.decorations) ? layout.layout.decorations : [];
  const functionalCount = Object.keys(layout.layout?.functional || {}).length;
  const shot = `./assets/layouts/${encodeURIComponent(layout.id)}.svg`;
  return `
    <article class="card">
      <div class="preview-shell">
        <img class="layout-shot" src="${escapeHtml(shot)}" alt="${escapeHtml(layout.name)} Agent Town layout screenshot" loading="lazy" />
      </div>
      <div class="meta">
        <span class="pill is-accent">${escapeHtml(layout.category || "Layout")}</span>
        <span class="pill">${escapeHtml(`${decorations.length} pieces`)}</span>
        <span class="pill">${escapeHtml(`${functionalCount} buildings`)}</span>
        <span class="pill">${escapeHtml(layout.version || "0.1.0")}</span>
      </div>
      <h2>${escapeHtml(layout.name)}</h2>
      <p>${escapeHtml(layout.description)}</p>
      <div class="tags">${renderTags(tags)}</div>
      <div class="actions">
        <button class="copy" type="button" data-copy-layout="${escapeHtml(layout.id)}">Copy blueprint</button>
      </div>
    </article>
  `;
}

function renderBuildingCard(building) {
  const tags = getDisplayTags(Array.isArray(building.keywords) ? building.keywords : []);
  const shape = normalizeClassName(building.visual?.shape || building.icon || "plugin");
  return `
    <article class="card">
      <div class="building-mark building-shape-${escapeHtml(shape)}" aria-hidden="true">
        <span class="building-mark-grid"></span>
        <span class="building-mark-shadow"></span>
        <span class="building-mark-roof"></span>
        <span class="building-mark-body">
          <span class="building-mark-window"></span>
          <span class="building-mark-window"></span>
          <span class="building-mark-door"></span>
        </span>
        <span class="building-mark-sign">${escapeHtml(building.category || "Building")}</span>
      </div>
      <div class="meta">
        <span class="pill is-accent">${escapeHtml(building.category || "Building")}</span>
        <span class="pill">${escapeHtml(building.trust || "manifest-only")}</span>
        <span class="pill">${escapeHtml(building.version || "0.1.0")}</span>
      </div>
      <h2>${escapeHtml(building.name)}</h2>
      <p>${escapeHtml(building.description)}</p>
      <div class="tags">${renderTags(tags)}</div>
      <div class="actions">
        <button class="copy" type="button" data-copy-building="${escapeHtml(building.id)}">Copy manifest</button>
      </div>
    </article>
  `;
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
  const entries = state.tab === "layouts"
    ? (Array.isArray(registry.layouts) ? registry.layouts : [])
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
  summary.textContent = `${filtered.length} ${state.tab} shown · ${totalLayouts} layouts · ${totalBuildings} buildings`;
  cards.innerHTML = filtered.length
    ? filtered.map((entry) => state.tab === "layouts" ? renderLayoutCard(entry) : renderBuildingCard(entry)).join("")
    : `<article class="card empty-card"><h2>No matches</h2><p>Try a broader search.</p></article>`;
  document.querySelectorAll("[data-copy-layout]").forEach((button) => {
    button.addEventListener("click", () => {
      const layout = (registry.layouts || []).find((candidate) => candidate.id === button.getAttribute("data-copy-layout"));
      if (layout) {
        void copyJson(layout.layout || layout);
      }
    });
  });
  document.querySelectorAll("[data-copy-building]").forEach((button) => {
    button.addEventListener("click", () => {
      const building = (registry.buildings || []).find((candidate) => candidate.id === button.getAttribute("data-copy-building"));
      if (building) {
        void copyJson(building);
      }
    });
  });
}

document.querySelectorAll("[data-tab]").forEach((button) => {
  button.addEventListener("click", () => {
    setActiveTab(button.getAttribute("data-tab") || "layouts");
    render();
  });
});

search.addEventListener("input", () => {
  state.query = search.value;
  render();
});

try {
  const response = await fetch("./registry.json", { cache: "no-store" });
  state.registry = await response.json();
  setActiveTab(state.tab);
  render();
} catch (error) {
  summary.textContent = `Could not load registry.json: ${error.message || error}`;
}
