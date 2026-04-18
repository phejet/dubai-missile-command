import type { PerfReport } from "./perf-recorder";

export interface PerfSink {
  emit(report: PerfReport): Promise<void>;
}

export class ConsoleSink implements PerfSink {
  async emit(report: PerfReport): Promise<void> {
    console.log("PERF_REPORT_V1", JSON.stringify(report));
  }
}

export class HttpSink implements PerfSink {
  private readonly url: string;
  private readonly fetchImpl: typeof fetch;

  constructor(url: string, fetchImpl: typeof fetch = fetch) {
    this.url = url;
    this.fetchImpl = fetchImpl;
  }

  async emit(report: PerfReport): Promise<void> {
    const response = await this.fetchImpl(this.url, {
      body: JSON.stringify(report),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });

    if (!response.ok) {
      throw new Error(`Perf sink POST failed: ${response.status} ${response.statusText}`);
    }
  }
}
