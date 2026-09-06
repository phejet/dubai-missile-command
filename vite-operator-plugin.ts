import type { Plugin } from "vite";
import { SAFE_ID } from "./src/capture-contract";

export default function operatorPlugin(stagingUrl: string): Plugin {
  return {
    name: "vite-operator-reads",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/api/operator-dev/staging", async (req, res) => {
        res.setHeader("Cache-Control", "private, no-store");
        const reject = (status: number, message: string) => {
          res.statusCode = status;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ ok: false, message }));
        };
        if (req.method !== "GET") return reject(405, "Read-only endpoint");
        // The dev server may be LAN-accessible; only its own pages may use this route.
        const origin = req.headers.origin;
        if (origin && origin !== `http://${req.headers.host}` && origin !== `https://${req.headers.host}`) {
          return reject(403, "Origin not allowed");
        }
        const url = new URL(req.url ?? "/", "http://local.invalid");
        let sessionId: string | undefined;
        try {
          const match = /^\/api\/session\/([^/]+)$/.exec(url.pathname);
          if (match) sessionId = decodeURIComponent(match[1]);
        } catch {
          return reject(400, "Invalid session ID");
        }
        if (url.pathname !== "/api/operator/sessions" && (!sessionId || !SAFE_ID.test(sessionId))) {
          return reject(404, "Unknown operator read");
        }
        const authorization = req.headers.authorization;
        if (!authorization?.startsWith("Bearer ")) return reject(401, "Operator token required");
        try {
          const upstream = await fetch(new URL(url.pathname + url.search, stagingUrl), {
            headers: { Authorization: authorization },
            redirect: "error",
            signal: AbortSignal.timeout(30_000),
          });
          const body = await upstream.arrayBuffer();
          res.statusCode = upstream.status;
          res.setHeader("Content-Type", upstream.headers.get("content-type") ?? "application/json");
          res.end(Buffer.from(body));
        } catch {
          reject(502, "Staging operator service unavailable");
        }
      });
    },
  };
}
