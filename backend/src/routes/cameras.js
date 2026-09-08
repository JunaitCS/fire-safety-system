const express = require('express');
const { PrismaClient } = require('@prisma/client');
const authMiddleware = require('../middleware/auth');

const router = express.Router();
const prisma = new PrismaClient();

router.get('/building/:buildingId', authMiddleware, async (req, res) => {
  try {
    // Privacy: occupants may never bulk-list cameras. Managers/responders only.
    // (Occupant evacuation map uses whitelisted exit markers from /buildings/qr/:qrCode.
    //  Live crowd levels use the public-safe /exit-load endpoint below instead.)
    if (req.user.role === 'OCCUPANT' && req.query.emergencyOnly !== '0') {
      return res.status(403).json({ error: 'Camera access is restricted to managers and responders' });
    }
    const cameras = await prisma.camera.findMany({
      where: { buildingId: req.params.buildingId },
      include: {
        floor: true,
        _count: {
          select: { detections: true },
        },
      },
    });

    res.json(cameras);
  } catch (error) {
    console.error('Error fetching cameras:', error);
    res.status(500).json({ error: 'Failed to fetch cameras' });
  }
});

// Public-safe live crowd levels per EXIT camera (no video, no room feeds).
// Occupants poll this during fire/drill to pick the less-crowded exit.
// Counts prefer the freshest DetectionEvent (<2 min), fall back to active
// drill exit totals, then to live CV stats best-effort. Never 500s when the
// CV service is offline — it degrades to DB counts.
router.get('/building/:buildingId/exit-load', async (req, res) => {
  try {
    const { buildingId } = req.params;
    const building = await prisma.building.findUnique({ where: { id: buildingId } });
    if (!building) return res.status(404).json({ error: 'Building not found' });

    const exits = await prisma.camera.findMany({
      where: { buildingId, isActive: true, OR: [{ isExit: true }, { role: { in: ['EXIT', 'BOTH'] } }] },
      select: { id: true, name: true, floorId: true, role: true, isExit: true },
      orderBy: { name: 'asc' },
    });
    if (!exits.length) return res.json({ buildingId, exits: [], updatedAt: new Date().toISOString() });

    const since = new Date(Date.now() - 2 * 60 * 1000);
    const [recent, activeDrill] = await Promise.all([
      prisma.detectionEvent.findMany({
        where: { cameraId: { in: exits.map((c) => c.id) }, timestamp: { gte: since } },
        orderBy: { timestamp: 'desc' },
        take: exits.length * 5,
      }),
      prisma.fireDrill.findFirst({
        where: { buildingId, status: 'active' },
        include: { exitStats: true },
      }),
    ]);
    const latestByCam = {};
    for (const d of recent) {
      if (!latestByCam[d.cameraId]) latestByCam[d.cameraId] = d;
    }
    const drillByCam = {};
    if (activeDrill) {
      for (const s of activeDrill.exitStats || []) drillByCam[s.cameraId] = s.exitCount;
    }

    // Best-effort live CV stats (short timeout, failures ignored).
    let liveByCam = {};
    try {
      const cvBase = (process.env.PYTHON_SERVICE_URL || process.env.CV_BASE_URL || 'http://localhost:5000').replace(/\/$/, '');
      const results = await Promise.all(
        exits.map(async (c) => {
          try {
            const ctrl = new AbortController();
            const t = setTimeout(() => ctrl.abort(), 1500);
            const r = await fetch(`${cvBase}/cameras/${c.id}/stats`, { signal: ctrl.signal }).then((x) => (x.ok ? x.json() : null)).catch(() => null);
            clearTimeout(t);
            const n = r != null ? Number(r.count ?? r.personCount ?? r.people) : NaN;
            return [c.id, Number.isFinite(n) && n >= 0 ? n : null];
          } catch { return [c.id, null]; }
        })
      );
      liveByCam = Object.fromEntries(results);
    } catch { liveByCam = {}; }

    const levelOf = (n) => (n < 5 ? 'LOW' : n < 15 ? 'MODERATE' : 'CROWDED');
    let list = exits.map((c) => {
      let count = null;
      let source = 'none';
      if (latestByCam[c.id]) { count = latestByCam[c.id].count; source = 'detection'; }
      else if (drillByCam[c.id] != null) { count = drillByCam[c.id]; source = 'drill'; }
      else if (liveByCam[c.id] != null) { count = liveByCam[c.id]; source = 'live'; }
      if (count == null) { count = 0; source = 'none'; }
      return {
        cameraId: c.id, name: c.name, floorId: c.floorId,
        role: c.role || (c.isExit ? 'EXIT' : 'CCTV'),
        count, level: levelOf(count), source,
        recommended: false,
      };
    });
    list.sort((a, b) => a.count - b.count);
    if (list.length) list[0].recommended = true;
    res.json({ buildingId, exits: list, updatedAt: new Date().toISOString() });
  } catch (error) {
    console.error('Error fetching exit load:', error);
    res.status(500).json({ error: 'Failed to fetch exit load' });
  }
});

