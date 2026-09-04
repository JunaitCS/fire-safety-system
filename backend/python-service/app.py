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


@app.route("/cameras/<camera_id>/feed")
def feed(camera_id):
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