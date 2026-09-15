-- Read-only seven-day diagnostic. Group by delivery cohort, never export identities.
WITH slates AS MATERIALIZED (
  SELECT request.id, first_item.candidate_provenance->>'cohort' AS cohort
  FROM recommendation_request request
  JOIN recommendation_served_item first_item
    ON first_item.request_id = request.id AND first_item.position = 0
  WHERE request.purpose = 'user' AND request.surface_version = 'watch-for-you-v1'
    AND request.state = 'issued' AND request.issued_at >= now() - interval '7 days'
    AND request.expires_at > now()
), outcomes AS MATERIALIZED (
  SELECT episode.id, episode.selection_id
  FROM recommendation_playback_episode episode
  JOIN recommendation_outcome_revision outcome ON outcome.episode_id = episode.id
    AND outcome.classifier_version = 'active-watch-proxy-v1' AND outcome.qualified_view
    AND outcome.fact_watermark = episode.next_fact_sequence - 1 AND outcome.expires_at > now()
  JOIN recommendation_eligibility_decision decision ON decision.outcome_id = outcome.id
    AND decision.is_current AND decision.state = 'eligible'
    AND decision.policy_version = 'recommendation-integrity-v1'
    AND 'profile' = ANY(decision.eligible_scopes) AND decision.expires_at > now()
  WHERE episode.state = 'finalized' AND episode.conflict_count = 0 AND episode.expires_at > now()
    AND NOT EXISTS (SELECT 1 FROM recommendation_outcome_revision newer WHERE newer.supersedes_id = outcome.id)
    AND NOT EXISTS (SELECT 1 FROM recommendation_playback_fact fact WHERE fact.episode_id = episode.id AND fact.late)
)
SELECT slate.cohort,
  count(DISTINCT slate.id) AS delivered_slates,
  count(DISTINCT slate.id) FILTER (WHERE impression.id IS NOT NULL) AS displayed_slates,
  count(DISTINCT selection.id) AS selected_items,
  count(DISTINCT episode.id) AS claimed_episodes,
  count(DISTINCT outcomes.id) AS qualified_episodes,
  count(DISTINCT slate.id) FILTER (WHERE outcomes.id IS NOT NULL) AS slates_with_qualified_view
FROM slates slate
LEFT JOIN recommendation_served_item item ON item.request_id = slate.id
LEFT JOIN recommendation_impression impression ON impression.request_id = slate.id
  AND impression.item_id = item.id AND impression.visibility_policy = 'watch-for-you-v1'
  AND impression.expires_at > now()
LEFT JOIN recommendation_selection selection ON selection.item_id = item.id
  AND selection.attribution_eligible_at IS NOT NULL
  AND impression.expires_at >= selection.attribution_eligible_at AND selection.expires_at > now()
LEFT JOIN recommendation_playback_episode episode ON episode.selection_id = selection.id
  AND episode.claimed_at IS NOT NULL AND episode.expires_at > now()
LEFT JOIN outcomes ON outcomes.id = episode.id
GROUP BY slate.cohort ORDER BY slate.cohort;
