import {
  getAllUpgradeNodeDefs,
  getNodeLockReason,
  getUpgradeObjectiveLabel,
  isUpgradeNodeEligible,
} from "./game-sim-upgrades";
import type { UpgradeNodeDef } from "./game-sim-upgrades";
import type { UpgradeNodeId, UpgradeProgressionState } from "./types";

export const UPGRADE_GRAPH_NODE_W = 172;
export const UPGRADE_GRAPH_NODE_H = 112;
const GRAPH_FAMILY_COLUMNS = 3;
const FAMILY_CLUSTER_W = 612;
const FAMILY_CLUSTER_H = 284;
const GRAPH_PADDING_X = 120;
const GRAPH_PADDING_Y = 116;
const GRAPH_COLUMN_GAP = 124;
const GRAPH_ROW_GAP = 112;
const FAMILY_NODE_X_STEP = 196;
const FAMILY_NODE_Y_STEP = 34;
const GRAPH_STAGE_FIT_PADDING = 44;
export const UPGRADE_GRAPH_MIN_SCALE = 0.34;
export const UPGRADE_GRAPH_MAX_SCALE = 2.4;

export interface UpgradeGraphNodePosition {
  x: number;
  y: number;
}

export interface UpgradeGraphLayout {
  width: number;
  height: number;
  nodes: Record<UpgradeNodeId, UpgradeGraphNodePosition>;
}

export type UpgradeGraphNodeState = "owned" | "available" | "locked" | "metaLocked";

export interface UpgradeGraphNodeView {
  id: UpgradeNodeId;
  family: string;
  name: string;
  icon: string;
  desc: string;
  statLine: string;
  rank: number;
  x: number;
  y: number;
  w: number;
  h: number;
  state: UpgradeGraphNodeState;
  lockReason: string | null;
  unmetObjectives: string[];
  active: boolean;
}

export interface UpgradeGraphEdgeView {
  from: UpgradeNodeId;
  to: UpgradeNodeId;
  kind: "anyOf" | "allOf";
}

export interface UpgradeGraphViewModel {
  width: number;
  height: number;
  nodes: UpgradeGraphNodeView[];
  edges: UpgradeGraphEdgeView[];
}

export interface UpgradeGraphPoint {
  x: number;
  y: number;
}

export interface UpgradeGraphViewportState {
  scale: number;
  panX: number;
  panY: number;
}

