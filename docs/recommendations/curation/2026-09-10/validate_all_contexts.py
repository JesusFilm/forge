#!/usr/bin/env python3
"""Independently check exhaustive matrix, lossless grouping, and prior en audit."""

import argparse
import csv
import hashlib
import json
from collections import Counter
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--raw-dir", required=True, type=Path)
    args = parser.parse_args()
    directory = Path(__file__).parent
    summary = json.loads((directory / "all-context-coverage-summary.json").read_text())
    groups = json.loads((directory / "all-context-locale-groups.json").read_text())
    group_for_locale = {locale: group["id"] for group in groups for locale in group["locales"]}
    assert len(group_for_locale) == summary["websiteLocaleCount"]
    grouped = {}
    with (directory / "all-context-grouped-coverage.csv").open() as handle:
        for row in csv.DictReader(handle):
            key = (row.pop("localeGroup"), row["audioLanguageSlug"])
            assert key not in grouped
            grouped[key] = row
    prior = {}
    with (directory / "admin-language-coverage.csv").open() as handle:
        prior = {row["audioLanguageSlug"]: row for row in csv.DictReader(handle)}
    full_path = args.raw_dir / "all-context-coverage.csv"
    assert hashlib.sha256(full_path.read_bytes()).hexdigest() == summary["fullCsvSha256"]
    totals = Counter()
    inventory = Counter()
    contexts_per_locale = Counter()
    seen = set()
    previous_en_checks = 0
    with full_path.open() as handle:
        for row in csv.DictReader(handle):
            locale = row.pop("locale")
            slug = row["audioLanguageSlug"]
            assert (locale, slug) not in seen
            seen.add((locale, slug))
            assert row == grouped[(group_for_locale[locale], slug)]
            contexts_per_locale[locale] += 1
            count = int(row["startUnique"])
            ceiling = int(row["eligibleVideoIdsUpperBound"])
            assert count <= int(row["unionUnique"]) <= ceiling
            for depth in (6, 30, 44):
                assert row[f"atLeast{depth}"] == str(count >= depth).lower()
                totals[f"atLeast{depth}"] += count >= depth
                inventory[f"atLeast{depth}"] += ceiling >= depth
            totals["oneTo5"] += 0 < count < 6
            totals["zero"] += count == 0
            inventory["oneTo5"] += 0 < ceiling < 6
            inventory["zero"] += ceiling == 0
            if locale == "en":
                comparison_keys = ["startUnique", "unionUnique", "eligibleVideoIdsUpperBound"]
                comparison_keys.extend(key for key in row if key.startswith("pool:"))
                assert all(row[key] == prior[slug][key] for key in comparison_keys)
                previous_en_checks += 1
    assert len(seen) == summary["contextCount"]
    assert all(count == summary["audioLanguageCount"] for count in contexts_per_locale.values())
    assert dict(totals) == summary["starterCoverage"]
    assert dict(inventory) == summary["inventoryUpperBoundCoverage"]
    web_rows = []
    with (directory / "all-context-web-default-coverage.csv").open() as handle:
        for row in csv.DictReader(handle):
            locale = row.pop("locale")
            row.pop("htmlLang")
            assert row.pop("publicHomepageLanguage") == "true"
            assert row == grouped[(group_for_locale[locale], row["audioLanguageSlug"])]
            web_rows.append(row)
    assert len(web_rows) == summary["audioLanguageCount"]
    assert len({row["audioLanguageSlug"] for row in web_rows}) == len(web_rows)
    checks = json.loads((directory / "all-context-equivalence-checks.json").read_text())
    assert len(checks) == summary["officialServiceEquivalenceChecks"]
    assert all(row["passedEquivalence"] for row in checks)
    result = {
        "passed": True,
        "exhaustiveDistinctContexts": len(seen),
        "losslessGroupedMatrixComparisons": len(seen),
        "priorEnglishAudioContextsCompared": previous_en_checks,
        "webDefaultContextProjectionsCompared": len(web_rows),
        "officialServiceEquivalenceChecks": len(checks),
        "fullCsvSha256": summary["fullCsvSha256"],
    }
    (directory / "all-context-evidence-validation.json").write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps(result))


if __name__ == "__main__":
    main()
