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

function layoutBounds(decorations) {
  if (!decorations.length) {
    return { x: 0, y: 0, width: 120, height: 80 };
  }

  const minX = Math.min(...decorations.map((decoration) => Number(decoration.x) || 0));
  const minY = Math.min(...decorations.map((decoration) => Number(decoration.y) || 0));
  const maxX = Math.max(...decorations.map((decoration) => (Number(decoration.x) || 0) + (decoration.itemId === "shed" ? 56 : 28)));
  const maxY = Math.max(...decorations.map((decoration) => (Number(decoration.y) || 0) + 28));
  return { x: minX, y: minY, width: Math.max(28, maxX - minX), height: Math.max(28, maxY - minY) };
}

function renderLayoutPreview(layout) {
  const decorations = Array.isArray(layout.layout?.decorations) ? layout.layout.decorations : [];
  const bounds = layoutBounds(decorations);
  const pad = 18;
  const width = bounds.width + pad * 2;
  const height = bounds.height + pad * 2;
  const cells = decorations.map((decoration) => {
    const itemId = text(decoration.itemId || "decor");
    const itemWidth = itemId === "shed" ? 56 : 28;
    const itemHeight = 28;
    const left = (((Number(decoration.x) || 0) - bounds.x + pad) / width) * 100;
    const top = (((Number(decoration.y) || 0) - bounds.y + pad) / height) * 100;
    return `<i class="${escapeHtml(itemId)}" style="left:${left.toFixed(2)}%;top:${top.toFixed(2)}%;width:${((itemWidth / width) * 100).toFixed(2)}%;height:${((itemHeight / height) * 100).toFixed(2)}%;"></i>`;
  }).join("");
  return `<div class="preview">${cells}</div>`;
}

async function copyJson(value) {
  const json = JSON.stringify(value, null, 2);
  try {
    await navigator.clipboard.writeText(json);
  } catch {
    window.prompt("Copy blueprint JSON", json);
  }
}

function renderLayoutCard(layout) {
  const tags = (Array.isArray(layout.tags) ? layout.tags : []).slice(0, 6);
  const decorations = Array.isArray(layout.layout?.decorations) ? layout.layout.decorations : [];
  return `
    <article class="card">
      ${renderLayoutPreview(layout)}
      <div class="meta">
        <span class="pill">${escapeHtml(layout.category || "Layout")}</span>
        <span class="pill">${escapeHtml(`${decorations.length} pieces`)}</span>
        <span class="pill">${escapeHtml(layout.version || "0.1.0")}</span>
      </div>
      <h2>${escapeHtml(layout.name)}</h2>
      <p>${escapeHtml(layout.description)}</p>
      <div class="tags">${tags.map((tag) => `<span class="pill">${escapeHtml(tag)}</span>`).join("")}</div>
      <div class="actions">
        <button class="copy" type="button" data-copy-layout="${escapeHtml(layout.id)}">Copy blueprint</button>
      </div>
    </article>
  `;
}

function renderBuildingCard(building) {
  const tags = (Array.isArray(building.keywords) ? building.keywords : []).slice(0, 6);
  return `
    <article class="card">
      <div class="meta">
        <span class="pill">${escapeHtml(building.category || "Building")}</span>
        <span class="pill">${escapeHtml(building.trust || "manifest-only")}</span>
        <span class="pill">${escapeHtml(building.version || "0.1.0")}</span>
      </div>
      <h2>${escapeHtml(building.name)}</h2>
      <p>${escapeHtml(building.description)}</p>
      <div class="tags">${tags.map((tag) => `<span class="pill">${escapeHtml(tag)}</span>`).join("")}</div>
      <div class="actions">
        <button class="copy" type="button" data-copy-building="${escapeHtml(building.id)}">Copy manifest</button>
      </div>
    </article>
  `;
}

function render() {
  const registry = state.registry || {};
  const entries = state.tab === "layouts"
    ? (Array.isArray(registry.layouts) ? registry.layouts : [])
    : (Array.isArray(registry.buildings) ? registry.buildings : []);
  const filtered = entries.filter((entry) => matches(entry, state.query));
  summary.textContent = `${filtered.length} ${state.tab} shown from ${registry.name || "BuildingHub"}`;
  cards.innerHTML = filtered.length
    ? filtered.map((entry) => state.tab === "layouts" ? renderLayoutCard(entry) : renderBuildingCard(entry)).join("")
    : `<article class="card"><h2>No matches</h2><p>Try a broader search.</p></article>`;
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
    state.tab = button.getAttribute("data-tab") || "layouts";
    document.querySelectorAll("[data-tab]").forEach((candidate) => {
      candidate.classList.toggle("is-active", candidate === button);
    });
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
  render();
} catch (error) {
  summary.textContent = `Could not load registry.json: ${error.message || error}`;
}
