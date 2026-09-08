const express = require('express');
const QRCode = require('qrcode');
const { PrismaClient } = require('@prisma/client');
const authMiddleware = require('../middleware/auth');

const router = express.Router();
const prisma = new PrismaClient();

const parseCoord = (v) => {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined; // undefined signals invalid
};

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
    const lat = parseCoord(latitude);
    const lng = parseCoord(longitude);
    if (lat === undefined || lng === undefined) {
      return res.status(400).json({ error: 'Latitude/longitude must be valid numbers' });
    }
    if (lat !== null && (lat < -90 || lat > 90)) {
      return res.status(400).json({ error: 'Latitude must be between -90 and 90' });
    }
    if (lng !== null && (lng < -180 || lng > 180)) {
      return res.status(400).json({ error: 'Longitude must be between -180 and 180' });
    }
    const qrCode = 'BUILDING_' + Date.now();

    const building = await prisma.building.create({
      data: {
        name: String(name).trim(),
        address: String(address).trim(),
        description: description || null,
        latitude: lat,
        longitude: lng,
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

// Responder overview: public buildings (limited fields, always visible) +
// active FIRE emergencies with full building details (address + map coords).
// Private buildings without an active fire are returned as locked placeholders.
router.get('/responder/overview', authMiddleware, async (req, res) => {
  try {
    if (!['RESPONDER', 'MANAGER'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Access denied' });
    }
    const wherePublic = req.user.role === 'MANAGER'
      ? { ownerId: req.user.userId }
      : { isPublic: true };
    const publicBuildings = await prisma.building.findMany({
      where: wherePublic,
      select: {
        id: true, name: true, address: true, isPublic: true,
        latitude: true, longitude: true, qrCode: true,
        _count: { select: { floors: true, cameras: true } },
      },
      orderBy: { name: 'asc' },
    });
    const activeEmergencies = await prisma.emergencyEvent.findMany({
      where: { status: 'ACTIVE', type: 'FIRE' },
      include: {
        building: {
          select: {
            id: true, name: true, address: true, description: true,
            latitude: true, longitude: true, isPublic: true, qrCode: true,
            _count: { select: { floors: true, cameras: true } },
          },
        },
        triggerer: { select: { id: true, name: true } },
        _count: { select: { occupancies: true, sosRequests: true } },
      },
      orderBy: { startTime: 'desc' },
    });
    const fireIds = new Set(activeEmergencies.map((e) => e.buildingId));
    // Locked private buildings (manager scope only lists own, so mostly empty;
    // responders get an explicit empty list unless fires expose them).
    let locked = [];
    if (req.user.role === 'RESPONDER') {
      const fireBuildings = activeEmergencies.map((e) => e.building).filter(Boolean);
      // Merge fire buildings that are private so the UI can show them separately.
      res.json({ publicBuildings, activeEmergencies, fireBuildings, locked });
      return;
    }
    res.json({ publicBuildings, activeEmergencies, fireBuildings: [], locked });
  } catch (error) {
    console.error('Error building responder overview:', error);
    res.status(500).json({ error: 'Failed to build responder overview' });
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

    // Responders: private building details unlock ONLY during an ACTIVE FIRE
    // emergency for that building. Public buildings always return limited info.
    // Drills never unlock private details.
    if (req.user.role === 'RESPONDER' && !building.isPublic) {
      const activeFire = await prisma.emergencyEvent.findFirst({
        where: { buildingId: building.id, status: 'ACTIVE', type: 'FIRE' },
        select: { id: true },
      });
      if (!activeFire) {
        return res.status(403).json({ error: 'Building details are private. They unlock during an active fire emergency.' });
      }
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
    if (latitude !== undefined) {
      const lat = parseCoord(latitude);
      if (lat === undefined) return res.status(400).json({ error: 'Latitude must be a valid number' });
      if (lat !== null && (lat < -90 || lat > 90)) return res.status(400).json({ error: 'Latitude must be between -90 and 90' });
      data.latitude = lat;
    }
    if (longitude !== undefined) {
      const lng = parseCoord(longitude);
      if (lng === undefined) return res.status(400).json({ error: 'Longitude must be a valid number' });
      if (lng !== null && (lng < -180 || lng > 180)) return res.status(400).json({ error: 'Longitude must be between -180 and 180' });
      data.longitude = lng;
    }
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
