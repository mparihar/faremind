// ═══════════════════════════════════════════════
// Travel DNA Service — Phase 2
// Separate domestic/international thresholds
// User preference feedback (Accurate / Not Me)
// ═══════════════════════════════════════════════

import { prisma } from '@/lib/db';

// ── Types ────────────────────────────────────────────────────────────────────

type ProfileType = 'DOMESTIC' | 'INTERNATIONAL';
type DnaStatus = 'LEARNING' | 'ACTIVE';

interface ExtractedPreference {
  category: string;
  key: string;
  label: string;
}

interface PreferenceAccumulator {
  [category: string]: {
    [key: string]: { label: string; count: number; lastSeen: Date };
  };
}

export interface TravelDnaPreferenceItem {
  id?: string;
  label: string;
  score: number;
  confidenceLabel: string;
  occurrenceCount: number;
  totalCount: number;
  userValidated: boolean;
  rejectedByUser: boolean;
}

export interface TravelDnaProfileData {
  profileType: ProfileType;
  status: DnaStatus;
  confirmedBookingCount: number;
  minBookingsRequired: number;
  confidenceScore: number;
  preferences: Record<string, TravelDnaPreferenceItem[]>;
}

export interface TravelDnaResponse {
  enabled: boolean;
  status: DnaStatus;
  userFirstName: string | null;
  confirmedBookingCount: number;
  minBookingsRequired: number;
  confidenceScore: number;
  message: string;
  profiles: {
    domestic?: TravelDnaProfileData;
    international?: TravelDnaProfileData;
  };
  showLearningState: boolean;
  showConfidenceScore: boolean;
  domesticRequiredBookings: number;
  internationalRequiredBookings: number;
}

export interface TravelDnaRecommendationContext {
  active: boolean;
  profileType: ProfileType;
  preferences: Record<string, TravelDnaPreferenceItem[]>;
}

// ── Confidence Label Derivation ──────────────────────────────────────────────

function getConfidenceLabel(score: number): string {
  if (score >= 70) return 'High Confidence';
  if (score >= 40) return 'Medium Confidence';
  return 'Learning';
}

// ── Config ───────────────────────────────────────────────────────────────────

export async function getTravelDnaConfig() {
  // Singleton pattern — get first row, or create with defaults
  let config = await (prisma as any).travelDnaConfig.findFirst();
  if (!config) {
    config = await (prisma as any).travelDnaConfig.create({
      data: {
        travelDnaEnabled: true,
        minConfirmedBookingsRequired: 5,
        domesticRequiredBookings: 5,
        internationalRequiredBookings: 5,
        domesticProfileEnabled: true,
        internationalProfileEnabled: true,
        dnaSearchTopN: 30,
        showLearningState: true,
        showConfidenceScore: true,
      },
    });
  }
  // Backfill: if config exists but doesn't have the new fields yet
  if (config.domesticRequiredBookings === undefined || config.domesticRequiredBookings === null) {
    config = await (prisma as any).travelDnaConfig.update({
      where: { id: config.id },
      data: {
        domesticRequiredBookings: config.minConfirmedBookingsRequired || 5,
        internationalRequiredBookings: config.minConfirmedBookingsRequired || 5,
      },
    });
  }
  // Backfill: dnaSearchTopN
  if (config.dnaSearchTopN === undefined || config.dnaSearchTopN === null) {
    config = await (prisma as any).travelDnaConfig.update({
      where: { id: config.id },
      data: { dnaSearchTopN: 30 },
    });
  }
  return config;
}

export async function updateTravelDnaConfig(
  data: {
    travelDnaEnabled?: boolean;
    minConfirmedBookingsRequired?: number;
    domesticRequiredBookings?: number;
    internationalRequiredBookings?: number;
    domesticProfileEnabled?: boolean;
    internationalProfileEnabled?: boolean;
    dnaSearchTopN?: number;
    showLearningState?: boolean;
    showConfidenceScore?: boolean;
  },
  adminId: string,
  adminEmail: string,
) {
  const config = await getTravelDnaConfig();
  return (prisma as any).travelDnaConfig.update({
    where: { id: config.id },
    data: {
      ...data,
      updatedByAdminId: adminId,
      updatedByAdminEmail: adminEmail,
    },
  });
}

