const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { PrismaClient } = require('@prisma/client');
const authMiddleware = require('../middleware/auth');

const router = express.Router();
const prisma = new PrismaClient();

const uploadDir = path.join(__dirname, '../../uploads/floors');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + '-' + file.originalname);
  },
});

const upload = multer({ storage });

router.get('/building/:buildingId', authMiddleware, async (req, res) => {
  try {
    const floors = await prisma.floor.findMany({
      where: { buildingId: req.params.buildingId },
      include: {
        elements: true,
        cameras: true,
      },
      orderBy: { floorNumber: 'asc' },
    });

    res.json(floors);
  } catch (error) {
    console.error('Error fetching floors:', error);
    res.status(500).json({ error: 'Failed to fetch floors' });
  }
});

router.post('/', authMiddleware, async (req, res) => {
  try {
    const { buildingId, floorNumber, name, imageUrl } = req.body;
    if (!buildingId) return res.status(400).json({ error: 'buildingId is required' });
    const floor = await prisma.floor.create({
      data: {
        buildingId,
        floorNumber: floorNumber ?? 0,
        name: name || `Floor ${floorNumber ?? 0}`,
        imageUrl: imageUrl || null,
      },
      include: {
        elements: true,
      },
    });

    res.json(floor);
  } catch (error) {
    console.error('Error creating floor:', error);
    res.status(500).json({ error: 'Failed to create floor' });
  }
});

router.put('/:id', authMiddleware, async (req, res) => {
  try {
    const { elements, floorNumber, name, imageUrl } = req.body;
    const floorData = {};
    if (floorNumber !== undefined) floorData.floorNumber = Number(floorNumber);
    if (name !== undefined) floorData.name = name;
    if (imageUrl !== undefined) floorData.imageUrl = imageUrl;

    const floor = await prisma.floor.update({
      where: { id: req.params.id },
      data: floorData,
    });

    if (elements && Array.isArray(elements)) {
      await prisma.floorElement.deleteMany({
        where: { floorId: req.params.id },
      });

      const validElements = elements
        .filter((el) => el && typeof el.x === 'number' && typeof el.y === 'number')
        .map((el) => {
          const { id, label, color, points, ...rest } = el;
          const num = (v, fallback) => {
            const n = Number(v);
            return Number.isFinite(n) ? n : fallback;
          };
          // Frontend sends label/points packed into a `properties` JSON string;
          // older payloads may carry top-level `label`/`color`/`points` instead.
          let properties = rest.properties;
          if (properties !== undefined && properties !== null && typeof properties !== 'string') {
            try {
              properties = JSON.stringify(properties);
            } catch {
              properties = null;
            }
          }
          if ((properties === undefined || properties === null) && (label !== undefined || color !== undefined || points !== undefined)) {
            try {
              properties = JSON.stringify({ label: label || '', points: points || null, color: color || null });
            } catch {
              properties = null;
            }
          }
          return {
            type: rest.type || 'WALL',
            x: num(rest.x, 0),
            y: num(rest.y, 0),
            width: num(rest.width, 50),
            height: num(rest.height, 50),
            rotation: num(rest.rotation, 0),
            properties: properties ?? null,
            floorId: req.params.id,
          };
        });

      if (validElements.length > 0) {
        await prisma.floorElement.createMany({
          data: validElements,
        });
      }
    }

    const updatedFloor = await prisma.floor.findUnique({
      where: { id: req.params.id },
      include: { elements: true },
    });

    res.json(updatedFloor);
  } catch (error) {
    console.error('Error updating floor:', error);
    const detail = error.code || (error.message ? String(error.message).split('\n').filter(Boolean)[0]?.slice(0, 300) : undefined);
    res.status(500).json({ error: 'Failed to update floor', detail });
  }
});

router.post('/:id/image', authMiddleware, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image uploaded' });
    }
    const imageUrl = `/uploads/floors/${req.file.filename}`;
    
    const floor = await prisma.floor.update({
      where: { id: req.params.id },
      data: { imageUrl },
    });

    res.json({ ...floor, imageUrl });
  } catch (error) {
    console.error('Error uploading image:', error);
    res.status(500).json({ error: 'Failed to upload image' });
  }
});

router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    await prisma.floor.delete({
      where: { id: req.params.id },
    });

    res.json({ message: 'Floor deleted' });
  } catch (error) {
    console.error('Error deleting floor:', error);
    res.status(500).json({ error: 'Failed to delete floor' });
  }
});

module.exports = router;