function nodeStatePriority(state: UpgradeGraphNodeState): number {
  switch (state) {
    case "available":
      return 0;
    case "owned":
      return 1;
    case "locked":
      return 2;
    case "metaLocked":
      return 3;
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function uniqueFamilies(nodes: UpgradeNodeDef[]): string[] {
  return Array.from(new Set(nodes.map((node) => node.family)));
}

function buildDefaultLayout(): UpgradeGraphLayout {
  const nodes = getAllUpgradeNodeDefs();
  const families = uniqueFamilies(nodes);
  const rowCount = Math.ceil(families.length / GRAPH_FAMILY_COLUMNS);
  const layoutNodes: Record<UpgradeNodeId, UpgradeGraphNodePosition> = {};

  families.forEach((family, familyIndex) => {
    const familyNodes = nodes.filter((node) => node.family === family).sort((a, b) => a.rank - b.rank);
    const column = familyIndex % GRAPH_FAMILY_COLUMNS;
    const row = Math.floor(familyIndex / GRAPH_FAMILY_COLUMNS);
    const clusterX = GRAPH_PADDING_X + column * (FAMILY_CLUSTER_W + GRAPH_COLUMN_GAP);
    const clusterY = GRAPH_PADDING_Y + row * (FAMILY_CLUSTER_H + GRAPH_ROW_GAP);
    familyNodes.forEach((node, nodeIndex) => {
      layoutNodes[node.id] = {
        x: clusterX + nodeIndex * FAMILY_NODE_X_STEP,
        y: clusterY + (nodeIndex % 2) * FAMILY_NODE_Y_STEP,
      };
    });
  });

  return {
    width:
      GRAPH_PADDING_X * 2 +
      FAMILY_CLUSTER_W * GRAPH_FAMILY_COLUMNS +
      Math.max(0, GRAPH_FAMILY_COLUMNS - 1) * GRAPH_COLUMN_GAP,
    height: GRAPH_PADDING_Y * 2 + rowCount * FAMILY_CLUSTER_H + Math.max(0, rowCount - 1) * GRAPH_ROW_GAP,
    nodes: layoutNodes,
  };
}

export const DEFAULT_UPGRADE_GRAPH_LAYOUT = buildDefaultLayout();

export function getUpgradeGraphPositionDefaults(): Record<string, number> {
  const defaults: Record<string, number> = {};
  for (const [nodeId, pos] of Object.entries(DEFAULT_UPGRADE_GRAPH_LAYOUT.nodes)) {
    defaults[`upgradeGraph.${nodeId}.x`] = pos.x;
    defaults[`upgradeGraph.${nodeId}.y`] = pos.y;
  }
  return defaults;
}

function getLayoutPosition(
  nodeId: UpgradeNodeId,
  overrides: Record<string, number> | undefined,
): UpgradeGraphNodePosition {
  const base = DEFAULT_UPGRADE_GRAPH_LAYOUT.nodes[nodeId];
  return {
    x: overrides?.[`upgradeGraph.${nodeId}.x`] ?? base.x,
    y: overrides?.[`upgradeGraph.${nodeId}.y`] ?? base.y,
  };
}

function getUnmetObjectiveLabels(node: UpgradeNodeDef, progression: UpgradeProgressionState): string[] {
  return (node.objectives ?? [])
    .filter((objectiveId) => !progression.completedObjectives.includes(objectiveId))
    .map(getUpgradeObjectiveLabel);
}

export function buildUpgradeGraphViewModel(options: {
  progression: UpgradeProgressionState;
  ownedNodes?: Set<UpgradeNodeId>;
  layoutOverrides?: Record<string, number>;
}): UpgradeGraphViewModel {
  const ownedNodes = options.ownedNodes ?? new Set<UpgradeNodeId>();
  const defs = getAllUpgradeNodeDefs();
  const nodes = defs.map((node) => {
    const pos = getLayoutPosition(node.id, options.layoutOverrides);
    const unmetObjectives = getUnmetObjectiveLabels(node, options.progression);
    const eligible = isUpgradeNodeEligible(ownedNodes, options.progression, node.id);
    const owned = ownedNodes.has(node.id);
    const state: UpgradeGraphNodeState = owned
      ? "owned"
      : unmetObjectives.length > 0
        ? "metaLocked"
        : eligible
          ? "available"
          : "locked";
    return {
      id: node.id,
      family: node.family,
      name: node.name,
      icon: node.icon,
      desc: node.desc,
      statLine: node.statLine,
      rank: node.rank,
      x: pos.x,
      y: pos.y,
      w: UPGRADE_GRAPH_NODE_W,
      h: UPGRADE_GRAPH_NODE_H,
      state,
      lockReason: owned ? "Owned" : getNodeLockReason(node, ownedNodes, options.progression),
      unmetObjectives,
      active: !!node.active,
    } satisfies UpgradeGraphNodeView;
  });

  const edges: UpgradeGraphEdgeView[] = defs.flatMap((node) => [
    ...(node.anyOf ?? []).map((from) => ({ from, to: node.id, kind: "anyOf" as const })),
    ...(node.allOf ?? []).map((from) => ({ from, to: node.id, kind: "allOf" as const })),
  ]);

  const width = Math.max(DEFAULT_UPGRADE_GRAPH_LAYOUT.width, ...nodes.map((node) => node.x + node.w + GRAPH_PADDING_X));
  const height = Math.max(
    DEFAULT_UPGRADE_GRAPH_LAYOUT.height,
    ...nodes.map((node) => node.y + node.h + GRAPH_PADDING_Y),
  );

  return {
    width,
    height,
    nodes,
    edges,
  };
}

export function getDefaultSelectedUpgradeNodeId(view: UpgradeGraphViewModel): UpgradeNodeId | null {
  const sorted = [...view.nodes].sort((a, b) => {
    const priority = nodeStatePriority(a.state) - nodeStatePriority(b.state);
    if (priority !== 0) return priority;
    if (a.family !== b.family) return a.family.localeCompare(b.family);
    return a.rank - b.rank;
  });
  return sorted[0]?.id ?? null;
}

function clampScale(scale: number): number {
  return Math.max(UPGRADE_GRAPH_MIN_SCALE, Math.min(UPGRADE_GRAPH_MAX_SCALE, scale));
}

function graphStagePadding(stageSize: number): number {
  return Math.min(GRAPH_STAGE_FIT_PADDING, Math.max(18, stageSize * 0.08));
}

export function fitUpgradeGraphViewport(
  stageWidth: number,
  stageHeight: number,
  graphWidth: number,
  graphHeight: number,
): UpgradeGraphViewportState {
  const safeStageWidth = Math.max(stageWidth, 1);
  const safeStageHeight = Math.max(stageHeight, 1);
  const paddingX = graphStagePadding(safeStageWidth);
  const paddingY = graphStagePadding(safeStageHeight);
  const scale = clampScale(
    Math.min(
      (safeStageWidth - paddingX * 2) / Math.max(graphWidth, 1),
      (safeStageHeight - paddingY * 2) / Math.max(graphHeight, 1),
      1,
    ),
  );

  return clampUpgradeGraphViewport(
    {
      scale,
      panX: (safeStageWidth - graphWidth * scale) / 2,
      panY: (safeStageHeight - graphHeight * scale) / 2,
    },
    safeStageWidth,
    safeStageHeight,
    graphWidth,
    graphHeight,
  );
}

export function clampUpgradeGraphViewport(
  viewport: UpgradeGraphViewportState,
  stageWidth: number,
  stageHeight: number,
  graphWidth: number,
  graphHeight: number,
): UpgradeGraphViewportState {
  const scale = clampScale(viewport.scale);
  const scaledWidth = graphWidth * scale;
  const scaledHeight = graphHeight * scale;
  let panX = viewport.panX;
  let panY = viewport.panY;

  if (scaledWidth <= stageWidth) {
    panX = (stageWidth - scaledWidth) / 2;
  } else {
    panX = Math.min(0, Math.max(stageWidth - scaledWidth, panX));
  }

  if (scaledHeight <= stageHeight) {
    panY = (stageHeight - scaledHeight) / 2;
  } else {
    panY = Math.min(0, Math.max(stageHeight - scaledHeight, panY));
  }

  return { scale, panX, panY };
}

export function graphScreenToWorld(point: UpgradeGraphPoint, viewport: UpgradeGraphViewportState): UpgradeGraphPoint {
  return {
    x: (point.x - viewport.panX) / viewport.scale,
    y: (point.y - viewport.panY) / viewport.scale,
  };
}

export function zoomUpgradeGraphViewportAtPoint(
  viewport: UpgradeGraphViewportState,
  stageWidth: number,
  stageHeight: number,
  graphWidth: number,
  graphHeight: number,
  point: UpgradeGraphPoint,
  targetScale: number,
): UpgradeGraphViewportState {
  const nextScale = clampScale(targetScale);
  const worldPoint = graphScreenToWorld(point, viewport);
  return clampUpgradeGraphViewport(
    {
      scale: nextScale,
      panX: point.x - worldPoint.x * nextScale,
      panY: point.y - worldPoint.y * nextScale,
    },
    stageWidth,
    stageHeight,
    graphWidth,
    graphHeight,
  );
}

function getNodeCenter(node: UpgradeGraphNodeView): { x: number; y: number } {
  return { x: node.x + node.w / 2, y: node.y + node.h / 2 };
}

function renderEdgePath(from: UpgradeGraphNodeView, to: UpgradeGraphNodeView): string {
  const start = getNodeCenter(from);
  const end = getNodeCenter(to);
  const ctrlA = start.x + (end.x - start.x) * 0.45;
  const ctrlB = end.x - (end.x - start.x) * 0.45;
  return `M ${start.x} ${start.y} C ${ctrlA} ${start.y}, ${ctrlB} ${end.y}, ${end.x} ${end.y}`;
}

export function renderUpgradeGraphMarkup(
  view: UpgradeGraphViewModel,
  options: { selectedNodeId?: UpgradeNodeId | null } = {},
): string {
  const nodeMap = new Map(view.nodes.map((node) => [node.id, node]));
  const edgeMarkup = view.edges
    .map((edge) => {
      const from = nodeMap.get(edge.from);
      const to = nodeMap.get(edge.to);
      if (!from || !to) return "";
      return `<path class="upgrade-graph__edge upgrade-graph__edge--${edge.kind}" d="${renderEdgePath(from, to)}" />`;
    })
    .join("");

  const nodeMarkup = view.nodes
    .map((node) => {
      const stateClass = `upgrade-graph__node--${node.state}`;
      const selectedClass = options.selectedNodeId === node.id ? " upgrade-graph__node--selected" : "";
      const statusText =
        node.state === "owned"
          ? "Owned"
          : node.state === "available"
            ? "Available"
            : node.state === "metaLocked"
              ? "Meta locked"
              : "Locked";
      return `<button type="button" class="upgrade-graph__node ${stateClass}${selectedClass}" data-node-id="${escapeHtml(node.id)}" style="left:${node.x}px;top:${node.y}px;width:${node.w}px;height:${node.h}px">
        <span class="upgrade-graph__node-topline">
          <span class="upgrade-graph__node-icon" aria-hidden="true">${node.icon}</span>
          <span class="upgrade-graph__node-status">${escapeHtml(statusText)}</span>
        </span>
        <span class="upgrade-graph__node-name">${escapeHtml(node.name)}</span>
        <span class="upgrade-graph__node-meta">${escapeHtml(node.family)} · R${node.rank}</span>
        <span class="upgrade-graph__node-effect">${escapeHtml(node.statLine)}</span>
      </button>`;
    })
    .join("");

  return `<div class="upgrade-graph" style="--upgrade-graph-width:${view.width}px;--upgrade-graph-height:${view.height}px">
    <div class="upgrade-graph__backdrop" aria-hidden="true"></div>
    <svg class="upgrade-graph__edges" viewBox="0 0 ${view.width} ${view.height}" aria-hidden="true">${edgeMarkup}</svg>
    <div class="upgrade-graph__nodes">${nodeMarkup}</div>
  </div>`;
}

export function renderUpgradeGraphDetailMarkup(
  view: UpgradeGraphViewModel,
  selectedNodeId: UpgradeNodeId | null | undefined,
): string {
  const node = view.nodes.find((entry) => entry.id === selectedNodeId) ?? view.nodes[0];
  if (!node) return "";
  const objectiveHtml =
    node.unmetObjectives.length > 0
      ? `<div class="upgrade-graph-detail__section">
          <div class="upgrade-graph-detail__label">Unmet objectives</div>
          <ul class="upgrade-graph-detail__list">${node.unmetObjectives
            .map((item) => `<li>${escapeHtml(item)}</li>`)
            .join("")}</ul>
        </div>`
      : "";
  const lockHtml =
    node.lockReason && node.state !== "owned"
      ? `<div class="upgrade-graph-detail__section">
          <div class="upgrade-graph-detail__label">Status</div>
          <div class="upgrade-graph-detail__status">${escapeHtml(node.lockReason)}</div>
        </div>`
      : "";
  return `<div class="upgrade-graph-detail upgrade-graph-detail--${node.state}">
    <div class="upgrade-graph-detail__eyebrow">${escapeHtml(node.family)} · Rank ${node.rank}</div>
    <div class="upgrade-graph-detail__title-row">
      <span class="upgrade-graph-detail__icon" aria-hidden="true">${node.icon}</span>
      <div>
        <h3 class="upgrade-graph-detail__title">${escapeHtml(node.name)}</h3>
        <div class="upgrade-graph-detail__pill">${escapeHtml(node.state === "metaLocked" ? "Meta Locked" : node.state)}</div>
      </div>
    </div>
    <p class="upgrade-graph-detail__copy">${escapeHtml(node.desc)}</p>
    <div class="upgrade-graph-detail__section">
      <div class="upgrade-graph-detail__label">Effect</div>
      <div class="upgrade-graph-detail__status">${escapeHtml(node.statLine)}</div>
    </div>
    ${lockHtml}
    ${objectiveHtml}
  </div>`;
}
