import "./operator.css";
import {
  OPERATOR_REPLAY_LOAD,
  OPERATOR_REPLAY_QUERY,
  OPERATOR_REPLAY_READY,
  isReplayData,
  validReplayOptions,
  type OperatorReplayOptions,
} from "./operator-replay-bridge";
import {
  listPath,
  operatorFragment,
  operatorRequest,
  parseDetail,
  parseList,
  parseOperatorFragment,
  RequestSlot,
} from "./operator-api";
import { record, type OperatorSessionDetail, type OperatorSessionSummary } from "./operator-contract";
import { CURRENT_REPLAY_VERSION } from "./replay-version";
import { SIMULATION_HZ } from "./fixed-step-clock";
import type { ReplayData } from "./types";
import type { ReplayInspection } from "./operator-inspection";

const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const form = element<HTMLFormElement>("operator-form");
const filters = element<HTMLFormElement>("operator-filters");
const token = element<HTMLInputElement>("operator-token");
const status = element<HTMLElement>("operator-status");
const body = element<HTMLTableSectionElement>("operator-runs");
const panel = element<HTMLElement>("operator-detail");
const more = element<HTMLButtonElement>("operator-more");
const empty = element<HTMLElement>("operator-empty");
const listSlot = new RequestSlot(),
  detailSlot = new RequestSlot(),
  replaySlot = new RequestSlot();
