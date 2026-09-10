#!/usr/bin/env python3
"""Reproduce Core-only coverage and export draft exact-audio fallback pools."""

import argparse
import collections
import csv
import hashlib
import itertools
import json
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent
LEAF_LABELS = {"shortFilm", "featureFilm", "episode", "segment"}


def read_json(path):
    return json.loads(path.read_text())


def csv_write(path, fields, rows):
    with path.open("w", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=fields, lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)


def csv_read(path):
    with path.open(newline="") as stream:
        return list(csv.DictReader(stream))


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def project_snapshot(snapshot):
    """Retain enough source evidence to reproduce counts without huge dub rows."""
    sources = {key: read_json(snapshot / f"{key}.json") for key in (
        "videos", "languages", "videoVariants"
    )}
    videos = {row["id"]: row for row in sources["videos"]["videos"]}
    languages = sources["languages"]["languages"]
    variants = sources["videoVariants"]["videoVariants"]
    assert len(videos) == len(sources["videos"]["videos"])
    assert len({row["id"] for row in languages}) == len(languages)
    assert len({row["id"] for row in variants}) == len(variants)
    by_video = collections.defaultdict(list)
    for variant in variants:
        by_video[variant["videoId"]].append(variant)
    rows = []
    for core_id, video in sorted(videos.items()):
        dubs = by_video[core_id]
        published = [dub for dub in dubs if dub["published"] and dub.get("language")]
        hls = [dub for dub in published if dub["hasHls"]]
        durations = sorted(dub["duration"] for dub in hls if dub["duration"] is not None)
        rows.append({
            "coreVideoId": core_id,
            "coreLabel": video["label"],
            "primaryTitle": (video.get("title") or [{"value": ""}])[0]["value"],
            "publishedLanguageIds": " ".join(sorted({dub["language"]["id"] for dub in published})),
            "hlsLanguageIds": " ".join(sorted({dub["language"]["id"] for dub in hls})),
            "variantCount": len(dubs),
            "publishedHlsVariantCount": len(hls),
            "durationMinSeconds": min(durations) if durations else "",
            "durationMedianSeconds": durations[len(durations) // 2] if durations else "",
            "durationMaxSeconds": max(durations) if durations else "",
        })
    csv_write(ROOT / "core-video-availability.csv", list(rows[0]), rows)
    csv_write(ROOT / "core-languages.csv", ["id", "slug", "bcp47"], sorted(languages, key=lambda x: x["id"]))
    provenance = {
        "status": "draft-core-only",
        "sourceFiles": [{
            "file": f"{key}.json",
            "sha256": sha256(snapshot / f"{key}.json"),
            "recordCount": len(sources[key][key]),
            "metadata": {k: v for k, v in sources[key].items() if k != key},
        } for key in sources],
        "sourceVariantCount": len(variants),
        "variantsForVisibleVideos": sum(len(by_video[core_id]) for core_id in videos),
        "variantsForVideosOutsideVisibleSnapshot": sum(variant["videoId"] not in videos for variant in variants),
        "projection": "Distinct video-language membership; published flag and nonempty HLS only. Durations aggregate across published HLS dubs, not selected Admin dubs. No streams were played.",
        "retainedEvidenceSha256": {name: sha256(ROOT / name) for name in (
            "core-video-availability.csv", "core-languages.csv"
        )},
        "adminValidation": {"verifiedCandidates": 0, "status": "pending", "blocker": "Admin GraphQL returned HTTP 403; no authenticated Admin catalog/database access available in this session. Core restrictViewPlatforms is authorization-only and returned Not authorized."},
    }
    (ROOT / "provenance.json").write_text(json.dumps(provenance, indent=2) + "\n")


def load_inputs():
    manifest = read_json(ROOT / "editorial-manifest.json")
    candidates = manifest["candidates"]
    assert manifest["status"] == "draft-core-only"
    assert len(candidates) == len({item["coreVideoId"] for item in candidates})
    assert len(candidates) == len({item["duplicateGroup"] for item in candidates})
    assert [item["editorialRank"] for item in candidates] == list(range(1, len(candidates) + 1))
    themes = [theme["key"] for theme in manifest["themeVocabulary"]]
    core_rows = csv_read(ROOT / "core-video-availability.csv")
    core = {row["coreVideoId"]: row for row in core_rows}
    languages = csv_read(ROOT / "core-languages.csv")
    slug_counts = collections.Counter(row["slug"] for row in languages if row["slug"])
    availability = collections.defaultdict(set)
    published = collections.defaultdict(set)
    hls_leaf = collections.defaultdict(set)
    for row in core_rows:
        for language_id in row["publishedLanguageIds"].split():
            if row["coreLabel"] in LEAF_LABELS:
                published[language_id].add(row["coreVideoId"])
        for language_id in row["hlsLanguageIds"].split():
            availability[language_id].add(row["coreVideoId"])
            if row["coreLabel"] in LEAF_LABELS:
                hls_leaf[language_id].add(row["coreVideoId"])
    all_source_ids = []
    for item in candidates:
        assert set(item["themeKeys"]) <= set(themes)
        sources = [item["coreVideoId"], *item["alternateCoreVideoIds"]]
        assert all(source in core for source in sources)
        all_source_ids.extend(sources)
        assert item["adminVideoId"] is None and item["adminValidation"] == "pending"
    assert len(all_source_ids) == len(set(all_source_ids)), "Source belongs to multiple editorial choices"
    provenance = read_json(ROOT / "provenance.json")
    for name, expected in provenance["retainedEvidenceSha256"].items():
        assert sha256(ROOT / name) == expected, f"Source evidence drift: {name}"
    return manifest, core, languages, slug_counts, availability, published, hls_leaf


def language_pools(manifest, language, slug_counts, availability, core):
    admitted = []
    # Slug collisions are not an exact identity; retain the gap rather than merge.
    if language["slug"] and slug_counts[language["slug"]] == 1:
        for item in manifest["candidates"]:
            source = next((core_id for core_id in (
                item["coreVideoId"], *item["alternateCoreVideoIds"]
            ) if core_id in availability[language["id"]]), None)
            if source:
                # Mirror verifiable runtime checks using Core primary titles.
                # Localized Admin titles and embedding similarity remain unknown.
                duplicate = any(
                    source.startswith(kept_source) or kept_source.startswith(source)
                    or (core[source]["primaryTitle"] and core[source]["primaryTitle"] == core[kept_source]["primaryTitle"])
                    for _, kept_source in admitted
                )
                if not duplicate:
                    admitted.append((item, source))
    pools = {
        "start": [(item, source) for item, source in admitted if item["startPool"]]
    }
    pools.update({theme["key"]: [(item, source) for item, source in admitted
                              if theme["key"] in item["themeKeys"]]
                  for theme in manifest["themeVocabulary"]})
    return pools


def summarize():
    manifest, core, languages, slug_counts, availability, published, hls_leaf = load_inputs()
    coverage = []
    overlaps = []
    for language in sorted(languages, key=lambda row: row["slug"]):
        pools = language_pools(manifest, language, slug_counts, availability, core)
        union = {item["duplicateGroup"] for pool in pools.values() for item, _ in pool}
        start = pools["start"]
        row = {
            "audioLanguageSlug": language["slug"],
            "coreLanguageId": language["id"],
            "sourcePublishedLeafVideos": len(published[language["id"]]),
            "sourcePublishedHlsLeafVideos": len(hls_leaf[language["id"]]),
            "sourcePublishedHlsVideosAllLabels": len(availability[language["id"]]),
            "curatedStartUnique": len(start),
            "curatedUnionUnique": len(union),
            "curatedStartWorkFamilies": len({item.get("sourceWorkFamilies", {}).get(source, item["workFamily"]) for item, source in start}),
            "curatedStartStoryGroups": len({item["storyGroup"] for item, _ in start}),
            "curatedStartMedianDubAtMost15m": sum(
                bool(core[source]["durationMedianSeconds"]) and 0 < float(core[source]["durationMedianSeconds"]) <= 900
                for _, source in start
            ),
            "curatedStartFeatureFilms": sum(item["coreLabel"] == "featureFilm" for item, _ in start),
            "startMeets6": len(start) >= 6,
            "startMeets30": len(start) >= 30,
            "unionMeets30": len(union) >= 30,
            "adminValidatedUnique": 0,
            "identityStatus": "missing_slug" if not language["slug"] else (
                "duplicate_slug" if slug_counts[language["slug"]] > 1 else "core_only"
            ),
        }
        row.update({f"pool_{key}": len(pool) for key, pool in pools.items() if key != "start"})
        coverage.append(row)
        for theme, pool in pools.items():
            if theme == "start":
                continue
            start_ids = {item["duplicateGroup"] for item, _ in start}
            theme_ids = {item["duplicateGroup"] for item, _ in pool}
            overlaps.append({
                "audioLanguageSlug": language["slug"], "coreLanguageId": language["id"],
                "poolKey": theme, "themeUnique": len(theme_ids),
                "sharedWithStart": len(start_ids & theme_ids),
                "additionalBeyondStart": len(theme_ids - start_ids),
                "unionWithStart": len(start_ids | theme_ids),
            })
    csv_write(ROOT / "language-coverage.csv", list(coverage[0]), coverage)
    csv_write(ROOT / "pool-overlap.csv", list(overlaps[0]), overlaps)
    active = [row for row in coverage if row["sourcePublishedHlsLeafVideos"] > 0]
    summary = {
        "version": manifest["version"], "status": manifest["status"],
        "coreLanguages": len(languages), "languagesWithPublishedHlsVisibleLeaf": len(active),
        "editorialChoices": len(manifest["candidates"]),
        "editorialStarterChoices": sum(item["startPool"] for item in manifest["candidates"]),
        "adminValidatedChoices": 0,
        "coverageDenominator": "Languages with at least one published nonempty-HLS dub of a visible leaf-label Core video; not supported Admin languages",
        "activeLanguagesByStarterDepth": {
            "0": sum(row["curatedStartUnique"] == 0 for row in active),
            "1to5": sum(1 <= row["curatedStartUnique"] < 6 for row in active),
            "6to29": sum(6 <= row["curatedStartUnique"] < 30 for row in active),
            "30plus": sum(row["curatedStartUnique"] >= 30 for row in active),
        },
        "activeLanguagesWithSourceHlsLeafBelow6": sum(row["sourcePublishedHlsLeafVideos"] < 6 for row in active),
        "activeLanguagesWithSourceHlsAllLabelsBelow6": sum(row["sourcePublishedHlsVideosAllLabels"] < 6 for row in active),
        "activeLanguagesWithSourceHlsLeafBelow30": sum(row["sourcePublishedHlsLeafVideos"] < 30 for row in active),
        "activeLanguagesWithUnion30": sum(row["curatedUnionUnique"] >= 30 for row in active),
        "activeLanguagesWithFewerThan6WorkFamilies": sum(row["curatedStartWorkFamilies"] < 6 for row in active),
        "themeCoverage": {theme["key"]: {
            "globalEditorialChoices": sum(theme["key"] in item["themeKeys"] for item in manifest["candidates"]),
            "activeLanguagesAtLeast6": sum(row[f"pool_{theme['key']}"] >= 6 for row in active),
            "activeLanguagesAtLeast30": sum(row[f"pool_{theme['key']}"] >= 30 for row in active),
        } for theme in manifest["themeVocabulary"]},
        "globalPairwiseThemeOverlap": [{"poolA": left["key"], "poolB": right["key"],
            "sharedEditorialChoices": sum(left["key"] in item["themeKeys"] and right["key"] in item["themeKeys"]
                                          for item in manifest["candidates"])}
            for left, right in itertools.combinations(manifest["themeVocabulary"], 2)],
    }
    (ROOT / "coverage-summary.json").write_text(json.dumps(summary, indent=2) + "\n")
    print(json.dumps(summary, indent=2))


def export(language_slug):
    if not language_slug:
        raise ValueError("Expected one exact, nonempty Core audio slug")
    manifest, core, languages, slug_counts, availability, _, _ = load_inputs()
    matches = [language for language in languages if language["slug"] == language_slug]
    if len(matches) != 1:
        raise ValueError("Expected one exact, nonempty Core audio slug")
    language = matches[0]
    pools = language_pools(manifest, language, slug_counts, availability, core)
    print(json.dumps({
        "version": manifest["version"], "status": "draft-core-only", "adminValidated": False,
        "audioLanguageSlug": language_slug, "coreLanguageId": language["id"],
        "pools": [{"poolKey": key, "orderedCoreVideoIds": [source for _, source in pool]}
                  for key, pool in pools.items()],
    }, indent=2))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    project = commands.add_parser("project")
    project.add_argument("snapshot", type=pathlib.Path)
    commands.add_parser("summarize")
    exporter = commands.add_parser("export")
    exporter.add_argument("audio_language_slug")
    args = parser.parse_args()
    if args.command == "project":
        project_snapshot(args.snapshot)
    elif args.command == "summarize":
        summarize()
    else:
        export(args.audio_language_slug)


if __name__ == "__main__":
    main()
