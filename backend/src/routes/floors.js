const express = require('express');
const multer = require('multer');
const { createClient } = require('@supabase/supabase-js');
const { PrismaClient } = require('@prisma/client');
const authMiddleware = require('../middleware/auth');

const router = express.Router();
const prisma = new PrismaClient();

// ==========================================
// Supabase Storage
// ==========================================

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const FLOOR_BUCKET = 'floor-plans';

// ==========================================
// Multer
// ==========================================
// Store uploaded files temporarily in memory.
// They will then be uploaded to Supabase Storage.

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10 MB
  },
});

// ==========================================
// Get floors for a building
// ==========================================

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
    res.status(500).json({
      error: 'Failed to fetch floors',
    });
  }
});

// ==========================================
// Create floor
// ==========================================

router.post('/', authMiddleware, async (req, res) => {
  try {
    const {
      buildingId,
      floorNumber,
      name,
      imageUrl,
    } = req.body;

    if (!buildingId) {
      return res.status(400).json({
        error: 'buildingId is required',
      });
    }

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

    res.status(500).json({
      error: 'Failed to create floor',
    });
  }
});

// ==========================================
// Update floor
// ==========================================

router.put('/:id', authMiddleware, async (req, res) => {
  try {
    const {
      elements,
      floorNumber,
      name,
      imageUrl,
    } = req.body;

    const floorData = {};

    if (floorNumber !== undefined) {
      floorData.floorNumber = Number(floorNumber);
    }

    if (name !== undefined) {
      floorData.name = name;
    }

    if (imageUrl !== undefined) {
      floorData.imageUrl = imageUrl;
    }

    const floor = await prisma.floor.update({
      where: {
        id: req.params.id,
      },
      data: floorData,
    });

    // ==========================================
    // Update floor elements
    // ==========================================

    if (elements && Array.isArray(elements)) {
      await prisma.floorElement.deleteMany({
        where: {
          floorId: req.params.id,
        },
      });

      const validElements = elements
        .filter(
          (el) =>
            el &&
            typeof el.x === 'number' &&
            typeof el.y === 'number'
        )
        .map((el) => {
          const {
            id,
            label,
            color,
            points,
            ...rest
          } = el;

          const num = (v, fallback) => {
            const n = Number(v);

            return Number.isFinite(n)
              ? n
              : fallback;
          };

          // Frontend sends label/points packed into
          // a `properties` JSON string.
          //
          // Older payloads may carry top-level
          // label/color/points instead.

          let properties = rest.properties;

          if (
            properties !== undefined &&
            properties !== null &&
            typeof properties !== 'string'
          ) {
            try {
              properties = JSON.stringify(properties);
            } catch {
              properties = null;
            }
          }

          if (
            (properties === undefined ||
              properties === null) &&
            (
              label !== undefined ||
              color !== undefined ||
              points !== undefined
            )
          ) {
            try {
              properties = JSON.stringify({
                label: label || '',
                points: points || null,
                color: color || null,
              });
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
      where: {
        id: req.params.id,
      },
      include: {
        elements: true,
      },
    });

    res.json(updatedFloor);
  } catch (error) {
    console.error('Error updating floor:', error);

    const detail =
      error.code ||
      (
        error.message
          ? String(error.message)
              .split('\n')
              .filter(Boolean)[0]
              ?.slice(0, 300)
          : undefined
      );

    res.status(500).json({
      error: 'Failed to update floor',
      detail,
    });
  }
});

// ==========================================
// Upload floor-plan image
// ==========================================

router.post(
  '/:id/image',
  authMiddleware,
  upload.single('image'),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({
          error: 'No image uploaded',
        });
      }

      // Make sure the floor exists first.
      const existingFloor = await prisma.floor.findUnique({
        where: {
          id: req.params.id,
        },
      });

      if (!existingFloor) {
        return res.status(404).json({
          error: 'Floor not found',
        });
      }

      // ==========================================
      // Validate image type
      // ==========================================

      const allowedMimeTypes = [
        'image/jpeg',
        'image/png',
        'image/webp',
        'image/gif',
      ];

      if (!allowedMimeTypes.includes(req.file.mimetype)) {
        return res.status(400).json({
          error:
            'Invalid image type. Please upload JPG, PNG, WEBP, or GIF.',
        });
      }

      // ==========================================
      // Generate unique storage path
      // ==========================================

      const originalName = req.file.originalname || 'floor-plan';

      const extension =
        originalName.includes('.')
          ? originalName
              .substring(originalName.lastIndexOf('.'))
              .toLowerCase()
          : '.jpg';

      const safeExtension =
        ['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(
          extension
        )
          ? extension
          : '.jpg';

      const fileName =
        `floor-${req.params.id}-${Date.now()}-${Math.random()
          .toString(36)
          .substring(2, 10)}${safeExtension}`;

      const storagePath = `floors/${req.params.id}/${fileName}`;

      // ==========================================
      // Upload to Supabase Storage
      // ==========================================

      const {
        error: uploadError,
      } = await supabase.storage
        .from(FLOOR_BUCKET)
        .upload(storagePath, req.file.buffer, {
          contentType: req.file.mimetype,
          cacheControl: '3600',
          upsert: false,
        });

      if (uploadError) {
        console.error(
          'Supabase Storage upload error:',
          uploadError
        );

        return res.status(500).json({
          error: 'Failed to upload image to storage',
          detail: uploadError.message,
        });
      }

      // ==========================================
      // Get public URL
      // ==========================================

      const {
        data: publicUrlData,
      } = supabase.storage
        .from(FLOOR_BUCKET)
        .getPublicUrl(storagePath);

      const imageUrl = publicUrlData.publicUrl;

      // ==========================================
      // Delete previous image from Supabase
      // ==========================================

      if (
        existingFloor.imageUrl &&
        existingFloor.imageUrl.includes(
          '/storage/v1/object/public/'
        )
      ) {
        try {
          const marker =
            `/storage/v1/object/public/${FLOOR_BUCKET}/`;

          const markerIndex =
            existingFloor.imageUrl.indexOf(marker);

          if (markerIndex !== -1) {
            const oldPath =
              existingFloor.imageUrl.substring(
                markerIndex + marker.length
              );

            if (oldPath) {
              const {
                error: deleteError,
              } = await supabase.storage
                .from(FLOOR_BUCKET)
                .remove([oldPath]);

              if (deleteError) {
                console.warn(
                  'Could not delete previous floor image:',
                  deleteError.message
                );
              }
            }
          }
        } catch (deleteError) {
          console.warn(
            'Error removing previous floor image:',
            deleteError.message
          );
        }
      }

      // ==========================================
      // Save public URL in database
      // ==========================================

      const floor = await prisma.floor.update({
        where: {
          id: req.params.id,
        },
        data: {
          imageUrl,
        },
      });

      res.json({
        ...floor,
        imageUrl,
      });
    } catch (error) {
      console.error(
        'Error uploading floor image:',
        error
      );

      res.status(500).json({
        error: 'Failed to upload image',
      });
    }
  }
);