const state: {
  sessions: OperatorSessionSummary[];
  nextCursor: string | null;
  selectedRunId: string | null;
  detail: OperatorSessionDetail | null;
  replay: ReplayData | null;
  inspection: ReplayInspection | null;
  filters: URLSearchParams;
} = {
  sessions: [],
  nextCursor: null,
  selectedRunId: null,
  detail: null,
  replay: null,
  inspection: null,
  filters: new URLSearchParams(),
};
let inspectionSignal = { cancelled: false };
let popupCleanup: (() => void) | null = null;
let deepLink: string | null = null;
function setStatus(message: string, error = false) {
  status.textContent = message;
  status.dataset.state = error ? "error" : "ready";
}
function url(path: string) {
  const endpoint = __DMC_SHARE_BASE_URLS__.staging;
  if (!endpoint) throw new Error("Staging is not configured");
  return import.meta.env.DEV ? new URL(`/api/operator-dev/staging${path}`, location.origin) : new URL(path, endpoint);
}
function node<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string) {
  const item = document.createElement(tag);
  if (text !== undefined) item.textContent = text;
  return item;
}
function button(label: string, action: () => void) {
  const item = node("button", label);
  item.type = "button";
  item.addEventListener("click", action);
  return item;
}
function showError(error: unknown) {
  setStatus(error instanceof Error ? error.message : "Unable to complete request", true);
}
function cancelSelection() {
  detailSlot.cancel();
  replaySlot.cancel();
  inspectionSignal.cancelled = true;
  state.detail = null;
  state.replay = null;
  state.inspection = null;
}
function renderRows() {
  body.replaceChildren();
  for (const session of state.sessions) {
    const row = body.insertRow();
    row.setAttribute("aria-selected", String(session.runId === state.selectedRunId));
    const values = [
      ["Received / build", new Date(session.receivedAt).toLocaleString(), session.build],
      ["Score / wave", session.score.toLocaleString(), `Wave ${session.wave}`],
      ["Outcome / feedback", session.outcome.replace(/_/g, " "), session.feedbackEmoji ?? "No feedback"],
      ["Replay", session.replayStatus, ""],
    ];
    for (const [label, text, subtitle] of values) {
      const cell = row.insertCell();
      cell.dataset.label = label;
      cell.append(node("span", text));
      if (subtitle) cell.append(node("small", subtitle));
    }
    const cell = row.insertCell();
    cell.dataset.label = "Inspect";
    const select = button("Inspect", () => void selectRun(session.runId));
    select.dataset.runId = session.runId;
    select.setAttribute("aria-label", `Inspect run ${session.runId}`);
    cell.append(select);
  }
  empty.hidden = state.sessions.length !== 0;
  empty.textContent = state.nextCursor
    ? "No matches in this scan. Load more to continue."
    : "No runs match these filters.";
  more.hidden = !state.nextCursor;
}
function backToResults() {
  const selected = [...body.querySelectorAll<HTMLButtonElement>("button")].find(
    (item) => item.dataset.runId === state.selectedRunId,
  );
  (selected ?? element("operator-results")).focus();
}
function renderDetail() {
  panel.replaceChildren(node("h2", "Run inspector"));
  const detail = state.detail;
  if (!detail) {
    panel.append(node("p", "Select a run to inspect its summary and replay."));
    return;
  }
  panel.append(button("Back to results", backToResults));
  const metadata = node("dl");
  const provenance = node("dl");
  for (const [label, value] of [
    ["Run", detail.runId],
    ["Build", detail.build],
    ["Received", new Date(detail.receivedAt).toLocaleString()],
    ["Created", new Date(detail.createdAt).toLocaleString()],
    ["Flavor / Apple environment", `${detail.appFlavor} / ${detail.appleEnvironment ?? "unknown"}`],
    ["Platform / input", `${detail.platform} / ${detail.inputClass}`],
    ["Capture source", detail.source],
    ["Score / wave", `${detail.score.toLocaleString()} / ${detail.wave}`],
    ["Outcome", detail.outcome],
    ["Death cause", detail.deathCause ?? "None"],
    ["Duration", `${(detail.timePlayedMs / 1000).toFixed(1)}s`],
    ["Burj health", detail.burjHealth],
    ["Shots / kills", `${detail.shotsFired} / ${detail.totalKills}`],
    ["Hit ratio", `${(detail.hitRatio * 100).toFixed(1)}%`],
    ["Multi-shots / max combo", `${detail.multiShots} / ${detail.maxCombo}`],
    ["Feedback", detail.feedbackEmoji ?? "None"],
    ["Replay", detail.replayStatus === "available" ? "Indexed; object checked on fetch" : detail.replayStatus],
    ["Complete replay claimed", detail.replayCompleteClaimed ? "Yes" : "No"],
  ]) {
    const destination = ["Run", "Build", "Score / wave", "Outcome", "Duration", "Feedback", "Replay"].includes(
      String(label),
    )
      ? metadata
      : provenance;
    destination.append(node("dt", String(label)), node("dd", String(value)));
  }
  const extra = node("details");
  extra.append(node("summary", "Provenance and detailed totals"), provenance);
  panel.append(metadata, extra, node("h3", "Stored upgrades"));
  const upgrades = node("ul");
  for (const entry of detail.upgrades)
    upgrades.append(node("li", `Wave ${entry.wave} · tick ${entry.tick}: ${entry.bought.join(", ")}`));
  panel.append(detail.upgrades.length ? upgrades : node("p", "No upgrades purchased."));
  const destroyed = node("details");
  destroyed.append(node("summary", "Destroyed threats"));
  const counts = node("ul");
  for (const [type, count] of Object.entries(detail.destroyedByType)) counts.append(node("li", `${type}: ${count}`));
  destroyed.append(counts);
  panel.append(destroyed);
  const actions = node("div");
  actions.className = "operator-actions";
  const inspect = button(state.inspection ? "Inspect again" : "Inspect replay", () => void inspectSelected());
  inspect.disabled = !detail.canRequestReplay;
  actions.append(inspect);
  if (state.replay && state.inspection) actions.append(button("Play from start", () => launchReplay({})));
  panel.insertBefore(actions, metadata);
  if (!detail.canRequestReplay)
    panel.append(
      node("p", `Replay ${detail.replayStatus}. Stored summary remains available; wave evidence cannot be derived.`),
    );
  if (state.inspection) renderInspection(state.inspection);
}
function launchReplay(options: OperatorReplayOptions) {
  const replay = state.replay;
  if (!replay || !validReplayOptions(replay, options)) {
    setStatus("Invalid replay launch", true);
    return;
  }
  popupCleanup?.();
  const target = new URL("./", location.href);
  target.searchParams.set(OPERATOR_REPLAY_QUERY, "1");
  const popup = window.open(target, "_blank");
  if (!popup) {
    setStatus("Replay window was blocked", true);
    return;
  }
  const ready = (event: MessageEvent<unknown>) => {
    if (
      event.origin !== location.origin ||
      event.source !== popup ||
      !record(event.data) ||
      event.data.type !== OPERATOR_REPLAY_READY
    )
      return;
    popupCleanup?.();
    popup.postMessage({ type: OPERATOR_REPLAY_LOAD, replay, ...options }, location.origin);
    setStatus("Replay launched");
  };
  const timeout = window.setTimeout(() => {
    popupCleanup?.();
    setStatus("Replay window did not become ready", true);
  }, 15000);
  popupCleanup = () => {
    clearTimeout(timeout);
    window.removeEventListener("message", ready);
    popupCleanup = null;
  };
  window.addEventListener("message", ready);
}
function renderInspection(inspection: ReplayInspection) {
  panel.append(
    node("h3", `Local consistency check: ${inspection.status}`),
    node("p", "Compared with the stored summary. This is not server score verification."),
  );
  if (inspection.differences.length) {
    const list = node("ul");
    for (const difference of inspection.differences)
      list.append(
        node(
          "li",
          `${difference.field}: stored ${JSON.stringify(difference.expected)}; replay ${JSON.stringify(difference.derived)}`,
        ),
      );
    panel.append(list);
  }
  const waves = node("ul");
  waves.className = "operator-waves";
  for (const wave of inspection.recap.waveCards) {
    const item = node("li");
    item.append(
      button(`Play wave ${wave.wave}`, () => launchReplay({ seekToTick: wave.startTick })),
      node(
        "p",
        `Ticks ${wave.startTick}–${wave.endTick} · score +${wave.scoreEarned} · missiles ${wave.missileKills} · drones ${wave.droneKills} · multi-shots ${wave.multiShots} · combo ${wave.maxCombo} · buildings ${wave.buildingsSurviving} · Burj ${wave.burjHealth}${wave.terminal ? " · terminal" : ""}`,
      ),
      node("p", `Upgrades: ${wave.bought.join(", ") || "none"}`),
    );
    waves.append(item);
  }
  panel.append(node("h3", "Waves"), waves);
  const label = node("label", "Exact tick");
  const tick = node("input");
  tick.type = "number";
  tick.min = "0";
  tick.max = String(inspection.finalTick);
  tick.step = "1";
  tick.value = "0";
  label.append(tick);
  const preview = node("p");
  const play = button("Play from here", () => launchReplay({ seekToTick: Number(tick.value), startPaused: true }));
  const update = () => {
    const value = Number(tick.value);
    const valid = tick.value !== "" && Number.isSafeInteger(value) && value >= 0 && value <= inspection.finalTick;
    play.disabled = !valid;
    const wave = [...inspection.recap.waveCards].reverse().find((item) => value >= item.startTick)?.wave ?? 1;
    preview.textContent = valid
      ? `Wave ${wave} · ${(value / SIMULATION_HZ).toFixed(2)}s · opens paused`
      : `Enter a whole tick from 0 to ${inspection.finalTick}`;
  };
  tick.addEventListener("input", update);
  update();
  panel.append(label, preview, play);
  const timeline = node("ul");
  timeline.className = "operator-timeline";
  for (const item of inspection.timeline) {
    const entry = node("li");
    entry.append(
      button(`${item.label} · W${item.wave} · ${item.seconds.toFixed(1)}s · tick ${item.seekToTick}`, () =>
        launchReplay({ seekToTick: item.seekToTick, startPaused: true }),
      ),
    );
    timeline.append(entry);
  }
  panel.append(node("h3", "Timeline"), timeline);
}
async function selectRun(runId: string) {
  cancelSelection();
  state.selectedRunId = runId;
  history.replaceState(null, "", operatorFragment(runId));
  renderRows();
  renderDetail();
  panel.append(node("p", "Loading run…"));
  const signal = detailSlot.begin();
  try {
    const payload = await operatorRequest(
      url(`/api/operator/sessions/${encodeURIComponent(runId)}`),
      token.value,
      signal,
    );
    if (!detailSlot.current(signal)) return;
    if (!record(payload) || payload.ok !== true) throw new Error("Invalid detail response");
    const detail = parseDetail(payload.session);
    if (detail.runId !== runId) throw new Error("Run response did not match selection");
    state.detail = detail;
    renderDetail();
    panel.focus();
    setStatus("Run loaded");
  } catch (error) {
    if (detailSlot.current(signal)) {
      renderDetail();
      panel.append(node("p", "Run unavailable. Check access or choose another result."));
      showError(error);
    }
  }
}
async function inspectSelected() {
  const detail = state.detail;
  if (!detail) return;
  replaySlot.cancel();
  inspectionSignal.cancelled = true;
  inspectionSignal = { cancelled: false };
  const cancellation = inspectionSignal;
  const signal = replaySlot.begin();
  const cancel = button("Cancel inspection", () => {
    cancellation.cancelled = true;
    replaySlot.cancel();
    cancel.remove();
    setStatus("Inspection cancelled");
  });
  panel.append(cancel);
  setStatus("Loading replay…");
  try {
    const payload = await operatorRequest(
      url(`/api/operator/sessions/${encodeURIComponent(detail.runId)}/replay`),
      token.value,
      signal,
    );
    if (!replaySlot.current(signal)) return;
    if (!record(payload) || payload.ok !== true || payload.replayStatus !== "available")
      throw new Error(
        `Replay ${record(payload) && ["missing", "omitted", "expired"].includes(String(payload.replayStatus)) ? payload.replayStatus : "unavailable"}`,
      );
    if (!isReplayData(payload.replay)) throw new Error("Invalid replay response");
    if (payload.replay.version !== CURRENT_REPLAY_VERSION)
      throw new Error(
        `Replay format v${payload.replay.version} is incompatible with this runtime (v${CURRENT_REPLAY_VERSION})`,
      );
    const replay = payload.replay;
    const { inspectReplay } = await import("./operator-inspection");
    if (!replaySlot.current(signal)) return;
    const inspection = await inspectReplay(detail, replay, cancellation, (tick) => {
      if (replaySlot.current(signal))
        setStatus(`Inspecting replay · tick ${tick}${replay.finalTick === undefined ? "" : ` / ${replay.finalTick}`}`);
    });
    if (!replaySlot.current(signal)) return;
    state.replay = replay;
    state.inspection = inspection;
    renderDetail();
    setStatus(`Inspection complete: ${inspection.status}`);
  } catch (error) {
    if (replaySlot.current(signal)) showError(error);
  } finally {
    cancel.remove();
  }
}
async function loadSessions(append = false) {
  const signal = listSlot.begin();
  const params = new URLSearchParams(state.filters);
  if (append && state.nextCursor) params.set("cursor", state.nextCursor);
  more.disabled = true;
  setStatus("Loading runs…");
  try {
    const payload = parseList(await operatorRequest(url(listPath(params)), token.value, signal));
    if (!listSlot.current(signal)) return;
    state.sessions = [
      ...new Map([...(append ? state.sessions : []), ...payload.sessions].map((item) => [item.runId, item])).values(),
    ];
    state.nextCursor = payload.nextCursor;
    renderRows();
    setStatus(`${state.sessions.length} runs loaded`);
  } catch (error) {
    if (listSlot.current(signal)) showError(error);
  } finally {
    if (listSlot.current(signal)) more.disabled = false;
  }
}
function applyFilters() {
  const params = new URLSearchParams();
  for (const [key, value] of new FormData(filters)) if (String(value).trim()) params.set(key, String(value).trim());
  try {
    listPath(params);
  } catch (error) {
    showError(error);
    return;
  }
  cancelSelection();
  state.selectedRunId = null;
  state.sessions = [];
  state.nextCursor = null;
  state.filters = params;
  history.replaceState(null, "", location.pathname);
  renderRows();
  renderDetail();
  void loadSessions();
}
try {
  deepLink = parseOperatorFragment(location.hash);
  if (deepLink) setStatus("Candidate selected. Enter the bearer token and load runs to inspect it.");
} catch (error) {
  showError(error);
}
form.addEventListener("submit", (event) => {
  event.preventDefault();
  void loadSessions();
  if (deepLink) {
    void selectRun(deepLink);
    deepLink = null;
  }
});
filters.addEventListener("submit", (event) => {
  event.preventDefault();
  applyFilters();
});
filters.addEventListener("reset", () => queueMicrotask(applyFilters));
more.addEventListener("click", () => void loadSessions(true));
window.addEventListener("pagehide", () => {
  listSlot.cancel();
  cancelSelection();
  popupCleanup?.();
});

window.addEventListener("hashchange", () => {
  try {
    deepLink = parseOperatorFragment(location.hash);
    if (deepLink && token.value.trim()) {
      const runId = deepLink;
      deepLink = null;
      void selectRun(runId);
    } else if (deepLink) setStatus("Candidate selected. Enter the bearer token and load runs to inspect it.");
  } catch (error) {
    showError(error);
  }
});
