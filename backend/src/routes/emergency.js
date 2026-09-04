const express = require('express');
const { PrismaClient } = require('@prisma/client');
const authMiddleware = require('../middleware/auth');

const router = express.Router();
const prisma = new PrismaClient();

router.get('/active', authMiddleware, async (req, res) => {
  try {
    const where = { status: 'ACTIVE' };
    if (req.query.buildingId) where.buildingId = String(req.query.buildingId);
    if (req.query.type) where.type = String(req.query.type).toUpperCase();
    const emergencies = await prisma.emergencyEvent.findMany({
      where,
      include: {
        building: true,
        triggerer: {
          select: { id: true, name: true, email: true },
        },
        _count: {
          select: { occupancies: true, sosRequests: true },
        },
      },
      orderBy: { startTime: 'desc' },
    });

    res.json(emergencies);
  } catch (error) {
    console.error('Error fetching emergencies:', error);
    res.status(500).json({ error: 'Failed to fetch emergencies' });
  }
});

router.post('/trigger', authMiddleware, async (req, res) => {
  try {
    if (!['MANAGER', 'RESPONDER'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Only managers or responders can trigger fire emergencies' });
    }
    const { buildingId, severity = 'high', title, description, type = 'FIRE' } = req.body;
    if (!buildingId) return res.status(400).json({ error: 'buildingId is required' });
    const allowedSev = ['low', 'medium', 'high', 'critical'];
    if (!allowedSev.includes(severity)) return res.status(400).json({ error: 'Invalid severity' });
    const eventType = String(type).toUpperCase() === 'DRILL' ? 'DRILL' : 'FIRE';

    const building = await prisma.building.findUnique({ where: { id: buildingId } });
    if (!building) return res.status(404).json({ error: 'Building not found' });

    const existing = await prisma.emergencyEvent.findFirst({ where: { buildingId, status: 'ACTIVE' } });
    if (existing) return res.status(409).json({ error: 'An active emergency already exists for this building', emergency: existing });

    const emergency = await prisma.emergencyEvent.create({
      data: {
        buildingId,
        triggeredBy: req.user.userId,
        severity,
        status: 'ACTIVE',
        type: eventType,
        title: title || (eventType === 'FIRE' ? 'Fire emergency' : 'Evacuation drill alert'),
        description: description || null,
      },
      include: {
        building: true,
        triggerer: {
          select: { id: true, name: true },
        },
      },
    });

    let occupantCount = 0;
    try {
      occupantCount = await prisma.occupantPresence.count({
        where: { buildingId, isActive: true },
      });
    } catch (_) {}

    const firePayload = {
      id: emergency.id,
      emergencyId: emergency.id,
      buildingId,
      severity,
      type: eventType,
      title: emergency.title,
      startTime: emergency.startTime,
      message: eventType === 'FIRE'
        ? 'FIRE EMERGENCY: Real fire incident. Evacuate immediately via nearest exit. Do not use elevators.'
        : 'DRILL ALERT: Practice evacuation. Proceed to nearest exit in an orderly manner.',
      building: emergency.building,
      occupantCount,
    };
    // Distinct event names: fire-started (real) vs drill-alert (practice).
    // Legacy emergency-started / building-emergency kept for backward compat.
    if (req.io) req.io.to(`building-${buildingId}`).emit('emergency-started', firePayload);

    // also broadcast globally so any client with this building checked-in hears it
    if (req.io) req.io.emit('building-emergency', {
      emergencyId: emergency.id,
      buildingId,
      buildingName: emergency.building?.name,
      severity,
      type: eventType,
      message: firePayload.message,
      startTime: emergency.startTime,
    });
    if (req.io) {
      if (eventType === 'FIRE') req.io.to(`building-${buildingId}`).emit('fire-started', firePayload);
      else req.io.to(`building-${buildingId}`).emit('drill-alert', firePayload);
      req.io.emit(eventType === 'FIRE' ? 'fire-started-global' : 'drill-alert-global', firePayload);
    }

    res.json(emergency);
  } catch (error) {
    console.error('Error triggering emergency:', error);
    res.status(500).json({ error: 'Failed to trigger emergency' });
  }
});

router.post('/:id/resolve', authMiddleware, async (req, res) => {
  try {
    const existing = await prisma.emergencyEvent.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Emergency not found' });
    if (existing.status === 'RESOLVED') return res.status(409).json({ error: 'Emergency already resolved' });
    const emergency = await prisma.emergencyEvent.update({
      where: { id: req.params.id },
      data: {
        status: 'RESOLVED',
        endTime: new Date(),
      },
      include: {
        building: true,
      },
    });

    if (req.io) {
      req.io.to(`building-${emergency.buildingId}`).emit('emergency-resolved', {
        emergencyId: emergency.id,
        message: 'Emergency has been resolved. Thank you for your cooperation.',
      });
      // Distinct resolve event so CCTV clients can auto-cut feeds immediately.
      req.io.to(`building-${emergency.buildingId}`).emit('fire-resolved', {
        emergencyId: emergency.id,
        buildingId: emergency.buildingId,
      });
      req.io.to(`emergency-${emergency.id}`).emit('fire-resolved', {
        emergencyId: emergency.id,
        buildingId: emergency.buildingId,
      });
      req.io.emit('fire-resolved-global', { emergencyId: emergency.id, buildingId: emergency.buildingId });
    }

    res.json(emergency);
  } catch (error) {
    console.error('Error resolving emergency:', error);
    res.status(500).json({ error: 'Failed to resolve emergency' });
  }
});

router.get('/:id/feeds', authMiddleware, async (req, res) => {
  try {
    // Strict privacy: only MANAGER / RESPONDER, only while FIRE is ACTIVE.
    if (!['MANAGER', 'RESPONDER'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Camera feeds during fire emergencies are restricted to managers and responders' });
    }
    const emergency = await prisma.emergencyEvent.findUnique({
      where: { id: req.params.id },
      include: { building: { include: { cameras: { include: { floor: true } }, floors: true } } },
    });
    if (!emergency) return res.status(404).json({ error: 'Emergency not found' });
    if (emergency.status !== 'ACTIVE' || emergency.type === 'DRILL') {
      return res.status(410).json({ error: 'Feeds available only during an ACTIVE fire emergency' });
    }
    console.log(`[feed-access] user=${req.user.userId} role=${req.user.role} emergency=${emergency.id} at=${new Date().toISOString()}`);
    const base = (process.env.CV_BASE_URL || 'http://localhost:5000').replace(/\/$/, '');
    // CCTV fleet only: EXIT-only cameras stay in the drill console, never here.
    const cctv = (emergency.building.cameras || []).filter((c) => (c.role || (c.isExit ? 'EXIT' : 'CCTV')) !== 'EXIT');
    const feeds = cctv.map((c) => ({
      id: c.id,
      name: c.name,
      type: c.type,
      role: c.role || 'CCTV',
      floorId: c.floorId,
      floorName: c.floor?.name || null,
      isExit: c.isExit,
      feedUrl: `${base}/cameras/${c.id}/feed`,
      statsUrl: `${base}/cameras/${c.id}/stats`,
    }));
    res.json({ emergencyId: emergency.id, buildingId: emergency.buildingId, status: emergency.status, feeds });
  } catch (error) {
    console.error('Error fetching emergency feeds:', error);
    res.status(500).json({ error: 'Failed to fetch feeds' });
  }
});

// Hardware placeholders (added later) — return disabled flag so UI can show "coming soon".
router.post('/:id/auto-detect/config', authMiddleware, async (req, res) => {
  return res.json({ enabled: false, message: 'Automatic fire detection hardware module — coming soon. Manual trigger remains authoritative.' });
});

router.post('/:id/robot/dispatch', authMiddleware, async (req, res) => {
  if (!['MANAGER', 'RESPONDER'].includes(req.user.role)) return res.status(403).json({ error: 'Access denied' });
  return res.json({ enabled: false, message: 'Fire responder robot module — coming soon. Dispatch will be available after hardware integration.' });
});

router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const emergency = await prisma.emergencyEvent.findUnique({
      where: { id: req.params.id },
      include: {
        building: {
          include: {
            floors: true,
            cameras: true,
          },
        },
        occupancies: {
          orderBy: { timestamp: 'desc' },
          take: 50,
        },
        sosRequests: {
          where: { status: 'PENDING' },
          include: {
            user: {
              select: { id: true, name: true, phone: true },
            },
          },
        },
      },
    });

    if (!emergency) {
      return res.status(404).json({ error: 'Emergency not found' });
    }

    res.json(emergency);
  } catch (error) {
    console.error('Error fetching emergency:', error);
    res.status(500).json({ error: 'Failed to fetch emergency' });
  }
});

router.post('/:id/occupancy', authMiddleware, async (req, res) => {
  try {
    const { roomId, cameraId, personCount } = req.body;
    const count = Number(personCount);
    if (!Number.isFinite(count) || count < 0) return res.status(400).json({ error: 'Valid personCount is required' });

    const occupancy = await prisma.occupancyTracking.create({
      data: {
        emergencyId: req.params.id,
        roomId,
        cameraId,
        personCount: count,
      },
    });

    if (req.io) req.io.to(`emergency-${req.params.id}`).emit('occupancy-update', {
      roomId,
      cameraId,
      personCount,
      timestamp: occupancy.timestamp,
    });

    res.json(occupancy);
  } catch (error) {
    console.error('Error updating occupancy:', error);
    res.status(500).json({ error: 'Failed to update occupancy' });
  }
});

module.exports = router;
