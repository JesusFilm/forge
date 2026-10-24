SELECT set_config('hnsw.iterative_scan','strict_order',true),set_config('hnsw.max_scan_tuples','20000',true);

    WITH seed_candidates AS MATERIALIZED (
      SELECT
        vtc.id,
        vtc.chunk_index,
        vtc.embedding
      FROM video_transcript_chunk vtc
      JOIN video_transcript vt ON vt.id = vtc.transcript_id
      WHERE vt.video_id = 'cmp76xcw602imny01vnsbwwy9'
        AND vt.language = 'zh'
        AND vtc.language = 'zh'
        AND vtc.embedding IS NOT NULL
        AND EXISTS (SELECT 1 FROM content_embedding_contract_pointer p JOIN content_embedding_contract c ON c.id=p.active_contract_id WHERE p.id='content-embedding-contract-pointer' AND vt.embedding_provider=c.storage_provider AND vt.model=c.storage_model AND vt.dimensions=c.storage_dimensions AND vt.embedding_native_dimensions=c.storage_native_dimensions AND vt.embedding_transform_version IS NOT DISTINCT FROM c.storage_transform_version AND vtc.model=c.storage_model AND vtc.dimensions=c.storage_dimensions)
    ),
    bucketed_seed_chunks AS MATERIALIZED (
      SELECT
        id,
        chunk_index,
        embedding,
        ntile(8::int) OVER (
          ORDER BY chunk_index, id
        ) AS seed_bucket
      FROM seed_candidates
    ),
    seed_chunks AS MATERIALIZED (
      SELECT DISTINCT ON (seed_bucket)
        embedding AS seed_embedding
      FROM bucketed_seed_chunks
      ORDER BY seed_bucket, chunk_index, id
    ),
    excluded_video_ids AS MATERIALIZED (
      SELECT 'cmp76xcw602imny01vnsbwwy9'::text AS id
      UNION
      SELECT parent_id FROM video_relation WHERE child_id = 'cmp76xcw602imny01vnsbwwy9'
      UNION
      SELECT child_id FROM video_relation WHERE parent_id = 'cmp76xcw602imny01vnsbwwy9'
    ),
    nearest_chunks AS MATERIALIZED (
      SELECT nearest.*
      FROM seed_chunks seed
      CROSS JOIN LATERAL (
        SELECT
          candidate.id,
          candidate.transcript_id,
          candidate.chunk_index,
          candidate.content_summary,
          candidate.raw_source_text,
          candidate.text,
          candidate.start_seconds,
          candidate.end_seconds,
          candidate.felt_needs,
          candidate.demographics,
          candidate.spiritual_context,
          candidate.embedding,
          1 - (
            candidate.embedding OPERATOR(public.<=>) seed.seed_embedding
          ) AS similarity
        FROM video_transcript_chunk candidate
        WHERE candidate.embedding IS NOT NULL
          AND candidate.language = 'zh'
          -- Keep parent provenance as a scalar filter on the ordered ANN scan.
          -- Joining the parent here can instead plan a full scan/distance sort.
          -- The primary key permits at most one row; missing or incompatible
          -- provenance yields NULL and is rejected before the neighbor limit.
          AND (
            SELECT true
            FROM video_transcript candidate_transcript
            WHERE candidate_transcript.id = candidate.transcript_id
              AND EXISTS (SELECT 1 FROM content_embedding_contract_pointer p JOIN content_embedding_contract c ON c.id=p.active_contract_id WHERE p.id='content-embedding-contract-pointer' AND candidate_transcript.embedding_provider=c.storage_provider AND candidate_transcript.model=c.storage_model AND candidate_transcript.dimensions=c.storage_dimensions AND candidate_transcript.embedding_native_dimensions=c.storage_native_dimensions AND candidate_transcript.embedding_transform_version IS NOT DISTINCT FROM c.storage_transform_version AND candidate.model=c.storage_model AND candidate.dimensions=c.storage_dimensions)
              AND NOT EXISTS (
                SELECT 1
                FROM excluded_video_ids excluded
                WHERE excluded.id = candidate_transcript.video_id
              )
          )
        ORDER BY
          candidate.embedding OPERATOR(public.<=>) seed.seed_embedding
        LIMIT 48
      ) nearest
    ),
    eligible_chunks AS MATERIALIZED (
      SELECT
        vt.video_id,
        v.slug AS video_slug,
        display_locale.title AS video_title,
        v.core_id AS video_core_id,
        nearest.id AS chunk_id,
        nearest.chunk_index AS scene_index,
        COALESCE(
          NULLIF(nearest.content_summary, ''),
          NULLIF(nearest.raw_source_text, ''),
          nearest.text
        ) AS description,
        COALESCE(nearest.start_seconds, 0) AS start_seconds,
        nearest.end_seconds,
        dub_mux.duration_seconds,
        nearest.felt_needs AS themes,
        nearest.demographics,
        nearest.spiritual_context,
        dub_mux.playback_id,
        nearest.similarity,
        nearest.embedding
      FROM nearest_chunks nearest
      JOIN video_transcript vt
        ON vt.id = nearest.transcript_id
        AND vt.language = 'zh'
        AND EXISTS (SELECT 1 FROM content_embedding_contract_pointer p JOIN content_embedding_contract c ON c.id=p.active_contract_id WHERE p.id='content-embedding-contract-pointer' AND vt.embedding_provider=c.storage_provider AND vt.model=c.storage_model AND vt.dimensions=c.storage_dimensions AND vt.embedding_native_dimensions=c.storage_native_dimensions AND vt.embedding_transform_version IS NOT DISTINCT FROM c.storage_transform_version )
      JOIN video v
        ON v.id = vt.video_id
        AND v.deleted_at IS NULL
        AND NOT ('watch' = ANY(v.restrict_view_platforms))
      JOIN LATERAL (
        SELECT vl_display.title
        FROM video_locale vl_display
        WHERE vl_display.video_id = v.id
          AND vl_display.locale = 'zh-hans'
          AND vl_display.status = 'published'
          AND vl_display.deleted_at IS NULL
        ORDER BY
          CASE
            WHEN vl_display.language_slug = 'mandarin-china' THEN 0
            ELSE 1
          END,
          vl_display.language_core_id ASC NULLS LAST,
          vl_display.language_slug ASC NULLS LAST,
          vl_display.id ASC
        LIMIT 1
      ) display_locale ON true
      JOIN LATERAL (
        SELECT
          mv.playback_id,
          COALESCE(
            ROUND(vd.length_in_milliseconds / 1000.0)::int,
            vd.duration
          ) AS duration_seconds
        FROM video_dub vd
        JOIN language lg
          ON lg.id = vd.language_id
          AND lg.slug = 'mandarin-china'
        JOIN mux_video mv
          ON mv.id = vd.mux_video_id
          AND mv.playback_id IS NOT NULL
        WHERE vd.video_edition_id = vt.video_edition_id
          AND vd.deleted_at IS NULL
        ORDER BY vd.published DESC NULLS LAST, vd.updated_at DESC, vd.id ASC
        LIMIT 1
      ) dub_mux ON true
      WHERE EXISTS (
        SELECT 1
        FROM video_locale vl_visible
        WHERE vl_visible.video_id = v.id
          AND vl_visible.locale = 'zh-hans'
          AND vl_visible.status = 'published'
          AND vl_visible.deleted_at IS NULL
      )
    ),
    ranked_chunks AS MATERIALIZED (
      SELECT
        eligible_chunks.*,
        row_number() OVER (
          PARTITION BY video_id
          ORDER BY similarity DESC, scene_index, chunk_id
        ) AS video_rank
      FROM eligible_chunks
    ),
    ordered_candidates AS MATERIALIZED (
      SELECT *
      FROM ranked_chunks
      WHERE video_rank = 1
      ORDER BY similarity DESC, video_id, scene_index
      LIMIT 36
    )
SELECT (SELECT count(*) FROM seed_candidates) seed_chunks,(SELECT count(*) FROM nearest_chunks) nearest_chunks,(SELECT count(DISTINCT transcript_id) FROM nearest_chunks) nearest_transcripts,(SELECT count(*) FROM eligible_chunks) eligible_chunks,(SELECT count(DISTINCT video_id) FROM eligible_chunks) eligible_videos,(SELECT count(*) FROM ordered_candidates) returned_candidates;