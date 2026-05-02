import { UnifiedFlight, Booking, PricePoint, Airport } from './types';

// ─── Popular Airports ───

export const AIRPORTS: Airport[] = [
  { code: 'JFK', name: 'John F. Kennedy International', city: 'New York', country: 'US' },
  { code: 'LAX', name: 'Los Angeles International', city: 'Los Angeles', country: 'US' },
  { code: 'ORD', name: "O'Hare International", city: 'Chicago', country: 'US' },
  { code: 'SFO', name: 'San Francisco International', city: 'San Francisco', country: 'US' },
  { code: 'MIA', name: 'Miami International', city: 'Miami', country: 'US' },
  { code: 'DFW', name: 'Dallas/Fort Worth International', city: 'Dallas', country: 'US' },
  { code: 'ATL', name: 'Hartsfield-Jackson Atlanta', city: 'Atlanta', country: 'US' },
  { code: 'SEA', name: 'Seattle-Tacoma International', city: 'Seattle', country: 'US' },
  { code: 'DEN', name: 'Denver International', city: 'Denver', country: 'US' },
  { code: 'BOS', name: 'Boston Logan International', city: 'Boston', country: 'US' },
  { code: 'LHR', name: 'Heathrow Airport', city: 'London', country: 'GB' },
  { code: 'CDG', name: 'Charles de Gaulle Airport', city: 'Paris', country: 'FR' },
  { code: 'NRT', name: 'Narita International', city: 'Tokyo', country: 'JP' },
  { code: 'DXB', name: 'Dubai International', city: 'Dubai', country: 'AE' },
  { code: 'SIN', name: 'Changi Airport', city: 'Singapore', country: 'SG' },
  { code: 'HND', name: 'Haneda Airport', city: 'Tokyo', country: 'JP' },
  { code: 'FRA', name: 'Frankfurt Airport', city: 'Frankfurt', country: 'DE' },
  { code: 'AMS', name: 'Amsterdam Schiphol', city: 'Amsterdam', country: 'NL' },
  { code: 'ICN', name: 'Incheon International', city: 'Seoul', country: 'KR' },
  { code: 'YYZ', name: 'Toronto Pearson International', city: 'Toronto', country: 'CA' },
  { code: 'SYD', name: 'Sydney Kingsford Smith', city: 'Sydney', country: 'AU' },
  { code: 'DEL', name: 'Indira Gandhi International', city: 'Delhi', country: 'IN' },
  { code: 'BOM', name: 'Chhatrapati Shivaji Maharaj', city: 'Mumbai', country: 'IN' },
  { code: 'CAN', name: 'Guangzhou Baiyun', city: 'Guangzhou', country: 'CN' },
  { code: 'MEX', name: 'Mexico City International', city: 'Mexico City', country: 'MX' },
];

// ─── Mock Flight Data ───

