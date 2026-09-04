# FireGuard Pro - Fire Safety & Evacuation Management System

A comprehensive fire safety and evacuation management system with AI-powered person detection, real-time alerts, floor plan designer, and role-based interfaces for Managers, Occupants, and Responders.

## Technology Stack

- **Frontend**: React 18 + TypeScript + Vite + Tailwind CSS + React-Konva
- **Backend**: Node.js + Express + Socket.io + Prisma + SQLite
- **Computer Vision**: Python + Flask + OpenCV + YOLOv8
- **Auth**: JWT + bcrypt

## Quick Start (VS Code)

### Prerequisites
- Node.js 18+
- Python 3.10+
- npm / pip

### 1. Backend Setup

```bash
cd backend
npm install
npx prisma generate
npx prisma migrate dev --name init
npm run db:seed
```

### 2. Python CV Service

```bash
cd backend/python-service
pip install -r requirements.txt
# On first run, YOLOv8n model will download automatically
```

### 3. Frontend Setup

```bash
cd frontend
npm install
```

### 4. Run All Services (3 terminals)

**Terminal 1 - Backend:**
```bash
cd backend
npm run dev
```

**Terminal 2 - Python CV:**
```bash
cd backend/python-service
python app.py
```

**Terminal 3 - Frontend:**
```bash
cd frontend
npm run dev
```

Open http://localhost:5173

### Demo Credentials

| Role       | Email                        | Password      |
|------------|------------------------------|---------------|
| Manager    | manager@firesafety.com       | manager123    |
| Occupant   | user@firesafety.com          | user123       |
| Responder  | responder@firesafety.com     | responder123  |

## Features

- Floor plan designer (drag & drop walls, doors, exits, cameras)
- Multi-camera support (webcam, USB, IP, phone)
- YOLOv8 real-time person detection & counting
- Fire drills with exit usage stats + CSV export
- Real-time emergency alerts via WebSockets
- SOS system with location
- QR code building access
- Three distinct UIs for Manager / Occupant / Responder

## Project Structure

```
fire-safety-system/
├── backend/
│   ├── prisma/
│   ├── src/routes/
│   ├── python-service/
│   └── server.js
├── frontend/
│   └── src/
└── README.md
```


## QR check-in flow (Rahim → Rakib's building)

1. Manager creates a building (public) and prints the QR from Buildings page.
2. Visitor scans QR → opens `/building/{qrCode}`.
3. Visitor checks in (name / phone / floor) → stored as active presence.
4. Manager triggers Emergency or Drill → all checked-in clients get socket + browser notification + sound.
5. Visitor sees evacuation map (exits, paths, assembly), can SOS and submit complaints.
6. Responder Command shows live SOS queue and who is still checked in.

After schema changes run:
```bash
cd backend
npx prisma db push
```