// ── Get Confirmed Bookings ───────────────────────────────────────────────────

async function getConfirmedBookings(userId: string) {
  return (prisma as any).masterBooking.findMany({
    where: {
      userId,
      OR: [
        { bookingStatus: 'CONFIRMED' },
        { bookingStatus: 'TICKETED' },
        { bookingStatus: 'COMPLETED' },
        { ticketingStatus: 'ISSUED' },
      ],
    },
    include: {
      journeys: {
        include: {
          segments: true,
        },
      },
      segments: true,
      passengers: true,
      seats: true,
      baggage: true,
      meals: true,
      addons: true,
      pnrs: true,
    },
    orderBy: { createdAt: 'desc' },
  });
}

// ── Trip Classification ──────────────────────────────────────────────────────

function classifyTripCategory(booking: any): ProfileType {
  const originCountry = booking.originCountry;
  const destCountry = booking.destinationCountry;

  // If countries available at booking level
  if (originCountry && destCountry) {
    return originCountry === destCountry ? 'DOMESTIC' : 'INTERNATIONAL';
  }

  // Check journey-level countries
  if (booking.journeys?.length) {
    for (const journey of booking.journeys) {
      const jOrigin = journey.originCountry;
      const jDest = journey.destinationCountry;
      if (jOrigin && jDest && jOrigin !== jDest) return 'INTERNATIONAL';
    }
    // Check segment-level countries
    for (const journey of booking.journeys) {
      for (const segment of journey.segments || []) {
        const sOrigin = segment.originCountry;
        const sDest = segment.destinationCountry;
        if (sOrigin && sDest && sOrigin !== sDest) return 'INTERNATIONAL';
      }
    }
  }

  // Default to domestic if all countries match or unavailable
  return 'DOMESTIC';
}

// ── Departure Time Bucket ────────────────────────────────────────────────────

function getDepartureTimeBucket(hour: number): { key: string; label: string } {
  if (hour >= 5 && hour < 12) return { key: 'morning', label: 'Morning Flight' };
  if (hour >= 12 && hour < 17) return { key: 'afternoon', label: 'Afternoon Flight' };
  if (hour >= 17 && hour < 21) return { key: 'evening', label: 'Evening Flight' };
  return { key: 'night', label: 'Night Flight' };
}

// ── Booking Window Bucket ────────────────────────────────────────────────────

function getBookingWindowBucket(daysBeforeTravel: number): { key: string; label: string } {
  if (daysBeforeTravel <= 3) return { key: 'last_minute', label: 'Last Minute (0-3 days)' };
  if (daysBeforeTravel <= 14) return { key: '1_2_weeks', label: '1-2 Weeks Before' };
  if (daysBeforeTravel <= 42) return { key: '2_6_weeks', label: '2-6 Weeks Before' };
  return { key: '6_plus_weeks', label: '6+ Weeks Before' };
}

// ── Travel Party Pattern ─────────────────────────────────────────────────────

function getTravelPartyPattern(passengers: any[]): { key: string; label: string } {
  if (!passengers?.length || passengers.length === 1) return { key: 'solo', label: 'Solo' };
  
  const adults = passengers.filter((p: any) => 
    !p.passengerType || p.passengerType.toUpperCase() === 'ADULT'
  ).length;
  const children = passengers.filter((p: any) => 
    p.passengerType?.toUpperCase() === 'CHILD' || p.passengerType?.toUpperCase() === 'INFANT'
  ).length;

  if (children > 0) return { key: 'family', label: 'Family' };
  if (adults === 2) return { key: 'couple', label: 'Couple' };
  if (adults > 2) return { key: 'group', label: 'Group' };
  return { key: 'solo', label: 'Solo' };
}

// ── Cabin Label ──────────────────────────────────────────────────────────────

function normalizeCabin(cabin: string): { key: string; label: string } {
  const c = (cabin || 'economy').toLowerCase();
  if (c.includes('first')) return { key: 'first', label: 'First' };
  if (c.includes('business')) return { key: 'business', label: 'Business' };
  if (c.includes('premium')) return { key: 'premium_economy', label: 'Premium Economy' };
  return { key: 'economy', label: 'Economy' };
}

// ── Extract Preferences from a Single Booking ────────────────────────────────

