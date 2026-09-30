-- Current catalog mechanism probe. Exact retained G6; graph invalidation is preserved.
-- At most 128 deterministically ordered eligible distinct targets, 128 matching chunks/target.
SELECT now() observed_at,current_setting('transaction_read_only') read_only;
WITH edges AS MATERIALIZED (
 SELECT target_media_id FROM recommendation_cowatch_edge
 WHERE generation_id='ba4d332f88695f36230308de1ed88820bdb9ddb5d14f0f4c89b7fba56d9c91b7' AND eligible
 ORDER BY target_media_id,id LIMIT 9001
), target_bound AS MATERIALIZED (
 SELECT DISTINCT target_media_id FROM edges WHERE (SELECT count(*) FROM edges)<=9000 ORDER BY target_media_id LIMIT 129
), targets AS MATERIALIZED (SELECT target_media_id FROM target_bound ORDER BY target_media_id LIMIT 128),
playable_targets AS MATERIALIZED (
 SELECT video.id,playable.video_edition_id
 FROM targets JOIN video ON video.id=targets.target_media_id AND video.deleted_at IS NULL AND NOT('watch'=ANY(video.restrict_view_platforms))
 JOIN LATERAL (
 SELECT locale.id FROM video_locale locale WHERE locale.video_id=video.id AND locale.locale='en' AND locale.status='published' AND locale.deleted_at IS NULL
 ORDER BY CASE WHEN locale.language_slug='english' THEN 0 ELSE 1 END,locale.id LIMIT 1
 ) display ON true
 JOIN LATERAL (
 SELECT dub.video_edition_id FROM video_dub dub JOIN language ON language.id=dub.language_id AND language.slug='english'
 JOIN mux_video mux ON mux.id=dub.mux_video_id AND mux.playback_id IS NOT NULL
 WHERE dub.video_id=video.id AND dub.published=true AND dub.deleted_at IS NULL
 ORDER BY dub.published DESC NULLS LAST,dub.updated_at DESC,dub.id LIMIT 1
 ) playable ON true
), per_target AS MATERIALIZED (
 SELECT t.id,metadata.* FROM playable_targets t
 CROSS JOIN LATERAL (
 SELECT count(*) matching_chunks_observed,count(*)>128 chunk_bound_reached,
 bool_or(ordinal=1 AND usable) first_has_theme,
 bool_or(ordinal>1 AND ordinal<=128 AND usable) later_has_theme,
 bool_or(ordinal<=128 AND usable) any_has_theme
 FROM (
 SELECT chunk_rows.*,row_number() OVER(ORDER BY chunk_index,id) ordinal,
 EXISTS(SELECT 1 FROM unnest(felt_needs[1:16]) label WHERE trim(lower(left(label,64)))<>'') usable
 FROM (
 SELECT chunk.id,chunk.chunk_index,chunk.felt_needs
 FROM video_transcript transcript
 JOIN video_edition edition ON edition.id=transcript.video_edition_id AND edition.deleted_at IS NULL
 JOIN video_transcript_chunk chunk ON chunk.transcript_id=transcript.id AND chunk.language='en'
 WHERE transcript.video_id=t.id AND transcript.video_edition_id=t.video_edition_id AND transcript.language='en'
 AND EXISTS (
 SELECT 1 FROM content_embedding_contract_pointer pointer JOIN content_embedding_contract contract ON contract.id=pointer.active_contract_id
 WHERE pointer.id='content-embedding-contract-pointer'
 AND transcript.embedding_provider=contract.storage_provider AND transcript.model=contract.storage_model
 AND transcript.dimensions=contract.storage_dimensions AND transcript.embedding_native_dimensions=contract.storage_native_dimensions
 AND transcript.embedding_transform_version IS NOT DISTINCT FROM contract.storage_transform_version
 AND chunk.model=contract.storage_model AND chunk.dimensions=contract.storage_dimensions
 ) ORDER BY chunk.chunk_index,chunk.id LIMIT 129
 ) chunk_rows
 ) classified
 ) metadata
)
SELECT (SELECT count(*) FROM edges) eligible_edges_observed,(SELECT count(*)>9000 FROM edges) edge_bound_exceeded,
 (SELECT count(*) FROM target_bound) target_rows_observed,(SELECT count(*)>128 FROM target_bound) target_bound_reached,
 (SELECT count(*) FROM targets) sampled_targets,count(*) playable_sampled_targets,
 count(*) FILTER(WHERE matching_chunks_observed=0) no_matching_active_chunks,
 count(*) FILTER(WHERE first_has_theme) first_chunk_has_usable_theme,
 count(*) FILTER(WHERE NOT first_has_theme AND later_has_theme) first_missing_later_has_usable_theme,
 count(*) FILTER(WHERE matching_chunks_observed>0 AND NOT any_has_theme AND NOT chunk_bound_reached) no_usable_theme_complete_chunk_population,
 count(*) FILTER(WHERE matching_chunks_observed>0 AND NOT any_has_theme AND chunk_bound_reached) no_usable_theme_with_truncated_chunks,
 count(*) FILTER(WHERE chunk_bound_reached) targets_with_chunk_bound_reached,
 sum(matching_chunks_observed) matching_chunk_rows_observed
FROM per_target;
