import type { PerfReport } from "./perf-recorder";

export interface PerfSink {
  emit(report: PerfReport): Promise<void>;
}

type FetchImpl = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export class ConsoleSink implements PerfSink {
  async emit(report: PerfReport): Promise<void> {
    console.log("PERF_REPORT_V1", JSON.stringify(report));
  }
}

export class HttpSink implements PerfSink {
  private readonly url: string;
  private readonly fetchImpl?: FetchImpl;

  constructor(url: string, fetchImpl?: FetchImpl) {
    this.url = url;
    this.fetchImpl = fetchImpl;
  }

  async emit(report: PerfReport): Promise<void> {
    const fetchImpl =
      this.fetchImpl ?? ((input: RequestInfo | URL, init?: RequestInit) => globalThis.fetch(input, init));
    const body = JSON.stringify(report);
    console.log(
      `[perf-sink] POST ${this.url} runId=${report.runId} replayId=${report.replayId} frames=${report.frames.length} bytes=${body.length}`,
    );
    let response: Response;
    try {
      response = await fetchImpl(this.url, {
        body,
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[perf-sink] fetch threw: ${message}`);
      throw error;
    }

    let responseText = "";
    try {
      responseText = await response.clone().text();
    } catch {
      responseText = "<unreadable>";
    }
    console.log(`[perf-sink] response status=${response.status} ok=${response.ok} body=${responseText.slice(0, 300)}`);

    if (!response.ok) {
      throw new Error(`Perf sink POST failed: ${response.status} ${response.statusText}`);
    }
  }
}
