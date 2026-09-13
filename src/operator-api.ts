import { decodeCursor, OPERATOR_SAFE_ID, parseOperatorFilters, record, parseSummary } from "./operator-contract";
export { parseDetail } from "./operator-contract";
export type { OperatorSessionDetail, OperatorSessionSummary } from "./operator-contract";

export function parseList(value: unknown) {
  if (
    !record(value) ||
    value.ok !== true ||
    !Array.isArray(value.sessions) ||
    value.sessions.length > 100 ||
    (value.nextCursor !== null && typeof value.nextCursor !== "string")
  )
    throw new Error("Invalid run list response");
  if (typeof value.nextCursor === "string") decodeCursor(value.nextCursor);
  return { sessions: value.sessions.map(parseSummary), nextCursor: value.nextCursor as string | null };
}
export function operatorFragment(runId: string): string {
  if (!OPERATOR_SAFE_ID.test(runId)) throw new Error("Invalid run ID");
  return `#${new URLSearchParams({ environment: "staging", run: runId })}`;
}
export function parseOperatorFragment(fragment: string): string | null {
  if (!fragment || fragment === "#") return null;
  const params = new URLSearchParams(fragment.replace(/^#/, ""));
  if (
    params.size !== 2 ||
    params.get("environment") !== "staging" ||
    !OPERATOR_SAFE_ID.test(params.get("run") ?? "") ||
    [...params.keys()].some((key) => key !== "environment" && key !== "run")
  )
    throw new Error("Invalid Staging run link");
  return params.get("run");
}
export function listPath(params: URLSearchParams): string {
  parseOperatorFilters(params);
  return `/api/operator/sessions?${params}`;
}
export class RequestSlot {
  private controller: AbortController | null = null;
  begin(): AbortSignal {
    this.cancel();
    this.controller = new AbortController();
    return this.controller.signal;
  }
  cancel(): void {
    this.controller?.abort();
  }
  current(signal: AbortSignal): boolean {
    return this.controller?.signal === signal && !signal.aborted;
  }
}
export async function operatorRequest(url: URL, token: string, signal: AbortSignal): Promise<unknown> {
  if (!token.trim()) throw new Error("Enter the operator bearer token");
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token.trim()}` },
    cache: "no-store",
    signal,
    referrerPolicy: "no-referrer",
  });
  if (!response.ok)
    throw new Error(response.status === 401 ? "Bearer token rejected" : `Request failed (${response.status})`);
  try {
    return await response.json();
  } catch {
    throw new Error("Invalid operator response");
  }
}
