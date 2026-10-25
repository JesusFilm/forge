#!/usr/bin/env python3
"""Explicit, read-only public Core snapshot; no credentials or model API calls."""

import argparse
import datetime
import json
import pathlib
import urllib.request

ENDPOINT = "https://api-gateway.central.jesusfilm.org/"
QUERIES = {
    "videos": """query CatalogCurationSnapshot($offset:Int!,$limit:Int!){
      videos(offset:$offset,limit:$limit){id slug label publishedAt primaryLanguageId
        title(primary:true){value} description(primary:true){value}
        snippet(primary:true){value} children{id}}}""",
    "languages": """query CurationLanguages($offset:Int!,$limit:Int!){
      languages(offset:$offset,limit:$limit){id slug bcp47}}""",
    "videoVariants": """query CurationAvailability($offset:Int!,$limit:Int!){
      videoVariants(offset:$offset,limit:$limit){id videoId duration hls published
        language{id}}}""",
}


def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def fetch(key, limit, max_pages):
    records = []
    seen = set()
    started = now()
    for page in range(max_pages):
        payload = {
            "query": QUERIES[key],
            "variables": {"offset": page * limit, "limit": limit},
        }
        request = urllib.request.Request(
            ENDPOINT,
            data=json.dumps(payload).encode(),
            headers={
                "Content-Type": "application/json",
                "x-graphql-client-name": "watch",
            },
        )
        with urllib.request.urlopen(request, timeout=60) as response:
            result = json.load(response)
        if result.get("errors"):
            raise RuntimeError(result["errors"])
        batch = result["data"][key]
        for item in batch:
            if item["id"] in seen:
                raise RuntimeError(f"Duplicate {key} ID across pages: {item['id']}")
            seen.add(item["id"])
            if key == "videoVariants":
                item["hasHls"] = bool((item.pop("hls") or "").strip())
            records.append(item)
        print(f"{key}: {len(records)} records", flush=True)
        if len(batch) < limit:
            return {
                "source": ENDPOINT,
                "query": QUERIES[key],
                "startedAt": started,
                "finishedAt": now(),
                "pageSize": limit,
                "pages": page + 1,
                "completePagination": True,
                "sourceScope": "Public Core; not current Admin eligibility; offset pagination is not an atomic snapshot",
                "projection": "HLS URL reduced to nonempty boolean; all other requested fields preserved",
                key: records,
            }
    raise RuntimeError(f"{key}: reached finite {max_pages}-page bound without EOF")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=pathlib.Path)
    parser.add_argument("--reuse-catalog", type=pathlib.Path)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    for key, limit, max_pages in [
        ("videos", 200, 20),
        ("languages", 1000, 30),
        ("videoVariants", 5000, 80),
    ]:
        target = args.output / f"{key}.json"
        if target.exists():
            raise RuntimeError(f"Refusing to overwrite existing snapshot: {target}")
        if key == "videos" and args.reuse_catalog:
            result = json.loads(args.reuse_catalog.read_text())
        else:
            result = fetch(key, limit, max_pages)
        target.write_text(json.dumps(result, ensure_ascii=False) + "\n")


if __name__ == "__main__":
    main()
