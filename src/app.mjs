import {
  GROUP_STORAGE_KEY,
  THEME_STORAGE_KEY,
  VIEW_MODE_STORAGE_KEY,
  formatBytes,
  formatBytesPerSecond,
  formatRelativeTime,
  getStoredGroup,
  getStoredTheme,
  getStoredViewMode,
  mergeNodeLists,
  normalizeNodes,
  normalizeRealtimeNodes,
  summarizeNodes,
  unwrapApiEnvelope,
} from "./theme-data.mjs";

const REALTIME_REFRESH_INTERVAL_MS = 5_000;

const mockNodes = [
  {
    uuid: "hortus-zju",
    name: "ZJU Lab",
    group: "Research",
    region: "Hangzhou",
    online: true,
    updated_at: new Date(Date.now() - 45_000).toISOString(),
    cpu: 32,
    memory: { used: 5.8 * 1024 ** 3, total: 16 * 1024 ** 3 },
    disk: { used: 96 * 1024 ** 3, total: 256 * 1024 ** 3 },
    network: { up: 64 * 1024, down: 420 * 1024 },
    load: [0.46, 0.38, 0.33],
    os: "Debian",
    arch: "amd64",
    tags: ["lab", "api"],
  },
  {
    uuid: "hortus-edge",
    name: "Edge Orchard",
    group: "Edge",
    region: "Singapore",
    online: true,
    updated_at: new Date(Date.now() - 180_000).toISOString(),
    cpu: 61,
    memory: { used: 1.8 * 1024 ** 3, total: 4 * 1024 ** 3 },
    disk: { used: 28 * 1024 ** 3, total: 64 * 1024 ** 3 },
    network: { up: 318 * 1024, down: 1.2 * 1024 ** 2 },
    load: [0.82, 0.78, 0.65],
    os: "Ubuntu",
    arch: "arm64",
    tags: ["cdn"],
  },
  {
    uuid: "hortus-archive",
    name: "Archive Bed",
    group: "Storage",
    region: "Los Angeles",
    online: false,
    updated_at: new Date(Date.now() - 8_400_000).toISOString(),
    cpu: 0,
    memory: { used: 0, total: 32 * 1024 ** 3 },
    disk: { used: 1.4 * 1024 ** 4, total: 2 * 1024 ** 4 },
    network: { up: 0, down: 0 },
    load: [0, 0, 0],
    os: "AlmaLinux",
    arch: "amd64",
    tags: ["backup"],
  },
];

const state = {
  nodes: normalizeNodes(mockNodes),
  filteredGroup: "all",
  viewMode: "grid",
  publicInfo: null,
  socket: null,
  realtimeTimer: null,
  lastRefresh: null,
  usingMock: true,
};

const elements = {
  app: document.querySelector("#app"),
  siteName: document.querySelector("[data-site-name]"),
  siteDescription: document.querySelector("[data-site-description]"),
  summaryOnline: document.querySelector("[data-summary-online]"),
  summaryOffline: document.querySelector("[data-summary-offline]"),
  summaryCpu: document.querySelector("[data-summary-cpu]"),
  summaryMemory: document.querySelector("[data-summary-memory]"),
  summaryTraffic: document.querySelector("[data-summary-traffic]"),
  groupFilter: document.querySelector("[data-group-filter]"),
  nodeGrid: document.querySelector("[data-node-grid]"),
  nodeTableWrap: document.querySelector("[data-node-table-wrap]"),
  emptyState: document.querySelector("[data-empty-state]"),
  connectionState: document.querySelector("[data-connection-state]"),
  lastRefresh: document.querySelector("[data-last-refresh]"),
  refreshButton: document.querySelector("[data-refresh-button]"),
  themeToggle: document.querySelector("[data-theme-toggle]"),
  viewButtons: [...document.querySelectorAll("[data-view-button]")],
};

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function applyTheme(theme) {
  const resolvedTheme =
    theme === "system"
      ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
      : theme;

  document.documentElement.dataset.theme = resolvedTheme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", resolvedTheme === "dark" ? "#1C1C1C" : "#F8F5EC");
}

function cycleTheme() {
  const current = getStoredTheme(localStorage);
  const next = current === "light" ? "dark" : current === "dark" ? "system" : "light";
  localStorage.setItem(THEME_STORAGE_KEY, next);
  applyTheme(next);
}

function setViewMode(viewMode) {
  state.viewMode = viewMode;
  localStorage.setItem(VIEW_MODE_STORAGE_KEY, viewMode);
  elements.app.dataset.view = viewMode;
  window.scrollTo({ left: 0 });
  elements.viewButtons.forEach((button) => {
    button.dataset.active = String(button.dataset.viewButton === viewMode);
  });
}

