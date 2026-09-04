"""
FireGuard CV — accuracy + behavior layer (v4).
- YOLOv8s default, imgsz 640, tuned conf, ByteTrack persistence
- Per-camera exit line ratio, mean-confidence reporting
- Behaviors: fall, crowd, running/panic, loitering, stuck-in-room
"""
import cv2
import numpy as np
from ultralytics import YOLO
import threading
import time
from datetime import datetime
from collections import defaultdict, deque
import requests
import os
import math

MODEL_NAME = os.environ.get("YOLO_MODEL", "yolov8s.pt")
CONF = float(os.environ.get("YOLO_CONF", "0.35"))
IMGSZ = int(os.environ.get("YOLO_IMGSZ", "640"))
# USB webcams stall if we infer every frame at 640 — use lighter settings for local indexes.
USB_IMGSZ = int(os.environ.get("YOLO_USB_IMGSZ", "480"))
USB_DETECT_EVERY = int(os.environ.get("USB_DETECT_EVERY_N", "5"))
DETECT_EVERY = int(os.environ.get("DETECT_EVERY_N", "3"))
EXIT_RATIO = float(os.environ.get("EXIT_LINE_RATIO", "0.62"))
EXIT_DIR = os.environ.get("EXIT_DIRECTION", "down")
W = int(os.environ.get("CAP_WIDTH", "640"))
H = int(os.environ.get("CAP_HEIGHT", "480"))
CROWD_THRESH = int(os.environ.get("CROWD_THRESH", "8"))
RUN_SPEED_PX_S = float(os.environ.get("RUN_SPEED_PX_S", "220"))
LOITER_SECS = float(os.environ.get("LOITER_SECS", "60"))
MIN_BOX_AREA = int(os.environ.get("MIN_BOX_AREA", "700"))


def open_camera(source):
    """USB-tuned open: MJPG + 30fps + small buffer + warmup. Falls back across backends."""
    is_usb_index = str(source).isdigit()
    if is_usb_index:
        i = int(source)
        # DSHOW first on Windows (most stable for USB), then MSMF, then ANY.
        attempts = [(i, cv2.CAP_DSHOW), (i, cv2.CAP_MSMF), (i, cv2.CAP_ANY)]
    else:
        attempts = [(source, cv2.CAP_FFMPEG), (source, cv2.CAP_ANY)]

    for src, backend in attempts:
        try:
            cap = cv2.VideoCapture(src, backend)
        except Exception:
            cap = cv2.VideoCapture(src)
        if not cap.isOpened():
            continue
        try:
            cap.set(cv2.CAP_PROP_FOURCC, cv2.VideoWriter_fourcc(*"MJPG"))
        except Exception:
            pass
        cap.set(cv2.CAP_PROP_FRAME_WIDTH, W)
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, H)
        try:
            # 30fps requested — USB cams that can't do it just ignore it.
            cap.set(cv2.CAP_PROP_FPS, 30)
        except Exception:
            pass
        try:
            cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
        except Exception:
            pass
        try:
            # Disable autofocus hunting on USB cams (major shake source).
            cap.set(cv2.CAP_PROP_AUTOFOCUS, 0)
        except Exception:
            pass
        # Warmup: discard stale buffered frames so the first served frame is fresh.
        ok, frame = False, None
        for _ in range(10):
            ok, frame = cap.read()
            time.sleep(0.02)
            if ok and frame is not None and frame.mean() > 1:
                break
        if ok and frame is not None:
            print(f"[open] source={src!r} backend={backend} shape={frame.shape} fps={cap.get(cv2.CAP_PROP_FPS):.0f}")
            return cap
        cap.release()
    print(f"[open] FAILED source={source!r}")
    return None


def grab_latest(cap):
    """Single read (BUFFERSIZE=1 already drops stale frames).
    The old grab()+grab()+read() pattern stalls USB cameras and causes glitches."""
    if cap is None:
        return None
    ok, frame = cap.read()
    if ok and frame is not None:
        return frame
    return None


def post_async(url, payload):
    """Fire-and-forget backend POST — never blocks the capture loop.
    The old synchronous requests.post(timeout=1.5) froze the feed on every push."""
    def _send():
        try:
            requests.post(url, json=payload, timeout=0.8)
        except Exception:
            pass
    threading.Thread(target=_send, daemon=True).start()


