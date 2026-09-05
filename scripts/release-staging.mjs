import { spawnSync } from "node:child_process";
import { createPrivateKey, randomUUID, sign } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const REPO = "phejet/dubai-missile-command";
const BUNDLE = "com.phejet.dubaicmd.staging";
const API = "https://api.appstoreconnect.apple.com";
const WORKFLOW = "deploy-worker.yml";
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

export function appleToken({ keyId, issuerId, privateKey }, now = Math.floor(Date.now() / 1000)) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const input = `${encode({ alg: "ES256", kid: keyId, typ: "JWT" })}.${encode({ iss: issuerId, iat: now, exp: now + 120, aud: "appstoreconnect-v1" })}`;
  return `${input}.${sign("sha256", Buffer.from(input), { key: privateKey, dsaEncoding: "ieee-p1363" }).toString("base64url")}`;
}

export function additiveList(current, value) {
  const entries = current
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  if (!entries.length) throw new Error("Refusing to replace an empty Staging allowlist.");
  return [...new Set([...entries, value])].join(",");
}

export function selectGroup(groups, requested) {
  const matches = groups.filter((group) => group.attributes.isInternalGroup && (!requested || group.id === requested));
  if (matches.length !== 1)
    throw new Error("Set ASC_INTERNAL_GROUP_ID to one existing internal group for the Staging app.");
  return matches[0];
}

export function verifyManifest(manifest, buildId) {
  if (manifest.flavor !== "staging" || manifest.channel !== "staging" || manifest.buildId !== buildId) {
    throw new Error("Archived native manifest does not match the clean Staging source.");
  }
}

export function verifyDeployment(run, sha) {
  if (
    run.headSha !== sha ||
    run.conclusion !== "success" ||
    run.jobs.find((job) => job.name === "staging")?.conclusion !== "success" ||
    run.jobs.find((job) => job.name === "production")?.conclusion !== "skipped"
  ) {
    throw new Error("Staging deployment was not successful at the expected source, with Production skipped.");
  }
}

function command(bin, args, stream = false) {
  const result = spawnSync(bin, args, {
    cwd: ROOT,
    encoding: "utf8",
    stdio: stream ? "inherit" : "pipe",
    env: { ...process.env, CAP_DEV_SERVER: "" },
  });
  if (result.error || result.status !== 0)
    throw new Error(
      `${bin} ${args[0]} failed; ${stream ? "see output above" : "check command authentication/configuration"}.`,
    );
  return result.stdout?.trim() ?? "";
}
const gh = (...args) => command("gh", [...args, "--repo", REPO]);
const jsonGh = (...args) => JSON.parse(gh(...args));

