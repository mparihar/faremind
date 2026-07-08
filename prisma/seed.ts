import 'dotenv/config';

// Prisma v7 generates ESM output — import is handled inside main()
let prisma: any;

// ═══════════════════════════════════════════════
// Seed: Airlines
// ═══════════════════════════════════════════════

const airlines = [
  { iataCode: 'UA', name: 'United Airlines', country: 'US', logoUrl: 'https://images.kiwi.com/airlines/64/UA.png' },
  { iataCode: 'AA', name: 'American Airlines', country: 'US', logoUrl: 'https://images.kiwi.com/airlines/64/AA.png' },
  { iataCode: 'DL', name: 'Delta Air Lines', country: 'US', logoUrl: 'https://images.kiwi.com/airlines/64/DL.png' },
  { iataCode: 'WN', name: 'Southwest Airlines', country: 'US', logoUrl: 'https://images.kiwi.com/airlines/64/WN.png' },
  { iataCode: 'B6', name: 'JetBlue Airways', country: 'US', logoUrl: 'https://images.kiwi.com/airlines/64/B6.png' },
  { iataCode: 'AS', name: 'Alaska Airlines', country: 'US', logoUrl: 'https://images.kiwi.com/airlines/64/AS.png' },
  { iataCode: 'NK', name: 'Spirit Airlines', country: 'US', logoUrl: 'https://images.kiwi.com/airlines/64/NK.png' },
  { iataCode: 'F9', name: 'Frontier Airlines', country: 'US', logoUrl: 'https://images.kiwi.com/airlines/64/F9.png' },
  { iataCode: 'BA', name: 'British Airways', country: 'GB', logoUrl: 'https://images.kiwi.com/airlines/64/BA.png' },
  { iataCode: 'LH', name: 'Lufthansa', country: 'DE', logoUrl: 'https://images.kiwi.com/airlines/64/LH.png' },
  { iataCode: 'AF', name: 'Air France', country: 'FR', logoUrl: 'https://images.kiwi.com/airlines/64/AF.png' },
  { iataCode: 'KL', name: 'KLM Royal Dutch Airlines', country: 'NL', logoUrl: 'https://images.kiwi.com/airlines/64/KL.png' },
  { iataCode: 'EK', name: 'Emirates', country: 'AE', logoUrl: 'https://images.kiwi.com/airlines/64/EK.png' },
  { iataCode: 'QR', name: 'Qatar Airways', country: 'QA', logoUrl: 'https://images.kiwi.com/airlines/64/QR.png' },
  { iataCode: 'EY', name: 'Etihad Airways', country: 'AE', logoUrl: 'https://images.kiwi.com/airlines/64/EY.png' },
  { iataCode: 'SQ', name: 'Singapore Airlines', country: 'SG', logoUrl: 'https://images.kiwi.com/airlines/64/SQ.png' },
  { iataCode: 'CX', name: 'Cathay Pacific', country: 'HK', logoUrl: 'https://images.kiwi.com/airlines/64/CX.png' },
  { iataCode: 'JL', name: 'Japan Airlines', country: 'JP', logoUrl: 'https://images.kiwi.com/airlines/64/JL.png' },
  { iataCode: 'NH', name: 'All Nippon Airways', country: 'JP', logoUrl: 'https://images.kiwi.com/airlines/64/NH.png' },
  { iataCode: 'TK', name: 'Turkish Airlines', country: 'TR', logoUrl: 'https://images.kiwi.com/airlines/64/TK.png' },
  { iataCode: 'LX', name: 'Swiss International Air Lines', country: 'CH', logoUrl: 'https://images.kiwi.com/airlines/64/LX.png' },
  { iataCode: 'AC', name: 'Air Canada', country: 'CA', logoUrl: 'https://images.kiwi.com/airlines/64/AC.png' },
  { iataCode: 'QF', name: 'Qantas', country: 'AU', logoUrl: 'https://images.kiwi.com/airlines/64/QF.png' },
  { iataCode: 'VS', name: 'Virgin Atlantic', country: 'GB', logoUrl: 'https://images.kiwi.com/airlines/64/VS.png' },
  { iataCode: 'IB', name: 'Iberia', country: 'ES', logoUrl: 'https://images.kiwi.com/airlines/64/IB.png' },
  { iataCode: 'AZ', name: 'ITA Airways', country: 'IT', logoUrl: 'https://images.kiwi.com/airlines/64/AZ.png' },
  { iataCode: 'KE', name: 'Korean Air', country: 'KR', logoUrl: 'https://images.kiwi.com/airlines/64/KE.png' },
  { iataCode: 'OZ', name: 'Asiana Airlines', country: 'KR', logoUrl: 'https://images.kiwi.com/airlines/64/OZ.png' },
  { iataCode: 'AI', name: 'Air India', country: 'IN', logoUrl: 'https://images.kiwi.com/airlines/64/AI.png' },
  { iataCode: 'MU', name: 'China Eastern Airlines', country: 'CN', logoUrl: 'https://images.kiwi.com/airlines/64/MU.png' },
];

