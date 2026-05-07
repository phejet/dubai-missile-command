// Bootstrap shim that registers tsx so the worker can load `.ts` modules.
// Used by train.ts via `new Worker(...path-to-this-file...)`.
import { register } from "tsx/esm/api";
register();
await import("./game-worker.ts");