export function createAppleClient(credentials, fetchImpl = fetch) {
  return async function request(path, method = "GET", body) {
    const url = new URL(path, API);
    if (url.origin !== API) throw new Error("Refusing to send Apple credentials to another origin.");
    const response = await fetchImpl(url, {
      method,
      redirect: "error",
      signal: AbortSignal.timeout(30000),
      headers: { Authorization: `Bearer ${appleToken(credentials)}`, "Content-Type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!response.ok) throw new Error(`Apple API ${method} ${url.pathname}: HTTP ${response.status}.`);
    return response.status === 204 ? null : response.json();
  };
}

async function all(apple, path) {
  const rows = [];
  while (path) {
    const page = await apple(path);
    rows.push(...page.data);
    path = page.links?.next;
  }
  return rows;
}

async function poll(label, fn, minutes = 30) {
  const deadline = Date.now() + minutes * 60000;
  while (Date.now() < deadline) {
    const result = await fn();
    if (result) return result;
    console.log(`${label}; checking again in 20 seconds…`);
    await sleep(20000);
  }
  throw new Error(`${label} timed out. Resume with the printed release record; do not create another upload.`);
}

export async function main(args = process.argv.slice(2)) {
  if (args.includes("--help")) {
    console.log(
      "npm run ios:release:staging -- [--check | --resume <release.json>]\nRequires ASC_KEY_PATH, ASC_KEY_ID, ASC_ISSUER_ID in .env.local or the environment.",
    );
    return;
  }
  const check = args.length === 1 && args[0] === "--check";
  const resume = args.length === 2 && args[0] === "--resume" ? resolve(args[1]) : null;
  if (args.length && !check && !resume) throw new Error("Use --help for supported arguments.");
  if (existsSync(resolve(ROOT, ".env.local"))) process.loadEnvFile(resolve(ROOT, ".env.local"));
  for (const name of ["ASC_KEY_PATH", "ASC_KEY_ID", "ASC_ISSUER_ID"]) {
    if (!process.env[name])
      throw new Error(`Missing ${name}. See docs/staging-testflight-release.md for one-time API setup.`);
  }
  const keyPath = resolve(process.env.ASC_KEY_PATH);
  const credentials = {
    keyId: process.env.ASC_KEY_ID,
    issuerId: process.env.ASC_ISSUER_ID,
    privateKey: createPrivateKey(readFileSync(keyPath)),
  };
  const apple = createAppleClient(credentials);
  const apps = await all(apple, `/v1/apps?filter[bundleId]=${BUNDLE}`);
  if (apps.length !== 1 || apps[0].attributes.bundleId !== BUNDLE)
    throw new Error("Cannot resolve exactly the Staging app.");
  const appId = apps[0].id;
  const group = selectGroup(
    await all(apple, `/v1/apps/${appId}/betaGroups?limit=200`),
    process.env.ASC_INTERNAL_GROUP_ID,
  );
  gh("variable", "get", "ALLOWED_BUILDS", "--env", "staging", "--json", "value", "--jq", ".value");
  command("xcodebuild", ["-version"]);
  console.log(`Apple authentication verified; Staging internal group: ${group.attributes.name}.`);
  if (check) return;

  const sha = command("git", ["rev-parse", "HEAD"]);
  const remoteSha = command("git", ["ls-remote", "origin", "refs/heads/main"]).split(/\s/)[0];
  if (sha !== remoteSha)
    throw new Error("Release source must equal origin/main. Commit and merge the intended changes first.");
  let state;
  let record;
  if (resume) {
    record = resume;
    state = JSON.parse(readFileSync(record, "utf8"));
    if (
      state.schema !== 1 ||
      state.sha !== sha ||
      state.appId !== appId ||
      state.groupId !== group.id ||
      state.bundle !== BUNDLE ||
      dirname(record) !== state.directory
    ) {
      throw new Error("Resume record does not match source, Staging app, group, or directory.");
    }
  } else {
    if (command("git", ["status", "--porcelain"]))
      throw new Error("Use a clean checkout of main for release; existing changes are preserved.");
    const builds = await all(apple, `/v1/builds?filter[app]=${appId}&limit=200`);
    const versions = builds.map((build) => build.attributes.version);
    if (versions.some((version) => !/^\d+$/.test(version)))
      throw new Error("Automatic build numbering requires integer previous build versions.");
    const number = String(Math.max(0, ...versions.map(Number)) + 1);
    if (Number(number) > 9999) throw new Error("Build number range exhausted; review version numbering.");
    const directory = resolve(ROOT, "operator-results", "staging-releases", randomUUID());
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    record = resolve(directory, "release.json");
    state = {
      schema: 1,
      sha,
      buildId: command("git", ["rev-parse", "--short", "HEAD"]),
      number,
      directory,
      appId,
      groupId: group.id,
      bundle: BUNDLE,
    };
  }
  const save = () => writeFileSync(record, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  save();
  console.log(`Release build ${state.number}. Resume record: ${record}`);
  const archive = resolve(state.directory, "App-Staging.xcarchive");
  const auth = [
    "-allowProvisioningUpdates",
    "-authenticationKeyPath",
    keyPath,
    "-authenticationKeyID",
    credentials.keyId,
    "-authenticationKeyIssuerID",
    credentials.issuerId,
  ];
  if (!state.archived) {
    if (command("git", ["status", "--porcelain"]))
      throw new Error("Archive requires a clean checkout; use a fresh checkout to retry an interrupted build.");
    command("npm", ["run", "typecheck"], true);
    command("npm", ["run", "build:ios:staging"], true);
    command("npm", ["run", "cap:sync:staging"], true);
    command(
      "xcodebuild",
      [
        "-project",
        "ios/App/App.xcodeproj",
        "-scheme",
        "App-Staging",
        "-configuration",
        "Staging",
        "-destination",
        "generic/platform=iOS",
        "-archivePath",
        archive,
        `CURRENT_PROJECT_VERSION=${state.number}`,
        ...auth,
        "archive",
      ],
      true,
    );
    state.archived = true;
    save();
  }
  const app = resolve(archive, "Products/Applications/App.app");
  const plist = (key) => command("/usr/libexec/PlistBuddy", ["-c", `Print :${key}`, resolve(app, "Info.plist")]);
  verifyManifest(JSON.parse(readFileSync(resolve(app, "public/dmc-native-build.json"), "utf8")), state.buildId);
  if (
    plist("CFBundleIdentifier") !== BUNDLE ||
    plist("CFBundleVersion") !== state.number ||
    plist("ITSAppUsesNonExemptEncryption") !== "false"
  )
    throw new Error("Archive identity/version/encryption declaration mismatch.");
  const cap = JSON.parse(readFileSync(resolve(app, "capacitor.config.json"), "utf8"));
  if (cap.server?.url) throw new Error("TestFlight archive must not use live reload.");
  command("plutil", ["-lint", resolve(app, "PrivacyInfo.xcprivacy")]);

  if (!state.deployed) {
    for (const [name, value] of [
      ["ALLOWED_BUILDS", state.buildId],
      ["APPLE_BUNDLE_VERSIONS", state.number],
    ]) {
      const current = gh("variable", "get", name, "--env", "staging", "--json", "value", "--jq", ".value");
      const updated = additiveList(current, value);
      if (updated !== current) gh("variable", "set", name, "--env", "staging", "--body", updated);
    }
    if (!state.dispatchId) {
      state.dispatchId = randomUUID();
      save();
      gh("workflow", "run", WORKFLOW, "--ref", "main", "-f", "target=staging", "-f", `release_id=${state.dispatchId}`);
    }
    const run = await poll("Waiting for protected Staging deployment", async () => {
      const runs = jsonGh(
        "run",
        "list",
        "--workflow",
        WORKFLOW,
        "--event",
        "workflow_dispatch",
        "--limit",
        "100",
        "--json",
        "databaseId,displayTitle",
      );
      const found = runs.find((item) => item.displayTitle === `Staging release ${state.dispatchId}`);
      if (!found) return null;
      const detail = jsonGh("run", "view", String(found.databaseId), "--json", "status,conclusion,headSha,jobs,url");
      if (detail.status !== "completed") return null;
      verifyDeployment(detail, sha);
      return detail;
    });
    state.deployed = run.url;
    save();
  }
  if (!state.uploadRequested) {
    const options = resolve(state.directory, "ExportOptions.plist");
    writeFileSync(
      options,
      '<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>method</key><string>app-store-connect</string><key>destination</key><string>upload</string><key>teamID</key><string>5A2PL567F2</string><key>signingStyle</key><string>automatic</string><key>manageAppVersionAndBuildNumber</key><false/></dict></plist>',
    );
    state.uploadRequested = true;
    save();
    command("xcodebuild", ["-exportArchive", "-archivePath", archive, "-exportOptionsPlist", options, ...auth], true);
  }
  const build = await poll("Waiting for Apple processing", async () => {
    const matches = await all(apple, `/v1/builds?filter[app]=${appId}&filter[version]=${state.number}`);
    if (matches.length > 1) throw new Error("Build lookup is ambiguous.");
    const found = matches[0];
    if (!found) return null;
    const status = found.attributes.processingState;
    if (["FAILED", "INVALID"].includes(status)) throw new Error(`Apple processing: ${status}.`);
    if (status !== "VALID") return null;
    if (found.attributes.usesNonExemptEncryption !== false || found.attributes.expired)
      throw new Error("Build compliance/expiry needs attention in App Store Connect.");
    return found;
  });
  const groupPath = `/v1/betaGroups/${group.id}/relationships/builds`;
  if (!(await all(apple, groupPath)).some((item) => item.id === build.id)) {
    await apple(groupPath, "POST", { data: [{ type: "builds", id: build.id }] });
  }
  await poll(
    "Verifying internal group assignment",
    async () => (await all(apple, groupPath)).some((item) => item.id === build.id),
    5,
  );
  state.ready = true;
  state.appleBuildId = build.id;
  save();
  console.log(
    `Staging build ${state.number} is processed and assigned to ${group.attributes.name}. Open TestFlight on the phone and tap Update.`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
