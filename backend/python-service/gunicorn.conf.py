# Gunicorn config for the FireGuard CV service on Render.
#
# WHY THIS EXISTS:
# The detector keeps ALL camera state (loops, frames, stats) in process
# memory, so:
#   workers = 1        (more workers = each has its own amnesiac copy of the
#                       state; /frame may land on worker A while the capture
#                       loop runs on worker B and viewers poll worker C)
#   threads = 4        (concurrency via threads instead; detector has its own
#                       lock, and capture loops run in background threads)
#   timeout = 120      (headroom for slow YOLO cold inference; live views must
#                       use /snapshot polling anyway — /feed is capped at ~25s)
#
# RENDER DASHBOARD: set this service's Start Command to:
#   gunicorn app:app -c gunicorn.conf.py --bind 0.0.0.0:$PORT
import os

bind = f"0.0.0.0:{os.environ.get('PORT', '5000')}"
workers = 1
threads = 4
worker_class = "gthread"
timeout = 120
graceful_timeout = 30
keepalive = 5
preload_app = False