function extractBookingPreferences(booking: any): ExtractedPreference[] {
  const prefs: ExtractedPreference[] = [];

  // Airline Preference — from segments
  const airlineSeen = new Set<string>();
  for (const segment of booking.segments || []) {
    const code = segment.airlineCode;
    const name = segment.airlineName || code;
    if (code && !airlineSeen.has(code)) {
      airlineSeen.add(code);
      prefs.push({ category: 'airline', key: code, label: name });
    }
  }

  // Connection / Stop Airport Preference — only track intermediate stops, NOT origin/destination
  // Build set of origin/destination airports to exclude
  const excludeAirports = new Set<string>();
  if (booking.originAirport) excludeAirports.add(booking.originAirport);
  if (booking.destinationAirport) excludeAirports.add(booking.destinationAirport);
  for (const journey of booking.journeys || []) {
    if (journey.originAirport) excludeAirports.add(journey.originAirport);
    if (journey.destinationAirport) excludeAirports.add(journey.destinationAirport);
  }

  const connectionSeen = new Set<string>();
  // Check journey-level segments for connections
  for (const journey of booking.journeys || []) {
    const journeySegs = (journey.segments || []);
    if (journeySegs.length > 1) {
      for (let i = 0; i < journeySegs.length - 1; i++) {
        const seg = journeySegs[i];
        const arrAirport = seg.destinationAirport || seg.arrivalAirport;
        const arrCity = seg.destinationCity || seg.arrivalCity || '';
        if (arrAirport && !excludeAirports.has(arrAirport) && !connectionSeen.has(arrAirport)) {
          connectionSeen.add(arrAirport);
          prefs.push({
            category: 'connection_airport',
            key: arrAirport,
            label: `${arrAirport}${arrCity ? ` (${arrCity})` : ''}`,
          });
        }
      }
    }
  }
  // Also check top-level segments for connections
  const allSegments = booking.segments || [];
  if (allSegments.length > 1) {
    for (let i = 0; i < allSegments.length - 1; i++) {
      const seg = allSegments[i];
      const arrAirport = seg.destinationAirport;
      const arrCity = seg.destinationCity || '';
      if (arrAirport && !excludeAirports.has(arrAirport) && !connectionSeen.has(arrAirport)) {
        connectionSeen.add(arrAirport);
        prefs.push({
          category: 'connection_airport',
          key: arrAirport,
          label: `${arrAirport}${arrCity ? ` (${arrCity})` : ''}`,
        });
      }
    }
  }

  // Cabin Preference
  const cabinSeen = new Set<string>();
  for (const segment of booking.segments || []) {
    if (segment.cabin) {
      const cab = normalizeCabin(segment.cabin);
      if (!cabinSeen.has(cab.key)) {
        cabinSeen.add(cab.key);
        prefs.push({ category: 'cabin', key: cab.key, label: cab.label });
      }
    }
  }

  // Stops Preference — from journeys
  for (const journey of booking.journeys || []) {
    const stops = journey.totalStops ?? 0;
    if (stops === 0) {
      prefs.push({ category: 'stops', key: 'nonstop', label: 'Nonstop' });
    } else if (stops === 1) {
      prefs.push({ category: 'stops', key: '1_stop', label: '1 Stop' });
    } else {
      prefs.push({ category: 'stops', key: '2_plus_stops', label: '2+ Stops' });
    }
  }

  // Departure Time Preference
  for (const journey of booking.journeys || []) {
    if (journey.departureDateTime) {
      const hour = new Date(journey.departureDateTime).getHours();
      const bucket = getDepartureTimeBucket(hour);
      prefs.push({ category: 'departure_time', key: bucket.key, label: bucket.label });
    }
  }

  // Seat Preference
  const seats = booking.seats || [];
  if (seats.length > 0) {
    for (const seat of seats) {
      if (seat.seatType && seat.seatType !== 'unknown') {
        const seatType = seat.seatType.toLowerCase();
        let seatKey = seatType;
        let seatLabel = seatType.charAt(0).toUpperCase() + seatType.slice(1);
        if (seatType.includes('window')) { seatKey = 'window'; seatLabel = 'Window Seat'; }
        else if (seatType.includes('aisle')) { seatKey = 'aisle'; seatLabel = 'Aisle Seat'; }
        else if (seatType.includes('middle')) { seatKey = 'middle'; seatLabel = 'Middle Seat'; }
        else if (seatType.includes('extra') || seatType.includes('legroom')) { seatKey = 'extra_legroom'; seatLabel = 'Extra Legroom Seat'; }
        prefs.push({ category: 'seat', key: seatKey, label: seatLabel });
      } else if (seat.seatNumber) {
        prefs.push({ category: 'seat', key: 'pre_selected', label: 'Pre-selected Seat' });
      }
    }
  } else {
    prefs.push({ category: 'seat', key: 'no_seat_selected', label: 'No Seat Pre-selected' });
  }

  // Baggage Preference
  const checkedBags = (booking.baggage || []).filter(
    (b: any) => b.baggageType === 'checked' && b.quantity > 0
  );
  if (checkedBags.length > 0) {
    // Any checked bag with a price > 0 is a purchased extra bag
    const hasPaidBag = checkedBags.some((b: any) => parseFloat(b.baggagePrice || '0') > 0);
    const totalQty = checkedBags.reduce((sum: number, b: any) => sum + (b.quantity || 1), 0);
    if (hasPaidBag || totalQty > 1) {
      prefs.push({ category: 'baggage', key: 'extra_baggage', label: 'Extra Baggage' });
    } else {
      prefs.push({ category: 'baggage', key: 'checked_bag', label: '1 Checked Bag' });
    }
  } else {
    prefs.push({ category: 'baggage', key: 'carry_on_only', label: 'Carry-on Only' });
  }

  // Travel Insurance Preference
  const hasInsurance = (booking.addons || []).some(
    (a: any) => a.addonType?.toLowerCase().includes('insurance') || a.addonName?.toLowerCase().includes('insurance')
  );
  prefs.push({
    category: 'insurance',
    key: hasInsurance ? 'with_insurance' : 'no_insurance',
    label: hasInsurance ? 'Travel Insurance Added' : 'No Travel Insurance',
  });

  // Price Drop Protection Preference
  const hasPriceProtection = (booking.addons || []).some(
    (a: any) =>
      a.addonType?.toLowerCase().includes('price') ||
      a.addonType?.toLowerCase().includes('protection') ||
      a.addonName?.toLowerCase().includes('price') ||
      a.addonName?.toLowerCase().includes('protection')
  );
  prefs.push({
    category: 'price_protection',
    key: hasPriceProtection ? 'with_protection' : 'no_protection',
    label: hasPriceProtection ? 'Price Drop Protection Added' : 'No Price Drop Protection',
  });

  // Meal Preference
  const meals = booking.meals || [];
  if (meals.length > 0) {
    const mealSeen = new Set<string>();
    for (const meal of meals) {
      const mealCode = meal.mealCode || meal.mealLabel || '';
      if (mealCode && mealCode !== 'STANDARD' && mealCode !== 'NONE' && !mealSeen.has(mealCode)) {
        mealSeen.add(mealCode);
        const label = meal.mealLabel || mealCode;
        prefs.push({ category: 'meal', key: mealCode.toLowerCase(), label: `${label} Meal` });
      }
    }
    if (mealSeen.size === 0) {
      prefs.push({ category: 'meal', key: 'standard', label: 'Standard Meal' });
    }
  } else {
    prefs.push({ category: 'meal', key: 'no_meal_selected', label: 'No Meal Pre-selected' });
  }

  // Fare Flexibility Preference
  for (const pnr of booking.pnrs || []) {
    if (pnr.refundable && pnr.changeable) {
      prefs.push({ category: 'fare_flexibility', key: 'flex', label: 'Flex / Refundable' });
    } else if (pnr.changeable) {
      prefs.push({ category: 'fare_flexibility', key: 'standard', label: 'Standard (Changeable)' });
    } else {
      prefs.push({ category: 'fare_flexibility', key: 'basic', label: 'Basic (Non-refundable)' });
    }
  }

  // Travel Party Pattern
  const partyPattern = getTravelPartyPattern(booking.passengers);
  prefs.push({ category: 'travel_party', key: partyPattern.key, label: partyPattern.label });

  // Booking Window
  if (booking.createdAt && booking.departureDate) {
    const created = new Date(booking.createdAt);
    const departure = new Date(booking.departureDate);
    const daysBefore = Math.max(0, Math.round((departure.getTime() - created.getTime()) / (1000 * 60 * 60 * 24)));
    const windowBucket = getBookingWindowBucket(daysBefore);
    prefs.push({ category: 'booking_window', key: windowBucket.key, label: windowBucket.label });
  }

  return prefs;
}

