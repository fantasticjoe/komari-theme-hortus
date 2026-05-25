export const THEME_STORAGE_KEY = "appearance";
export const VIEW_MODE_STORAGE_KEY = "nodeViewMode";
export const GROUP_STORAGE_KEY = "nodeSelectedGroup";

function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function firstValue(...values) {
  return values.find((value) => value !== undefined && value !== null);
}

function percent(used, total, explicit) {
  if (explicit !== undefined && explicit !== null) {
    return round(toNumber(explicit));
  }

  const numericUsed = toNumber(used);
  const numericTotal = toNumber(total);

  if (numericTotal <= 0) {
    return 0;
  }

  return round((numericUsed / numericTotal) * 100);
}

function round(value, precision = 2) {
  const factor = 10 ** precision;
  return Math.round(toNumber(value) * factor) / factor;
}

function normalizeResource(rawResource, totalKeys = [], usedKeys = [], percentKeys = []) {
  const raw = rawResource && typeof rawResource === "object" ? rawResource : {};
  const total = firstValue(raw.total, ...totalKeys);
  const used = firstValue(raw.used, ...usedKeys);
  const explicitPercent = firstValue(raw.percent, raw.usagePercent, raw.usedPercent, ...percentKeys);

  return {
    used: toNumber(used),
    total: toNumber(total),
    percent: percent(used, total, explicitPercent),
  };
}

function normalizeLoad(rawLoad) {
  if (Array.isArray(rawLoad)) {
    return rawLoad.slice(0, 3).map((value) => round(value));
  }

  if (rawLoad && typeof rawLoad === "object") {
    return [
      firstValue(rawLoad.load1, rawLoad.one, rawLoad["1"]),
      firstValue(rawLoad.load5, rawLoad.five, rawLoad["5"]),
      firstValue(rawLoad.load15, rawLoad.fifteen, rawLoad["15"]),
    ].map((value) => round(value));
  }

  const value = toNumber(rawLoad);
  return value ? [round(value), 0, 0] : [0, 0, 0];
}

