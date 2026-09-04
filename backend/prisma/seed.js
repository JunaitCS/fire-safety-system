const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function main() {
  const hashedManagerPass = await bcrypt.hash('manager123', 10);
  const hashedUserPass = await bcrypt.hash('user123', 10);
  const hashedResponderPass = await bcrypt.hash('responder123', 10);

  const manager = await prisma.user.upsert({
    where: { email: 'manager@firesafety.com' },
    update: {},
    create: {
      email: 'manager@firesafety.com',
      password: hashedManagerPass,
      name: 'Building Manager',
      role: 'MANAGER',
    },
  });

  const occupant = await prisma.user.upsert({
    where: { email: 'user@firesafety.com' },
    update: {},
    create: {
      email: 'user@firesafety.com',
      password: hashedUserPass,
      name: 'John Doe',
      role: 'OCCUPANT',
      phone: '+1234567890',
    },
  });

  const responder = await prisma.user.upsert({
    where: { email: 'responder@firesafety.com' },
    update: {},
    create: {
      email: 'responder@firesafety.com',
      password: hashedResponderPass,
      name: 'Fire Chief',
      role: 'RESPONDER',
    },
  });

  let building = await prisma.building.findFirst({ where: { ownerId: manager.id } });
  if (!building) {
    building = await prisma.building.create({
    data: {
      ownerId: manager.id,
      name: 'Tech Plaza Building',
      address: '123 Innovation Drive, Tech City',
      description: 'Modern 5-story office building with advanced fire safety systems',
      qrCode: 'BUILDING_' + Date.now(),
      isPublic: true,
      latitude: 40.7128,
      longitude: -74.0060,
    },
  });

  const floors = [];
  for (let i = 1; i <= 5; i++) {
    const existing = await prisma.floor.findFirst({ where: { buildingId: building.id, floorNumber: i } });
    if (existing) {
      floors.push(existing);
      continue;
    }
    const floor = await prisma.floor.create({
      data: {
        buildingId: building.id,
        floorNumber: i,
        name: `Floor ${i}`,
      },
    });
    floors.push(floor);
  }

  const cameraTypes = ['IP', 'USB', 'WEBCAM'];
  const locations = [
    { name: 'Main Entrance', isExit: true, floor: 1 },
    { name: 'Emergency Exit A', isExit: true, floor: 1 },
    { name: 'Emergency Exit B', isExit: true, floor: 2 },
    { name: 'Stairwell Camera', isExit: false, floor: 3 },
    { name: 'Lobby Camera', isExit: false, floor: 1 },
  ];

  for (let i = 0; i < locations.length; i++) {
    const exists = await prisma.camera.findFirst({
      where: { buildingId: building.id, name: locations[i].name },
    });
    if (exists) continue;
    await prisma.camera.create({
      data: {
        buildingId: building.id,
        floorId: floors[locations[i].floor - 1].id,
        name: locations[i].name,
        type: cameraTypes[i % cameraTypes.length],
        sourceUrl: i === 0 ? '0' : `rtsp://192.168.1.${10 + i}:554/stream`,
        isExit: locations[i].isExit,
        x: 100 + (i * 50),
        y: 100 + (i * 30),
      },
    });
  }
  } // end if (!building)

  console.log('✅ Database seeded successfully!');
  console.log('\nLogin credentials:');
  console.log('Manager: manager@firesafety.com / manager123');
  console.log('Occupant: user@firesafety.com / user123');
  console.log('Responder: responder@firesafety.com / responder123');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