// ═══════════════════════════════════════════════
// Seed: Airports
// ═══════════════════════════════════════════════

const airports = [
  // US
  { iataCode: 'JFK', name: 'John F. Kennedy International Airport', city: 'New York', country: 'United States', countryCode: 'US', latitude: 40.6413, longitude: -73.7781, timezone: 'America/New_York' },
  { iataCode: 'LAX', name: 'Los Angeles International Airport', city: 'Los Angeles', country: 'United States', countryCode: 'US', latitude: 33.9425, longitude: -118.4081, timezone: 'America/Los_Angeles' },
  { iataCode: 'ORD', name: "O'Hare International Airport", city: 'Chicago', country: 'United States', countryCode: 'US', latitude: 41.9742, longitude: -87.9073, timezone: 'America/Chicago' },
  { iataCode: 'SFO', name: 'San Francisco International Airport', city: 'San Francisco', country: 'United States', countryCode: 'US', latitude: 37.6213, longitude: -122.3790, timezone: 'America/Los_Angeles' },
  { iataCode: 'MIA', name: 'Miami International Airport', city: 'Miami', country: 'United States', countryCode: 'US', latitude: 25.7959, longitude: -80.2870, timezone: 'America/New_York' },
  { iataCode: 'DFW', name: 'Dallas/Fort Worth International Airport', city: 'Dallas', country: 'United States', countryCode: 'US', latitude: 32.8998, longitude: -97.0403, timezone: 'America/Chicago' },
  { iataCode: 'ATL', name: 'Hartsfield-Jackson Atlanta International Airport', city: 'Atlanta', country: 'United States', countryCode: 'US', latitude: 33.6407, longitude: -84.4277, timezone: 'America/New_York' },
  { iataCode: 'SEA', name: 'Seattle-Tacoma International Airport', city: 'Seattle', country: 'United States', countryCode: 'US', latitude: 47.4502, longitude: -122.3088, timezone: 'America/Los_Angeles' },
  { iataCode: 'DEN', name: 'Denver International Airport', city: 'Denver', country: 'United States', countryCode: 'US', latitude: 39.8561, longitude: -104.6737, timezone: 'America/Denver' },
  { iataCode: 'BOS', name: 'Boston Logan International Airport', city: 'Boston', country: 'United States', countryCode: 'US', latitude: 42.3656, longitude: -71.0096, timezone: 'America/New_York' },
  { iataCode: 'IAH', name: 'George Bush Intercontinental Airport', city: 'Houston', country: 'United States', countryCode: 'US', latitude: 29.9844, longitude: -95.3414, timezone: 'America/Chicago' },
  { iataCode: 'PHX', name: 'Phoenix Sky Harbor International Airport', city: 'Phoenix', country: 'United States', countryCode: 'US', latitude: 33.4373, longitude: -112.0078, timezone: 'America/Phoenix' },
  { iataCode: 'MSP', name: 'Minneapolis-Saint Paul International Airport', city: 'Minneapolis', country: 'United States', countryCode: 'US', latitude: 44.8848, longitude: -93.2223, timezone: 'America/Chicago' },
  { iataCode: 'CLT', name: 'Charlotte Douglas International Airport', city: 'Charlotte', country: 'United States', countryCode: 'US', latitude: 35.2140, longitude: -80.9431, timezone: 'America/New_York' },
  { iataCode: 'EWR', name: 'Newark Liberty International Airport', city: 'Newark', country: 'United States', countryCode: 'US', latitude: 40.6895, longitude: -74.1745, timezone: 'America/New_York' },

  // International
  { iataCode: 'LHR', name: 'Heathrow Airport', city: 'London', country: 'United Kingdom', countryCode: 'GB', latitude: 51.4700, longitude: -0.4543, timezone: 'Europe/London' },
  { iataCode: 'CDG', name: 'Charles de Gaulle Airport', city: 'Paris', country: 'France', countryCode: 'FR', latitude: 49.0097, longitude: 2.5479, timezone: 'Europe/Paris' },
  { iataCode: 'FRA', name: 'Frankfurt Airport', city: 'Frankfurt', country: 'Germany', countryCode: 'DE', latitude: 50.0379, longitude: 8.5622, timezone: 'Europe/Berlin' },
  { iataCode: 'AMS', name: 'Amsterdam Schiphol Airport', city: 'Amsterdam', country: 'Netherlands', countryCode: 'NL', latitude: 52.3105, longitude: 4.7683, timezone: 'Europe/Amsterdam' },
  { iataCode: 'NRT', name: 'Narita International Airport', city: 'Tokyo', country: 'Japan', countryCode: 'JP', latitude: 35.7720, longitude: 140.3929, timezone: 'Asia/Tokyo' },
  { iataCode: 'HND', name: 'Haneda Airport', city: 'Tokyo', country: 'Japan', countryCode: 'JP', latitude: 35.5494, longitude: 139.7798, timezone: 'Asia/Tokyo' },
  { iataCode: 'DXB', name: 'Dubai International Airport', city: 'Dubai', country: 'United Arab Emirates', countryCode: 'AE', latitude: 25.2532, longitude: 55.3657, timezone: 'Asia/Dubai' },
  { iataCode: 'SIN', name: 'Changi Airport', city: 'Singapore', country: 'Singapore', countryCode: 'SG', latitude: 1.3644, longitude: 103.9915, timezone: 'Asia/Singapore' },
  { iataCode: 'ICN', name: 'Incheon International Airport', city: 'Seoul', country: 'South Korea', countryCode: 'KR', latitude: 37.4602, longitude: 126.4407, timezone: 'Asia/Seoul' },
  { iataCode: 'YYZ', name: 'Toronto Pearson International Airport', city: 'Toronto', country: 'Canada', countryCode: 'CA', latitude: 43.6777, longitude: -79.6248, timezone: 'America/Toronto' },
  { iataCode: 'SYD', name: 'Sydney Kingsford Smith Airport', city: 'Sydney', country: 'Australia', countryCode: 'AU', latitude: -33.9461, longitude: 151.1772, timezone: 'Australia/Sydney' },
  { iataCode: 'DEL', name: 'Indira Gandhi International Airport', city: 'Delhi', country: 'India', countryCode: 'IN', latitude: 28.5562, longitude: 77.1000, timezone: 'Asia/Kolkata' },
  { iataCode: 'BOM', name: 'Chhatrapati Shivaji Maharaj International Airport', city: 'Mumbai', country: 'India', countryCode: 'IN', latitude: 19.0896, longitude: 72.8656, timezone: 'Asia/Kolkata' },
  { iataCode: 'CAN', name: 'Guangzhou Baiyun International Airport', city: 'Guangzhou', country: 'China', countryCode: 'CN', latitude: 23.3924, longitude: 113.2988, timezone: 'Asia/Shanghai' },
  { iataCode: 'MEX', name: 'Mexico City International Airport', city: 'Mexico City', country: 'Mexico', countryCode: 'MX', latitude: 19.4363, longitude: -99.0721, timezone: 'America/Mexico_City' },
  { iataCode: 'IST', name: 'Istanbul Airport', city: 'Istanbul', country: 'Turkey', countryCode: 'TR', latitude: 41.2753, longitude: 28.7519, timezone: 'Europe/Istanbul' },
  { iataCode: 'DOH', name: 'Hamad International Airport', city: 'Doha', country: 'Qatar', countryCode: 'QA', latitude: 25.2731, longitude: 51.6081, timezone: 'Asia/Qatar' },
  { iataCode: 'GRU', name: 'São Paulo–Guarulhos International Airport', city: 'São Paulo', country: 'Brazil', countryCode: 'BR', latitude: -23.4356, longitude: -46.4731, timezone: 'America/Sao_Paulo' },
  { iataCode: 'MAD', name: 'Adolfo Suárez Madrid–Barajas Airport', city: 'Madrid', country: 'Spain', countryCode: 'ES', latitude: 40.4983, longitude: -3.5676, timezone: 'Europe/Madrid' },
  { iataCode: 'FCO', name: 'Leonardo da Vinci–Fiumicino Airport', city: 'Rome', country: 'Italy', countryCode: 'IT', latitude: 41.8003, longitude: 12.2389, timezone: 'Europe/Rome' },
];