// ── Calculate Scores ─────────────────────────────────────────────────────────

function calculatePreferenceScores(
  accumulator: PreferenceAccumulator,
  totalBookings: number,
): Array<{
  category: string;
  preferenceKey: string;
  preferenceLabel: string;
  occurrenceCount: number;
  totalCount: number;
  score: number;
  confidenceLabel: string;
  lastSeenAt: Date | null;
}> {
  const results: Array<{
    category: string;
    preferenceKey: string;
    preferenceLabel: string;
    occurrenceCount: number;
    totalCount: number;
    score: number;
    confidenceLabel: string;
    lastSeenAt: Date | null;
  }> = [];

  for (const [category, entries] of Object.entries(accumulator)) {
    const categoryTotal = totalBookings;

    for (const [key, value] of Object.entries(entries)) {
      const score = Math.round((value.count / categoryTotal) * 100);
      const clampedScore = Math.min(100, score);
      results.push({
        category,
        preferenceKey: key,
        preferenceLabel: value.label,
        occurrenceCount: value.count,
        totalCount: categoryTotal,
        score: clampedScore,
        confidenceLabel: getConfidenceLabel(clampedScore),
        lastSeenAt: value.lastSeen,
      });
    }
  }

  // Sort by score descending within each category
  results.sort((a, b) => {
    if (a.category !== b.category) return a.category.localeCompare(b.category);
    return b.score - a.score;
  });

  return results;
}

