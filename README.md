# FireGuard Pro — Fire Safety & Evacuation Management System

> Real-time fire alerts, QR check-in, live evacuation guidance, drill analytics, and responder coordination — built for offices, campuses, and residential towers.

[![Frontend](https://img.shields.io/badge/frontend-React%2018%20%2B%20Vite-blue)](frontend/)
[![Backend](https://img.shields.io/badge/backend-Node%20%2B%20Express%20%2B%20Socket.io-green)](backend/)
[![Database](https://img.shields.io/badge/database-PostgreSQL%20%2B%20Prisma-336791)](backend/prisma/schema.prisma)
[![Vision](https://img.shields.io/badge/vision-YOLOv8%20%2B%20OpenCV-orange)](backend/python-service/)

---

## Table of contents

- [What it does](#what-it-does)
- [Role matrix](#role-matrix)
- [Key features](#key-features)
- [Architecture](#architecture)
- [Tech stack](#tech-stack)
- [Getting started (local)](#getting-started-local)
- [Environment variables](#environment-variables)
- [Deploying to production](#deploying-to-production)
- [QR check-in flow](#qr-check-in-flow)
- [Emergency & drill flows](#emergency--drill-flows)
- [API overview](#api-overview)
- [Realtime events (Socket.io)](#realtime-events-socketio)
- [Troubleshooting](#troubleshooting)
- [Safety disclaimer](#safety-disclaimer)

---

## What it does

FireGuard Pro connects **building managers**, **occupants**, and **fire responders** on one realtime platform:

1. Managers design floor plans, place exit cameras, and publish a QR code per building.
2. Occupants scan the QR, check in, and instantly receive fire/drill alerts with an evacuation map.
3. During an incident, occupants see a **live less-crowded exit recommendation** from exit-camera counts.
4. Responders see exactly **which building is on fire**, its address, map directions, SOS queue, and who is still checked in.

---

## Role matrix

| Capability | Manager | Occupant | Responder |
|---|---|---|---|
| Create / edit buildings, floors, cameras | ✅ | ❌ | ❌ |
| Add building map address (lat/lng + Google Maps link) | ✅ | ❌ | ❌ (views) |
| Check in via QR, view evacuation map, SOS | ✅* | ✅ | ✅* |
| Check out / remove any occupant from own building | ✅ | self only | ❌ |
| Trigger / resolve fire emergency or drill | ✅ (own buildings) | ❌ | ✅ |
| See private building details | own only | checked-in only | **only during active fire at that building** |
| See public building address + map | ✅ | checked-in only | ✅ |
| Live exit-crowd guidance | ✅ | ✅ (counts only, no video) | ✅ |
| Room camera feeds | during active fire only | ❌ never | during active fire only |

\* Managers/responders can also use occupant views for testing.

---

## Key features

- **Buildings + QR check-in** — public/private visibility, printable QR, guest + authenticated check-in, active presence board with CSV export.
- **Manager occupant control** — remove / force-checkout anyone from your building; their devices clear instantly via `presence-force-removed`.
- **Floor plan designer** — drag-and-drop walls, doors, exits, stairs, assembly points over an uploaded plan image (React-Konva, 1000×700 design space).
- **Multi-camera support** — webcam, USB, IP, phone/browser publishing; `EXIT` / `CCTV` / `BOTH` roles; YOLOv8 person detection + behavior flags via Python service.
- **Live less-crowded routing** — `GET /api/cameras/building/:id/exit-load` ranks exits (LOW / MODERATE / CROWDED, `recommended` flag) from fresh detections + drill totals + live CV stats with DB fallback; occupant map highlights `✓ USE THIS EXIT` and polls every 5s.
- **In-app emergency alerts** — persistent non-dismissable fire banner, fire wail vs drill tone, vibration, Wake Lock + flashing tab title during fire, auto-rejoining sockets; 5s polling fallback if sockets drop.
- **Fire drills** — start/end, per-exit counts, behavior summary, CSV export, drill report endpoint.
- **SOS pipeline** — location + message, acknowledge/resolve, live queues for managers and responders.
- **Responder command** — `ON FIRE NOW` hero card with exact address + **Get directions / View on map** (Google Maps links, no API key), per-building separate cards (public open, private locked unless on fire), incident monitor with SOS + presence + fire-only CCTV.
- **Safety reports** — occupant complaints per building with manager triage (`open → in_progress → resolved`).

---

## Architecture

```text
                    +------------------+
                    |  React 18 + Vite |
                    |  Tailwind + Konva|
                    +--------+---------+
                             |  HTTPS/WSS  axios + socket.io-client
                             v
                    +--------+---------+
                    | Node + Express   |----> Supabase Postgres (Prisma)
                    | Socket.io rooms  |
                    |  building-{id}   |
                    |  emergency-{id}  |
                    +--------+---------+
                             |  HTTP  PYTHON_SERVICE_URL
                             v
                    +--------+---------+
                    | Flask + YOLOv8   |
                    | /stats /snapshot |
                    | /frame /start    |
                    +------------------+
```

- **Rooms:** clients `join-building` on check-in; managers/responders `join-emergency` on incidents.
- **Static assets:** floor images served from `backend/uploads/` → `/uploads` (proxied in dev via `vite.config.ts`).
- **Privacy rule:** room video (`/emergency/:id/feeds`) is MANAGER/RESPONDER-only during ACTIVE FIRE; occupants only ever see exit **counts**.

---

## Tech stack

| Layer | Choice |
|---|---|
| Frontend | React 18, TypeScript, Vite, Tailwind CSS, React-Konva, Zustand, socket.io-client, axios |
| Backend | Node.js, Express 4, Socket.io 4, Prisma 5, JWT + bcryptjs, multer, qrcode |
| Database | PostgreSQL (Supabase in production, SQLite-compatible schema for dev) |
| Vision | Python 3.10+, Flask, OpenCV, YOLOv8 (`yolov8n.pt` bundled) |
| Auth | JWT (`Authorization: Bearer`) |

---

## Getting started (local)

### Prerequisites

- Node.js 18+, Python 3.10+, npm, pip
- A Postgres database (or Supabase project) for `DATABASE_URL`

### 1. Backend

```bash
cd backend
npm install
npx prisma generate
npx prisma migrate dev --name init
npm run db:seed   # demo users + sample building
npm run dev       # http://localhost:3001
```

### 2. Python vision service (optional but recommended for live counts)

```bash
cd backend/python-service
pip install -r requirements.txt
python app.py     # http://localhost:5000
```

Without it the app still runs — exit guidance falls back to stored detections/drill totals.

### 3. Frontend

```bash
cd frontend
npm install
npm run dev       # http://localhost:5173
```

Copy `.env.example` to `.env` and adjust hosts if phones join over LAN (use your PC's LAN IP for `VITE_SOCKET_URL` / `VITE_CV_URL`).

### Demo credentials

| Role | Email | Password |
|---|---|---|
| Manager | manager@firesafety.com | manager123 |
| Occupant | user@firesafety.com | user123 |
| Responder | responder@firesafety.com | responder123 |

---

## Environment variables

### Backend (`backend/.env`)

| Key | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | ✅ | Postgres connection (Supabase pooler URL works) |
| `JWT_SECRET` | ✅ | Signing key for auth tokens |
| `JWT_EXPIRES_IN` | ❌ | Default `7d` |
| `PORT` | ❌ | Default `3001` |
| `FRONTEND_URL` | ✅ (prod) | Allowed CORS origin(s), comma-separated; also used for QR links |
| `PYTHON_SERVICE_URL` | ❌ | CV service base, default `http://localhost:5000` |
| `CV_BASE_URL` | ❌ | Alias honored by `/emergency/:id/feeds` |
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | prod | Only if you use Supabase helpers directly |

### Frontend (`frontend/.env`)

| Key | Default | Purpose |
|---|---|---|
| `VITE_API_URL` | `/api` | Backend REST base (use `/api` behind same-origin proxy in prod) |
| `VITE_SOCKET_URL` | `http://<host>:3001` | Socket.io endpoint; LAN-aware fallback built in |
| `VITE_CV_URL` | `http://<host>:5000` | Live snapshots via `SnapshotImg` |

---

## Deploying to production

Tested shape: **Vercel/Netlify (frontend)** + **Render/Railway/Fly (backend)** + **Supabase Postgres** + optional CV worker.

1. **Database** — create a Supabase project, copy the pooler `DATABASE_URL`, then:
   ```bash
   cd backend
   npx prisma migrate deploy
   npm run db:seed   # optional, demo data only
   ```
2. **Backend** — set env (`DATABASE_URL`, `JWT_SECRET`, `FRONTEND_URL=https://your-app.vercel.app`, `PYTHON_SERVICE_URL`), start with `node server.js`. Ensure `/uploads` persists (or swap to object storage later — `imageUrl` fields are plain URLs).
3. **Frontend** — set `VITE_API_URL=/api` (with a proxy) or the absolute backend URL, then `npm run build` → deploy `dist/`.
4. **CORS/Sockets** — `server.js` allows `FRONTEND_URL` + localhost + RFC1918 LAN hosts; add your domain to `FRONTEND_URL` if the defaults block it.
5. **Vision (optional)** — deploy `backend/python-service` where cameras are reachable; point `PYTHON_SERVICE_URL` at it. The app degrades gracefully if it is offline.
6. **Smoke test** — login as manager → create building → print QR → check in on a phone → trigger drill → resolve; then trigger FIRE as responder and confirm the responder hero card + directions link + SOS flow.

---

## QR check-in flow

1. Manager creates a **public** building → Buildings page → **QR** → print at entrances.
2. Visitor opens `/building/{qrCode}` → enters name/phone/floor → **Check in**.
3. Manager triggers **Emergency** or **Drill** → checked-in clients get socket push + banner + siren + vibration.
4. Visitor follows the evacuation map + **live recommended exit**, uses **SOS** if trapped, files safety reports.
5. Manager force-checkout removes anyone instantly (`presence-force-removed`); responder monitor shows live SOS + remaining occupants.

---

## Emergency & drill flows

- **Fire (real):** `POST /api/emergency/trigger { buildingId, type: 'FIRE' }` → `fire-started` + `building-emergency` to `building-{id}` and global; responder overview lists it as `ON FIRE NOW` with address + directions; CCTV feeds unlock (`GET /api/emergency/:id/feeds`); resolve emits `fire-resolved` and auto-cuts feeds + siren.
- **Drill (practice):** `POST /api/drills/start` → `drill-started` + `drill-alert` (amber tone, dismissable); exit cameras count via `POST /api/drills/:id/exit/:cameraId`; end with `drill-ended`; CSV export at `GET /api/drills/:id/export`.
- **Exit guidance (both):** occupants poll `GET /api/cameras/building/:id/exit-load` every 5s + instant `exit-load-update` pushes; no video leaves the server.

---

## API overview

| Area | Endpoints |
|---|---|
| Auth | `POST /api/auth/register, /login, /me` |
| Buildings | `GET /api/buildings`, `GET /api/buildings/responder/overview`, `GET /api/buildings/qr/:qrCode`, `POST /api/buildings`, `GET/PUT/DELETE /api/buildings/:id` |
| Presence | `POST /api/presence/check-in`, `POST /api/presence/check-out`, `DELETE /api/presence/:id` (manager), `GET /api/presence/mine`, `/status`, `/building/:id`, `/building/:id/count` |
| Emergency | `GET /api/emergency/active`, `POST /api/emergency/trigger`, `POST /api/emergency/:id/resolve`, `GET /api/emergency/:id`, `GET /api/emergency/:id/feeds`, `POST /api/emergency/:id/occupancy` |
| Drills | `GET /api/drills/building/:id`, `POST /api/drills/start`, `POST /api/drills/:id/end`, `POST /api/drills/:id/exit/:cameraId`, `GET /api/drills/:id/export`, `GET /api/drills/:id/report` |
| Cameras | `GET /api/cameras/building/:id`, `GET /api/cameras/building/:id/exit-load` (public-safe), `POST /api/cameras`, `PUT/DELETE /api/cameras/:id`, `POST /api/cameras/:id/test`, `GET /api/cameras/:id/detections`, `POST /api/cameras/:id/detect` |
| SOS / Complaints | `GET/POST /api/sos`, `POST /api/sos/:id/acknowledge|resolve`, `GET /api/complaints/building/:id`, `POST /api/complaints`, `PUT /api/complaints/:id` |

---

## Realtime events (Socket.io)

| Event | Direction | Payload |
|---|---|---|
| `join-building` / `join-emergency` | client → server | `{ buildingId }` / `{ emergencyId }` |
| `fire-started`, `drill-alert`, `emergency-started`, `building-emergency` (+ `-global`) | server → room | `{ emergencyId, buildingId, type, severity, message, building }` |
| `fire-resolved`, `emergency-resolved` (+ `-global`), `drill-ended` (+ `-global`) | server → room | `{ emergencyId, buildingId }` |
| `occupant-checked-in/out`, `presence-force-removed` | server → `building-{id}` | `{ presenceId, buildingId }` |
| `detection`, `exit-load-update`, `exit-count` | server → `building-{id}` | `{ cameraId, count }` |
| `sos-received`, `sos-updated`, `occupancy-update` | server → room | SOS / occupancy payloads |

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| Frontend can't reach backend on a phone | Use your PC's LAN IP in `VITE_SOCKET_URL`/`VITE_API_URL`; same Wi-Fi; backend binds `0.0.0.0:3001` already |
| Floor images 404 in dev | Keep the `/uploads` proxy in `frontend/vite.config.ts`; restart Vite after backend restart |
| Camera feeds 410 / "Feeds cut" | Expected unless ACTIVE **FIRE** (drills never unlock CCTV); check `PYTHON_SERVICE_URL` health |
| Siren silent on phones | Browsers require one tap first; the app auto-retries resume for ~30s + vibrates; resolving anywhere stops it globally |
| Responder sees "locked" building | Private details unlock only during ACTIVE FIRE at that building; make it public or trigger a fire to verify |
| No exit recommendation | Add at least one camera with role EXIT/BOTH (`isExit`), then counts flow from detections or drill totals |
| Prisma errors after pull | `cd backend && npx prisma generate && npx prisma migrate dev` |

---

## Safety disclaimer

FireGuard Pro is an **aid to evacuation management**, not a certified fire-detection system. Always follow local fire codes, audible alarm panels, and instructions from emergency services. Test alerts and QR flows before relying on them in a real building.