class PersonTracker:
    def __init__(self, backend_url="http://localhost:3001"):
        print(f"Loading {MODEL_NAME} (imgsz={IMGSZ}, conf={CONF}) ...")
        try:
            self.model = YOLO(MODEL_NAME)
            self.model.predict(np.zeros((320, 320, 3), dtype=np.uint8), classes=[0], verbose=False, imgsz=320)
            print("YOLO ready")
        except Exception as e:
            print("YOLO load failed:", e)
            self.model = None

        self.backend_url = backend_url
        self.active = {}
        self.frames = {}
        self.stats = {}
        self.lock = threading.Lock()
        # hist[cam][id] = deque of (cx, cy, w, h, t), maxlen 60
        self.hist = defaultdict(lambda: defaultdict(lambda: deque(maxlen=60)))
        self.enter_time = defaultdict(dict)
        self.crossed = defaultdict(set)
        self.exited = defaultdict(int)
        self.line_ratio = {}
        self.crowd_state = defaultdict(bool)
        self.crowd_events = defaultdict(int)
        self.fall_ids = defaultdict(set)
        self.still_since = defaultdict(dict)
        self.behavior_counts = defaultdict(lambda: {"falls": 0, "crowdEvents": 0, "loitering": 0, "running": 0, "stuck": 0, "maxOccupancy": 0})

    def _line_y(self, frame_h, cam_id):
        return int(frame_h * self.line_ratio.get(cam_id, EXIT_RATIO))

    def _draw(self, frame, boxes, ids, confs, flags, is_exit, line_y, exited_n, crowd):
        out = frame.copy()
        for i, (x1, y1, x2, y2) in enumerate(boxes):
            tid = ids[i]
            conf = confs[i]
            f = flags[i] if i < len(flags) else {}
            if f.get("fall"):
                color = (255, 0, 255)
            elif f.get("running"):
                color = (0, 165, 255)
            elif f.get("loitering"):
                color = (255, 255, 0)
            elif tid is not None and tid in self.crossed[self._cam]:
                color = (0, 140, 255)
            else:
                color = (0, 220, 0)
            cv2.rectangle(out, (x1, y1), (x2, y2), color, 2)
            label = f"ID{tid} {conf:.2f}" if tid is not None else f"{conf:.2f}"
            tags = []
            if tid is not None and tid in self.crossed[self._cam]:
                tags.append("OUT")
            if f.get("fall"):
                tags.append("FALL")
            if f.get("running"):
                tags.append("RUN")
            if f.get("loitering"):
                tags.append("LOITER")
            if tags:
                label += " " + "|".join(tags)
            cv2.putText(out, label, (x1, max(16, y1 - 6)),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.5, color, 1)
        if is_exit and line_y is not None:
            h, w = out.shape[:2]
            cv2.line(out, (0, line_y), (w, line_y), (0, 0, 255), 3)
            cv2.putText(out, "EVACUATION LINE", (10, line_y - 10),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.55, (0, 0, 255), 2)
            cv2.putText(out, f"EVACUATED: {exited_n}", (10, line_y + 24),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 0, 255), 2)
        if crowd:
            cv2.putText(out, "CROWD ALERT", (10, 60),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 0, 255), 2)
        cv2.rectangle(out, (4, 4), (170, 36), (0, 0, 0), -1)
        cv2.putText(out, f"People: {len(boxes)}", (10, 26),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.65, (0, 255, 0), 2)
        return out

    def _classify(self, cam_id, tid, cx, cy, w, h, now):
        """Return flags dict for one track. Uses trajectory history."""
        q = self.hist[cam_id][tid]
        flags = {}
        # Fall: wide aspect + sudden cy drop + stillness
        aspect = (w / max(h, 1))
        if len(q) >= 4:
            (_, py, _, _, _) = q[-4]
            drop = cy - py
            if aspect > 1.15 and drop > h * 0.25:
                self.still_since[cam_id][tid] = self.still_since[cam_id].get(tid, now)
            # stillness: low movement over last ~2s
            recent = list(q)[-12:]
            if len(recent) >= 6:
                xs = [p[0] for p in recent]
                ys = [p[1] for p in recent]
                disp = math.hypot(max(xs) - min(xs), max(ys) - min(ys))
                if aspect > 1.15 and disp < 25 and (now - self.still_since[cam_id].get(tid, now)) > 2.0:
                    flags["fall"] = True
                    if tid not in self.fall_ids[cam_id]:
                        self.fall_ids[cam_id].add(tid)
                        self.behavior_counts[cam_id]["falls"] += 1
                elif disp >= 25:
                    self.still_since[cam_id][tid] = now
        # Running: speed from oldest->newest in window
        if len(q) >= 6:
            (ox, oy, _, _, ot) = q[0]
            dt = max(now - ot, 1e-3)
            speed = math.hypot(cx - ox, cy - oy) / dt
            if speed > RUN_SPEED_PX_S:
                flags["running"] = True
        # Loitering: long dwell + small displacement
        first = self.enter_time[cam_id].get(tid)
        if first is None:
            self.enter_time[cam_id][tid] = now
            first = now
        if now - first > LOITER_SECS and len(q) >= 10:
            xs = [p[0] for p in list(q)[-20:]]
            ys = [p[1] for p in list(q)[-20:]]
            disp = math.hypot(max(xs) - min(xs), max(ys) - min(ys))
            if disp < 80:
                flags["loitering"] = True
        return flags

    def _detect(self, frame, cam_id, is_exit, infer_imgsz=None):
        if self.model is None:
            return frame, 0, 0, {}, 0.0
        self._cam = cam_id
        h = frame.shape[0]
        line_y = self._line_y(h, cam_id) if is_exit else None
        new_exits = 0
        boxes, ids, confs, flags = [], [], [], []
        now = time.time()

        try:
            results = self.model.track(
                frame, classes=[0], conf=CONF, persist=True,
                tracker="bytetrack.yaml", verbose=False, imgsz=infer_imgsz or IMGSZ,
            )
            if results and results[0].boxes is not None and len(results[0].boxes):
                r = results[0]
                xyxy = r.boxes.xyxy.cpu().numpy()
                cf = r.boxes.conf.cpu().numpy()
                tid = r.boxes.id.cpu().numpy().astype(int) if r.boxes.id is not None else None
                for i, b in enumerate(xyxy):
                    x1, y1, x2, y2 = map(int, b)
                    bw, bh = (x2 - x1), (y2 - y1)
                    if bw * bh < MIN_BOX_AREA:
                        continue
                    cx, cy = (x1 + x2) // 2, (y1 + y2) // 2
                    idv = int(tid[i]) if tid is not None else None
                    boxes.append((x1, y1, x2, y2))
                    c = float(cf[i])
                    confs.append(c)
                    ids.append(idv)
                    if idv is not None:
                        q = self.hist[cam_id][idv]
                        q.append((cx, cy, bw, bh, now))
                        f = self._classify(cam_id, idv, cx, cy, bw, bh, now)
                        flags.append(f)
                        if is_exit and line_y is not None and len(q) >= 2:
                            a, b_ = q[-2][1], q[-1][1]
                            crossed = (a < line_y <= b_) if EXIT_DIR == "down" else (a > line_y >= b_)
                            if crossed and idv not in self.crossed[cam_id]:
                                self.crossed[cam_id].add(idv)
                                self.exited[cam_id] += 1
                                new_exits += 1
                    else:
                        flags.append({})
        except Exception as e:
            print("[detect]", e)

        mean_conf = float(sum(confs) / len(confs)) if confs else 0.0
        # Crowd: count threshold or density
        crowd = len(boxes) >= CROWD_THRESH
        if not crowd and boxes:
            area = sum((b[2] - b[0]) * (b[3] - b[1]) for b in boxes)
            frame_area = frame.shape[0] * frame.shape[1]
            crowd = (area / max(frame_area, 1)) > 0.35
        if crowd and not self.crowd_state[cam_id]:
            self.crowd_state[cam_id] = True
            self.behavior_counts[cam_id]["crowdEvents"] += 1
        elif not crowd:
            self.crowd_state[cam_id] = False
        # Stuck: people present but no exits crossing for a while during fire
        stuck = len(boxes) > 0 and is_exit and new_exits == 0 and self.exited[cam_id] == 0 and len(boxes) >= 2

        fall_ids = [ids[i] for i in range(len(ids)) if ids[i] is not None and flags[i].get("fall")]
        running_ids = [ids[i] for i in range(len(ids)) if ids[i] is not None and flags[i].get("running")]
        loiter_ids = [ids[i] for i in range(len(ids)) if ids[i] is not None and flags[i].get("loitering")]
        behaviors = {
            "fallIds": fall_ids,
            "runningIds": running_ids,
            "loiteringIds": loiter_ids,
            "crowd": crowd,
            "stuck": stuck,
        }
        annotated = self._draw(frame, boxes, ids, confs, flags, is_exit, line_y, self.exited[cam_id], crowd)
        return annotated, len(boxes), new_exits, behaviors, mean_conf

    def _loop(self, cam_id, source, is_exit, drill_id):
        is_usb = str(source).isdigit()
        infer_imgsz = USB_IMGSZ if is_usb else IMGSZ
        detect_every = USB_DETECT_EVERY if is_usb else DETECT_EVERY
        cap = open_camera(source)
        if cap is None:
            with self.lock:
                self.active[cam_id] = False
                self.stats[cam_id] = {**self.stats.get(cam_id, {}), "active": False, "error": "camera-open-failed"}
            return

        n = 0
        last_post = 0.0
        last_boxes = 0
        last_behaviors = {}
        last_conf = 0.0
        fail_streak = 0
        last_frame_t = time.time()

        while self.active.get(cam_id):
            frame = grab_latest(cap)
            if frame is None:
                fail_streak += 1
                if fail_streak >= 30:
                    # USB glitch / unplugged — try to reopen instead of serving frozen frames.
                    try:
                        cap.release()
                    except Exception:
                        pass
                    cap = open_camera(source)
                    fail_streak = 0
                    if cap is None:
                        time.sleep(0.5)
                        continue
                else:
                    time.sleep(0.02)
                continue
            fail_streak = 0

            n += 1
            display = frame
            count = last_boxes
            new_exits = 0
            behaviors = last_behaviors
            mean_conf = last_conf

            # Pacing: if inference is slower than the camera, skip extra frames
            # instead of queueing (queueing = visible stutter).
            if n % detect_every == 0:
                t0 = time.time()
                display, count, new_exits, behaviors, mean_conf = self._detect(frame, cam_id, is_exit, infer_imgsz)
                last_boxes = count
                last_behaviors = behaviors
                last_conf = mean_conf
                bc = self.behavior_counts[cam_id]
                bc["maxOccupancy"] = max(bc["maxOccupancy"], count)
                infer_ms = (time.time() - t0) * 1000
                with self.lock:
                    s = self.stats.get(cam_id, {})
                    s["inferMs"] = round(infer_ms, 1)
            else:
                display = frame.copy()
                cv2.rectangle(display, (4, 4), (170, 36), (0, 0, 0), -1)
                cv2.putText(display, f"People: {last_boxes}", (10, 26),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.65, (0, 255, 0), 2)
                if is_exit:
                    ly = self._line_y(display.shape[0], cam_id)
                    cv2.line(display, (0, ly), (display.shape[1], ly), (0, 0, 255), 2)

            with self.lock:
                self.frames[cam_id] = display
                self.stats[cam_id] = {
                    "count": count,
                    "exited": self.exited[cam_id],
                    "tracks": count,
                    "behaviors": behaviors,
                    "meanConfidence": round(mean_conf, 3),
                    "timestamp": datetime.now().isoformat(),
                    "active": True,
                    "inferMs": self.stats.get(cam_id, {}).get("inferMs"),
                    "usbMode": is_usb,
                }
            last_frame_t = time.time()

            now = time.time()
            if now - last_post >= 2.0:
                post_async(
                    f"{self.backend_url}/api/cameras/{cam_id}/detect",
                    {"count": count, "confidence": round(mean_conf, 3) if mean_conf else 0.5, "behaviors": behaviors},
                )
                last_post = now

            if new_exits and drill_id:
                post_async(
                    f"{self.backend_url}/api/drills/{drill_id}/exit/{cam_id}",
                    {"count": new_exits},
                )

            # Tiny yield — no fixed sleep that would cap fps; capture paces itself.
            time.sleep(0.002)

        cap.release()
        with self.lock:
            self.active[cam_id] = False
            self.stats[cam_id] = {**self.stats.get(cam_id, {}), "active": False}
        print(f"[cam {cam_id}] stopped")

    def start_camera(self, camera_id, source, is_exit=False, direction="both", drill_id=None, line_ratio=None):
        with self.lock:
            if self.active.get(camera_id):
                return False
            self.active[camera_id] = True
            self.hist[camera_id].clear()
            self.crossed[camera_id].clear()
            self.enter_time[camera_id].clear()
            self.fall_ids[camera_id].clear()
            self.still_since[camera_id].clear()
            try:
                r = float(line_ratio) if line_ratio is not None else EXIT_RATIO
                if 0.05 < r < 0.95:
                    self.line_ratio[camera_id] = r
            except Exception:
                pass
            if not drill_id:
                self.exited[camera_id] = 0

        t = threading.Thread(
            target=self._loop,
            args=(camera_id, str(source), bool(is_exit), drill_id),
            daemon=True,
        )
        t.start()
        return True

    def stop_camera(self, camera_id):
        with self.lock:
            self.active[camera_id] = False

    def stop_all(self):
        with self.lock:
            for k in list(self.active.keys()):
                self.active[k] = False

    def get_frame(self, camera_id):
        with self.lock:
            f = self.frames.get(camera_id)
            if f is None:
                return None
            return {"frame": f, **self.stats.get(camera_id, {})}

    def get_stats(self, camera_id):
        with self.lock:
            s = self.stats.get(camera_id) or {}
            bc = self.behavior_counts.get(camera_id, {})
            return {
                "camera_id": camera_id,
                "count": s.get("count", 0),
                "exited": s.get("exited", self.exited.get(camera_id, 0)),
                "tracks": s.get("tracks", 0),
                "behaviors": s.get("behaviors", {}),
                "behaviorTotals": bc,
                "meanConfidence": s.get("meanConfidence", 0),
                "active": bool(self.active.get(camera_id)),
                "timestamp": s.get("timestamp"),
            }


detector = PersonTracker()