function normalizeTags(tags) {
  if (Array.isArray(tags)) {
    return tags.filter(Boolean).map(String);
  }

  if (typeof tags !== "string") {
    return [];
  }

  return tags
    .split(/[;,，\s]+/)
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function inferOnline(rawNode) {
  const explicit = firstValue(rawNode.online, rawNode.is_online, rawNode.isOnline);
  if (typeof explicit === "boolean") {
    return explicit;
  }

  if (typeof explicit === "string") {
    return explicit.toLowerCase() !== "false";
  }

  if (rawNode.status) {
    return String(rawNode.status).toLowerCase() !== "offline";
  }

  return true;
}

function hasApiEnvelope(payload) {
  return Boolean(
    payload &&
      typeof payload === "object" &&
      !Array.isArray(payload) &&
      "data" in payload &&
      ("status" in payload || "message" in payload || "code" in payload),
  );
}

function isObjectMap(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function normalizeNode(rawNode = {}, fallbackId = "") {
  const id = String(firstValue(rawNode.uuid, rawNode.id, rawNode.client, rawNode.name, fallbackId, "unknown"));
  const cpu = firstValue(
    rawNode.cpu?.usage,
    rawNode.cpu?.percent,
    rawNode.cpu,
    rawNode.cpu_usage,
    rawNode.cpuUsage,
    0,
  );
  const memory = normalizeResource(
    firstValue(rawNode.memory, rawNode.ram, {}),
    [rawNode.mem_total, rawNode.ram_total, rawNode.memory_total],
    [rawNode.mem_used, rawNode.ram_used, rawNode.memory_used],
    [rawNode.mem_percent, rawNode.ram_percent, rawNode.memory_percent, rawNode.ram],
  );
  const disk = normalizeResource(
    firstValue(rawNode.disk, {}),
    [rawNode.disk_total],
    [rawNode.disk_used],
    [rawNode.disk_percent],
  );
  const network = firstValue(rawNode.network, {});

  return {
    id,
    uuid: id,
    name: String(firstValue(rawNode.name, rawNode.alias, rawNode.hostname, id)),
    group: String(firstValue(rawNode.group, rawNode.node_group, "Ungrouped") || "Ungrouped"),
    region: String(firstValue(rawNode.region, rawNode.location, "Earth") || "Earth"),
    online: inferOnline(rawNode),
    cpu: round(cpu),
    memory,
    disk,
    swap: normalizeResource(
      firstValue(rawNode.swap, {}),
      [rawNode.swap_total],
      [rawNode.swap_used],
      [rawNode.swap_percent],
    ),
    network: {
      up: toNumber(firstValue(network.up, network.out, rawNode.net_out, rawNode.network_up)),
      down: toNumber(firstValue(network.down, network.in, rawNode.net_in, rawNode.network_down)),
      totalUp: toNumber(firstValue(network.totalUp, network.total_up, rawNode.net_total_up)),
      totalDown: toNumber(firstValue(network.totalDown, network.total_down, rawNode.net_total_down)),
    },
    load: normalizeLoad(firstValue(rawNode.load, rawNode.loads)),
    os: String(firstValue(rawNode.os, rawNode.system, "")),
    arch: String(firstValue(rawNode.arch, "")),
    cpuName: String(firstValue(rawNode.cpu_name, rawNode.cpuName, "")),
    cpuCores: toNumber(firstValue(rawNode.cpu_cores, rawNode.cpuCores)),
    uptime: toNumber(rawNode.uptime),
    process: toNumber(rawNode.process),
    connections: {
      tcp: toNumber(firstValue(rawNode.connections?.tcp, rawNode.connections, rawNode.tcp)),
      udp: toNumber(firstValue(rawNode.connections?.udp, rawNode.connections_udp, rawNode.udp)),
    },
    tags: normalizeTags(rawNode.tags),
    updatedAt: firstValue(rawNode.updated_at, rawNode.updatedAt, rawNode.time, ""),
    raw: rawNode,
  };
}

export function normalizeNodes(rawNodes = []) {
  if (hasApiEnvelope(rawNodes)) {
    return normalizeNodes(rawNodes.data);
  }

  if (Array.isArray(rawNodes)) {
    return rawNodes.map((node, index) => normalizeNode(node, String(index)));
  }

  if (isObjectMap(rawNodes?.data?.data)) {
    return normalizeRealtimeNodes(rawNodes.data);
  }

  if (isObjectMap(rawNodes?.data) && (Array.isArray(rawNodes.online) || "online" in rawNodes)) {
    return normalizeRealtimeNodes(rawNodes);
  }

  if (isObjectMap(rawNodes?.data)) {
    return normalizeNodes(rawNodes.data);
  }

  if (isObjectMap(rawNodes)) {
    return Object.entries(rawNodes)
      .filter(([, node]) => isObjectMap(node))
      .map(([id, node]) => normalizeNode({ ...node, uuid: firstValue(node.uuid, id) }, id));
  }

  return [];
}

export function normalizeRealtimeNodes(payload = {}) {
  const unwrappedPayload = hasApiEnvelope(payload) ? payload.data : payload;
  const onlineSet = new Set(unwrappedPayload.online || []);
  const data = unwrappedPayload.data || unwrappedPayload;

  if (!isObjectMap(data)) {
    return [];
  }

  return Object.entries(data)
    .filter(([, node]) => isObjectMap(node))
    .map(([id, node]) =>
      normalizeNode({ ...node, uuid: firstValue(node.uuid, id), online: onlineSet.size ? onlineSet.has(id) : node.online }, id),
    );
}

export function mergeNodeLists(baseNodes = [], realtimeNodes = []) {
  const realtimeById = new Map(realtimeNodes.map((node) => [node.id, node]));
  const mergedIds = new Set();

  const mergedNodes = baseNodes.map((baseNode) => {
    const liveNode = realtimeById.get(baseNode.id);
    if (!liveNode) {
      return baseNode;
    }

    mergedIds.add(baseNode.id);

    return {
      ...baseNode,
      online: liveNode.online,
      cpu: liveNode.cpu,
      memory: liveNode.memory,
      disk: liveNode.disk,
      swap: liveNode.swap,
      network: liveNode.network,
      load: liveNode.load,
      uptime: liveNode.uptime || baseNode.uptime,
      process: liveNode.process || baseNode.process,
      connections: liveNode.connections,
      updatedAt: liveNode.updatedAt || baseNode.updatedAt,
      raw: { ...baseNode.raw, ...liveNode.raw },
    };
  });

  return [
    ...mergedNodes,
    ...realtimeNodes.filter((node) => !mergedIds.has(node.id) && !baseNodes.some((baseNode) => baseNode.id === node.id)),
  ];
}

export function formatBytes(value) {
  const number = Math.max(0, toNumber(value));
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  let current = number;
  let unitIndex = 0;

  while (current >= 1024 && unitIndex < units.length - 1) {
    current /= 1024;
    unitIndex += 1;
  }

  const formatted = current >= 10 || Number.isInteger(current) ? String(round(current, 0)) : String(round(current, 1));
  return `${formatted} ${units[unitIndex]}`;
}

export function formatBytesPerSecond(value) {
  return `${formatBytes(value)}/s`;
}

export function formatRelativeTime(value, now = new Date()) {
  if (!value) {
    return "never";
  }

  const date = value instanceof Date ? value : new Date(value);
  const diffSeconds = Math.max(0, Math.round((now.getTime() - date.getTime()) / 1000));

  if (!Number.isFinite(diffSeconds)) {
    return "never";
  }

  if (diffSeconds < 60) {
    return `${diffSeconds}s ago`;
  }

  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) {
    return `${diffMinutes}m ago`;
  }

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) {
    return `${diffHours}h ago`;
  }

  return `${Math.floor(diffHours / 24)}d ago`;
}

export function getStoredTheme(storage) {
  const value = storage?.getItem?.(THEME_STORAGE_KEY);
  return value === "light" || value === "dark" || value === "system" ? value : "system";
}

export function getStoredViewMode(storage) {
  const value = storage?.getItem?.(VIEW_MODE_STORAGE_KEY);
  return value === "table" ? "table" : "grid";
}

export function getStoredGroup(storage) {
  return storage?.getItem?.(GROUP_STORAGE_KEY) || "all";
}

export function summarizeNodes(nodes = []) {
  const onlineNodes = nodes.filter((node) => node.online);
  const average = (values) => {
    const usable = values.filter((value) => Number.isFinite(value));
    if (!usable.length) return 0;
    return round(usable.reduce((total, value) => total + value, 0) / usable.length, 1);
  };

  return {
    total: nodes.length,
    online: onlineNodes.length,
    offline: Math.max(0, nodes.length - onlineNodes.length),
    cpu: average(onlineNodes.map((node) => node.cpu)),
    memory: average(onlineNodes.map((node) => node.memory.percent)),
    disk: average(onlineNodes.map((node) => node.disk.percent)),
    networkUp: onlineNodes.reduce((total, node) => total + node.network.up, 0),
    networkDown: onlineNodes.reduce((total, node) => total + node.network.down, 0),
  };
}