export function generateMockFlights(
  origin: string,
  destination: string,
  departureDate: string
): UnifiedFlight[] {
  const airlines = [
    { code: 'UA', name: 'United Airlines' },
    { code: 'AA', name: 'American Airlines' },
    { code: 'DL', name: 'Delta Air Lines' },
    { code: 'BA', name: 'British Airways' },
    { code: 'LH', name: 'Lufthansa' },
    { code: 'EK', name: 'Emirates' },
    { code: 'SQ', name: 'Singapore Airlines' },
    { code: 'JL', name: 'Japan Airlines' },
    { code: 'AF', name: 'Air France' },
    { code: 'KL', name: 'KLM' },
  ];

  const basePrices = [189, 234, 278, 312, 356, 399, 445, 489, 534, 612, 678, 745];
  const departureTimes = ['06:30', '08:15', '09:45', '11:00', '13:20', '15:45', '17:30', '20:00', '22:15'];
  const durations = [180, 210, 245, 280, 320, 360, 420, 480, 540, 620, 720];

  const flights: UnifiedFlight[] = [];
  const numFlights = 12 + Math.floor(Math.random() * 6);

  for (let i = 0; i < numFlights; i++) {
    const airline = airlines[i % airlines.length];
    const basePrice = basePrices[i % basePrices.length] + Math.floor(Math.random() * 80);
    const depTime = departureTimes[i % departureTimes.length];
    const duration = durations[i % durations.length] + Math.floor(Math.random() * 30);
    const stops = i < 4 ? 0 : i < 9 ? 1 : 2;
    const provider = i % 3 === 0 ? 'duffel' as const : 'amadeus' as const;
    const refundable = Math.random() > 0.6;

    const depDate = new Date(`${departureDate}T${depTime}:00`);
    const arrDate = new Date(depDate.getTime() + duration * 60 * 1000);

    const segments = [];

    if (stops === 0) {
      segments.push({
        id: `seg-${i}-0`,
        departure: {
          airport: origin,
          airportName: AIRPORTS.find(a => a.code === origin)?.name || origin,
          city: AIRPORTS.find(a => a.code === origin)?.city || origin,
          time: depDate.toISOString(),
          terminal: `T${Math.ceil(Math.random() * 4)}`,
        },
        arrival: {
          airport: destination,
          airportName: AIRPORTS.find(a => a.code === destination)?.name || destination,
          city: AIRPORTS.find(a => a.code === destination)?.city || destination,
          time: arrDate.toISOString(),
          terminal: `T${Math.ceil(Math.random() * 3)}`,
        },
        airline: { code: airline.code, name: airline.name },
        flightNumber: `${airline.code}${100 + Math.floor(Math.random() * 900)}`,
        duration,
        aircraft: ['Boeing 737-800', 'Airbus A320', 'Boeing 787-9', 'Airbus A350'][Math.floor(Math.random() * 4)],
      });
    } else {
      const connectingAirports = ['ORD', 'ATL', 'DFW', 'DEN', 'IAH', 'CLT', 'PHX', 'MSP'];
      const connection1 = connectingAirports[Math.floor(Math.random() * connectingAirports.length)];

      const seg1Duration = Math.floor(duration * 0.45);
      const layover = 60 + Math.floor(Math.random() * 120);
      const seg2Duration = duration - seg1Duration - layover;

      const seg1Arr = new Date(depDate.getTime() + seg1Duration * 60 * 1000);
      const seg2Dep = new Date(seg1Arr.getTime() + layover * 60 * 1000);

      segments.push({
        id: `seg-${i}-0`,
        departure: {
          airport: origin,
          airportName: AIRPORTS.find(a => a.code === origin)?.name || origin,
          city: AIRPORTS.find(a => a.code === origin)?.city || origin,
          time: depDate.toISOString(),
        },
        arrival: {
          airport: connection1,
          airportName: connection1,
          city: connection1,
          time: seg1Arr.toISOString(),
        },
        airline: { code: airline.code, name: airline.name },
        flightNumber: `${airline.code}${100 + Math.floor(Math.random() * 900)}`,
        duration: seg1Duration,
        aircraft: 'Boeing 737-800',
      });

      segments.push({
        id: `seg-${i}-1`,
        departure: {
          airport: connection1,
          airportName: connection1,
          city: connection1,
          time: seg2Dep.toISOString(),
        },
        arrival: {
          airport: destination,
          airportName: AIRPORTS.find(a => a.code === destination)?.name || destination,
          city: AIRPORTS.find(a => a.code === destination)?.city || destination,
          time: arrDate.toISOString(),
        },
        airline: { code: airline.code, name: airline.name },
        flightNumber: `${airline.code}${100 + Math.floor(Math.random() * 900)}`,
        duration: Math.max(seg2Duration, 60),
        aircraft: 'Airbus A320neo',
      });

      if (stops === 2) {
        const connection2 = connectingAirports[(Math.floor(Math.random() * connectingAirports.length) + 3) % connectingAirports.length];
        segments.push({
          id: `seg-${i}-2`,
          departure: {
            airport: connection2,
            airportName: connection2,
            city: connection2,
            time: new Date(seg2Dep.getTime() - 90 * 60 * 1000).toISOString(),
          },
          arrival: {
            airport: connection1,
            airportName: connection1,
            city: connection1,
            time: seg2Dep.toISOString(),
          },
          airline: { code: airline.code, name: airline.name },
          flightNumber: `${airline.code}${100 + Math.floor(Math.random() * 900)}`,
          duration: 85,
          aircraft: 'Embraer E175',
        });
      }
    }

    const valueScore = Math.max(10, Math.min(98, Math.round(
      (1000 - basePrice) / 10 * 0.45 +
      (800 - duration) / 8 * 0.30 +
      (2 - stops) * 15 +
      (refundable ? 10 : 0)
    )));

    flights.push({
      id: `flight-${i}-${Date.now()}`,
      provider,
      providerOfferId: `${provider}_offer_${Math.random().toString(36).substr(2, 12)}`,
      airline: { code: airline.code, name: airline.name },
      segments,
      totalPrice: basePrice,
      currency: 'USD',
      cabinClass: 'economy',
      fareRules: {
        refundable,
        changeable: refundable || Math.random() > 0.5,
        cancellationFee: refundable ? 0 : 75 + Math.floor(Math.random() * 150),
        changeFee: Math.random() > 0.3 ? 50 + Math.floor(Math.random() * 100) : 0,
      },
      baggage: {
        carryOn: 1,
        checked: refundable ? 2 : Math.random() > 0.5 ? 1 : 0,
        carryOnWeight: 7,
        checkedWeight: 23,
      },
      totalDuration: duration,
      stops,
      valueScore,
      fareClass: ['Economy Saver', 'Economy Flex', 'Economy Plus', 'Main Cabin'][Math.floor(Math.random() * 4)],
      seatsRemaining: Math.random() > 0.6 ? Math.ceil(Math.random() * 9) : undefined,
    });
  }

  return flights.sort((a, b) => a.totalPrice - b.totalPrice);
}

