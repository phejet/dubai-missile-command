import "./operator.css";
import {
  OPERATOR_REPLAY_LOAD,
  OPERATOR_REPLAY_QUERY,
  OPERATOR_REPLAY_READY,
  isReplayData,
} from "./operator-replay-bridge";

type Environment = "staging" | "production";

interface OperatorSession {
  runId: string;
  receivedAt: number;
  build: string;
  score: number;
  wave: number;
  outcome: string;
  replayStatus: "available" | "expired" | "missing" | "omitted";
}

const form = document.getElementById("operator-form") as HTMLFormElement;
const environment = document.getElementById("operator-environment") as HTMLSelectElement;
const token = document.getElementById("operator-token") as HTMLInputElement;
const status = document.getElementById("operator-status") as HTMLElement;
const body = document.getElementById("operator-runs") as HTMLTableSectionElement;
const refresh = document.getElementById("operator-refresh") as HTMLButtonElement;

function endpoint(): string {
  const selected = environment.value as Environment;
  const value = __DMC_SHARE_BASE_URLS__[selected];
  if (!value) throw new Error(`${selected} capture is not configured`);
  return value;
}

function bearerHeaders(): HeadersInit {
  const value = token.value.trim();
  if (!value) throw new Error("Enter the operator bearer token");
  return { Authorization: `Bearer ${value}` };
}

function setStatus(message: string, error = false): void {
  status.textContent = message;
  status.dataset.state = error ? "error" : "ready";
}

function cell(row: HTMLTableRowElement, value: string, className?: string): HTMLTableCellElement {
  const element = row.insertCell();
  element.textContent = value;
  if (className) element.className = className;
  return element;
}

function replayWindowUrl(): URL {
  const url = new URL("./", window.location.href);
  url.searchParams.set(OPERATOR_REPLAY_QUERY, "1");
  return url;
}

function launchReplay(replay: unknown): void {
  if (!isReplayData(replay)) throw new Error("Worker returned an invalid replay");
  const popup = window.open(replayWindowUrl(), "_blank");
  if (!popup) throw new Error("Replay window was blocked");
  const timeout = window.setTimeout(() => {
    window.removeEventListener("message", ready);
    setStatus("Replay window did not become ready", true);
  }, 15_000);
  const ready = (event: MessageEvent<unknown>) => {
    if (event.origin !== window.location.origin || event.source !== popup) return;
    if (typeof event.data !== "object" || event.data === null) return;
    if ((event.data as { type?: unknown }).type !== OPERATOR_REPLAY_READY) return;
    window.clearTimeout(timeout);
    window.removeEventListener("message", ready);
    popup.postMessage({ type: OPERATOR_REPLAY_LOAD, replay }, window.location.origin);
    setStatus("Replay launched");
  };
  window.addEventListener("message", ready);
}

async function play(session: OperatorSession, button: HTMLButtonElement): Promise<void> {
  button.disabled = true;
  setStatus(`Loading ${session.runId}…`);
  try {
    const response = await fetch(new URL(`/api/session/${encodeURIComponent(session.runId)}`, endpoint()), {
      headers: bearerHeaders(),
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`Replay request failed (${response.status})`);
    const payload = (await response.json()) as { replay?: unknown; replayStatus?: string };
    if (!payload.replay) throw new Error(`Replay is ${payload.replayStatus ?? "unavailable"}`);
    launchReplay(payload.replay);
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), true);
  } finally {
    button.disabled = false;
  }
}

function renderSessions(sessions: OperatorSession[]): void {
  body.replaceChildren();
  for (const session of sessions) {
    const row = body.insertRow();
    cell(row, new Date(session.receivedAt).toLocaleString());
    cell(row, session.build, "operator-table__build");
    cell(row, session.score.toLocaleString());
    cell(row, String(session.wave));
    cell(row, session.outcome.replace(/_/g, " "));
    const availability = cell(row, session.replayStatus);
    availability.dataset.replayStatus = session.replayStatus;
    const action = row.insertCell();
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "Play";
    button.disabled = session.replayStatus !== "available";
    button.setAttribute("aria-label", `Play replay for ${session.runId}`);
    button.addEventListener("click", () => void play(session, button));
    action.append(button);
  }
}

async function loadSessions(): Promise<void> {
  refresh.disabled = true;
  setStatus("Loading uploads…");
  try {
    const response = await fetch(new URL("/api/operator/sessions?limit=100", endpoint()), {
      headers: bearerHeaders(),
      cache: "no-store",
    });
    if (!response.ok)
      throw new Error(response.status === 401 ? "Bearer token rejected" : `Request failed (${response.status})`);
    const payload = (await response.json()) as { sessions?: unknown };
    if (!Array.isArray(payload.sessions)) throw new Error("Worker returned an invalid session list");
    renderSessions(payload.sessions as OperatorSession[]);
    setStatus(`${payload.sessions.length} uploaded run${payload.sessions.length === 1 ? "" : "s"}`);
  } catch (error) {
    renderSessions([]);
    setStatus(error instanceof Error ? error.message : String(error), true);
  } finally {
    refresh.disabled = false;
  }
}

for (const value of ["staging", "production"] as const) {
  const option = environment.querySelector<HTMLOptionElement>(`option[value="${value}"]`);
  if (option) option.disabled = !__DMC_SHARE_BASE_URLS__[value];
}
form.addEventListener("submit", (event) => {
  event.preventDefault();
  void loadSessions();
});
