const express = require('express');
const { PrismaClient } = require('@prisma/client');
const authMiddleware = require('../middleware/auth');

const router = express.Router();
const prisma = new PrismaClient();

router.get('/building/:buildingId', authMiddleware, async (req, res) => {
  try {
    const complaints = await prisma.complaint.findMany({
      where: { buildingId: req.params.buildingId },
      include: {
        user: {
          select: { id: true, name: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json(complaints);
  } catch (error) {
    console.error('Error fetching complaints:', error);
    res.status(500).json({ error: 'Failed to fetch complaints' });
  }
});

router.post('/', authMiddleware, async (req, res) => {
  try {
    const { buildingId, type, message } = req.body;

    const complaint = await prisma.complaint.create({
      data: {
        buildingId,
        userId: req.user.userId,
        type,
        message,
        status: 'open',
      },
      include: {
        user: {
          select: { id: true, name: true },
        },
      },
    });

    res.json(complaint);
  } catch (error) {
    console.error('Error creating complaint:', error);
    res.status(500).json({ error: 'Failed to create complaint' });
  }
});

router.put('/:id', authMiddleware, async (req, res) => {
  try {
    const { status } = req.body;
    const allowed = ['open', 'in_progress', 'resolved'];
    if (!allowed.includes(status)) return res.status(400).json({ error: `Status must be one of: ${allowed.join(', ')}` });
    if (!['MANAGER', 'RESPONDER'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Only managers or responders can update complaints' });
    }

    const complaint = await prisma.complaint.update({
      where: { id: req.params.id },
      data: {
        status,
        resolvedAt: status === 'resolved' ? new Date() : null,
      },
      include: {
        user: {
          select: { id: true, name: true },
        },
      },
    });

    res.json(complaint);
  } catch (error) {
    console.error('Error updating complaint:', error);
    res.status(500).json({ error: 'Failed to update complaint' });
  }
});

module.exports = router;
