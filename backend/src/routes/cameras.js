const express = require('express');
const { PrismaClient } = require('@prisma/client');
const authMiddleware = require('../middleware/auth');

const router = express.Router();
const prisma = new PrismaClient();

router.get('/building/:buildingId', authMiddleware, async (req, res) => {
  try {
    // Privacy: occupants may never bulk-list cameras. Managers/responders only.
    // (Occupant evacuation map uses whitelisted exit markers from /buildings/qr/:qrCode.)
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

router.post('/', authMiddleware, async (req, res) => {
  try {
    if (!['MANAGER', 'RESPONDER'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Only managers can add cameras' });
    }
    const { name, type, streamUrl, sourceUrl, buildingId, floorId, x, y, isExit, role, direction, isActive, lineRatio } = req.body;
    if (!name || !buildingId) return res.status(400).json({ error: 'Camera name and buildingId are required' });
    const allowedTypes = ['WEBCAM', 'USB', 'IP', 'PHONE'];
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
    const resolvedSource = sourceUrl || streamUrl || '0';
    if (!String(resolvedSource).trim()) return res.status(400).json({ error: 'Camera source is required (index or URL)' });
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
        type: (type || 'WEBCAM').toUpperCase(),
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
    if (type !== undefined) data.type = String(type).toUpperCase();
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

router.get('/:id/detections', authMiddleware, async (req, res) => {
  try {
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
      }
    }

    res.json(detection);
  } catch (error) {
    console.error('Error recording detection:', error);
    res.status(500).json({ error: 'Failed to record detection' });
  }
});

module.exports = router;
