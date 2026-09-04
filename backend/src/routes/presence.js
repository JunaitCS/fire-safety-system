const express = require('express');
const { PrismaClient } = require('@prisma/client');
const authMiddleware = require('../middleware/auth');

const router = express.Router();
const prisma = new PrismaClient();

// Public check-in via QR (optional auth)
router.post('/check-in', async (req, res) => {
  try {
    const { buildingId, qrCode, guestName, guestPhone, floorHint } = req.body;
    let building = null;
    if (buildingId) {
      building = await prisma.building.findUnique({ where: { id: buildingId } });
    } else if (qrCode) {
      building = await prisma.building.findUnique({ where: { qrCode } });
    }
    if (!building) return res.status(404).json({ error: 'Building not found' });
    if (!building.isPublic) return res.status(403).json({ error: 'Building is private' });

    let userId = null;
    const authHeader = req.headers.authorization;
    if (authHeader) {
      try {
        const jwt = require('jsonwebtoken');
        const decoded = jwt.verify(authHeader.replace('Bearer ', ''), process.env.JWT_SECRET);
        userId = decoded.userId;
      } catch (_) {}
    }

    // deactivate previous active presence for same user/guest in this building
    if (userId) {
      await prisma.occupantPresence.updateMany({
        where: { buildingId: building.id, userId, isActive: true },
        data: { isActive: false, checkedOutAt: new Date() },
      });
    } else if (guestName || guestPhone) {
      const or = [];
      if (guestName) or.push({ guestName: String(guestName).trim() });
      if (guestPhone) or.push({ guestPhone: String(guestPhone).trim() });
      if (or.length) {
        await prisma.occupantPresence.updateMany({
          where: { buildingId: building.id, userId: null, isActive: true, OR: or },
          data: { isActive: false, checkedOutAt: new Date() },
        });
      }
    }

    const presence = await prisma.occupantPresence.create({
      data: {
        buildingId: building.id,
        userId,
        guestName: guestName || null,
        guestPhone: guestPhone || null,
        floorHint: floorHint || null,
        isActive: true,
      },
      include: {
        building: {
          select: { id: true, name: true, address: true, qrCode: true },
        },
      },
    });

    if (req.io) {
      req.io.to(`building-${building.id}`).emit('occupant-checked-in', {
        presenceId: presence.id,
        guestName: presence.guestName,
        floorHint: presence.floorHint,
      });
    }

    res.json(presence);
  } catch (error) {
    console.error('Check-in error:', error);
    res.status(500).json({ error: 'Check-in failed' });
  }
});

router.post('/check-out', async (req, res) => {
  try {
    const { presenceId } = req.body;
    if (!presenceId) return res.status(400).json({ error: 'presenceId is required' });
    const existing = await prisma.occupantPresence.findUnique({ where: { id: presenceId } });
    if (!existing) return res.status(404).json({ error: 'Presence record not found' });
    if (!existing.isActive) return res.status(409).json({ error: 'Already checked out' });
    const presence = await prisma.occupantPresence.update({
      where: { id: presenceId },
      data: { isActive: false, checkedOutAt: new Date() },
    });
    if (req.io) {
      req.io.to(`building-${presence.buildingId}`).emit('occupant-checked-out', { presenceId });
    }
    res.json(presence);
  } catch (error) {
    res.status(500).json({ error: 'Check-out failed' });
  }
});

router.get('/mine', authMiddleware, async (req, res) => {
  try {
    const list = await prisma.occupantPresence.findMany({
      where: { userId: req.user.userId, isActive: true },
      include: { building: { select: { id: true, name: true, address: true, qrCode: true, isPublic: true } } },
      orderBy: { checkedInAt: 'desc' },
    });
    res.json(list);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch my presence' });
  }
});

router.get('/status', authMiddleware, async (req, res) => {
  try {
    const { presenceId, buildingId } = req.query;
    if (presenceId) {
      const p = await prisma.occupantPresence.findUnique({
        where: { id: String(presenceId) },
        include: { building: { select: { id: true, name: true, qrCode: true } } },
      });
      if (!p || !p.isActive) return res.json({ active: false });
      if (buildingId && p.buildingId !== String(buildingId)) return res.json({ active: false });
      return res.json({ active: true, presence: p });
    }
    if (buildingId) {
      const p = await prisma.occupantPresence.findFirst({
        where: { userId: req.user.userId, buildingId: String(buildingId), isActive: true },
        include: { building: { select: { id: true, name: true, qrCode: true } } },
      });
      return res.json({ active: !!p, presence: p || null });
    }
    return res.status(400).json({ error: 'presenceId or buildingId required' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to check status' });
  }
});

router.get('/building/:buildingId', authMiddleware, async (req, res) => {
  try {
    const list = await prisma.occupantPresence.findMany({
      where: { buildingId: req.params.buildingId, isActive: true },
      include: {
        user: { select: { id: true, name: true, phone: true, email: true } },
      },
      orderBy: { checkedInAt: 'desc' },
    });
    res.json(list);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch presence' });
  }
});

router.get('/building/:buildingId/count', async (req, res) => {
  try {
    const count = await prisma.occupantPresence.count({
      where: { buildingId: req.params.buildingId, isActive: true },
    });
    res.json({ count });
  } catch (error) {
    res.status(500).json({ error: 'Failed' });
  }
});

module.exports = router;
