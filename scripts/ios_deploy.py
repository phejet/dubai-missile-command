#!/usr/bin/env python3
"""Build and install the Dubai Missile Command Capacitor iOS app on a connected iPhone.

This is the deterministic workhorse behind the `ios-iphone-deploy` skill. It mirrors
`npm run ios:deploy` (build:ios -> cap:sync -> ios:install) but adds preflight checks
and *categorized* exit codes so a caller (human, CI, or agent) can tell exactly which
stage failed and respond appropriately.

Exit codes:
  0  success
  2  bad config        (missing .env.local or IPHONE_UDID)
  3  no device         (iPhone not found / devicectl unavailable)
  4  app build failed  (Vite/TypeScript) -- the only failure that may need code fixes
  5  cap sync failed
  6  install failed    (xcodebuild / signing / devicectl install)
  7  launch failed     (--launch only; install already succeeded)

Usage:
  python3 scripts/ios_deploy.py [--launch] [--skip-device-check]
"""
from __future__ import annotations

import argparse
import os
import subprocess
import sys
from pathlib import Path
from typing import NoReturn

REPO_ROOT = Path(__file__).resolve().parent.parent
ENV_FILE = REPO_ROOT / ".env.local"
APP_PATH = REPO_ROOT / "ios/App/build/Build/Products/Release-iphoneos/App.app"
DEFAULT_BUNDLE_ID = "com.phejet.dubaicmd"

# Exit codes (see module docstring).
EXIT_OK = 0
EXIT_CONFIG = 2
EXIT_DEVICE = 3
EXIT_BUILD = 4
EXIT_SYNC = 5
EXIT_INSTALL = 6
EXIT_LAUNCH = 7


def fail(code: int, message: str, *fix_lines: str) -> "NoReturn":
    print(f"\n✗ {message}", file=sys.stderr)
    for line in fix_lines:
        print(f"  {line}", file=sys.stderr)
    sys.exit(code)


def parse_env_local() -> dict[str, str]:
    """Parse .env.local as plain KEY=VALUE lines (matching the `. ./.env.local` sourcing)."""
    if not ENV_FILE.exists():
        fail(
            EXIT_CONFIG,
            ".env.local is missing.",
            "Copy it from the template and fill in your device UUID:",
            "  cp .env.local.example .env.local",
        )
    env: dict[str, str] = {}
    for raw in ENV_FILE.read_text().splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        env[key.strip()] = value.strip().strip('"').strip("'")
    return env


def run(label: str, cmd: list[str], fail_code: int, *, env: dict[str, str] | None = None) -> None:
    """Stream a subprocess; on non-zero exit, abort with the given category code."""
    print(f"\n→ {label}\n  $ {' '.join(cmd)}", flush=True)
    result = subprocess.run(cmd, cwd=REPO_ROOT, env=env)
    if result.returncode != 0:
        fail(fail_code, f"{label} failed (exit {result.returncode}). See output above.")


def check_device(udid: str) -> None:
    try:
        listing = subprocess.run(
            ["xcrun", "devicectl", "list", "devices"],
            cwd=REPO_ROOT,
            capture_output=True,
            text=True,
        )
    except FileNotFoundError:
        fail(EXIT_DEVICE, "xcrun not found. Install Xcode command-line tools (xcode-select --install).")
    if listing.returncode != 0:
        fail(EXIT_DEVICE, "Could not list devices via devicectl.", listing.stderr.strip())
    if udid not in listing.stdout:
        fail(
            EXIT_DEVICE,
            f"IPHONE_UDID {udid} was not found among connected devices.",
            "Unlock and trust the iPhone, reconnect the cable, then:",
            "  xcrun devicectl list devices",
        )


def main() -> int:
    parser = argparse.ArgumentParser(description="Build and install the iOS app on a connected iPhone.")
    parser.add_argument("--launch", action="store_true", help="Launch the app on the device after install.")
    parser.add_argument(
        "--skip-device-check",
        action="store_true",
        help="Skip the pre-build devicectl presence check (install will still fail if absent).",
    )
    args = parser.parse_args()

    config = parse_env_local()
    udid = config.get("IPHONE_UDID", "").strip()
    if not udid or udid.startswith("0000000000"):
        fail(
            EXIT_CONFIG,
            "IPHONE_UDID is not set (or still the placeholder) in .env.local.",
            "Find your device UUID with:  xcrun devicectl list devices",
        )
    bundle_id = config.get("BUNDLE_ID", "").strip() or DEFAULT_BUNDLE_ID

    if not args.skip_device_check:
        check_device(udid)

    # 1. Production web build with the Capacitor flag.
    build_env = {**os.environ, "CAPACITOR": "1"}
    run("Building web app (CAPACITOR=1 vite build)", ["npx", "vite", "build"], EXIT_BUILD, env=build_env)

    # 2. Sync dist/ into the native iOS project.
    run("Syncing Capacitor (npx cap sync ios)", ["npx", "cap", "sync", "ios"], EXIT_SYNC)

    # 3. Build the signed release .app and install it on the device.
    run(
        "Building iOS release (xcodebuild)",
        [
            "xcodebuild",
            "-project", "ios/App/App.xcodeproj",
            "-scheme", "App",
            "-configuration", "Release",
            "-destination", "generic/platform=iOS",
            "-derivedDataPath", "ios/App/build",
            "-allowProvisioningUpdates",
            "build",
        ],
        EXIT_INSTALL,
    )
    if not APP_PATH.exists():
        fail(EXIT_INSTALL, f"Expected build product is missing: {APP_PATH}")
    run(
        "Installing app on device (devicectl)",
        ["xcrun", "devicectl", "device", "install", "app", "--device", udid, str(APP_PATH)],
        EXIT_INSTALL,
    )

    if args.launch:
        run(
            "Launching app on device",
            ["xcrun", "devicectl", "device", "process", "launch", "--device", udid, bundle_id],
            EXIT_LAUNCH,
        )

    print(f"\n✓ Deployed to device {udid}" + (f" and launched {bundle_id}" if args.launch else ""))
    return EXIT_OK


if __name__ == "__main__":
    sys.exit(main())