// ── Generate Travel DNA Profile ──────────────────────────────────────────────

export async function generateTravelDnaProfile(userId: string): Promise<TravelDnaResponse> {
  const config = await getTravelDnaConfig();

  const domesticRequired = config.domesticRequiredBookings ?? config.minConfirmedBookingsRequired ?? 5;
  const internationalRequired = config.internationalRequiredBookings ?? config.minConfirmedBookingsRequired ?? 5;

  if (!config.travelDnaEnabled) {
    return {
      enabled: false,
      status: 'LEARNING',
      userFirstName: null,
      confirmedBookingCount: 0,
      minBookingsRequired: domesticRequired,
      confidenceScore: 0,
      message: 'FAREMIND DNA™ is currently disabled.',
      profiles: {},
      showLearningState: config.showLearningState,
      showConfidenceScore: config.showConfidenceScore,
      domesticRequiredBookings: domesticRequired,
      internationalRequiredBookings: internationalRequired,
    };
  }

  // Get user first name
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { firstName: true },
  });

  const bookings = await getConfirmedBookings(userId);
  const totalBookings = bookings.length;

  // Classify bookings by trip category
  const domesticBookings: any[] = [];
  const internationalBookings: any[] = [];

  for (const booking of bookings) {
    const category = classifyTripCategory(booking);
    if (category === 'DOMESTIC') {
      domesticBookings.push(booking);
    } else {
      internationalBookings.push(booking);
    }
  }

  const profiles: TravelDnaResponse['profiles'] = {};

  // Process domestic profile — uses domestic-specific threshold
  if (config.domesticProfileEnabled) {
    profiles.domestic = await processProfileCategory(
      userId, 'DOMESTIC', domesticBookings, domesticRequired,
    );
  }

  // Process international profile — uses international-specific threshold
  if (config.internationalProfileEnabled) {
    profiles.international = await processProfileCategory(
      userId, 'INTERNATIONAL', internationalBookings, internationalRequired,
    );
  }

  // Global status: ACTIVE if either profile is active
  const domesticActive = profiles.domestic?.status === 'ACTIVE';
  const internationalActive = profiles.international?.status === 'ACTIVE';
  const globalStatus: DnaStatus = (domesticActive || internationalActive) ? 'ACTIVE' : 'LEARNING';

  // Overall confidence = weighted average of both profiles
  const overallConfidence = Math.round(
    ((profiles.domestic?.confidenceScore ?? 0) + (profiles.international?.confidenceScore ?? 0)) /
    ((profiles.domestic ? 1 : 0) + (profiles.international ? 1 : 0) || 1)
  );

  // Build message
  let message: string;
  if (totalBookings === 0) {
    message = 'Your personalized travel intelligence, built from your confirmed booking history.';
  } else if (globalStatus === 'LEARNING') {
    message = 'Your personalized travel intelligence, built from your confirmed booking history.';
  } else {
    message = 'Your personalized travel intelligence, built from your confirmed booking history.';
  }

  return {
    enabled: true,
    status: globalStatus,
    userFirstName: user?.firstName ?? null,
    confirmedBookingCount: totalBookings,
    minBookingsRequired: Math.max(domesticRequired, internationalRequired),
    confidenceScore: overallConfidence,
    message,
    profiles,
    showLearningState: config.showLearningState,
    showConfidenceScore: config.showConfidenceScore,
    domesticRequiredBookings: domesticRequired,
    internationalRequiredBookings: internationalRequired,
  };
}