function setGroup(group) {
  state.filteredGroup = group;
  localStorage.setItem(GROUP_STORAGE_KEY, group);
  window.scrollTo({ left: 0 });
  render();
}

function getVisibleNodes() {
  if (state.filteredGroup === "all") {
    return state.nodes;
  }

  return state.nodes.filter((node) => node.group === state.filteredGroup);
}

function meterClass(value) {
  if (value >= 85) return "is-critical";
  if (value >= 68) return "is-warn";
  return "";
}

function renderMeter(label, value) {
  const safeValue = Math.max(0, Math.min(100, Number(value) || 0));
  return `
    <div class="meter ${meterClass(safeValue)}">
      <div class="meter-row">
        <span>${label}</span>
        <strong>${Math.round(safeValue)}%</strong>
      </div>
      <div class="meter-track" aria-hidden="true">
        <span style="width: ${safeValue}%"></span>
      </div>
    </div>
  `;
}

function renderNodeCard(node) {
  const tags = node.tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join("");
  const updatedAt = formatRelativeTime(node.updatedAt);

  return `
    <article class="node-card ${node.online ? "is-online" : "is-offline"}">
      <header class="node-card-header">
        <div>
          <p class="node-kicker">${escapeHtml(node.group)} · ${escapeHtml(node.region)}</p>
          <h2>${escapeHtml(node.name)}</h2>
        </div>
        <span class="status-pill">
          <i aria-hidden="true"></i>${node.online ? "Online" : "Offline"}
        </span>
      </header>

      <div class="node-meta">
        <span>${escapeHtml(node.os || "System")}${node.arch ? ` · ${escapeHtml(node.arch)}` : ""}</span>
        <span>Seen ${updatedAt}</span>
      </div>

      <div class="meter-stack">
        ${renderMeter("CPU", node.cpu)}
        ${renderMeter("RAM", node.memory.percent)}
        ${renderMeter("Disk", node.disk.percent)}
      </div>

      <div class="node-stats">
        <div>
          <span>Upload</span>
          <strong>${formatBytesPerSecond(node.network.up)}</strong>
        </div>
        <div>
          <span>Download</span>
          <strong>${formatBytesPerSecond(node.network.down)}</strong>
        </div>
        <div>
          <span>Load</span>
          <strong>${node.load.map((value) => value.toFixed(2)).join(" / ")}</strong>
        </div>
      </div>

      ${tags ? `<div class="tag-row">${tags}</div>` : ""}
    </article>
  `;
}

