from flask import Flask, Response, jsonify, request
from flask_cors import CORS
import cv2
import time
import numpy as np
import os

from detector import detector

app = Flask(__name__)
CORS(app)


@app.route("/")
def index():
    return jsonify({
        "status": "CV Service",
        "version": "4.0-behavior"
    })


@app.route("/health")
def health():
    return jsonify({
        "status": "healthy",
        "model_loaded": detector.model is not None,
        "version": "4.0-behavior"
    })


@app.route("/cameras/<camera_id>/start", methods=["POST"])
def start_camera(camera_id):
    data = request.json or {}

    source = data.get("source", "0")
    is_exit = bool(data.get("is_exit", False))
    drill_id = data.get("drill_id")
    line_ratio = data.get("line_ratio")

    ok = detector.start_camera(
        camera_id,
        source,
        is_exit,
        drill_id=drill_id,
        line_ratio=line_ratio
    )

    return jsonify({
        "success": ok,
        "camera_id": camera_id,
        "is_exit": is_exit
    })


@app.route("/cameras/<camera_id>/frame", methods=["POST"])
def push_frame(camera_id):
    """Ingest a JPEG pushed by a phone/laptop browser (BrowserPublisher).

    Accepts raw image/jpeg bytes (preferred) or JSON {image: dataURL/base64}.
    Isolated from the VideoCapture path — never touches USB/RTSP logic.
    """
    try:
        raw = None
        ctype = (request.content_type or "").lower()
        if "json" in ctype:
            data = request.json or {}
            b64 = data.get("image", "") or ""
            if "," in b64:
                b64 = b64.split(",", 1)[1]
            import base64
            try:
                raw = base64.b64decode(b64)
            except Exception:
                return jsonify({"success": False, "error": "bad-base64"}), 400
        else:
            raw = request.get_data() or None

        if not raw or len(raw) < 1000 or len(raw) > 5 * 1024 * 1024:
            return jsonify({"success": False, "error": "empty-frame"}), 400

        # Reject non-JPEG payloads early (SOI marker).
        if len(raw) < 2 or raw[0] != 0xFF or raw[1] != 0xD8:
            return jsonify({"success": False, "error": "not-jpeg"}), 400

        detector.push_browser_frame(camera_id, raw)
        return jsonify({"success": True})
    except Exception:
        return jsonify({"success": False, "error": "ingest-failed"}), 500


@app.route("/cameras/<camera_id>/stop", methods=["POST"])
def stop_camera(camera_id):
    detector.stop_camera(camera_id)

    return jsonify({
        "success": True
    })


@app.route("/cameras/stop-all", methods=["POST"])
def stop_all():
    detector.stop_all()

    return jsonify({
        "success": True
    })


@app.route("/cameras/<camera_id>/stats")
def stats(camera_id):
    return jsonify(
        detector.get_stats(camera_id)
    )


@app.route("/cameras/<camera_id>/snapshot")
def snapshot(camera_id):
    """Single-frame snapshot for polling viewers (proxy/gunicorn-safe).

    Returns the latest annotated JPEG (200), or 204 when no frame exists yet.
    Prefer this over /feed on hosted deployments (Render, etc.): every request
    finishes in milliseconds, so sync workers are never blocked and killed.
    """
    frame = detector.get_snapshot(camera_id)
    if frame is None:
        return ("", 204)

    ok, buf = cv2.imencode(
        ".jpg",
        frame,
        [int(cv2.IMWRITE_JPEG_QUALITY), 72]
    )
    if not ok:
        return jsonify({"success": False, "error": "encode-failed"}), 500

    return Response(buf.tobytes(), mimetype="image/jpeg")


@app.route("/cameras/<camera_id>/feed")
def feed(camera_id):
    # NOTE: capped at ~25s so a forgotten viewer tab can never hold a sync
    # gunicorn worker past its timeout (which kills the worker and wipes all
    # in-memory camera state). Prefer /snapshot polling for live views.
    deadline = time.time() + 25

    def gen():
        blank = np.zeros((480, 640, 3), dtype=np.uint8)

        cv2.putText(
            blank,
            "Waiting for camera...",
            (120, 240),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.8,
            (180, 180, 180),
            2
        )

        last_sent = blank

        while True:
            if time.time() > deadline:
                break

            history = detector.get_frame(camera_id)

            raw = (
                history["frame"]
                if history and "frame" in history
                else None
            )

            frame = (
                raw.copy()
                if raw is not None
                else last_sent
            )

            last_sent = frame

            ok, buf = cv2.imencode(
                ".jpg",
                frame,
                [int(cv2.IMWRITE_JPEG_QUALITY), 72]
            )

            if ok:
                yield (
                    b"--frame\r\n"
                    b"Content-Type: image/jpeg\r\n\r\n"
                    + buf.tobytes()
                    + b"\r\n"
                )

            time.sleep(0.05)

    return Response(
        gen(),
        mimetype="multipart/x-mixed-replace; boundary=frame"
    )


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "5000"))

    print(f"FireGuard CV v4 behavior — running on port {port}")

    app.run(
        host="0.0.0.0",
        port=port,
        debug=False,
        threaded=True
    )