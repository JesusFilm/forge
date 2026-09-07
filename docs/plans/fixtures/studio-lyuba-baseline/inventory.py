"""Inventory supplied bytes without calling providers; originals are never overwritten."""
import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import zipfile


def digest(data):
    return hashlib.sha256(data).hexdigest()


def save_original(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        if path.read_bytes() != data:
            raise ValueError(f"Refusing to overwrite different original: {path}")
    else:
        with path.open("xb") as target:
            target.write(data)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive", type=Path)
    parser.add_argument("preserve", type=Path, help="Persistent directory outside worktrees")
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    archive = args.archive.read_bytes()
    save_original(args.preserve / "devo-data.zip", archive)
    entries = []
    scripts = []
    with zipfile.ZipFile(args.archive) as source:
        names = source.namelist()
        if len(names) != len(set(names)):
            raise ValueError("Duplicate archive paths")
        for item in sorted(source.infolist(), key=lambda item: item.filename):
            path = PurePosixPath(item.filename)
            if path.is_absolute() or ".." in path.parts or (item.external_attr >> 16) & 0o170000 == 0o120000:
                raise ValueError(f"Unsafe archive path: {path}")
            if item.is_dir():
                continue
            data = source.read(item)
            save_original(args.preserve / "originals" / path, data)
            role = ("script" if path.name == "devo.json" else
                    "approval" if path.name == "text-approved.json" else
                    "corpus" if "corpus" in path.parts else
                    "music-library" if "assets" in path.parts else
                    "audio-index" if path.name == "index.json" else
                    "cached-music" if path.name == "music.mp3" else "narration")
            entry = {"path": str(path), "bytes": len(data), "sha256": digest(data), "role": role,
                     "provenance": {"source": "supplied archive", "generationRequestId": None}}
            if role == "narration":
                index_path = str(path.parent / "index.json")
                index = json.loads(source.read(index_path))
                entry["provenance"].update({"metadataSource": index_path,
                    "recorded": next((s for s in index["segments"] if s["file"] == path.name), None),
                    "voiceSettings": None, "pronunciationVersion": None, "languageVerified": False})
            elif role == "music-library" and path.suffix == ".mp3":
                manifest_path = "devo/assets/music/manifest.json"
                tracks = json.loads(source.read(manifest_path))["tracks"]
                entry["provenance"].update({"metadataSource": manifest_path,
                    "recorded": next((s for s in tracks if s["file"] == path.name), None),
                    "originalGenerationPrompt": None, "providerRequest": None})
            elif role == "cached-music":
                entry["provenance"]["recorded"] = json.loads(source.read(str(path.parent / "index.json")))["music"]
            elif role == "corpus":
                entry["provenance"].update({"retrievalDate": None, "sourceEditionVerified": False})
            entries.append(entry)
            if role == "script":
                obj = json.loads(data)
                scripts.append({"id": path.parent.name, "archivePath": str(path), "sha256": digest(data),
                                "script": obj})
    args.output.mkdir(parents=True, exist_ok=True)
    report = {"schemaVersion": 1, "archive": {"sha256": digest(archive), "bytes": len(archive)},
              "files": entries, "totalBytes": sum(e["bytes"] for e in entries)}
    for name, value in [("inventory.json", report), ("saved-scripts.json", scripts)]:
        (args.output / name).write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n")
    print(f"Verified {len(entries)} files, {len(scripts)} scripts, {report['totalBytes']} bytes")


if __name__ == "__main__":
    main()