function renderTable(nodes) {
  const rows = nodes
    .map((node) => `
      <tr>
        <td>
          <div class="table-node-name">
            <span class="status-dot ${node.online ? "is-online" : "is-offline"}" aria-hidden="true"></span>
            <strong>${escapeHtml(node.name)}</strong>
          </div>
          <span>${escapeHtml(node.region)}</span>
        </td>
        <td>${escapeHtml(node.group)}</td>
        <td>${Math.round(node.cpu)}%</td>
        <td>${Math.round(node.memory.percent)}%</td>
        <td>${Math.round(node.disk.percent)}%</td>
        <td>${formatBytesPerSecond(node.network.up)} / ${formatBytesPerSecond(node.network.down)}</td>
        <td>${formatRelativeTime(node.updatedAt)}</td>
      </tr>
    `)
    .join("");

  elements.nodeTableWrap.innerHTML = `
    <table class="nodes-table">
      <thead>
        <tr>
          <th>Node</th>
          <th>Group</th>
          <th>CPU</th>
          <th>RAM</th>
          <th>Disk</th>
          <th>Network</th>
          <th>Seen</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function renderGroups() {
  const groups = ["all", ...new Set(state.nodes.map((node) => node.group).filter(Boolean))];
  elements.groupFilter.innerHTML = groups
    .map((group) => {
      const label = group === "all" ? "All" : group;
      const count = group === "all" ? state.nodes.length : state.nodes.filter((node) => node.group === group).length;
      return `
        <button type="button" data-group="${escapeHtml(group)}" data-active="${group === state.filteredGroup}">
          ${escapeHtml(label)}
          <span>${count}</span>
        </button>
      `;
    })
    .join("");

  elements.groupFilter.querySelectorAll("[data-group]").forEach((button) => {
    button.addEventListener("click", () => setGroup(button.dataset.group));
  });
}

function renderSummary() {
  const summary = summarizeNodes(state.nodes);
  elements.summaryOnline.textContent = `${summary.online} / ${summary.total}`;
  elements.summaryOffline.textContent = `${summary.offline} offline`;
  elements.summaryCpu.textContent = `${summary.cpu}%`;
  elements.summaryMemory.textContent = `${summary.memory}%`;
  elements.summaryTraffic.textContent = `${formatBytesPerSecond(summary.networkUp)} / ${formatBytesPerSecond(summary.networkDown)}`;
}

function renderStatus() {
  elements.connectionState.textContent = state.usingMock
    ? "Preview data active. Connect inside Komari for live nodes."
    : "Live data connected.";
  elements.lastRefresh.textContent = state.lastRefresh ? `Updated ${formatRelativeTime(state.lastRefresh)}` : "";
}

function render() {
  renderSummary();
  renderGroups();
  renderStatus();

  const visibleNodes = getVisibleNodes();
  elements.nodeGrid.innerHTML = visibleNodes.map(renderNodeCard).join("");
  renderTable(visibleNodes);
  elements.emptyState.hidden = visibleNodes.length > 0;
}

async function fetchJson(url) {
  const response = await fetch(url, { credentials: "same-origin" });
  if (!response.ok) {
    throw new Error(`${url} returned ${response.status}`);
  }
  return response.json();
}

function applyPublicInfo(info) {
  const publicInfo = unwrapApiEnvelope(info);
  const siteName = publicInfo?.sitename || publicInfo?.site_name || publicInfo?.name || publicInfo?.title;
  const description = publicInfo?.description || publicInfo?.desc;

  if (siteName) {
    elements.siteName.textContent = siteName;
  }

  if (description) {
    elements.siteDescription.textContent = description;
  }
}

async function refreshNodes() {
  elements.refreshButton.disabled = true;

  try {
    const [publicInfo, nodePayload] = await Promise.all([
      fetchJson("/api/public").catch(() => null),
      fetchJson("/api/nodes"),
    ]);

    state.publicInfo = publicInfo;
    state.nodes = normalizeNodes(nodePayload);
    state.usingMock = false;
    state.lastRefresh = new Date();
    applyPublicInfo(publicInfo);
  } catch (error) {
    console.warn("Hortus theme is using preview data:", error);
    if (!state.nodes.length) {
      state.nodes = normalizeNodes(mockNodes);
    }
    state.usingMock = true;
    state.lastRefresh = new Date();
  } finally {
    elements.refreshButton.disabled = false;
    render();
  }
}

function connectRealtime() {
  if (!("WebSocket" in window)) {
    return;
  }

  if (state.socket) {
    state.socket.close();
  }
  clearInterval(state.realtimeTimer);
  state.realtimeTimer = null;

  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const socket = new WebSocket(`${protocol}//${window.location.host}/api/clients`);
  state.socket = socket;

  const requestRealtimeSnapshot = () => {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send("get");
    }
  };

  socket.addEventListener("open", () => {
    requestRealtimeSnapshot();
    clearInterval(state.realtimeTimer);
    state.realtimeTimer = setInterval(requestRealtimeSnapshot, REALTIME_REFRESH_INTERVAL_MS);
  });

  socket.addEventListener("message", (event) => {
    try {
      const payload = JSON.parse(event.data);
      const realtimeNodes = normalizeRealtimeNodes(payload.data || payload);
      state.nodes = mergeNodeLists(state.nodes, realtimeNodes);
      state.usingMock = false;
      state.lastRefresh = new Date();
      render();
    } catch (error) {
      console.warn("Failed to parse Komari realtime payload:", error);
    }
  });

  socket.addEventListener("close", () => {
    if (state.socket === socket) {
      clearInterval(state.realtimeTimer);
      state.realtimeTimer = null;
      state.socket = null;
    }
  });
}

function bindEvents() {
  elements.refreshButton.addEventListener("click", refreshNodes);
  elements.themeToggle.addEventListener("click", cycleTheme);
  elements.viewButtons.forEach((button) => {
    button.addEventListener("click", () => setViewMode(button.dataset.viewButton));
  });

  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    applyTheme(getStoredTheme(localStorage));
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      refreshNodes();
      connectRealtime();
    }
  });
}

function boot() {
  state.filteredGroup = getStoredGroup(localStorage);
  state.viewMode = getStoredViewMode(localStorage);
  applyTheme(getStoredTheme(localStorage));
  setViewMode(state.viewMode);
  bindEvents();
  render();
  refreshNodes();
  connectRealtime();
}

boot();
