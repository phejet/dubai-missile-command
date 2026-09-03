import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const TARGETS = {
  staging: "dmc-captures-staging",
  production: "dmc-captures",
};

export function parseLifecycleArgs(argv) {
  const values = Object.fromEntries(
    argv.map((argument) => {
      const match = /^--([^=]+)=(.+)$/.exec(argument);
      if (!match) throw new Error(`Invalid argument: ${argument}`);
      return [match[1], match[2]];
    }),
  );
  if (values.env !== "staging" && values.env !== "production") {
    throw new Error("--env must be staging or production");
  }
  const expectedBucket = TARGETS[values.env];
  if (values.bucket !== expectedBucket) {
    throw new Error(`${values.env} lifecycle verification requires bucket ${expectedBucket}`);
  }
  return { environment: values.env, bucket: values.bucket };
}

export function normalizeLifecycleRules(rules) {
  if (!Array.isArray(rules)) throw new Error("Lifecycle response has no rules array");
  return rules
    .map((rule) => ({
      id: rule.id,
      enabled: rule.enabled,
      prefix: rule.conditions?.prefix,
      type: rule.deleteObjectsTransition?.condition?.type,
      maxAge: rule.deleteObjectsTransition?.condition?.maxAge,
    }))
    .sort((left, right) => String(left.id).localeCompare(String(right.id)));
}

export function assertLifecycleRules(actual, expected) {
  const normalizedActual = normalizeLifecycleRules(actual);
  const normalizedExpected = normalizeLifecycleRules(expected);
  if (JSON.stringify(normalizedActual) !== JSON.stringify(normalizedExpected)) {
    throw new Error(
      `Applied lifecycle does not match worker/lifecycle.json\nexpected=${JSON.stringify(normalizedExpected)}\nactual=${JSON.stringify(normalizedActual)}`,
    );
  }
  return normalizedActual;
}

export async function verifyLifecycle({ environment, bucket }, env = process.env, fetchImpl = fetch) {
  const accountId = env.CLOUDFLARE_ACCOUNT_ID;
  const token = env.CLOUDFLARE_API_TOKEN;
  if (!accountId || !token) throw new Error("CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN are required");
  if (TARGETS[environment] !== bucket) throw new Error("Lifecycle target does not match the selected environment");
  const response = await fetchImpl(
    `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/r2/buckets/${encodeURIComponent(bucket)}/lifecycle`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!response.ok) throw new Error(`Lifecycle read-back failed (${response.status})`);
  const payload = await response.json();
  if (payload?.success !== true) throw new Error("Cloudflare lifecycle read-back was not successful");
  const actual = payload.result?.rules ?? payload.result;
  const expected = JSON.parse(readFileSync(new URL("../worker/lifecycle.json", import.meta.url), "utf8")).rules;
  return assertLifecycleRules(actual, expected);
}

async function main() {
  const target = parseLifecycleArgs(process.argv.slice(2));
  const rules = await verifyLifecycle(target);
  process.stdout.write(`${JSON.stringify({ ok: true, ...target, rules }, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
