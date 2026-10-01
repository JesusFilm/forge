#!/usr/bin/env python3
"""Package the portable skill reproducibly; --check rejects stale committed bytes.

Maintainer-only Python 3 stdlib utility. Installing/using the resulting skill
requires neither Python nor a repository checkout.
"""
import argparse
import io
from pathlib import Path, PurePosixPath
import re
import stat
import zipfile

ROOT = Path(__file__).resolve().parents[3]
SOURCE = ROOT / "skills" / "shorts-creator"
OUTPUT = ROOT / "apps" / "manager" / "public" / "shorts-creator.zip"


def package_bytes():
    entries = {}
    for path in sorted(SOURCE.rglob("*")):
        if path.is_symlink():
            raise ValueError(f"Symlinks are not portable: {path.name}")
        if not path.is_file():
            continue
        relative = path.relative_to(SOURCE)
        if path.suffix not in {".md", ".json", ".yaml"}:
            raise ValueError(f"Unexpected package file: {relative}")
        text = path.read_text(encoding="utf-8")
        if re.search(r"(?:/home/|/Users/|file://|\.\./\.\./\.\./)", text):
            raise ValueError(f"Checkout-dependent path: {relative}")
        if path.suffix == ".md":
            for target in re.findall(r"\]\(([^)]+)\)", text):
                if target.startswith("https://"):
                    continue
                resolved = (path.parent / target.split("#")[0]).resolve()
                if not resolved.is_relative_to(SOURCE.resolve()) or not resolved.is_file():
                    raise ValueError(f"Missing or external package reference: {relative}: {target}")
        entries[f"shorts-creator/{relative.as_posix()}"] = path.read_bytes()
    if "shorts-creator/SKILL.md" not in entries:
        raise ValueError("Missing SKILL.md")
    archive = io.BytesIO()
    with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_STORED) as zipped:
        for name, data in entries.items():
            info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
            info.create_system = 3
            info.external_attr = (stat.S_IFREG | 0o644) << 16
            zipped.writestr(info, data)
    return archive.getvalue()


def verify_archive(data):
    with zipfile.ZipFile(io.BytesIO(data)) as zipped:
        names = zipped.namelist()
        if len(names) != len(set(names)):
            raise ValueError("Duplicate archive paths")
        for info in zipped.infolist():
            path = PurePosixPath(info.filename)
            if path.is_absolute() or ".." in path.parts or "\\" in info.filename:
                raise ValueError("Unsafe archive path")
            if path.parts[0] != "shorts-creator" or stat.S_ISLNK(info.external_attr >> 16):
                raise ValueError("Unexpected archive root or symlink")
        if zipped.testzip() is not None:
            raise ValueError("Corrupt archive")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    data = package_bytes()
    verify_archive(data)
    if args.check:
        if not OUTPUT.exists() or OUTPUT.read_bytes() != data:
            raise SystemExit("Skill ZIP is stale; run pnpm --filter @forge/manager skill:package")
        print(f"Portable skill ZIP verified ({len(data)} bytes)")
    else:
        OUTPUT.parent.mkdir(parents=True, exist_ok=True)
        OUTPUT.write_bytes(data)
        print(f"Packaged {len(data)} bytes")


if __name__ == "__main__":
    main()
