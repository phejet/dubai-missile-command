SELECT
  run_id,
  install_id,
  install_ephemeral,
  received_at,
  build,
  app_flavor,
  apple_environment,
  platform,
  input_class,
  source,
  outcome,
  death_cause,
  wave_reached,
  score,
  time_played_ms,
  burj_health,
  shots_fired,
  total_kills,
  hit_ratio,
  multi_shots,
  max_combo,
  destroyed_by_type_json,
  upgrades_json,
  feedback_emoji,
  CASE WHEN replay_sha256 IS NULL THEN 0 ELSE 1 END AS replay_present,
  replay_omitted_reason,
  replay_complete_claimed,
  replay_verified,
  shared
FROM sessions
WHERE received_at >= MAX(
    {{RECEIVED_FROM_MS}},
    CAST(strftime('%s', 'now') AS INTEGER) * 1000 - 31536000000
  )
  AND received_at < {{RECEIVED_TO_MS}}
  AND build IN ({{BUILD_LIST}})
ORDER BY received_at ASC, run_id ASC;
