export const SAFE_CAPTURE_ID = /^[A-Za-z0-9._+-]{1,64}$/;
export const SAFE_INSTALL_ID = /^(eph-)?[a-z0-9-]{8,64}$/;
export const SAFE_COMPARISON_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/;
export const SAFE_ARTIFACT_NAME = SAFE_COMPARISON_ID;

export const APP_FLAVORS = Object.freeze(["dev", "staging", "production", "unknown"]);
export const APPLE_ENVIRONMENTS = Object.freeze(["development", "production"]);
export const INPUT_CLASSES = Object.freeze(["touch", "mouse", "unknown"]);
export const SESSION_OUTCOMES = Object.freeze(["burj_destroyed", "survived", "abandoned"]);
export const SESSION_SOURCES = Object.freeze(["gameover", "manual"]);
export const RUN_FEEDBACK_EMOJIS = Object.freeze(["🔥", "👍", "😕", "😤"]);
export const THREAT_TYPES = Object.freeze([
  "ballisticMissile",
  "mirv",
  "mirvWarhead",
  "stackedMissile",
  "bomb",
  "shahed136",
  "shahed238",
  "other",
]);