router.post('/', authMiddleware, async (req, res) => {
  try {
    if (!['MANAGER', 'RESPONDER'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Only managers can add cameras' });
    }
    const { name, type, streamUrl, sourceUrl, buildingId, floorId, x, y, isExit, role, direction, isActive, lineRatio } = req.body;
    if (!name || !buildingId) return res.status(400).json({ error: 'Camera name and buildingId are required' });
    const allowedTypes = ['WEBCAM', 'USB', 'IP', 'PHONE', 'BROWSER'];
    if (type && !allowedTypes.includes(String(type).toUpperCase())) {
      return res.status(400).json({ error: `Invalid type. Use: ${allowedTypes.join(', ')}` });
    }
    const allowedRoles = ['EXIT', 'CCTV', 'BOTH'];
    const resolvedRole = role ? String(role).toUpperCase() : (isExit ? 'EXIT' : 'CCTV');
    if (!allowedRoles.includes(resolvedRole)) {
      return res.status(400).json({ error: `Invalid role. Use: ${allowedRoles.join(', ')}` });
    }
    const building = await prisma.building.findUnique({ where: { id: buildingId } });
    if (!building) return res.status(404).json({ error: 'Building not found' });
    const resolvedType = (type || 'WEBCAM').toUpperCase();
    let resolvedSource = sourceUrl || streamUrl || (resolvedType === 'BROWSER' ? 'browser' : '0');
    if (!String(resolvedSource).trim()) {
      if (resolvedType === 'BROWSER') resolvedSource = 'browser';
      else return res.status(400).json({ error: 'Camera source is required (index or URL)' });
    }
    let validatedFloorId = null;
    if (floorId) {
      const floor = await prisma.floor.findUnique({ where: { id: floorId } });
      if (!floor) return res.status(404).json({ error: 'Floor not found' });
      if (floor.buildingId !== buildingId) return res.status(400).json({ error: 'Floor does not belong to this building' });
      validatedFloorId = floorId;
    }
    const ratio = lineRatio !== undefined && lineRatio !== null && lineRatio !== '' ? Number(lineRatio) : null;
    if (ratio !== null && (!Number.isFinite(ratio) || ratio <= 0.05 || ratio >= 0.95)) {
      return res.status(400).json({ error: 'lineRatio must be between 0.05 and 0.95' });
    }
    const camera = await prisma.camera.create({
      data: {
        name: String(name).trim(),
        type: resolvedType,
        sourceUrl: resolvedSource || null,
        buildingId,
        floorId: validatedFloorId,
        x: x ?? null,
        y: y ?? null,
        isExit: resolvedRole !== 'CCTV',
        role: resolvedRole,
        direction: direction || null,
        lineRatio: ratio,
        isActive: isActive !== undefined ? Boolean(isActive) : true,
      },
      include: {
        floor: true,
      },
    });

    res.json(camera);
  } catch (error) {
    console.error('Error creating camera:', error);
    // Include the Prisma error code/message so the UI can tell the user what
    // actually went wrong instead of a bare "failed". Validation errors have
    // no `code`, so fall back to the first line of the message.
    const detail = error.code || (error.message ? String(error.message).split('\n')[0].slice(0, 300) : undefined);
    res.status(500).json({ error: 'Failed to create camera', detail });
  }
});

router.put('/:id', authMiddleware, async (req, res) => {
  try {
    const existing = await prisma.camera.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Camera not found' });
    const { name, type, streamUrl, sourceUrl, floorId, x, y, isExit, role, direction, isActive, buildingId, lineRatio } = req.body;
    const data = {};
    if (name !== undefined) data.name = String(name).trim();
    if (type !== undefined) {
      const t = String(type).toUpperCase();
      if (!['WEBCAM', 'USB', 'IP', 'PHONE', 'BROWSER'].includes(t)) return res.status(400).json({ error: 'Invalid type' });
      data.type = t;
    }
    if (streamUrl !== undefined || sourceUrl !== undefined) data.sourceUrl = sourceUrl || streamUrl || '0';
    if (x !== undefined) data.x = x;
    if (y !== undefined) data.y = y;
    if (role !== undefined) {
      const rr = String(role).toUpperCase();
      if (!['EXIT', 'CCTV', 'BOTH'].includes(rr)) return res.status(400).json({ error: 'Invalid role' });
      data.role = rr;
      data.isExit = rr !== 'CCTV';
    } else if (isExit !== undefined) {
      data.isExit = Boolean(isExit);
      data.role = data.isExit ? (existing.role === 'BOTH' ? 'BOTH' : 'EXIT') : 'CCTV';
    }
    if (direction !== undefined) data.direction = direction || null;
    if (isActive !== undefined) data.isActive = Boolean(isActive);
    if (buildingId !== undefined) data.buildingId = buildingId;
    if (floorId !== undefined) data.floorId = floorId || null;
    if (lineRatio !== undefined) {
      const r = lineRatio === null || lineRatio === '' ? null : Number(lineRatio);
      if (r !== null && (!Number.isFinite(r) || r <= 0.05 || r >= 0.95)) {
        return res.status(400).json({ error: 'lineRatio must be between 0.05 and 0.95' });
      }
      data.lineRatio = r;
    }
    const camera = await prisma.camera.update({
      where: { id: req.params.id },
      data,
      include: {
        floor: true,
      },
    });

    res.json(camera);
  } catch (error) {
    console.error('Error updating camera:', error);
    res.status(500).json({ error: 'Failed to update camera' });
  }
});

router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const existing = await prisma.camera.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Camera not found' });
    // Best-effort: stop any live CV stream for this camera.
    try {
      const cvBase = (process.env.PYTHON_SERVICE_URL || 'http://localhost:5000').replace(/\/$/, '');
      await fetch(`${cvBase}/cameras/${req.params.id}/stop`, { method: 'POST' }).catch(() => {});
    } catch {}
    // Delete child records first: DrillExitStats has no DB cascade, so a plain
    // camera.delete() fails with a foreign-key error once the camera has drill
    // or detection history ("Failed to delete camera").
    await prisma.$transaction([
      prisma.drillExitStats.deleteMany({ where: { cameraId: req.params.id } }),
      prisma.detectionEvent.deleteMany({ where: { cameraId: req.params.id } }),
      prisma.occupancyTracking.deleteMany({ where: { cameraId: req.params.id } }),
      prisma.camera.delete({ where: { id: req.params.id } }),
    ]);
    if (req.io) req.io.to(`building-${existing.buildingId}`).emit('camera-deleted', { cameraId: req.params.id });

    res.json({ message: 'Camera deleted' });
  } catch (error) {
    console.error('Error deleting camera:', error);
    res.status(500).json({ error: 'Failed to delete camera' });
  }
});

