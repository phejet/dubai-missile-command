export interface DisconnectableAudioNode {
  disconnect(): void;
}

export interface AudioNodeLifecycle {
  track<T extends DisconnectableAudioNode>(node: T): T;
  getTrackedCount(): number;
  clear(): void;
}

export function createAudioNodeLifecycle(
  schedule: (callback: () => void, delayMs: number) => unknown = (callback, delayMs) =>
    globalThis.setTimeout(callback, delayMs),
  ttlMs = 3000,
): AudioNodeLifecycle {
  const tracked = new Set<DisconnectableAudioNode>();

  const release = (node: DisconnectableAudioNode): void => {
    if (!tracked.delete(node)) return;
    try {
      node.disconnect();
    } catch {
      // Already-disconnected Web Audio nodes are harmless.
    }
  };

  return {
    track<T extends DisconnectableAudioNode>(node: T): T {
      tracked.add(node);
      schedule(() => release(node), ttlMs);
      return node;
    },
    getTrackedCount: () => tracked.size,
    clear(): void {
      for (const node of [...tracked]) release(node);
    },
  };
}
