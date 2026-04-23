const state = {
  registry: null,
  tab: "layouts",
  query: "",
};

const cards = document.querySelector("#cards");
const summary = document.querySelector("#summary");
const search = document.querySelector("#search");

function text(value) {
  return String(value ?? "");
}

function matches(entry, query) {
  if (!query) {
    return true;
  }

  const haystack = [
    entry.id,
    entry.name,
    entry.category,
    entry.description,
    entry.status,
    entry.trust,
    ...(Array.isArray(entry.tags) ? entry.tags : []),
    ...(Array.isArray(entry.keywords) ? entry.keywords : []),
    ...(Array.isArray(entry.requiredBuildings) ? entry.requiredBuildings : []),
  ].join(" ").toLowerCase();
  return haystack.includes(query.toLowerCase());
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

function renderLayoutCard(layout) {
  const tags = (Array.isArray(layout.tags) ? layout.tags : []).slice(0, 6);
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
  const tags = (Array.isArray(building.keywords) ? building.keywords : []).slice(0, 6);
  const initial = text(building.name || building.id).slice(0, 1).toUpperCase();
  return `
    <article class="card">
      <div class="building-mark" aria-hidden="true">
        <div class="building-icon">${escapeHtml(initial)}</div>
        <span>${escapeHtml(building.category || "Building")}</span>
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
  const filtered = entries.filter((entry) => matches(entry, state.query));
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