router.post('/:id/test', authMiddleware, async (req, res) => {
  try {
    const camera = await prisma.camera.findUnique({ where: { id: req.params.id } });
    if (!camera) return res.status(404).json({ error: 'Camera not found' });
    const cvBase = (process.env.PYTHON_SERVICE_URL || 'http://localhost:5000').replace(/\/$/, '');
    // Probe CV service health + camera stats endpoint without persisting anything.
    const healthRes = await fetch(`${cvBase}/health`).then((r) => r.json()).catch(() => null);
    return res.json({
      ok: true,
      cameraId: camera.id,
      sourceUrl: camera.sourceUrl,
      cvService: healthRes || { status: 'unreachable' },
      hint: healthRes ? 'CV service reachable. Open the live feed to visually confirm.' : 'Start the Python CV service on ' + cvBase,
    });
  } catch (error) {
    res.status(500).json({ error: 'Camera test failed' });
  }
});

router.get('/:id/detections', authMiddleware, async (req, res) => {  try {
    const detections = await prisma.detectionEvent.findMany({
      where: { cameraId: req.params.id },
      orderBy: { timestamp: 'desc' },
      take: 100,
    });

    res.json(detections);
  } catch (error) {
    console.error('Error fetching detections:', error);
    res.status(500).json({ error: 'Failed to fetch detections' });
  }
});

// Single-camera lookup (used by the phone publish page to show the camera
// name instead of a raw id, so publishing to the wrong camera is obvious).
// Any authenticated role may read it — the publish page is open to
// MANAGER / RESPONDER / OCCUPANT for testing.
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const camera = await prisma.camera.findUnique({
      where: { id: req.params.id },
      include: { floor: true, building: { select: { id: true, name: true } } },
    });
    if (!camera) return res.status(404).json({ error: 'Camera not found' });
    res.json(camera);
  } catch (error) {
    console.error('Error fetching camera:', error);
    res.status(500).json({ error: 'Failed to fetch camera' });
  }
});

router.post('/:id/detect', async (req, res) => {
  try {
    const count = Number(req.body.count);
    if (!Number.isFinite(count) || count < 0) return res.status(400).json({ error: 'Valid count is required' });
    const cameraExists = await prisma.camera.findUnique({ where: { id: req.params.id } });
    if (!cameraExists) return res.status(404).json({ error: 'Camera not found' });
    const { confidence, imageData, behaviors } = req.body;

    const detection = await prisma.detectionEvent.create({
      data: {
        cameraId: req.params.id,
        count,
        confidence: confidence ?? null,
        imageData: imageData ?? null,
        behaviors: behaviors ? (typeof behaviors === 'string' ? behaviors : JSON.stringify(behaviors)) : null,
      },
    });

    const io = req.io;
    if (io) {
      const camera = await prisma.camera.findUnique({
        where: { id: req.params.id },
      });
      
      if (camera) {
        io.to(`building-${camera.buildingId}`).emit('detection', {
          cameraId: req.params.id,
          count,
          timestamp: detection.timestamp,
        });
        // Live exit-crowd hint for occupant evacuation screens (throttled
        // client-side by polling; this push makes the first update instant).
        if (camera.isExit || camera.role === 'EXIT' || camera.role === 'BOTH') {
          io.to(`building-${camera.buildingId}`).emit('exit-load-update', {
            cameraId: req.params.id,
            count,
            timestamp: detection.timestamp,
          });
        }
      }
    }

    res.json(detection);
  } catch (error) {
    console.error('Error recording detection:', error);
    res.status(500).json({ error: 'Failed to record detection' });
  }
});

module.exports = router;
