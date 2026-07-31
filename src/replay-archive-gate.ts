export const REPLAY_ARCHIVE_GATE_TIMEOUT_MS = 5_000;
export const REPLAY_ARCHIVE_PREPARING_DELAY_MS = 150;

export function createReplayArchiveGate(persistence: Promise<unknown>): Promise<void> {
  return new Promise((resolve) => {
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(finish, REPLAY_ARCHIVE_GATE_TIMEOUT_MS);
    void persistence.then(finish, finish);
  });
}
