// Anonymous per-install identifier. Random, persisted, and not derived from
// anything: no Apple ID, no device fingerprint, nothing reversible to a person.
//
// Two independent things can go wrong, and they mean different things:
//
//   * Minting without WebCrypto. `crypto.randomUUID` requires a secure context,
//     so the insecure `http://<LAN-IP>:5173` iPhone dev shell does not have it.
//     A `Math.random` id is still a perfectly good anonymous label, so this path
//     is unremarkable and persists like any other.
//   * Failing to persist. Then the id lasts exactly one boot, and calling it an
//     "install" id would be a lie that inflates every per-install count that
//     step 5 stores and step 7 gates on. Those ids carry an `eph-` prefix so a
//     consumer can exclude them without guessing.

const STORAGE_KEY = "dmc.install.id.v1";

/** Path-safe by construction: this becomes an R2 key segment at step 5. */
const VALID_INSTALL_ID = /^[a-z0-9-]{8,64}$/;

const EPHEMERAL_PREFIX = "eph-";

let cached: string | null = null;

function readStored(): string | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    // A stored value is attacker-writable on the web build, and it would end up
    // in a storage path. Anything unexpected is discarded rather than escaped.
    return raw && VALID_INSTALL_ID.test(raw) ? raw : null;
  } catch {
    return null;
  }
}

/** Reads back, because private-mode quota failures can be silent. */
function writeStored(value: string): boolean {
  if (typeof localStorage === "undefined") return false;
  try {
    localStorage.setItem(STORAGE_KEY, value);
    return localStorage.getItem(STORAGE_KEY) === value;
  } catch {
    return false;
  }
}

function mint(): string {
  const cryptoApi = typeof globalThis === "undefined" ? undefined : globalThis.crypto;
  if (cryptoApi?.randomUUID) {
    try {
      const uuid = cryptoApi.randomUUID();
      if (VALID_INSTALL_ID.test(uuid)) return uuid;
    } catch {
      // Fall through to the non-secure-context path.
    }
  }
  const chunk = () => Math.random().toString(36).slice(2, 10).padEnd(8, "0");
  return `i-${Date.now().toString(36)}-${chunk()}${chunk()}`;
}

/**
 * The anonymous install id, stable across boots whenever storage allows it.
 * Never throws and never returns an empty string.
 */
export function getInstallId(): string {
  if (cached) return cached;
  const stored = readStored();
  if (stored) {
    cached = stored;
    return cached;
  }
  const minted = mint();
  cached = writeStored(minted) ? minted : `${EPHEMERAL_PREFIX}${minted}`;
  return cached;
}

/** True when the id lasts only for this boot and must not be counted as an install. */
export function isEphemeralInstallId(installId: string): boolean {
  return installId.startsWith(EPHEMERAL_PREFIX);
}

/** Test seam: drops the memoized value so storage is consulted again. */
export function resetInstallIdCache(): void {
  cached = null;
}
