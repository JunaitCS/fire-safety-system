const express = require('express');
const { PrismaClient } = require('@prisma/client');
const authMiddleware = require('../middleware/auth');

const router = express.Router();
const prisma = new PrismaClient();

router.get('/building/:buildingId', authMiddleware, async (req, res) => {
  try {
    const drills = await prisma.fireDrill.findMany({
      where: { buildingId: req.params.buildingId },
      include: {
        exitStats: {
          include: {
            camera: true,
          },
        },
        _count: {
          select: { exitStats: true },
        },
      },
      orderBy: { startTime: 'desc' },
    });

    res.json(drills);
  } catch (error) {
    console.error('Error fetching drills:', error);
    res.status(500).json({ error: 'Failed to fetch drills' });
  }
});

router.post('/start', authMiddleware, async (req, res) => {
  try {
    const { buildingId } = req.body;
    if (!buildingId) return res.status(400).json({ error: 'buildingId is required' });
    const building = await prisma.building.findUnique({ where: { id: buildingId } });
    if (!building) return res.status(404).json({ error: 'Building not found' });
    const active = await prisma.fireDrill.findFirst({ where: { buildingId, status: 'active' } });
    if (active) return res.status(409).json({ error: 'A drill is already active for this building', drill: active });

    const drill = await prisma.fireDrill.create({
      data: {
        buildingId,
        status: 'active',
      },
      include: {
        building: true,
      },
    });

    const exitCameras = await prisma.camera.findMany({
      where: {
        buildingId,
        isExit: true,
      },
    });

    if (exitCameras.length > 0) {
      await prisma.drillExitStats.createMany({
        data: exitCameras.map(camera => ({
          drillId: drill.id,
          cameraId: camera.id,
          exitCount: 0,
        })),
      });
    }

    // Room-scoped for managers in the drill console + standard drill-alert
    // shapes so EVERY occupant surface (EmergencyAlert banner/siren,
    // evacuation map, SOS view) reacts exactly like a fire drill trigger.
    // buildingId is required on all of these so clients can scope by building.
    const drillPayload = {
      id: drill.id,
      drillId: drill.id,
      emergencyId: drill.id,
      buildingId,
      severity: 'medium',
      type: 'DRILL',
      title: 'Fire drill',
      startTime: drill.startTime,
      message: 'FIRE DRILL: This is a practice evacuation. Please proceed to nearest exit.',
    };
    if (req.io) {
      req.io.to(`building-${buildingId}`).emit('drill-started', drillPayload);
      req.io.to(`building-${buildingId}`).emit('drill-alert', drillPayload);
      req.io.emit('drill-alert-global', drillPayload);
    }

    res.json(drill);
  } catch (error) {
    console.error('Error starting drill:', error);
    res.status(500).json({ error: 'Failed to start drill' });
  }
});

router.post('/:id/end', authMiddleware, async (req, res) => {
  try {
    const existing = await prisma.fireDrill.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Drill not found' });
    if (existing.status !== 'active') return res.status(409).json({ error: 'Drill is not active' });
    const { behaviorSummary } = req.body || {};
    const drill = await prisma.fireDrill.update({
      where: { id: req.params.id },
      data: {
        status: 'completed',
        endTime: new Date(),
        ...(behaviorSummary !== undefined
          ? { behaviorSummary: typeof behaviorSummary === 'string' ? behaviorSummary : JSON.stringify(behaviorSummary) }
          : {}),
      },
      include: {
        exitStats: {
          include: {
            camera: true,
          },
        },
        building: true,
      },
    });

    const totalExited = drill.exitStats.reduce((sum, stat) => sum + stat.exitCount, 0);

    if (req.io) {
      req.io.to(`building-${drill.buildingId}`).emit('drill-ended', {
        drillId: drill.id,
        buildingId: drill.buildingId,
        totalExited,
        message: 'Fire drill completed. Thank you for participating.',
      });
      req.io.emit('drill-ended-global', {
        drillId: drill.id,
        buildingId: drill.buildingId,
        totalExited,
      });
    }

    res.json({ ...drill, totalExited });
  } catch (error) {
    console.error('Error ending drill:', error);
    res.status(500).json({ error: 'Failed to end drill' });
  }
});

