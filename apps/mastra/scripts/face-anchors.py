"""
Sample a video and report where the faces are.

Reads a video, walks it at a fixed interval, and for each sampled second emits
the faces it found as normalized centres plus their share of the frame. Prints
one JSON object on stdout; writes nothing else.

This exists because the crop anchors have to be PRECISE. The vision model that
plans crops answers on a 0.1 grid, and a tenth of a widescreen frame is about a
third of the vertical window the crop keeps — enough to push a face off the
edge, which is how a good frame became a worse one on the first attempt.

Usage:
  python3 face-anchors.py --video=bg.mp4 --interval=0.5
Requires opencv-python (or -headless). The caller passes the interpreter, so a
virtualenv works without anything being installed globally.
"""

import argparse
import json
import os
import sys

try:
    import cv2
except ImportError:
    print(
        json.dumps({"error": "opencv_missing", "message": "import cv2 failed"}),
        file=sys.stdout,
    )
    sys.exit(2)

# Haar cascades ship inside the opencv wheel, so there is no model to download
# and no network call in this path. They miss faces in deep shadow and hard
# profile; the caller treats "no face here" as a normal answer and falls back.
CASCADES = ("haarcascade_frontalface_default.xml", "haarcascade_profileface.xml")
# Ignore anything smaller than this share of the frame: Haar's false positives
# are small and scattered (a fold of cloth, a patch of wall), real faces are not.
MIN_AREA_FRACTION = 0.0015


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--video", required=True)
    ap.add_argument("--interval", type=float, default=0.5)
    args = ap.parse_args()

    detectors = []
    for name in CASCADES:
        path = os.path.join(cv2.data.haarcascades, name)
        if os.path.exists(path):
            detectors.append((name, cv2.CascadeClassifier(path)))
    if not detectors:
        print(json.dumps({"error": "cascades_missing"}))
        return 2

    cap = cv2.VideoCapture(args.video)
    if not cap.isOpened():
        print(json.dumps({"error": "open_failed", "video": args.video}))
        return 2
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    # Seek by TIME, not by frame index, and report the time the decoder lands
    # on. The staged background is variable-frame-rate (ffprobe reports a 23.976
    # nominal rate against a ~20.4 average), so a frame index does not convert
    # to seconds by any fixed factor — while the shot cuts this is paired with
    # come from ffmpeg in real seconds. Two time bases would put a shot's faces
    # on the wrong shot's anchor.
    duration_sec = (total / fps) if fps > 0 else 0.0

    samples = []
    at = 0.0
    while duration_sec <= 0 or at < duration_sec:
        cap.set(cv2.CAP_PROP_POS_MSEC, at * 1000.0)
        ok, img = cap.read()
        if not ok:
            break
        pos_sec = cap.get(cv2.CAP_PROP_POS_MSEC) / 1000.0
        at += args.interval
        h, w = img.shape[:2]
        grey = cv2.equalizeHist(cv2.cvtColor(img, cv2.COLOR_BGR2GRAY))
        flipped = cv2.flip(grey, 1)
        faces = []
        for name, det in detectors:
            for x, y, fw, fh in det.detectMultiScale(grey, 1.1, 5, minSize=(60, 60)):
                faces.append(((x + fw / 2) / w, (y + fh / 2) / h, fw * fh / (w * h)))
            # The profile cascade only recognises one direction, so the mirrored
            # frame is how the other profile gets seen at all.
            if "profile" in name:
                for x, y, fw, fh in det.detectMultiScale(
                    flipped, 1.1, 5, minSize=(60, 60)
                ):
                    faces.append(
                        (1 - (x + fw / 2) / w, (y + fh / 2) / h, fw * fh / (w * h))
                    )
        faces = [f for f in faces if f[2] >= MIN_AREA_FRACTION]
        faces.sort(key=lambda f: -f[2])
        samples.append(
            {
                "atSec": round(pos_sec if pos_sec > 0 else at, 3),
                "faces": [
                    {"cx": round(cx, 4), "cy": round(cy, 4), "area": round(a, 5)}
                    for cx, cy, a in faces[:6]
                ],
            }
        )

    cap.release()
    print(json.dumps({"fps": fps, "samples": samples}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
