const express = require('express');
const QRCode = require('qrcode');
const { PrismaClient } = require('@prisma/client');
const authMiddleware = require('../middleware/auth');

const router = express.Router();
const prisma = new PrismaClient();

router.get('/', authMiddleware, async (req, res) => {
  try {
    let buildings;
    
    if (req.user.role === 'MANAGER') {
      buildings = await prisma.building.findMany({
        where: { ownerId: req.user.userId },
        include: {
          _count: {
            select: { floors: true, cameras: true },
          },
        },
      });
    } else if (req.user.role === 'RESPONDER') {
      buildings = await prisma.building.findMany({
        where: { isPublic: true },
        include: {
          _count: {
            select: { floors: true, cameras: true },
          },
        },
      });
    } else {
      // OCCUPANT: only buildings with an ACTIVE check-in — never the full public list.
      // This preserves privacy and fixes "sees buildings even when not checked in".
      const presences = await prisma.occupantPresence.findMany({
        where: { userId: req.user.userId, isActive: true },
        select: { buildingId: true },
      });
      const ids = [...new Set(presences.map((p) => p.buildingId))];
      if (!ids.length) return res.json([]);
      buildings = await prisma.building.findMany({
        where: { id: { in: ids } },
        select: {
          id: true,
          name: true,
          address: true,
          qrCode: true,
          isPublic: true,
        },
      });
    }

    res.json(buildings);
  } catch (error) {
    console.error('Error fetching buildings:', error);
    res.status(500).json({ error: 'Failed to fetch buildings' });
  }
});

router.get('/qr/:qrCode', async (req, res) => {
  try {
    const building = await prisma.building.findUnique({
      where: { qrCode: req.params.qrCode },
      include: {
        floors: {
          include: {
            elements: true,
          },
        },
        cameras: {
          where: { isActive: true },
          select: {
            id: true,
            name: true,
            type: true,
            x: true,
            y: true,
            isExit: true,
          },
        },
      },
    });

    if (!building) {
      return res.status(404).json({ error: 'Building not found' });
    }

    if (!building.isPublic) {
      return res.status(403).json({ error: 'Building information is private' });
    }

    res.json(building);
  } catch (error) {
    console.error('Error fetching building by QR:', error);
    res.status(500).json({ error: 'Failed to fetch building' });
  }
});

router.post('/', authMiddleware, async (req, res) => {
  if (req.user.role !== 'MANAGER') {
    return res.status(403).json({ error: 'Only managers can create buildings' });
  }

  try {
    const { name, address, description, latitude, longitude, isPublic = true } = req.body;
    if (!name || !address) {
      return res.status(400).json({ error: 'Name and address are required' });
    }
    const qrCode = 'BUILDING_' + Date.now();

    const building = await prisma.building.create({
      data: {
        name: String(name).trim(),
        address: String(address).trim(),
        description: description || null,
        latitude: latitude ?? null,
        longitude: longitude ?? null,
        isPublic: Boolean(isPublic),
        ownerId: req.user.userId,
        qrCode,
      },
    });

    const origin = req.headers.origin || 'http://localhost:5173';
    const qrDataUrl = await QRCode.toDataURL(`${origin}/building/${building.qrCode}`);
    
    res.json({ ...building, qrImage: qrDataUrl });
  } catch (error) {
    console.error('Error creating building:', error);
    res.status(500).json({ error: 'Failed to create building' });
  }
});

router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const building = await prisma.building.findUnique({
      where: { id: req.params.id },
      include: {
        floors: {
          orderBy: { floorNumber: 'asc' },
        },
        cameras: {
          include: {
            floor: true,
          },
        },
        _count: {
          select: { floors: true, cameras: true },
        },
      },
    });

    if (!building) {
      return res.status(404).json({ error: 'Building not found' });
    }

    if (req.user.role === 'MANAGER' && building.ownerId !== req.user.userId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    res.json(building);
  } catch (error) {
    console.error('Error fetching building:', error);
    res.status(500).json({ error: 'Failed to fetch building' });
  }
});

router.put('/:id', authMiddleware, async (req, res) => {
  try {
    const building = await prisma.building.findUnique({
      where: { id: req.params.id },
    });

    if (!building) {
      return res.status(404).json({ error: 'Building not found' });
    }

    if (req.user.role !== 'MANAGER' || building.ownerId !== req.user.userId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const { name, address, description, latitude, longitude, isPublic } = req.body;
    const data = {};
    if (name !== undefined) data.name = String(name).trim();
    if (address !== undefined) data.address = String(address).trim();
    if (description !== undefined) data.description = description || null;
    if (latitude !== undefined) data.latitude = latitude;
    if (longitude !== undefined) data.longitude = longitude;
    if (isPublic !== undefined) data.isPublic = Boolean(isPublic);

    const updated = await prisma.building.update({
      where: { id: req.params.id },
      data,
    });

    res.json(updated);
  } catch (error) {
    console.error('Error updating building:', error);
    res.status(500).json({ error: 'Failed to update building' });
  }
});

router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const building = await prisma.building.findUnique({
      where: { id: req.params.id },
    });

    if (!building) {
      return res.status(404).json({ error: 'Building not found' });
    }

    if (req.user.role !== 'MANAGER' || building.ownerId !== req.user.userId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    await prisma.building.delete({
      where: { id: req.params.id },
    });

    res.json({ message: 'Building deleted' });
  } catch (error) {
    console.error('Error deleting building:', error);
    res.status(500).json({ error: 'Failed to delete building' });
  }
});

router.get('/:id/qr', authMiddleware, async (req, res) => {
  try {
    const building = await prisma.building.findUnique({
      where: { id: req.params.id },
    });

    if (!building) {
      return res.status(404).json({ error: 'Building not found' });
    }

    const origin = (req.headers.origin || process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');
    const qrDataUrl = await QRCode.toDataURL(`${origin}/building/${building.qrCode}`);
    res.json({ qrImage: qrDataUrl, qrCode: building.qrCode, url: `${origin}/building/${building.qrCode}` });
  } catch (error) {
    console.error('Error generating QR:', error);
    res.status(500).json({ error: 'Failed to generate QR code' });
  }
});

module.exports = router;