router.post('/:id/exit/:cameraId', async (req, res) => {
  try {
    const count = Number(req.body.count);
    if (!Number.isFinite(count) || count < 0) return res.status(400).json({ error: 'Valid count >= 0 is required' });
    const drill = await prisma.fireDrill.findUnique({ where: { id: req.params.id } });
    if (!drill) return res.status(404).json({ error: 'Drill not found' });
    const camera = await prisma.camera.findUnique({ where: { id: req.params.cameraId } });
    if (!camera) return res.status(404).json({ error: 'Camera not found' });

    const stats = await prisma.drillExitStats.upsert({
      where: {
        drillId_cameraId: {
          drillId: req.params.id,
          cameraId: req.params.cameraId,
        },
      },
      update: {
        exitCount: {
          increment: count,
        },
      },
      create: {
        drillId: req.params.id,
        cameraId: req.params.cameraId,
        exitCount: count,
      },
    });

    if (drill && req.io) {
      req.io.to(`building-${drill.buildingId}`).emit('exit-count', {
        drillId: req.params.id,
        cameraId: req.params.cameraId,
        count: stats.exitCount,
      });
    }

    res.json(stats);
  } catch (error) {
    console.error('Error updating exit count:', error);
    res.status(500).json({ error: 'Failed to update exit count' });
  }
});

router.get('/:id/export', authMiddleware, async (req, res) => {
  try {
    const drill = await prisma.fireDrill.findUnique({
      where: { id: req.params.id },
      include: {
        exitStats: {
          include: {
            camera: true,
          },
        },
        building: true,
      },
    });

    if (!drill) {
      return res.status(404).json({ error: 'Drill not found' });
    }

    const headers = ['Exit Name', 'Exit Count', 'Percentage'];
    const totalExited = drill.exitStats.reduce((sum, stat) => sum + stat.exitCount, 0);
    
    const rows = drill.exitStats.map(stat => [
      stat.camera.name,
      stat.exitCount,
      totalExited > 0 ? ((stat.exitCount / totalExited) * 100).toFixed(2) + '%' : '0%',
    ]);

    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');

    // Behavior summary section (people behavior during evacuation)
    let behaviorCsv = '';
    try {
      if (drill.behaviorSummary) {
        const b = JSON.parse(drill.behaviorSummary);
        behaviorCsv = `\n\nBehavior Summary\nMetric,Count\nFalls,${b.falls ?? 0}\nCrowd events,${b.crowdEvents ?? 0}\nLoitering,${b.loitering ?? 0}\nRunning/panic,${b.running ?? 0}\nStuck alerts,${b.stuck ?? 0}\nMax occupancy,${b.maxOccupancy ?? 0}\n`;
      } else {
        // Fallback: aggregate recent detection behaviors for exit cameras
        const camIds = drill.exitStats.map((s) => s.cameraId);
        if (camIds.length) {
          const dets = await prisma.detectionEvent.findMany({
            where: { cameraId: { in: camIds }, timestamp: { gte: drill.startTime } },
            take: 500,
            orderBy: { timestamp: 'desc' },
          });
          let falls = 0, crowd = 0, loiter = 0, run = 0, stuck = 0, maxOcc = 0;
          for (const d of dets) {
            maxOcc = Math.max(maxOcc, d.count);
            try {
              const beh = d.behaviors ? JSON.parse(d.behaviors) : null;
              if (!beh) continue;
              falls += (beh.fallIds || []).length ? 1 : 0;
              run += (beh.runningIds || []).length ? 1 : 0;
              loiter += (beh.loiteringIds || []).length ? 1 : 0;
              crowd += beh.crowd ? 1 : 0;
              stuck += beh.stuck ? 1 : 0;
            } catch {}
          }
          behaviorCsv = `\n\nBehavior Summary (auto-aggregated from detections)\nMetric,Count\nFalls,${falls}\nCrowd events,${crowd}\nLoitering,${loiter}\nRunning/panic,${run}\nStuck alerts,${stuck}\nMax occupancy,${maxOcc}\n`;
        }
      }
    } catch {}

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="drill-${req.params.id}.csv"`);
    res.send(csv + behaviorCsv);
  } catch (error) {
    console.error('Error exporting drill:', error);
    res.status(500).json({ error: 'Failed to export drill data' });
  }
});

router.get('/:id/report', authMiddleware, async (req, res) => {
  try {
    const drill = await prisma.fireDrill.findUnique({
      where: { id: req.params.id },
      include: { exitStats: { include: { camera: true } }, building: true },
    });
    if (!drill) return res.status(404).json({ error: 'Drill not found' });
    const totalExited = drill.exitStats.reduce((s, x) => s + x.exitCount, 0);
    let behavior = null;
    try { behavior = drill.behaviorSummary ? JSON.parse(drill.behaviorSummary) : null; } catch {}
    const camIds = drill.exitStats.map((s) => s.cameraId);
    let recentDetections = [];
    if (camIds.length) {
      recentDetections = await prisma.detectionEvent.findMany({
        where: { cameraId: { in: camIds }, timestamp: { gte: drill.startTime } },
        orderBy: { timestamp: 'desc' },
        take: 50,
      });
    }
    res.json({ drill, totalExited, behavior, recentDetections });
  } catch (error) {
    res.status(500).json({ error: 'Failed to build drill report' });
  }
});

module.exports = router;
