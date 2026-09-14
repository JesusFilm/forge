#!/usr/bin/env python3
"""Read-only fresh Core videoVariants check for the previously flagged languages."""

import argparse
import collections
import concurrent.futures
import csv
import datetime
import hashlib
import json
import pathlib
import time
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent
ENDPOINT = "https://api-gateway.central.jesusfilm.org/"
QUERY = """query RecommendationVariantCrossCheck($language:ID!,$offset:Int!,$limit:Int!){
  videoVariants(input:{languageId:$language,onlyPublished:true},offset:$offset,limit:$limit){
    id videoId duration hls published language{id slug} muxVideo{playbackId}
    video{id label title(primary:true){value}}
  }
}"""
LEAF_LABELS = {"shortFilm", "featureFilm", "episode", "segment"}


def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def read_csv(path):
    with path.open(newline="") as stream:
        return list(csv.DictReader(stream))


def fetch_language(row, raw_dir):
    records = []
    seen = set()
    started = now()
    page_size = 500
    for page in range(8):
        payload = {"query": QUERY, "variables": {
            "language": row["coreLanguageId"], "offset": page * page_size, "limit": page_size,
        }}
        for attempt in range(3):
            try:
                request = urllib.request.Request(ENDPOINT, data=json.dumps(payload).encode(), headers={
                    "Content-Type": "application/json", "x-graphql-client-name": "watch",
                    "User-Agent": "ForgeRecommendationVariantAudit/1.0",
                })
                with urllib.request.urlopen(request, timeout=30) as response:
                    result = json.load(response)
                if result.get("errors"):
                    raise RuntimeError(result["errors"])
                batch = result["data"]["videoVariants"]
                break
            except Exception:
                if attempt == 2:
                    raise
                time.sleep(attempt + 1)
        for variant in batch:
            assert variant["language"] == {
                "id": row["coreLanguageId"], "slug": row["audioLanguageSlug"],
            }, "Returned language identity differs from the requested exact language"
            assert variant["published"], "onlyPublished filter returned an unpublished variant"
            assert variant["id"] not in seen, "Duplicate variant across pages"
            assert variant["video"]["id"] == variant["videoId"], "Video identity mismatch"
            seen.add(variant["id"])
            variant["hasHls"] = bool((variant.pop("hls") or "").strip())
            variant["hasMuxPlayback"] = bool(((variant.pop("muxVideo") or {}).get("playbackId") or "").strip())
            records.append(variant)
        if len(batch) < page_size:
            evidence = {"startedAt": started, "finishedAt": now(), "completePagination": True,
                        "pages": page + 1, "pageSize": page_size, "context": row, "videoVariants": records}
            (raw_dir / f"{row['audioLanguageSlug']}.json").write_text(json.dumps(evidence, ensure_ascii=False) + "\n")
            return evidence
    raise RuntimeError("Reached page bound without end-of-results")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--raw-dir", type=pathlib.Path, required=True)
    args = parser.parse_args()
    args.raw_dir.mkdir(parents=True, exist_ok=True)
    source_path = ROOT / "all-context-web-default-coverage.csv"
    contexts = {row["audioLanguageSlug"]: row for row in read_csv(source_path)}
    flagged = read_csv(ROOT / "unavailable-homepage-languages.csv")
    started = now()
    rows = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
        pending = {executor.submit(fetch_language, contexts[row["audioLanguageSlug"]], args.raw_dir): row for row in flagged}
        for future in concurrent.futures.as_completed(pending):
            row = pending[future]
            evidence = future.result()
            variants = evidence["videoVariants"]
            def count(predicate):
                return len({v["videoId"] for v in variants if predicate(v)})
            stream = lambda v: v["hasHls"] or v["hasMuxPlayback"]
            leaf = lambda v: v["video"]["label"] in LEAF_LABELS
            rows.append({
                **row, "coreLanguageId": contexts[row["audioLanguageSlug"]]["coreLanguageId"],
                "publishedVariantRows": len(variants), "publishedDistinctVideoIds": count(lambda _: True),
                "collectionOrSeriesVideoIds": count(lambda v: v["video"]["label"] in {"collection", "series"}),
                "publishedLeafVideoIds": count(leaf),
                "leafVideosWithHls": count(lambda v: leaf(v) and v["hasHls"]),
                "leafVideosWithMux": count(lambda v: leaf(v) and v["hasMuxPlayback"]),
                "leafVideosWithHlsOrMux": count(lambda v: leaf(v) and stream(v)),
                "nonLeafVideosWithHlsOrMux": count(lambda v: not leaf(v) and stream(v)),
                "nonLeafWithoutStream": count(lambda v: not leaf(v) and not stream(v)),
                "coreStreamCountAtLeast6": count(lambda v: leaf(v) and stream(v)) >= 6,
                "observedAt": evidence["finishedAt"], "pages": evidence["pages"],
                "evidenceSha256": hashlib.sha256((args.raw_dir / f"{row['audioLanguageSlug']}.json").read_bytes()).hexdigest(),
            })
            if len(rows) % 20 == 0:
                print(f"Checked {len(rows)}/{len(flagged)} exact languages", flush=True)
    rows.sort(key=lambda row: row["audioLanguageSlug"])
    assert len(rows) == len(flagged) == 244
    assert len({r["audioLanguageSlug"] for r in rows}) == 244
    with (ROOT / "video-variants-cross-check.csv").open("w", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=list(rows[0]), lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)
    by_reason = collections.defaultdict(list)
    for row in rows:
        by_reason[row["reason"]].append(row)
    summary = {"startedAt": started, "finishedAt": now(), "endpoint": ENDPOINT,
               "query": QUERY, "languageCount": len(rows), "completePaginationEveryLanguage": True,
               "localCoverageSourceSha256": hashlib.sha256(source_path.read_bytes()).hexdigest(),
               "scope": "Fresh public Core videoVariants. Published distinct leaf videos with declared HLS or Mux playback; not stream network testing, localized card publication, restrictions, or canonical-dedup clearance.",
               "rawEvidenceDirectory": str(args.raw_dir),
               "byPriorReason": {reason: {
                   "languages": len(group),
                   "coreStreamCountAtLeast6": sum(r["coreStreamCountAtLeast6"] for r in group),
                   "coreStreamCountBelow6": sum(not r["coreStreamCountAtLeast6"] for r in group),
                   "minCoreStreamVideos": min(r["leafVideosWithHlsOrMux"] for r in group),
                   "maxCoreStreamVideos": max(r["leafVideosWithHlsOrMux"] for r in group),
               } for reason, group in by_reason.items()}}
    english = {row["audioLanguageSlug"]: row for row in read_csv(ROOT / "admin-language-coverage.csv")}
    display_blocked = by_reason["Missing published card translation"]
    english_depths = [int(english[row["audioLanguageSlug"]]["startUnique"]) for row in display_blocked]
    summary["localDisplayIsolationCheck"] = {
        "languages": len(display_blocked),
        "allMeetThirtyCuratedWithEnglishUi": all(depth >= 30 for depth in english_depths),
        "minCuratedWithEnglishUi": min(english_depths),
        "maxCuratedWithEnglishUi": max(english_depths),
        "policy": "Diagnostic only; English card fallback not enabled.",
    }
    (ROOT / "video-variants-cross-check-summary.json").write_text(json.dumps(summary, indent=2) + "\n")
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
