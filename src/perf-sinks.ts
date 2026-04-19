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
    const response = await fetchImpl(this.url, {
      body: JSON.stringify(report),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });

    if (!response.ok) {
      throw new Error(`Perf sink POST failed: ${response.status} ${response.statusText}`);
    }
  }
}