// ── Process a Single Profile Category ────────────────────────────────────────

async function processProfileCategory(
  userId: string,
  profileType: ProfileType,
  bookings: any[],
  minRequired: number,
): Promise<TravelDnaProfileData> {
  const count = bookings.length;
  const confidence = Math.min(100, Math.round((count / minRequired) * 100));
  const status: DnaStatus = count >= minRequired ? 'ACTIVE' : 'LEARNING';

  // If LEARNING, return empty preferences — do not generate scores
  if (status === 'LEARNING') {
    // Still upsert the profile record for tracking
    await (prisma as any).travelDnaProfile.upsert({
      where: {
        userId_profileType: { userId, profileType },
      },
      create: {
        userId,
        profileType,
        confirmedBookingCount: count,
        minBookingsRequired: minRequired,
        confidenceScore: confidence,
        status,
        generatedAt: new Date(),
      },
      update: {
        confirmedBookingCount: count,
        minBookingsRequired: minRequired,
        confidenceScore: confidence,
        status,
        generatedAt: new Date(),
      },
    });

    return {
      profileType,
      status,
      confirmedBookingCount: count,
      minBookingsRequired: minRequired,
      confidenceScore: confidence,
      preferences: {},
    };
  }

  // ACTIVE — generate preferences
  const accumulator: PreferenceAccumulator = {};

  for (const booking of bookings) {
    const prefs = extractBookingPreferences(booking);
    const bookingDate = booking.createdAt ? new Date(booking.createdAt) : new Date();

    for (const pref of prefs) {
      if (!accumulator[pref.category]) accumulator[pref.category] = {};
      if (!accumulator[pref.category][pref.key]) {
        accumulator[pref.category][pref.key] = { label: pref.label, count: 0, lastSeen: bookingDate };
      }
      accumulator[pref.category][pref.key].count++;
      if (bookingDate > accumulator[pref.category][pref.key].lastSeen) {
        accumulator[pref.category][pref.key].lastSeen = bookingDate;
      }
    }
  }

  // Calculate scores
  const scored = calculatePreferenceScores(accumulator, count);

  // Upsert profile
  const profile = await (prisma as any).travelDnaProfile.upsert({
    where: {
      userId_profileType: { userId, profileType },
    },
    create: {
      userId,
      profileType,
      confirmedBookingCount: count,
      minBookingsRequired: minRequired,
      confidenceScore: confidence,
      status,
      generatedAt: new Date(),
    },
    update: {
      confirmedBookingCount: count,
      minBookingsRequired: minRequired,
      confidenceScore: confidence,
      status,
      generatedAt: new Date(),
    },
  });

  // Load existing preferences to preserve user feedback
  const existingPrefs = await (prisma as any).travelDnaPreference.findMany({
    where: { profileId: profile.id },
  });
  const existingMap = new Map<string, { userValidated: boolean; rejectedByUser: boolean }>();
  for (const ep of existingPrefs) {
    existingMap.set(`${ep.category}:${ep.preferenceKey}`, {
      userValidated: ep.userValidated ?? false,
      rejectedByUser: ep.rejectedByUser ?? false,
    });
  }

  // Delete old preferences for this profile, then insert new (preserving feedback)
  await (prisma as any).travelDnaPreference.deleteMany({
    where: { profileId: profile.id },
  });

  if (scored.length > 0) {
    await (prisma as any).travelDnaPreference.createMany({
      data: scored.map((s) => {
        const existing = existingMap.get(`${s.category}:${s.preferenceKey}`);
        return {
          profileId: profile.id,
          userId,
          profileType,
          category: s.category,
          preferenceKey: s.preferenceKey,
          preferenceLabel: s.preferenceLabel,
          occurrenceCount: s.occurrenceCount,
          totalCount: s.totalCount,
          score: s.score,
          confidenceLabel: s.confidenceLabel,
          lastSeenAt: s.lastSeenAt,
          userValidated: existing?.userValidated ?? false,
          rejectedByUser: existing?.rejectedByUser ?? false,
        };
      }),
    });
  }

  // Re-read preferences from DB to get IDs
  const savedPrefs = await (prisma as any).travelDnaPreference.findMany({
    where: { profileId: profile.id },
    orderBy: { score: 'desc' },
  });

  // Build grouped preferences for response — filter out rejected ones
  const preferences: Record<string, TravelDnaPreferenceItem[]> = {};
  for (const s of savedPrefs) {
    if (s.rejectedByUser) continue; // hide rejected preferences
    if (!preferences[s.category]) preferences[s.category] = [];
    preferences[s.category].push({
      id: s.id,
      label: s.preferenceLabel,
      score: s.score,
      confidenceLabel: s.confidenceLabel || getConfidenceLabel(s.score),
      occurrenceCount: s.occurrenceCount,
      totalCount: s.totalCount,
      userValidated: s.userValidated ?? false,
      rejectedByUser: s.rejectedByUser ?? false,
    });
  }

  return {
    profileType,
    status,
    confirmedBookingCount: count,
    minBookingsRequired: minRequired,
    confidenceScore: confidence,
    preferences,
  };
}