// ==========================================
// Delete floor
// ==========================================

router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const floor = await prisma.floor.findUnique({
      where: {
        id: req.params.id,
      },
    });

    if (!floor) {
      return res.status(404).json({
        error: 'Floor not found',
      });
    }

    // ==========================================
    // Delete floor image from Supabase Storage
    // ==========================================

    if (
      floor.imageUrl &&
      floor.imageUrl.includes(
        '/storage/v1/object/public/'
      )
    ) {
      try {
        const marker =
          `/storage/v1/object/public/${FLOOR_BUCKET}/`;

        const markerIndex =
          floor.imageUrl.indexOf(marker);

        if (markerIndex !== -1) {
          const storagePath =
            floor.imageUrl.substring(
              markerIndex + marker.length
            );

          if (storagePath) {
            const {
              error: deleteError,
            } = await supabase.storage
              .from(FLOOR_BUCKET)
              .remove([storagePath]);

            if (deleteError) {
              console.warn(
                'Could not delete floor image:',
                deleteError.message
              );
            }
          }
        }
      } catch (storageError) {
        console.warn(
          'Error deleting floor image:',
          storageError.message
        );
      }
    }

    // ==========================================
    // Delete floor from database
    // ==========================================

    await prisma.floor.delete({
      where: {
        id: req.params.id,
      },
    });

    res.json({
      message: 'Floor deleted',
    });
  } catch (error) {
    console.error('Error deleting floor:', error);

    res.status(500).json({
      error: 'Failed to delete floor',
    });
  }
});

module.exports = router;