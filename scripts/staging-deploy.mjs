import { spawnSync } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const ENGINE = fileURLToPath(new URL("./release-staging.mjs", import.meta.url));
const OUTPUT = resolve(ROOT, "operator-results");
const RECORD = resolve(OUTPUT, "staging-deploy.json");
const LOCK = resolve(OUTPUT, "staging-deploy.lock");

export function releaseRecordFromLog(log) {
  return log.match(/Resume record: (.+)/)?.[1]?.trim() ?? null;
}

export function releaseStatus(driver, release) {
  return {
    status: release?.ready ? "ready" : driver.status,
    build: release?.number ?? null,
    source: release?.sha ?? driver.source,
    stage: release?.ready
      ? "internal-testers"
      : release?.uploadRequested
        ? "apple-processing"
        : release?.deployed
          ? "upload"
          : release?.archived
            ? "staging-deployment"
            : driver.stage,
    log: driver.log,
    resume: driver.releaseRecord,
  };
}

// Releases run in the shared checkout. Refuse before `npm ci` replaces its dependencies.
export function checkoutProblem({ status, head, remote }) {
  if (status) return "Release needs a clean checkout. Stop and ask the user how to handle local changes.";
  if (head !== remote) return "Release needs this checkout at origin/main. Ask the user before pulling or pushing.";
  return null;
}

export function nextDriver(previous, resume, { output = OUTPUT, now = new Date(), pid = process.pid } = {}) {
  if (resume) {
    if (!previous || previous.status === "ready") throw new Error("No unfinished release to resume.");
    return previous;
  }
  if (previous && previous.status !== "ready")
    throw new Error(
      "Previous release is unfinished. Use --status and --resume; inspect its log if preparation failed.",
    );
  const run = now.toISOString().replace(/[:.]/g, "-");
  return { log: resolve(output, "staging-deploy", run, "release.log"), status: "running", stage: "prepare", pid };
}

function loadDriver() {
  if (!existsSync(RECORD)) return null;
  const driver = JSON.parse(readFileSync(RECORD, "utf8"));
  if (driver.log && existsSync(driver.log))
    driver.releaseRecord ??= releaseRecordFromLog(readFileSync(driver.log, "utf8"));
  return driver;
}

function report(driver) {
  const release =
    driver.releaseRecord && existsSync(driver.releaseRecord)
      ? JSON.parse(readFileSync(driver.releaseRecord, "utf8"))
      : null;
  console.log(JSON.stringify(releaseStatus(driver, release)));
}

function git(...argv) {
  const result = spawnSync("git", argv, { cwd: ROOT, encoding: "utf8" });
  if (result.error || result.status !== 0) throw new Error(`git ${argv[0]} failed.`);
  return result.stdout.trim();
}

export function main(args = process.argv.slice(2)) {
  if (args.includes("--help")) {
    console.log(
      "npm run ios:release:staging -- [--status | --check | --resume]\nDefault: release this checkout, which must be clean and at origin/main. Logs are saved under operator-results.",
    );
    return;
  }
  if (args.length > 1 || (args.length && !["--status", "--check", "--resume"].includes(args[0])))
    throw new Error("Use --help for supported arguments.");
  if (args[0] === "--status") {
    const driver = loadDriver();
    if (driver) report(driver);
    else console.log(JSON.stringify({ status: "no-release" }));
    return;
  }
  if (existsSync(resolve(ROOT, ".env.local"))) process.loadEnvFile(resolve(ROOT, ".env.local"));
  for (const name of ["ASC_KEY_PATH", "ASC_KEY_ID", "ASC_ISSUER_ID"]) {
    if (!process.env[name]) throw new Error(`Missing ${name}; see docs/staging-testflight-release.md.`);
  }
  if (args[0] === "--check") {
    const check = spawnSync(process.execPath, [ENGINE, "--check"], { cwd: ROOT, stdio: "inherit" });
    if (check.status !== 0) throw new Error("Release access check failed.");
    return;
  }
  mkdirSync(OUTPUT, { recursive: true, mode: 0o700 });
  if (existsSync(LOCK)) {
    const pid = Number(readFileSync(LOCK, "utf8"));
    if (!Number.isInteger(pid) || pid <= 0) throw new Error("Release lock needs inspection.");
    try {
      process.kill(pid, 0);
      throw new Error("A Staging release is already running. Use --status.");
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
    unlinkSync(LOCK);
  }
  const lock = openSync(LOCK, "wx", 0o600);
  writeFileSync(lock, String(process.pid));
  closeSync(lock);
  let driver;
  let logFd;
  try {
    driver = nextDriver(loadDriver(), args[0] === "--resume");
    mkdirSync(dirname(driver.log), { recursive: true, mode: 0o700 });
    logFd = openSync(driver.log, "a", 0o600);
    const save = () => writeFileSync(RECORD, `${JSON.stringify(driver, null, 2)}\n`, { mode: 0o600 });
    const run = (bin, argv) => {
      const result = spawnSync(bin, argv, { cwd: ROOT, stdio: ["ignore", logFd, logFd], env: process.env });
      if (result.error || result.status !== 0) throw new Error(`${bin} failed. Details: ${driver.log}`);
    };
    driver.status = "running";
    driver.pid = process.pid;
    save();
    console.log(`Staging release running. Detailed log: ${driver.log}`);
    if (!driver.releaseRecord) {
      run("git", ["fetch", "origin", "main"]);
      const problem = checkoutProblem({
        status: git("status", "--porcelain"),
        head: git("rev-parse", "HEAD"),
        remote: git("rev-parse", "origin/main"),
      });
      if (problem) throw new Error(problem);
      run("npm", ["ci"]);
    }
    driver.stage = "release";
    save();
    run(process.execPath, [ENGINE, ...(driver.releaseRecord ? ["--resume", driver.releaseRecord] : [])]);
    driver.releaseRecord = releaseRecordFromLog(readFileSync(driver.log, "utf8"));
    if (!driver.releaseRecord || !JSON.parse(readFileSync(driver.releaseRecord, "utf8")).ready)
      throw new Error("Release exited without verified readiness.");
    driver.status = "ready";
    save();
    report(driver);
  } catch (error) {
    if (driver) {
      driver.status = "failed";
      if (existsSync(driver.log)) driver.releaseRecord ??= releaseRecordFromLog(readFileSync(driver.log, "utf8"));
      writeFileSync(RECORD, `${JSON.stringify(driver, null, 2)}\n`, { mode: 0o600 });
    }
    throw error;
  } finally {
    if (logFd !== undefined) closeSync(logFd);
    unlinkSync(LOCK);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
