#!/usr/bin/env python3
"""Normalize the unfiltered PG snapshot, overlay editorial choices, and reconcile SQL controls."""

import argparse
import csv
import hashlib
import json
from collections import Counter, defaultdict
from pathlib import Path

LEAF_LABELS = {"featureFilm", "shortFilm", "episode", "segment", "trailer", "behindTheScenes"}


def read_rows(path: Path):
    with path.open() as handle:
        for line in handle:
            yield json.loads(line)


def csv_write(path: Path, rows: list[dict], fields: list[str] | None = None) -> None:
    with path.open("w", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields or list(rows[0]), lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)


def nonempty(value) -> bool:
    return isinstance(value, str) and bool(value.strip())


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--raw-dir", required=True, type=Path)
    args = parser.parse_args()
    raw = args.raw_dir
    output = Path(__file__).parent
    manifest = json.loads((raw / "pg-catalog-extraction-manifest.json").read_text())
    verified_files = []
    for item in manifest["files"]:
        path = raw / f"{item['table']}.jsonl"
        assert path.stat().st_size == item["bytes"]
        digest = hashlib.sha256()
        count = 0
        with path.open("rb") as handle:
            for line in handle:
                digest.update(line)
                count += 1
        assert digest.hexdigest() == item["sha256"]
        assert count == item["rows"]
        verified_files.append({**item, "verified": True})
    source_bytes = (output / "admin-preview-source.json").read_bytes()
    source = json.loads(source_bytes)
    choices = source["candidates"]
    editorial = {}
    for choice in choices:
        for index, core_id in enumerate([choice["coreVideoId"], *choice["alternateCoreVideoIds"]]):
            assert core_id not in editorial
            editorial[core_id] = {"choice": choice, "alternate": index > 0}
    videos = {row["id"]: row for row in read_rows(raw / "video.jsonl")}
    languages = {row["id"]: row for row in read_rows(raw / "language.jsonl")}
    video_by_core = {row["core_id"]: row for row in videos.values()}
    assert len(video_by_core) == len(videos)
    assert len({row["core_id"] for row in languages.values()}) == len(languages)
    assert all(core_id in video_by_core for core_id in editorial)
    language_names = defaultdict(list)
    for row in read_rows(raw / "language_locale.jsonl"):
        language_names[row["language_id"]].append(row)
    displays = defaultdict(list)
    for row in read_rows(raw / "video_locale.jsonl"):
        assert row["video_id"] in videos
        displays[row["video_id"]].append(row)
    display_groups = defaultdict(list)
    for rows in displays.values():
        for row in rows:
            display_groups[row["locale"]].append(row)
    csv_write(output / "pg-catalog-display-locales.csv", [{"exactLocale": locale, "rawRows": len(rows), "rawDistinctVideos": len({row["video_id"] for row in rows}), "publishedRows": sum(row["status"] == "published" for row in rows), "deletedRows": sum(row["deleted_at"] is not None for row in rows), "publishedNondeletedNonemptyTitleVideos": len({row["video_id"] for row in rows if row["status"] == "published" and row["deleted_at"] is None and nonempty(row["title"])})} for locale, rows in sorted(display_groups.items(), key=lambda item: item[0] or "")])
    images = defaultdict(list)
    for row in read_rows(raw / "video_image.jsonl"):
        assert row["video_id"] in videos
        images[row["video_id"]].append(row)
    children, parents = defaultdict(set), defaultdict(set)
    relation_rows = []
    for row in read_rows(raw / "video_relation.jsonl"):
        parent, child = videos[row["parent_id"]], videos[row["child_id"]]
        children[parent["id"]].add(child["id"])
        parents[child["id"]].add(parent["id"])
        relation_rows.append({"relationId": row["id"], "parentVideoId": parent["id"], "parentCoreId": parent["core_id"], "parentLabel": parent["label"], "childVideoId": child["id"], "childCoreId": child["core_id"], "childLabel": child["label"], "order": row["order"]})
    csv_write(output / "pg-catalog-relations.csv", relation_rows)
    keywords = {row["id"]: row for row in read_rows(raw / "keyword.jsonl")}
    video_keywords = defaultdict(list)
    keyword_rows = []
    for row in read_rows(raw / "video_keyword.jsonl"):
        video, keyword = videos[row["video_id"]], keywords[row["keyword_id"]]
        video_keywords[video["id"]].append(keyword)
        keyword_rows.append({"videoId": video["id"], "videoCoreId": video["core_id"], "keywordId": keyword["id"], "keywordCoreId": keyword["core_id"], "value": keyword["value"], "languageId": keyword["language_id"], "keywordDeletedAt": keyword["deleted_at"]})
    csv_write(output / "pg-catalog-keyword-links.csv", keyword_rows)
    transcripts = defaultdict(Counter)
    for row in read_rows(raw / "video_transcript.jsonl"):
        assert row["video_id"] in videos
        transcripts[row["video_id"]][row["language"]] += 1
    assert sum(row["chunks"] for row in read_rows(raw / "transcript_chunk_counts.jsonl")) == manifest["independentCounts"]["video_transcript_chunk"]

    variant_health = json.loads((output / "video-variants-persian-sign-stream-health.json").read_text())
    exact_health = {row["variantCoreId"]: row for row in variant_health["rows"]}
    pair_health = json.loads((output / "media-validation.json").read_text())
    pair_observations = {(row["coreVideoId"], row["audioLanguageSlug"]): row for row in pair_health["videos"]}
    sets = defaultdict(lambda: defaultdict(set))
    dub_counts = Counter()
    video_sets = defaultdict(lambda: defaultdict(set))
    video_dub_counts = Counter()
    counters = Counter()
    observed_exact = set()
    all_pairs = set()
    all_video_ids = set()
    all_language_ids = set()
    dub_ids = set()
    edition_links = Counter()
    dub_fields = ["dubId", "variantCoreId", "videoId", "videoCoreId", "videoLabel", "languageId", "languageCoreId", "audioLanguageSlug", "editionId", "editionCoreId", "muxVideoId", "published", "dubDeletedAt", "videoDeletedAt", "languageDeletedAt", "editionDeletedAt", "muxDeletedAt", "watchRestricted", "hlsUrl", "dashUrl", "muxPlaybackId", "hasDeclaredHls", "hasDeclaredMux", "activePublishedVariant", "durationMilliseconds", "durationSeconds", "syncedAt", "editorialChoiceCoreId", "editorialHeld", "exactVariantHealth", "exactVariantHealthObservedAt", "videoLanguagePairProbe", "pairProbeObservedAt"]
    normalized_dubs = raw / "pg-catalog-all-dubs.csv"
    with normalized_dubs.open("w", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=dub_fields, lineterminator="\n")
        writer.writeheader()
        for row in read_rows(raw / "video_dub.jsonl"):
            assert row["id"] not in dub_ids
            dub_ids.add(row["id"])
            vid, lid = row["video_id"], row["language_id"]
            assert row["joined_video_id"] == vid
            assert lid is None or row["joined_language_id"] == lid
            assert row["video_edition_id"] is None or row["joined_edition_id"] == row["video_edition_id"]
            assert row["mux_video_id"] is None or row["joined_mux_id"] == row["mux_video_id"]
            all_pairs.add((vid, lid))
            all_video_ids.add(vid)
            if lid is not None:
                all_language_ids.add(lid)
            else:
                counters["nullDubLanguage"] += 1
            counters["nullDubMux"] += row["mux_video_id"] is None
            hls, mux = nonempty(row["hls"]), nonempty(row["mux_playback_id"])
            active = bool(row["published"] and row["deleted_at"] is None and row["video_deleted_at"] is None and lid is not None and row["language_deleted_at"] is None and (row["video_edition_id"] is None or row["edition_deleted_at"] is None))
            active_source = hls or (mux and row["mux_deleted_at"] is None)
            leaf = row["video_label"] in LEAF_LABELS
            choice = editorial.get(row["video_core_id"], {}).get("choice")
            held = bool(choice and choice.get("sensitivityReviewRequired"))
            counts, vsets = sets[lid], video_sets[vid]
            counts["rawVideos"].add(vid)
            if leaf: counts["rawLeafVideos"].add(vid)
            if row["video_label"] == "collection": counts["rawCollectionVideos"].add(vid)
            if row["video_label"] == "series": counts["rawSeriesVideos"].add(vid)
            if hls or mux: counts["rawVideosWithDeclaredSource"].add(vid)
            if active and active_source:
                counts["publishedVideosWithDeclaredSource"].add(vid)
                if leaf:
                    counts["publishedLeafDeclaredSources"].add(vid)
                    counts["curatedDeclaredLeafReferences" if choice else "uncuratedDeclaredLeafVideos"].add(vid)
                    if choice:
                        counts["curatedEditorialChoicesWithDeclaredLeafSource"].add(choice["coreVideoId"])
                    if choice and not held:
                        counts["approvedCuratedDeclaredLeafReferences"].add(vid)
                        counts["approvedEditorialChoicesWithDeclaredLeafSource"].add(choice["coreVideoId"])
                    if hls: counts["publishedLeafHls"].add(vid)
                    if mux and row["mux_deleted_at"] is None: counts["publishedLeafMux"].add(vid)
                    if hls and not (mux and row["mux_deleted_at"] is None): counts["publishedLeafHlsOnly"].add(vid)
                    if "watch" not in row["restrict_view_platforms"]: counts["watchUnrestrictedPublishedLeafDeclared"].add(vid)
                elif row["video_label"] == "collection": counts["publishedCollectionDeclaredSources"].add(vid)
                elif row["video_label"] == "series": counts["publishedSeriesDeclaredSources"].add(vid)
                vsets["declaredSourceLanguages"].add(lid)
            if lid is not None: vsets["rawLanguageIds"].add(lid)
            if active and hls: vsets["hlsLanguages"].add(lid)
            if active and mux and row["mux_deleted_at"] is None: vsets["muxLanguages"].add(lid)
            if row["video_edition_id"]: vsets["editionIds"].add(row["video_edition_id"])
            edition_links[(vid, row["video_edition_id"])] += 1
            dub_counts[lid] += 1
            video_dub_counts[vid] += 1
            counters["dubRowsWithHls"] += hls
            counters["dubRowsWithMuxPlayback"] += mux
            counters["deletedDubRows"] += row["deleted_at"] is not None
            counters["unpublishedDubRows"] += not row["published"]
            observed = exact_health.get(row["core_id"])
            health = "untested"
            if observed:
                assert observed["videoCoreId"] == row["video_core_id"]
                observed_exact.add(row["core_id"])
                health = "manifest_pass" if observed["hlsHeader"] else "manifest_failed"
                counts[health].add(vid)
            paired = pair_observations.get((row["video_core_id"], row["language_slug"]))
            pair_status = ("manifest_pass_pair_only" if paired["hls"]["ok"] else "manifest_failed_pair_only") if paired else "untested"
            writer.writerow(dict(zip(dub_fields, [row["id"], row["core_id"], vid, row["video_core_id"], row["video_label"], lid, row["language_core_id"], row["language_slug"], row["video_edition_id"], row["edition_core_id"], row["mux_video_id"], row["published"], row["deleted_at"], row["video_deleted_at"], row["language_deleted_at"], row["edition_deleted_at"], row["mux_deleted_at"], "watch" in row["restrict_view_platforms"], row["hls"], row["dash"], row["mux_playback_id"], hls, mux, active, row["length_in_milliseconds"], row["duration"], row["synced_at"], choice and choice["coreVideoId"], held, health, variant_health["observedAt"] if observed else None, pair_status, pair_health["finishedAt"] if paired else None])))
    counters["dubDistinctVideos"] = len(all_video_ids)
    counters["dubDistinctLanguages"] = len(all_language_ids)
    counters["videoLanguagePairsIncludingNull"] = len(all_pairs)
    for key in ["dubDistinctVideos", "dubDistinctLanguages", "videoLanguagePairsIncludingNull", "dubRowsWithHls", "dubRowsWithMuxPlayback", "nullDubLanguage", "nullDubMux"]:
        assert counters[key] == manifest["invariants"][key], (key, counters[key], manifest["invariants"][key])
    assert len(dub_ids) == manifest["independentCounts"]["video_dub"]
    assert observed_exact == set(exact_health)
    for check in manifest["independentLanguageCounts"]:
        lid = check["language_id"]
        assert dub_counts[lid] == check["dub_rows"]
        for metric, column in [("rawVideos", "distinct_videos"), ("rawLeafVideos", "leaf_videos"), ("rawCollectionVideos", "collection_videos"), ("rawSeriesVideos", "series_videos"), ("publishedLeafDeclaredSources", "published_leaf_declared_sources")]:
            assert len(sets[lid][metric]) == check[column], (lid, metric)

    prior = {}
    with (output / "all-context-web-default-coverage.csv").open() as handle:
        prior = {row["audioLanguageSlug"]: row for row in csv.DictReader(handle)}
    metric_names = ["rawVideos", "rawLeafVideos", "rawCollectionVideos", "rawSeriesVideos", "rawVideosWithDeclaredSource", "publishedVideosWithDeclaredSource", "publishedLeafDeclaredSources", "publishedLeafHls", "publishedLeafMux", "publishedLeafHlsOnly", "publishedCollectionDeclaredSources", "publishedSeriesDeclaredSources", "watchUnrestrictedPublishedLeafDeclared", "curatedDeclaredLeafReferences", "approvedCuratedDeclaredLeafReferences", "curatedEditorialChoicesWithDeclaredLeafSource", "approvedEditorialChoicesWithDeclaredLeafSource", "uncuratedDeclaredLeafVideos", "manifest_pass", "manifest_failed"]
    language_rows = []
    for lid, language in sorted(languages.items(), key=lambda item: item[1]["slug"] or ""):
        canonical = [row for row in language_names[lid] if row["deleted_at"] is None]
        english_name = next((row["value"] for row in canonical if row["locale"] == "en"), "")
        names = {row["locale"]: row["value"] for row in canonical}
        old = prior.get(language["slug"], {})
        row = {"languageId": lid, "coreLanguageId": language["core_id"], "audioLanguageSlug": language["slug"], "canonicalEnglishName": english_name, "canonicalNameLocales": "|".join(sorted(names)), "legacyEnglishNameMirror": language["name"].get("en", ""), "bcp47": language["bcp47"], "iso3": language["iso3"], "source": language["source"], "deletedAt": language["deleted_at"], "syncedAt": language["synced_at"], "rawDubRows": dub_counts[lid]}
        row.update({metric: len(sets[lid][metric]) for metric in metric_names})
        row.update({"currentWebDisplayLocale": old.get("locale", ""), "priorCurrentRecommendationStartUnique": old.get("startUnique", ""), "priorCurrentRecommendationEligibleIdCeiling": old.get("eligibleVideoIdsUpperBound", ""), "rawLeafInventoryMeaning": "declared metadata; canonical identity and stream health not guaranteed"})
        language_rows.append(row)
    csv_write(output / "pg-catalog-languages.csv", language_rows)
    def title_for(vid):
        english = [row for row in displays[vid] if row["locale"] == "en" and nonempty(row["title"])]
        english.sort(key=lambda row: (row["deleted_at"] is not None, row["status"] != "published", row["language_core_id"] or "", row["id"]))
        return english[0]["title"] if english else ""
    video_rows = []
    for vid, video in sorted(videos.items(), key=lambda item: item[1]["core_id"]):
        choice = editorial.get(video["core_id"], {}).get("choice")
        published = {row["locale"] for row in displays[vid] if row["status"] == "published" and row["deleted_at"] is None and nonempty(row["title"])}
        paired = pair_observations.get((video["core_id"], "english"))
        pair_status = ("passed_pair_only" if paired["hls"]["ok"] else "failed_pair_only") if paired else "untested"
        row = {"videoId": vid, "coreVideoId": video["core_id"], "slug": video["slug"], "label": video["label"], "englishTitle": title_for(vid), "source": video["source"], "videoSource": video["video_source"], "publishedAt": video["published_at"], "deletedAt": video["deleted_at"], "watchRestricted": "watch" in video["restrict_view_platforms"], "syncedAt": video["synced_at"], "primaryLanguageId": video["primary_language_id"], "originId": video["origin_id"], "rawDubRows": video_dub_counts[vid], "rawAudioLanguages": len(video_sets[vid]["rawLanguageIds"]), "publishedDeclaredSourceLanguages": len(video_sets[vid]["declaredSourceLanguages"]), "publishedHlsLanguages": len(video_sets[vid]["hlsLanguages"]), "publishedMuxLanguages": len(video_sets[vid]["muxLanguages"]), "editionIds": "|".join(sorted(video_sets[vid]["editionIds"])), "parentCoreIds": "|".join(sorted(videos[key]["core_id"] for key in parents[vid])), "childCoreIds": "|".join(sorted(videos[key]["core_id"] for key in children[vid])), "displayRows": len(displays[vid]), "publishedDisplayLocales": "|".join(sorted(str(locale) for locale in published)), "imageRows": len(images[vid]), "keywordValues": "|".join(sorted({row["value"] for row in video_keywords[vid] if row["deleted_at"] is None})), "transcriptRows": sum(transcripts[vid].values()), "transcriptLanguages": "|".join(sorted(transcripts[vid])), "editorialChoiceCoreId": choice and choice["coreVideoId"], "editorialHeld": bool(choice and choice.get("sensitivityReviewRequired")), "editorialThemes": "|".join(choice["themeKeys"]) if choice else "", "existingEnglishPairManifestProbe": pair_status}
        video_rows.append(row)
    csv_write(output / "pg-catalog-videos.csv", video_rows)
    uncurated = [row for row in video_rows if not row["editorialChoiceCoreId"] and row["label"] in LEAF_LABELS and row["publishedDeclaredSourceLanguages"] > 0]
    csv_write(output / "pg-catalog-uncurated-candidates.csv", uncurated, list(video_rows[0]))
    editorial_rows = []
    for core_id, member in editorial.items():
        video, choice = video_by_core[core_id], member["choice"]
        audio_ids = video_sets[video["id"]]["declaredSourceLanguages"]
        editorial_rows.append({"choiceCoreId": choice["coreVideoId"], "referenceCoreId": core_id, "isAlternate": member["alternate"], "videoId": video["id"], "label": video["label"], "englishTitle": title_for(video["id"]), "editorialRank": choice["editorialRank"], "startPool": choice["startPool"], "held": choice.get("sensitivityReviewRequired", False), "themeKeys": "|".join(choice["themeKeys"]), "rawAudioLanguages": len(video_sets[video["id"]]["rawLanguageIds"]), "publishedDeclaredSourceLanguages": len(audio_ids), "declaredAudioSlugs": "|".join(sorted(languages[lid]["slug"] or f"core:{languages[lid]['core_id']}" for lid in audio_ids)), "rationale": choice["rationale"]})
    csv_write(output / "pg-catalog-editorial-map.csv", editorial_rows)
    csv_write(output / "pg-catalog-edition-links.csv", [{"videoId": vid, "coreVideoId": videos[vid]["core_id"], "editionId": eid, "dubRows": count} for (vid, eid), count in edition_links.items()])
    raw_manifest = {key: value for key, value in manifest.items() if key not in {"independentLanguageCounts", "queries"}}
    raw_manifest["files"] = verified_files + [{"table": "normalized_all_dubs", "rows": len(dub_ids), "bytes": normalized_dubs.stat().st_size, "sha256": hashlib.sha256(normalized_dubs.read_bytes()).hexdigest(), "path": str(normalized_dubs), "verified": True}]
    (output / "pg-catalog-raw-manifest.json").write_text(json.dumps(raw_manifest, indent=2) + "\n")
    available = [row for row in language_rows if row["audioLanguageSlug"] and not row["deletedAt"]]
    summary = {"status": "rebuilt-unfiltered-local-PG-catalog-with-separated-derived-inventory", "snapshotAt": manifest["snapshotAt"], "database": manifest["database"], "editorialSourceVersion": source["version"], "editorialSourceSha256": hashlib.sha256(source_bytes).hexdigest(), "rawTableCounts": manifest["independentCounts"], "videoLabels": dict(Counter(row["label"] for row in videos.values())), "videoSourceTiers": dict(Counter(row["source"] for row in videos.values())), "languageSourceTiers": dict(Counter(row["source"] for row in languages.values())), "sourceTiersAndSyncRanges": manifest["sourceTiers"], "editorialChoices": len(choices), "editorialCoreReferences": len(editorial), "resolvedEditorialReferences": len(editorial_rows), "uncuratedLeafVideosWithPublishedDeclaredSources": len(uncurated), "languagesWithSixPublishedLeafDeclaredSources": sum(row["publishedLeafDeclaredSources"] >= 6 for row in available), "languagesWithThirtyPublishedLeafDeclaredSources": sum(row["publishedLeafDeclaredSources"] >= 30 for row in available), "nondeletedNamedLanguages": len(available), "nullLanguageDubRows": counters["nullDubLanguage"], "orphanAndIdentityChecks": manifest["invariants"], "priorExactVariantHealth": {"observedAt": variant_health["observedAt"], "matchedVariantIds": len(observed_exact), "passedManifest": variant_health["hlsHeadersPassed"], "failedManifest": len(observed_exact) - variant_health["hlsHeadersPassed"], "allOtherVariantRows": "untested-at-exact-variant-identity-by-reused-evidence"}, "priorVideoLanguagePairHealth": {"finishedAt": pair_health["finishedAt"], "pairs": len(pair_observations), "meaning": "one selected English dub per Core reference; cannot assign success to every variant sharing that pair"}, "validation": {"passed": True, "verifiedRawFiles": len(verified_files), "normalizedDubRows": len(dub_ids), "independentPerLanguageSQLComparisons": len(manifest["independentLanguageCounts"]), "transcriptChunkCountReconciled": True, "allEditorialIdsResolved": True, "allExistingPersianVariantObservationsMatched": True}}
    (output / "pg-catalog-summary.json").write_text(json.dumps(summary, indent=2) + "\n")
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
