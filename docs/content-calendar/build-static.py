#!/usr/bin/env python3
"""Build a static copy of the content calendar for Netlify.

The live calendar reads its posts from the artifact database. A Netlify copy can't,
so this script freezes a snapshot: it embeds the posts in the page, copies the
thumbnails next to it and adds the analytics dashboard as dashboard.html.

Usage:
  build-static.py <posts dir> <blobmap.json> <dashboard.html> <out dir>

<posts dir>     ArtifactData `list` of collection `posts` saved with out_dir (one JSON per doc).
<blobmap.json>  {"<asset id>": "<local jpg path>"} for every `/_blob/<id>` thumb.
"""
import json
import os
import shutil
import sys

HERE = os.path.dirname(os.path.abspath(__file__))


def main(posts_dir, blobmap_path, dashboard, out):
    blobmap = json.load(open(blobmap_path))
    os.makedirs(os.path.join(out, "thumbs"), exist_ok=True)
    posts = []
    for name in sorted(os.listdir(posts_dir)):
        if not name.endswith(".json"):
            continue
        p = json.load(open(os.path.join(posts_dir, name)))
        p["id"] = name[:-5]
        t = p.get("thumb", "")
        if t.startswith("/_blob/"):
            aid = t[len("/_blob/"):]
            if aid in blobmap:
                shutil.copyfile(blobmap[aid], os.path.join(out, "thumbs", aid + ".jpg"))
                p["thumb"] = "thumbs/" + aid + ".jpg"
            else:
                p["thumb"] = ""
        posts.append(p)

    page = open(os.path.join(HERE, "index.html")).read()
    # Data: embedded instead of the artifact database.
    start = page.index("  ;(async () => {")
    end = page.index("})()", start) + len("})()")
    loader = (
        "  posts = " + json.dumps(posts, ensure_ascii=False) + "\n"
        "  build()\n  render()\n"
        '  document.getElementById("status").textContent = ""'
    )
    page = page[:start] + loader + page[end:]
    # Analytics button opens the dashboard copied next to this page.
    page = page.replace("https://claude.ai/artifact/T3QFpYWsVKKk1Px4k1QhNS", "dashboard.html")
    page = page.replace('href="dashboard.html"\n      target="_blank"', 'href="dashboard.html"\n      target="_self"')
    html = (
        '<!doctype html><html lang="en"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">'
        "<style>body{margin:0}[hidden]{display:none!important}img{max-width:100%}</style>"
        "</head><body>\n" + page + "\n</body></html>\n"
    )
    open(os.path.join(out, "index.html"), "w").write(html)
    shutil.copyfile(dashboard, os.path.join(out, "dashboard.html"))
    print(f"{len(posts)} posts, {len(os.listdir(os.path.join(out, 'thumbs')))} thumbnails -> {out}")


if __name__ == "__main__":
    main(*sys.argv[1:5])