// ── User Preference Feedback ─────────────────────────────────────────────────

export async function submitPreferenceFeedback(
  userId: string,
  preferenceId: string,
  action: 'accurate' | 'not_me',
): Promise<boolean> {
  try {
    const pref = await (prisma as any).travelDnaPreference.findFirst({
      where: { id: preferenceId, userId },
    });
    if (!pref) return false;

    await (prisma as any).travelDnaPreference.update({
      where: { id: preferenceId },
      data: {
        userValidated: action === 'accurate',
        rejectedByUser: action === 'not_me',
      },
    });
    return true;
  } catch (err) {
    console.error('[TravelDNA] Feedback error:', err);
    return false;
  }
}

// ── Get Travel DNA for Recommendation Context (UNCHANGED) ────────────────────
// This function feeds into the AI scoring engine and must NOT be modified.

export async function getTravelDnaForRecommendation(
  userId: string,
  tripCategory: ProfileType,
): Promise<TravelDnaRecommendationContext> {
  const config = await getTravelDnaConfig();
  if (!config.travelDnaEnabled) {
    return { active: false, profileType: tripCategory, preferences: {} };
  }

  const profile = await (prisma as any).travelDnaProfile.findUnique({
    where: {
      userId_profileType: { userId, profileType: tripCategory },
    },
    include: {
      preferences: {
        orderBy: { score: 'desc' },
      },
    },
  });

  if (!profile || profile.status !== 'ACTIVE') {
    return { active: false, profileType: tripCategory, preferences: {} };
  }

  // Group preferences, top 5 per category — exclude rejected ones
  const preferences: Record<string, TravelDnaPreferenceItem[]> = {};
  for (const pref of profile.preferences) {
    if (pref.rejectedByUser) continue; // Don't send rejected prefs to AI
    if (!preferences[pref.category]) preferences[pref.category] = [];
    if (preferences[pref.category].length < 5) {
      preferences[pref.category].push({
        label: pref.preferenceLabel,
        score: pref.score,
        confidenceLabel: pref.confidenceLabel || getConfidenceLabel(pref.score),
        occurrenceCount: pref.occurrenceCount,
        totalCount: pref.totalCount,
        userValidated: pref.userValidated ?? false,
        rejectedByUser: pref.rejectedByUser ?? false,
      });
    }
  }

  return {
    active: true,
    profileType: tripCategory,
    preferences,
  };
}

// ── Get Existing Profile (no regeneration) ───────────────────────────────────

export async function getTravelDnaProfile(userId: string): Promise<TravelDnaResponse | null> {
  return generateTravelDnaProfile(userId);
}
