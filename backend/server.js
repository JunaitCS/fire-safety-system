const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const { createServer } = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');

dotenv.config();

const authRoutes = require('./src/routes/auth');
const buildingRoutes = require('./src/routes/buildings');
const floorRoutes = require('./src/routes/floors');
const cameraRoutes = require('./src/routes/cameras');
const drillRoutes = require('./src/routes/drills');
const emergencyRoutes = require('./src/routes/emergency');
const sosRoutes = require('./src/routes/sos');
const complaintRoutes = require('./src/routes/complaints');
const presenceRoutes = require('./src/routes/presence');

const FRONTEND_ORIGINS = (
  process.env.FRONTEND_URL ||
  'http://localhost:5173,http://127.0.0.1:5173'
)
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const isAllowedOrigin = (origin) => {
  if (!origin) return true;

  if (FRONTEND_ORIGINS.includes(origin)) {
    return true;
  }

  try {
    const host = new URL(origin).hostname;

    if (host === 'localhost' || host === '127.0.0.1') {
      return true;
    }

    if (
      /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host)
    ) {
      return true;
    }
  } catch {
    return false;
  }

  return false;
};

const corsOrigin = (origin, callback) => {
  callback(null, isAllowedOrigin(origin));
};

const app = express();
const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin: corsOrigin,
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    credentials: true,
  },
});

const uploadsDir = path.join(__dirname, 'uploads', 'floors');

if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

app.use(
  cors({
    origin: corsOrigin,
    credentials: true,
  })
);

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.use((req, res, next) => {
  req.io = io;
  next();
});

app.use('/api/auth', authRoutes);
app.use('/api/buildings', buildingRoutes);
app.use('/api/floors', floorRoutes);
app.use('/api/cameras', cameraRoutes);
app.use('/api/drills', drillRoutes);
app.use('/api/emergency', emergencyRoutes);
app.use('/api/sos', sosRoutes);
app.use('/api/complaints', complaintRoutes);
app.use('/api/presence', presenceRoutes);

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  socket.on('join-building', (buildingId) => {
    socket.join(`building-${buildingId}`);
    console.log(
      `Socket ${socket.id} joined building-${buildingId}`
    );
  });

  socket.on('join-emergency', (emergencyId) => {
    socket.join(`emergency-${emergencyId}`);
    console.log(
      `Socket ${socket.id} joined emergency-${emergencyId}`
    );
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
  });
});

app.use('/api', (req, res) => {
  res.status(404).json({
    error: 'API route not found',
  });
});

app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);

  res.status(err.status || 500).json({
    error: err.message || 'Internal server error',
  });
});

const PORT = process.env.PORT || 3001;

if (!process.env.JWT_SECRET) {
  console.warn(
    'JWT_SECRET is not set. Using dev fallback — do not use in production.'
  );
}

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
  console.log('Socket.IO ready for real-time connections');
});