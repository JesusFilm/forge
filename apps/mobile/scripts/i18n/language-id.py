# /// script
# requires-python = ">=3.10,<3.13"
# dependencies = [
#   "fasttext-predict==0.9.2.4",
#   "huggingface_hub==2.1.1",
#   "iso639-lang==2.6.3",
# ]
# [tool.uv]
# exclude-newer = "2026-10-06T00:00:00Z"
# ///
"""Language ID for evaluate-translations.mjs: a JSON request file in, a JSON
answer on stdout. GlotLID (Apache-2.0) is pinned to one revision, and the first
run downloads 1.7 GB. Run it with `uv run`, so the repo gets no Python package."""

import json
import os
import sys

os.environ.setdefault("HF_HUB_DISABLE_PROGRESS_BARS", "1")
os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")

from iso639 import Lang  # noqa: E402

MODEL_REPO = "cis-lmu/glotlid"
MODEL_FILE = "model.bin"
MODEL_REVISION = "85cd6716494360367b75f642b5bc78667605d0b4"
TOP_LABELS = 3
# GlotLID labels Tagalog `fil`, where ISO 639-3 gives `tgl`.
LABEL_ALIASES = {"tgl": {"fil"}}


def iso639_3(code):
    try:
        return Lang(code).pt3 or None
    except Exception:
        return None


def label_name(label):
    return label.removeprefix("__label__")


def label_language(label):
    return label_name(label).split("_", 1)[0]


def shipped_codes_of(tags):
    return {code for code in (iso639_3(tag.split("-")[0]) for tag in tags) if code}


def accepted_codes(language, shipped_codes, known):
    """The ISO 639-3 codes that count as the catalog's language. A member of its
    macrolanguage counts (`arb` for `ar`), unless it ships as its own catalog
    (`ind` in the `ms` catalog is an error)."""
    own = iso639_3(language)
    if own is None:
        return set()
    try:
        members = {member.pt3 for member in Lang(own).individuals()}
    except Exception:
        members = set()
    accepted = {own} | LABEL_ALIASES.get(own, set())
    accepted |= {code for code in members if code not in shipped_codes}
    # `no` has no label of its own and both members ship (nb, nn), so the
    # exclusion would leave nothing GlotLID can name.
    if not accepted & known:
        accepted |= members
    return accepted


def one_line(text):
    # fastText predicts one line at a time.
    return " ".join(text.split())


def main():
    with open(sys.argv[1], encoding="utf-8") as request_file:
        request = json.load(request_file)
    # The model packages load here, so the helpers above import without them.
    import fasttext
    from huggingface_hub import hf_hub_download

    shipped_codes = shipped_codes_of(request.get("shipped", []))
    model = fasttext.load_model(
        hf_hub_download(MODEL_REPO, MODEL_FILE, revision=MODEL_REVISION)
    )
    every_label, _ = model.predict("a", k=-1)
    known = {label_language(label) for label in every_label}

    answer = {"model": f"{MODEL_REPO}@{MODEL_REVISION[:8]}", "locales": {}}
    for locale, texts in request["locales"].items():
        accepted = accepted_codes(locale.split("-")[0], shipped_codes, known)
        supported = bool(accepted & known)
        entry = {"expected": iso639_3(locale.split("-")[0]), "supported": supported}

        catalog = one_line(texts.get("catalog", ""))
        if catalog:
            labels, probabilities = model.predict(catalog, k=TOP_LABELS)
            entry["top"] = [
                {
                    "label": label_name(label),
                    "probability": round(float(p), 4),
                    "accepted": label_language(label) in accepted,
                }
                for label, p in zip(labels, probabilities)
            ]
            if not supported:
                entry["verdict"] = "unsupported"
            elif label_language(labels[0]) in accepted:
                entry["verdict"] = "match"
            else:
                entry["verdict"] = "mismatch"
        else:
            entry["verdict"] = "empty"

        # Only the messages in another language, to keep the answer small.
        mismatches = {}
        if supported:
            for key, text in texts.get("messages", {}).items():
                labels, probabilities = model.predict(one_line(text), k=1)
                if label_language(labels[0]) not in accepted:
                    mismatches[key] = {
                        "label": label_name(labels[0]),
                        "probability": round(float(probabilities[0]), 4),
                    }
        entry["messages"] = mismatches
        answer["locales"][locale] = entry

    json.dump(answer, sys.stdout, ensure_ascii=False)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:  # The caller reads stderr as the reason.
        print(f"language-id: {type(error).__name__}: {error}", file=sys.stderr)
        sys.exit(1)