// ─── Mock Bookings ───

export function generateMockBookings(): Booking[] {
  const now = new Date();

  const priceHistoryDown: PricePoint[] = [
    { timestamp: new Date(now.getTime() - 7 * 86400000).toISOString(), price: 445, currency: 'USD' },
    { timestamp: new Date(now.getTime() - 5 * 86400000).toISOString(), price: 445, currency: 'USD' },
    { timestamp: new Date(now.getTime() - 3 * 86400000).toISOString(), price: 423, currency: 'USD' },
    { timestamp: new Date(now.getTime() - 2 * 86400000).toISOString(), price: 398, currency: 'USD' },
    { timestamp: new Date(now.getTime() - 1 * 86400000).toISOString(), price: 378, currency: 'USD' },
    { timestamp: now.toISOString(), price: 362, currency: 'USD' },
  ];

  const priceHistoryUp: PricePoint[] = [
    { timestamp: new Date(now.getTime() - 7 * 86400000).toISOString(), price: 289, currency: 'USD' },
    { timestamp: new Date(now.getTime() - 5 * 86400000).toISOString(), price: 295, currency: 'USD' },
    { timestamp: new Date(now.getTime() - 3 * 86400000).toISOString(), price: 312, currency: 'USD' },
    { timestamp: new Date(now.getTime() - 1 * 86400000).toISOString(), price: 334, currency: 'USD' },
    { timestamp: now.toISOString(), price: 351, currency: 'USD' },
  ];

  return [
    {
      id: 'bk-001',
      userId: 'user-1',
      flightId: 'flight-mock-1',
      provider: 'duffel',
      providerBookingId: 'duf_booking_abc123',
      pnr: 'XKFM3R',
      status: 'confirmed',
      passengers: [
        {
          id: 'pax-1',
          firstName: 'Alex',
          lastName: 'Morgan',
          dateOfBirth: '1990-05-15',
          gender: 'male',
          email: 'alex@example.com',
          phone: '+1-555-0123',
          type: 'adult',
        },
      ],
      flight: {
        id: 'flight-mock-1',
        provider: 'duffel',
        providerOfferId: 'duf_offer_xyz',
        airline: { code: 'UA', name: 'United Airlines' },
        segments: [
          {
            id: 'seg-bk1-0',
            departure: {
              airport: 'SFO',
              airportName: 'San Francisco International',
              city: 'San Francisco',
              time: new Date(now.getTime() + 14 * 86400000).toISOString(),
              terminal: 'T3',
            },
            arrival: {
              airport: 'JFK',
              airportName: 'John F. Kennedy International',
              city: 'New York',
              time: new Date(now.getTime() + 14 * 86400000 + 5.5 * 3600000).toISOString(),
              terminal: 'T7',
            },
            airline: { code: 'UA', name: 'United Airlines' },
            flightNumber: 'UA 524',
            duration: 330,
            aircraft: 'Boeing 787-9',
          },
        ],
        totalPrice: 445,
        currency: 'USD',
        cabinClass: 'economy',
        fareRules: { refundable: true, changeable: true, cancellationFee: 0, changeFee: 50 },
        baggage: { carryOn: 1, checked: 1, carryOnWeight: 7, checkedWeight: 23 },
        totalDuration: 330,
        stops: 0,
        valueScore: 78,
        fareClass: 'Economy Flex',
      },
      totalPaid: 445,
      currency: 'USD',
      bookedAt: new Date(now.getTime() - 7 * 86400000).toISOString(),
      priceHistory: priceHistoryDown,
      priceTracking: true,
    },
    {
      id: 'bk-002',
      userId: 'user-1',
      flightId: 'flight-mock-2',
      provider: 'amadeus',
      providerBookingId: 'ama_booking_def456',
      pnr: 'YWTP8N',
      status: 'confirmed',
      passengers: [
        {
          id: 'pax-2',
          firstName: 'Alex',
          lastName: 'Morgan',
          dateOfBirth: '1990-05-15',
          gender: 'male',
          email: 'alex@example.com',
          phone: '+1-555-0123',
          type: 'adult',
        },
      ],
      flight: {
        id: 'flight-mock-2',
        provider: 'amadeus',
        providerOfferId: 'ama_offer_abc',
        airline: { code: 'DL', name: 'Delta Air Lines' },
        segments: [
          {
            id: 'seg-bk2-0',
            departure: {
              airport: 'LAX',
              airportName: 'Los Angeles International',
              city: 'Los Angeles',
              time: new Date(now.getTime() + 21 * 86400000).toISOString(),
              terminal: 'T2',
            },
            arrival: {
              airport: 'ORD',
              airportName: "O'Hare International",
              city: 'Chicago',
              time: new Date(now.getTime() + 21 * 86400000 + 4 * 3600000).toISOString(),
              terminal: 'T2',
            },
            airline: { code: 'DL', name: 'Delta Air Lines' },
            flightNumber: 'DL 1247',
            duration: 240,
            aircraft: 'Airbus A321neo',
          },
        ],
        totalPrice: 289,
        currency: 'USD',
        cabinClass: 'economy',
        fareRules: { refundable: false, changeable: true, cancellationFee: 150, changeFee: 75 },
        baggage: { carryOn: 1, checked: 0, carryOnWeight: 7 },
        totalDuration: 240,
        stops: 0,
        valueScore: 85,
        fareClass: 'Economy Saver',
      },
      totalPaid: 289,
      currency: 'USD',
      bookedAt: new Date(now.getTime() - 4 * 86400000).toISOString(),
      priceHistory: priceHistoryUp,
      priceTracking: true,
    },
    {
      id: 'bk-003',
      userId: 'user-1',
      flightId: 'flight-mock-3',
      provider: 'duffel',
      providerBookingId: 'duf_booking_ghi789',
      pnr: 'RKTV2M',
      status: 'completed',
      passengers: [
        {
          id: 'pax-3',
          firstName: 'Alex',
          lastName: 'Morgan',
          dateOfBirth: '1990-05-15',
          gender: 'male',
          email: 'alex@example.com',
          phone: '+1-555-0123',
          type: 'adult',
        },
      ],
      flight: {
        id: 'flight-mock-3',
        provider: 'duffel',
        providerOfferId: 'duf_offer_def',
        airline: { code: 'BA', name: 'British Airways' },
        segments: [
          {
            id: 'seg-bk3-0',
            departure: {
              airport: 'JFK',
              airportName: 'John F. Kennedy International',
              city: 'New York',
              time: new Date(now.getTime() - 10 * 86400000).toISOString(),
              terminal: 'T7',
            },
            arrival: {
              airport: 'LHR',
              airportName: 'Heathrow Airport',
              city: 'London',
              time: new Date(now.getTime() - 10 * 86400000 + 7.5 * 3600000).toISOString(),
              terminal: 'T5',
            },
            airline: { code: 'BA', name: 'British Airways' },
            flightNumber: 'BA 178',
            duration: 450,
            aircraft: 'Boeing 777-300ER',
          },
        ],
        totalPrice: 678,
        currency: 'USD',
        cabinClass: 'economy',
        fareRules: { refundable: true, changeable: true, cancellationFee: 0 },
        baggage: { carryOn: 1, checked: 2, carryOnWeight: 7, checkedWeight: 23 },
        totalDuration: 450,
        stops: 0,
        valueScore: 65,
        fareClass: 'Economy Plus',
      },
      totalPaid: 678,
      currency: 'USD',
      bookedAt: new Date(now.getTime() - 30 * 86400000).toISOString(),
      priceHistory: [],
      priceTracking: false,
    },
  ];
}

// ─── Popular Routes ───

export const POPULAR_ROUTES = [
  { from: 'JFK', to: 'LAX', price: 189, label: 'New York → Los Angeles' },
  { from: 'SFO', to: 'ORD', price: 156, label: 'San Francisco → Chicago' },
  { from: 'MIA', to: 'JFK', price: 134, label: 'Miami → New York' },
  { from: 'LAX', to: 'LHR', price: 412, label: 'Los Angeles → London' },
  { from: 'JFK', to: 'CDG', price: 389, label: 'New York → Paris' },
  { from: 'SFO', to: 'NRT', price: 534, label: 'San Francisco → Tokyo' },
];