// ═══════════════════════════════════════════════
// Main Seed Function
// ═══════════════════════════════════════════════

async function main() {
  const { PrismaClient } = await import('../src/generated/prisma/client.js');
  const { Pool } = await import('pg');
  const { PrismaPg } = await import('@prisma/adapter-pg');

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const adapter = new PrismaPg(pool);
  prisma = new PrismaClient({ adapter });

  console.log('🌱 Starting FareMind database seed...\n');

  // Seed Airlines
  console.log('✈️  Seeding airlines...');
  for (const airline of airlines) {
    await prisma.airline.upsert({
      where: { iataCode: airline.iataCode },
      update: airline,
      create: airline,
    });
  }
  console.log(`   ✅ ${airlines.length} airlines seeded\n`);

  // Seed Airports
  console.log('🏢 Seeding airports...');
  for (const airport of airports) {
    await prisma.airport.upsert({
      where: { iataCode: airport.iataCode },
      update: airport,
      create: airport,
    });
  }
  console.log(`   ✅ ${airports.length} airports seeded\n`);

  // Seed a demo user
  console.log('👤 Seeding demo user...');
  const demoUser = await prisma.user.upsert({
    where: { email: 'demo@faremind.com' },
    update: {},
    create: {
      email: 'demo@faremind.com',
      passwordHash: '$2a$12$placeholder_hash_for_demo_user_password',
      firstName: 'Alex',
      lastName: 'Morgan',
      phone: '+1-555-0123',
      emailVerified: true,
      role: 'USER',
    },
  });
  console.log(`   ✅ Demo user created: ${demoUser.email}\n`);

  // Seed demo bookings
  console.log('📋 Seeding demo bookings...');
  const now = new Date();

  const booking1 = await prisma.booking.upsert({
    where: { id: 'demo-booking-001' },
    update: {},
    create: {
      id: 'demo-booking-001',
      userId: demoUser.id,
      provider: 'DUFFEL',
      providerBookingId: 'duf_booking_demo_001',
      pnr: 'XKFM3R',
      status: 'CONFIRMED',
      airlineCode: 'UA',
      airlineName: 'United Airlines',
      originAirport: 'SFO',
      originCity: 'San Francisco',
      destinationAirport: 'JFK',
      destinationCity: 'New York',
      departureTime: new Date(now.getTime() + 14 * 86400000),
      arrivalTime: new Date(now.getTime() + 14 * 86400000 + 5.5 * 3600000),
      totalDuration: 330,
      stops: 0,
      cabinClass: 'ECONOMY',
      fareClass: 'Economy Flex',
      totalPrice: 445.00,
      baseFare: 378.25,
      taxes: 66.75,
      currency: 'USD',
      refundable: true,
      changeable: true,
      changeFee: 50.00,
      carryOnBags: 1,
      checkedBags: 1,
      priceTracking: true,
      currentTrackedPrice: 362.00,
      passengers: {
        create: {
          firstName: 'Alex',
          lastName: 'Morgan',
          dateOfBirth: new Date('1990-05-15'),
          gender: 'MALE',
          email: 'demo@faremind.com',
          phone: '+1-555-0123',
          type: 'ADULT',
        },
      },
      segments: {
        create: {
          segmentOrder: 0,
          depAirport: 'SFO',
          depAirportName: 'San Francisco International Airport',
          depCity: 'San Francisco',
          depTime: new Date(now.getTime() + 14 * 86400000),
          depTerminal: 'T3',
          arrAirport: 'JFK',
          arrAirportName: 'John F. Kennedy International Airport',
          arrCity: 'New York',
          arrTime: new Date(now.getTime() + 14 * 86400000 + 5.5 * 3600000),
          arrTerminal: 'T7',
          airlineCode: 'UA',
          airlineName: 'United Airlines',
          flightNumber: 'UA524',
          duration: 330,
          aircraft: 'Boeing 787-9',
        },
      },
    },
  });

  // Price history for booking 1 (showing a drop)
  const priceHistoryData1 = [
    { price: 445.00, daysAgo: 7, provider: 'DUFFEL' as const },
    { price: 445.00, daysAgo: 5, provider: 'DUFFEL' as const },
    { price: 423.00, daysAgo: 3, provider: 'DUFFEL' as const },
    { price: 398.00, daysAgo: 2, provider: 'DUFFEL' as const },
    { price: 378.00, daysAgo: 1, provider: 'DUFFEL' as const },
    { price: 362.00, daysAgo: 0, provider: 'DUFFEL' as const },
  ];

  for (const ph of priceHistoryData1) {
    await prisma.priceHistory.create({
      data: {
        bookingId: booking1.id,
        price: ph.price,
        currency: 'USD',
        provider: ph.provider,
        checkedAt: new Date(now.getTime() - ph.daysAgo * 86400000),
      },
    });
  }

  // Create price alert for the drop
  await prisma.priceAlert.create({
    data: {
      bookingId: booking1.id,
      userId: demoUser.id,
      bookedPrice: 445.00,
      currentPrice: 362.00,
      savings: 83.00,
      percentDrop: 18.65,
      currency: 'USD',
      status: 'NEW',
    },
  });

  // Create price tracking job
  await prisma.priceTrackingJob.upsert({
    where: { bookingId: booking1.id },
    update: {},
    create: {
      bookingId: booking1.id,
      origin: 'SFO',
      destination: 'JFK',
      departureDate: new Date(now.getTime() + 14 * 86400000),
      cabinClass: 'ECONOMY',
      bookedPrice: 445.00,
      currency: 'USD',
      threshold: 0.05,
      status: 'ACTIVE',
      lastRunAt: now,
      nextRunAt: new Date(now.getTime() + 4 * 3600000),
      runCount: 6,
    },
  });

  // Booking 2
  const booking2 = await prisma.booking.upsert({
    where: { id: 'demo-booking-002' },
    update: {},
    create: {
      id: 'demo-booking-002',
      userId: demoUser.id,
      provider: 'AMADEUS',
      providerBookingId: 'ama_booking_demo_002',
      pnr: 'YWTP8N',
      status: 'CONFIRMED',
      airlineCode: 'DL',
      airlineName: 'Delta Air Lines',
      originAirport: 'LAX',
      originCity: 'Los Angeles',
      destinationAirport: 'ORD',
      destinationCity: 'Chicago',
      departureTime: new Date(now.getTime() + 21 * 86400000),
      arrivalTime: new Date(now.getTime() + 21 * 86400000 + 4 * 3600000),
      totalDuration: 240,
      stops: 0,
      cabinClass: 'ECONOMY',
      fareClass: 'Economy Saver',
      totalPrice: 289.00,
      baseFare: 245.65,
      taxes: 43.35,
      currency: 'USD',
      refundable: false,
      changeable: true,
      cancellationFee: 150.00,
      changeFee: 75.00,
      carryOnBags: 1,
      checkedBags: 0,
      priceTracking: true,
      currentTrackedPrice: 351.00,
      passengers: {
        create: {
          firstName: 'Alex',
          lastName: 'Morgan',
          dateOfBirth: new Date('1990-05-15'),
          gender: 'MALE',
          email: 'demo@faremind.com',
          phone: '+1-555-0123',
          type: 'ADULT',
        },
      },
      segments: {
        create: {
          segmentOrder: 0,
          depAirport: 'LAX',
          depAirportName: 'Los Angeles International Airport',
          depCity: 'Los Angeles',
          depTime: new Date(now.getTime() + 21 * 86400000),
          depTerminal: 'T2',
          arrAirport: 'ORD',
          arrAirportName: "O'Hare International Airport",
          arrCity: 'Chicago',
          arrTime: new Date(now.getTime() + 21 * 86400000 + 4 * 3600000),
          arrTerminal: 'T2',
          airlineCode: 'DL',
          airlineName: 'Delta Air Lines',
          flightNumber: 'DL1247',
          duration: 240,
          aircraft: 'Airbus A321neo',
        },
      },
    },
  });

  // Price history for booking 2 (going up)
  const priceHistoryData2 = [
    { price: 289.00, daysAgo: 5, provider: 'AMADEUS' as const },
    { price: 295.00, daysAgo: 3, provider: 'AMADEUS' as const },
    { price: 312.00, daysAgo: 2, provider: 'AMADEUS' as const },
    { price: 334.00, daysAgo: 1, provider: 'AMADEUS' as const },
    { price: 351.00, daysAgo: 0, provider: 'AMADEUS' as const },
  ];

  for (const ph of priceHistoryData2) {
    await prisma.priceHistory.create({
      data: {
        bookingId: booking2.id,
        price: ph.price,
        currency: 'USD',
        provider: ph.provider,
        checkedAt: new Date(now.getTime() - ph.daysAgo * 86400000),
      },
    });
  }

  // Demo notification
  await prisma.notification.create({
    data: {
      userId: demoUser.id,
      bookingId: booking1.id,
      type: 'PRICE_DROP',
      channel: 'IN_APP',
      title: 'Price Drop Detected!',
      body: 'Your SFO → JFK flight dropped by $83 since you booked. Save now with smart rebooking.',
      status: 'DELIVERED',
      sentAt: now,
    },
  });

  await prisma.notification.create({
    data: {
      userId: demoUser.id,
      bookingId: booking1.id,
      type: 'BOOKING_CONFIRMATION',
      channel: 'EMAIL',
      title: 'Booking Confirmed - SFO → JFK',
      body: 'Your United Airlines flight UA524 from San Francisco to New York has been confirmed. PNR: XKFM3R',
      status: 'SENT',
      sentAt: new Date(now.getTime() - 7 * 86400000),
    },
  });

  console.log(`   ✅ 2 demo bookings created with price history\n`);

  // Seed WhatsApp Support Number
  console.log('📱 Seeding WhatsApp support number...');
  await prisma.whatsAppSupportNumber.upsert({
    where: { id: 'default-whatsapp-support' },
    update: {},
    create: {
      id: 'default-whatsapp-support',
      displayName: 'FareMind Super Admin Support',
      countryCode: '+1',
      phoneNumber: '9453695543',
      fullWhatsAppNumber: '19453695543',
      roleType: 'SUPER_ADMIN',
      isPrimary: true,
      isActive: true,
      priority: 1,
      notes: 'Default FareMind support WhatsApp number',
    },
  });
  console.log('   ✅ WhatsApp support number seeded\n');

  // Summary
  const counts = {
    users: await prisma.user.count(),
    airlines: await prisma.airline.count(),
    airports: await prisma.airport.count(),
    bookings: await prisma.booking.count(),
    passengers: await prisma.passenger.count(),
    segments: await prisma.flightSegment.count(),
    priceHistory: await prisma.priceHistory.count(),
    priceAlerts: await prisma.priceAlert.count(),
    trackingJobs: await prisma.priceTrackingJob.count(),
    notifications: await prisma.notification.count(),
  };

  console.log('═══════════════════════════════════════');
  console.log('  🎉 FareMind Database Seed Complete!');
  console.log('═══════════════════════════════════════');
  console.log('');
  Object.entries(counts).forEach(([table, count]) => {
    console.log(`  ${table.padEnd(16)} ${count}`);
  });
  console.log('');
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
