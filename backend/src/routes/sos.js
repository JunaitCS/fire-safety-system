const express = require('express');
const { PrismaClient } = require('@prisma/client');
const authMiddleware = require('../middleware/auth');

const router = express.Router();
const prisma = new PrismaClient();

router.get('/building/:buildingId', authMiddleware, async (req, res) => {
  try {
    const requests = await prisma.sOSRequest.findMany({
      where: { buildingId: req.params.buildingId },
      include: {
        user: {
          select: { id: true, name: true, phone: true },
        },
      },
      orderBy: { timestamp: 'desc' },
    });

    res.json(requests);
  } catch (error) {
    console.error('Error fetching SOS requests:', error);
    res.status(500).json({ error: 'Failed to fetch SOS requests' });
  }
});

router.post('/', authMiddleware, async (req, res) => {
  try {
    const { buildingId, location, message, emergencyId, guestName } = req.body;
    if (!buildingId) return res.status(400).json({ error: 'buildingId is required' });

    // Drill consoles surface drill ids as the active alert; those are NOT
    // EmergencyEvents, so only link when the id really is one — otherwise the
    // FK constraint would reject a legitimate SOS sent during a drill.
    let validEmergencyId = null;
    if (emergencyId) {
      const em = await prisma.emergencyEvent.findUnique({ where: { id: emergencyId } });
      if (em) validEmergencyId = emergencyId;
    }

    const sos = await prisma.sOSRequest.create({
      data: {
        buildingId,
        userId: req.user.userId,
        location,
        message,
        emergencyId: validEmergencyId,
        status: 'PENDING',
      },
      include: {
        user: {
          select: { id: true, name: true, phone: true },
        },
      },
    });

    if (req.io) req.io.to(`building-${buildingId}`).emit('sos-received', sos);

    if (validEmergencyId && req.io) {
      req.io.to(`emergency-${validEmergencyId}`).emit('new-sos', sos);
    }

    res.json(sos);
  } catch (error) {
    console.error('Error creating SOS:', error);
    res.status(500).json({ error: 'Failed to create SOS request' });
  }
});

router.post('/:id/acknowledge', authMiddleware, async (req, res) => {
  try {
    const sos = await prisma.sOSRequest.update({
      where: { id: req.params.id },
      data: { status: 'ACKNOWLEDGED' },
      include: {
        user: {
          select: { id: true, name: true, phone: true },
        },
      },
    });

    if (req.io) req.io.to(`building-${sos.buildingId}`).emit('sos-updated', sos);

    res.json(sos);
  } catch (error) {
    console.error('Error acknowledging SOS:', error);
    res.status(500).json({ error: 'Failed to acknowledge SOS' });
  }
});

router.post('/:id/resolve', authMiddleware, async (req, res) => {
  try {
    const sos = await prisma.sOSRequest.update({
      where: { id: req.params.id },
      data: {
        status: 'RESOLVED',
        resolvedAt: new Date(),
      },
      include: {
        user: {
          select: { id: true, name: true, phone: true },
        },
      },
    });

    if (req.io) req.io.to(`building-${sos.buildingId}`).emit('sos-updated', sos);

    res.json(sos);
  } catch (error) {
    console.error('Error resolving SOS:', error);
    res.status(500).json({ error: 'Failed to resolve SOS' });
  }
});

module.exports = router;
