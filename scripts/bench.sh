#!/bin/bash
set -euo pipefail

# Verified on Xcode 26.3 (17C529):
#   xcrun devicectl device process launch --device <udid> <bundle-id> --payload-url <deep-link>

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

LOOPS=1
WARMUP=0
COOLDOWN_SECONDS=60
TIMEOUT_SECONDS=120
REPLAY_INPUT=""
BASELINE_DIR="${PERF_BASELINE_DIR:-}"

usage() {
  cat <<'EOF'
Usage:
  scripts/bench.sh --list-devices
  scripts/bench.sh <replay-name> [--loop N] [--warmup N] [--cooldown-seconds N] [--timeout-seconds N] [--baseline-dir PATH]

Examples:
  scripts/bench.sh --list-devices
  scripts/bench.sh perf-wave1
  scripts/bench.sh perf-wave4-upgrades --warmup 1 --loop 3

Environment (.env.local):
  MAC_HOSTNAME=YourMacHostName
  IPHONE_UDID=00000000-0000000000000000
  BUNDLE_ID=com.phejet.dubaicmd
  PERF_BASELINE_DIR=perf-results/baselines/<buildId>   # optional pinned baseline root
EOF
}

normalize_replay_key() {
  local value="$1"
  value="${value#/replays/}"
  value="${value#replays/}"
  value="${value%.json}"
  echo "$value"
}

require_env_file() {
  if [[ ! -f ".env.local" ]]; then
    echo "[bench] Missing .env.local. Start from .env.local.example and fill in MAC_HOSTNAME, IPHONE_UDID, and BUNDLE_ID." >&2
    exit 1
  fi

  # shellcheck disable=SC1091
  source ".env.local"

  : "${MAC_HOSTNAME:?MAC_HOSTNAME is required in .env.local}"
  : "${IPHONE_UDID:?IPHONE_UDID is required in .env.local}"
  : "${BUNDLE_ID:?BUNDLE_ID is required in .env.local}"

  if [[ -z "${BASELINE_DIR}" && -n "${PERF_BASELINE_DIR:-}" ]]; then
    BASELINE_DIR="${PERF_BASELINE_DIR}"
  fi
}

probe_dev_server() {
  local lan_host="$MAC_HOSTNAME"
  if [[ "$lan_host" != *.* && "$lan_host" != *:* ]]; then
    lan_host="${lan_host}.local"
  fi
  local probe_url="http://${lan_host}:5173/api/save-perf"
  local http_code
  http_code="$(curl -sS -o /dev/null -w "%{http_code}" -I --max-time 5 "$probe_url" 2>/dev/null)"
  if [[ "$http_code" != "204" ]]; then
    echo "[bench] Perf dev server probe failed (HTTP ${http_code:-000}): $probe_url" >&2
    echo "[bench] Start it with: npm run dev:lan" >&2
    exit 1
  fi
}

list_devices() {
  exec xcrun devicectl list devices
}

extract_json_value() {
  local json_payload="$1"
  local expression="$2"
  PERF_JSON="$json_payload" PERF_EXPR="$expression" node --input-type=module - <<'EOF'
const payload = JSON.parse(process.env.PERF_JSON ?? "{}");
const expr = (process.env.PERF_EXPR ?? "").split(".");
let value = payload;
for (const segment of expr) {
  if (!segment) continue;
  value = value?.[segment];
}
if (value === undefined || value === null) process.exit(1);
if (typeof value === "object") {
  process.stdout.write(JSON.stringify(value));
} else {
  process.stdout.write(String(value));
}
EOF
}

run_launch() {
  local replay_key="$1"
  local run_id="$2"
  local launch_json
  launch_json="$(mktemp -t dmc-bench-launch)"

  # Pass perfSink as an absolute URL so the static Capacitor build (origin: capacitor://localhost)
  # POSTs to the Mac dev server instead of trying capacitor://localhost/api/save-perf.
  local lan_host="$MAC_HOSTNAME"
  if [[ "$lan_host" != *.* && "$lan_host" != *:* ]]; then
    lan_host="${lan_host}.local"
  fi
  local sink_url="http://${lan_host}:5173/api/save-perf"

  xcrun devicectl device process launch \
    --device "$IPHONE_UDID" \
    "$BUNDLE_ID" \
    --terminate-existing \
    --payload-url "dubaimissile://perf?replay=${replay_key}&autoquit=1&runId=${run_id}&perfSink=${sink_url}" \
    --timeout 30 \
    --json-output "$launch_json" >/dev/null

  rm -f "$launch_json"
}

wait_for_report() {
  local run_id="$1"
  node scripts/perf-wait.mjs --run-id "$run_id" --timeout-ms "$((TIMEOUT_SECONDS * 1000))"
}

pick_median_index() {
  local ranked=""
  local index

  for index in "${!measured_p95s[@]}"; do
    ranked+="${measured_p95s[$index]}"$'\t'"${index}"$'\t'"${measured_paths[$index]}"$'\n'
  done

  local line_count
  line_count="${#measured_p95s[@]}"
  printf "%s" "$ranked" | sort -n | sed -n "$((((line_count + 1) / 2)))p" | cut -f2
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --help|-h)
      usage
      exit 0
      ;;
    --list-devices)
      list_devices
      ;;
    --loop)
      LOOPS="${2:-}"
      shift 2
      ;;
    --warmup)
      WARMUP="${2:-}"
      shift 2
      ;;
    --cooldown-seconds)
      COOLDOWN_SECONDS="${2:-}"
      shift 2
      ;;
    --timeout-seconds)
      TIMEOUT_SECONDS="${2:-}"
      shift 2
      ;;
    --baseline-dir)
      BASELINE_DIR="${2:-}"
      shift 2
      ;;
    --*)
      echo "[bench] Unknown flag: $1" >&2
      usage
      exit 1
      ;;
    *)
      if [[ -n "$REPLAY_INPUT" ]]; then
        echo "[bench] Replay already set to $REPLAY_INPUT; unexpected extra argument $1" >&2
        usage
        exit 1
      fi
      REPLAY_INPUT="$1"
      shift
      ;;
  esac
done

if [[ -z "$REPLAY_INPUT" ]]; then
  usage
  exit 1
fi

if ! [[ "$LOOPS" =~ ^[0-9]+$ ]] || ! [[ "$WARMUP" =~ ^[0-9]+$ ]] || ! [[ "$COOLDOWN_SECONDS" =~ ^[0-9]+$ ]] || ! [[ "$TIMEOUT_SECONDS" =~ ^[0-9]+$ ]]; then
  echo "[bench] --loop, --warmup, --cooldown-seconds, and --timeout-seconds must be non-negative integers." >&2
  exit 1
fi

require_env_file
probe_dev_server

REPLAY_KEY="$(normalize_replay_key "$REPLAY_INPUT")"
mkdir -p perf-results/latest

declare -a measured_paths=()
declare -a measured_p95s=()

total_runs=$((WARMUP + LOOPS))
for ((run_index = 1; run_index <= total_runs; run_index++)); do
  is_warmup=0
  if (( run_index <= WARMUP )); then
    is_warmup=1
  fi

  run_label="run"
  if (( is_warmup )); then
    run_label="warmup"
  fi

  run_id="bench-${REPLAY_KEY}-${run_label}-${run_index}-$(date +%s)"
  echo "[bench] Launching ${run_label} ${run_index}/${total_runs}: replay=${REPLAY_KEY} runId=${run_id}"

  run_launch "$REPLAY_KEY" "$run_id"
  wait_json="$(wait_for_report "$run_id")"
  matched_file="$(extract_json_value "$wait_json" "file")"
  p95_value="$(extract_json_value "$wait_json" "summary.p95")"
  build_id="$(extract_json_value "$wait_json" "buildId")"

  echo "[bench] Matched ${matched_file} (build ${build_id}, p95 ${p95_value}ms)"

  if (( ! is_warmup )); then
    measured_paths+=("$matched_file")
    measured_p95s+=("$p95_value")
  fi

  if (( run_index < total_runs )); then
    echo "[bench] Cooling down ${COOLDOWN_SECONDS}s before the next run..."
    sleep "$COOLDOWN_SECONDS"
  fi
done

if (( ${#measured_paths[@]} == 0 )); then
  echo "[bench] No measured runs completed." >&2
  exit 1
fi

selected_index=0
if (( ${#measured_paths[@]} > 1 )); then
  selected_index="$(pick_median_index)"
fi

selected_file="${measured_paths[$selected_index]}"
selected_p95="${measured_p95s[$selected_index]}"
stable_latest="perf-results/latest/${REPLAY_KEY}.json"

cp "$selected_file" "$stable_latest"

echo "[bench] Selected median run: ${selected_file} (p95 ${selected_p95}ms)"
echo "[bench] Stable latest copy: ${stable_latest}"
echo ""

node scripts/perf-analyze.mjs "$selected_file"

if [[ -n "${BASELINE_DIR}" && -e "${BASELINE_DIR}" ]]; then
  echo ""
  node scripts/perf-analyze.mjs --compare "$selected_file" --baseline "$BASELINE_DIR"
else
  echo ""
  echo "[bench] PERF_BASELINE_DIR is not set (or the path does not exist); skipping baseline delta."
fi
