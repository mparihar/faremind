import { FastifyPluginAsync } from 'fastify';
import { fireNotification } from '../lib/notify';
import { prisma } from '../lib/db';

// FAREMIND_BUNDLE gate — reads from env (loaded via env.ts preloader)
function isBundleEnabled(): boolean {
  const val = process.env.FAREMIND_BUNDLE ?? process.env.NEXT_PUBLIC_FAREMIND_BUNDLE ?? 'false';
  return val.toLowerCase() === 'true';
}

// ── ISO code → full country name mapping for auto-fill ───────────────────────
// The DB may store ISO 2-letter codes (e.g. "IN") but the frontend select
// uses full names (e.g. "India"). This helper normalises the value.
const ISO_TO_COUNTRY: Record<string, string> = {
  AF:'Afghanistan',AL:'Albania',DZ:'Algeria',AD:'Andorra',AO:'Angola',AG:'Antigua and Barbuda',
  AR:'Argentina',AM:'Armenia',AU:'Australia',AT:'Austria',AZ:'Azerbaijan',
  BS:'Bahamas',BH:'Bahrain',BD:'Bangladesh',BB:'Barbados',BY:'Belarus',BE:'Belgium',BZ:'Belize',
  BJ:'Benin',BT:'Bhutan',BO:'Bolivia',BA:'Bosnia and Herzegovina',BW:'Botswana',BR:'Brazil',
  BN:'Brunei',BG:'Bulgaria',BF:'Burkina Faso',BI:'Burundi',
  CV:'Cabo Verde',KH:'Cambodia',CM:'Cameroon',CA:'Canada',CF:'Central African Republic',TD:'Chad',
  CL:'Chile',CN:'China',CO:'Colombia',KM:'Comoros',CG:'Congo (Brazzaville)',CD:'Congo (Kinshasa)',
  CR:'Costa Rica',HR:'Croatia',CU:'Cuba',CY:'Cyprus',CZ:'Czech Republic',CI:"Côte d'Ivoire",
  DK:'Denmark',DJ:'Djibouti',DM:'Dominica',DO:'Dominican Republic',
  TL:'East Timor',EC:'Ecuador',EG:'Egypt',SV:'El Salvador',GQ:'Equatorial Guinea',ER:'Eritrea',
  EE:'Estonia',SZ:'Eswatini',ET:'Ethiopia',
  FJ:'Fiji',FI:'Finland',FR:'France',
  GA:'Gabon',GM:'Gambia',GE:'Georgia',DE:'Germany',GH:'Ghana',GR:'Greece',GD:'Grenada',GT:'Guatemala',
  GN:'Guinea',GW:'Guinea-Bissau',GY:'Guyana',
  HT:'Haiti',HN:'Honduras',HK:'Hong Kong',HU:'Hungary',
  IS:'Iceland',IN:'India',ID:'Indonesia',IR:'Iran',IQ:'Iraq',IE:'Ireland',IL:'Israel',IT:'Italy',
  JM:'Jamaica',JP:'Japan',JO:'Jordan',
  KZ:'Kazakhstan',KE:'Kenya',KI:'Kiribati',XK:'Kosovo',KW:'Kuwait',KG:'Kyrgyzstan',
  LA:'Laos',LV:'Latvia',LB:'Lebanon',LS:'Lesotho',LR:'Liberia',LY:'Libya',LI:'Liechtenstein',
  LT:'Lithuania',LU:'Luxembourg',
  MO:'Macau',MG:'Madagascar',MW:'Malawi',MY:'Malaysia',MV:'Maldives',ML:'Mali',MT:'Malta',
  MH:'Marshall Islands',MR:'Mauritania',MU:'Mauritius',MX:'Mexico',FM:'Micronesia',MD:'Moldova',
  MC:'Monaco',MN:'Mongolia',ME:'Montenegro',MA:'Morocco',MZ:'Mozambique',MM:'Myanmar',
  NA:'Namibia',NR:'Nauru',NP:'Nepal',NL:'Netherlands',NZ:'New Zealand',NI:'Nicaragua',NE:'Niger',
  NG:'Nigeria',KP:'North Korea',MK:'North Macedonia',NO:'Norway',
  OM:'Oman',
  PK:'Pakistan',PW:'Palau',PS:'Palestine',PA:'Panama',PG:'Papua New Guinea',PY:'Paraguay',PE:'Peru',
  PH:'Philippines',PL:'Poland',PT:'Portugal',
  QA:'Qatar',
  RO:'Romania',RU:'Russia',RW:'Rwanda',
  KN:'Saint Kitts and Nevis',LC:'Saint Lucia',VC:'Saint Vincent',WS:'Samoa',SM:'San Marino',
  ST:'São Tomé and Príncipe',SA:'Saudi Arabia',SN:'Senegal',RS:'Serbia',SC:'Seychelles',SL:'Sierra Leone',
  SG:'Singapore',SK:'Slovakia',SI:'Slovenia',SB:'Solomon Islands',SO:'Somalia',ZA:'South Africa',
  KR:'South Korea',SS:'South Sudan',ES:'Spain',LK:'Sri Lanka',SD:'Sudan',SR:'Suriname',
  SE:'Sweden',CH:'Switzerland',SY:'Syria',
  TW:'Taiwan',TJ:'Tajikistan',TZ:'Tanzania',TH:'Thailand',TG:'Togo',TO:'Tonga',
  TT:'Trinidad and Tobago',TN:'Tunisia',TR:'Turkey',TM:'Turkmenistan',TV:'Tuvalu',
  UG:'Uganda',UA:'Ukraine',AE:'United Arab Emirates',GB:'United Kingdom',US:'United States',UY:'Uruguay',UZ:'Uzbekistan',
  VU:'Vanuatu',VA:'Vatican City',VE:'Venezuela',VN:'Vietnam',
  YE:'Yemen',ZM:'Zambia',ZW:'Zimbabwe',
};

/** Normalise a nationality/passportCountry value: if it's a 2-letter ISO code, convert to full name */
function normaliseCountry(val: string | null | undefined): string {
  if (!val) return '';
  const trimmed = val.trim();
  // If it's exactly 2 uppercase chars, treat as ISO code
  if (trimmed.length === 2 && /^[A-Z]{2}$/.test(trimmed)) {
    return ISO_TO_COUNTRY[trimmed] ?? trimmed;
  }
  return trimmed;
}

interface PassengerInfo {
  id?: string; firstName: string; lastName: string; email?: string;
  dateOfBirth?: string; passportNumber?: string; nationality?: string;
  type?: 'adult' | 'child' | 'infant';
}

interface PassengerPricing {
  id: string; type: 'adult' | 'child' | 'infant';
}

const plugin: FastifyPluginAsync = async (fastify) => {
  fastify.post('/passengers/save', async (request, reply) => {
    try {
      const { sessionId, passengers } = request.body as any;
      if (!sessionId) return reply.code(400).send({ error: 'sessionId is required' });
      if (!Array.isArray(passengers) || passengers.length === 0) return reply.code(400).send({ error: 'passengers must be a non-empty array' });
      for (const p of passengers as PassengerInfo[]) {
        if (!p.firstName || !p.lastName) return reply.code(400).send({ error: 'Each passenger must have firstName and lastName' });
      }
      return { success: true, sessionId };
    } catch (err) {
      console.error('[checkout] POST /passengers/save error:', err);
      reply.code(500).send({ error: 'Internal server error' });
    }
  });

  // ── Passenger Lookup: by email (Primary Contact auto-fill) ────────────────
  fastify.post('/passengers/lookup-by-email', async (request, reply) => {
    try {
      const { email } = request.body as { email?: string };
      if (!email || !email.includes('@')) {
        return reply.code(400).send({ error: 'A valid email is required' });
      }

      const emailLower = email.toLowerCase().trim();

      // 1. Check BookingPassenger table (most detailed — has passport info)
      const bookingPax = await prisma.bookingPassenger.findFirst({
        where: { email: { equals: emailLower, mode: 'insensitive' } },
        orderBy: { createdAt: 'desc' },
      });

      if (bookingPax) {
        return {
          found: true,
          source: 'booking',
          data: {
            firstName: bookingPax.firstName,
            middleName: bookingPax.middleName ?? '',
            lastName: bookingPax.lastName,
            phone: bookingPax.phone ?? '',
            gender: bookingPax.gender ?? '',
            dateOfBirth: bookingPax.dateOfBirth
              ? bookingPax.dateOfBirth.toISOString().split('T')[0]
              : '',
            nationality: normaliseCountry(bookingPax.nationality),
            passportCountry: normaliseCountry(bookingPax.passportCountry),
            passportNumber: bookingPax.passportNumber ?? '',
            passportExpiry: bookingPax.passportExpiry
              ? bookingPax.passportExpiry.toISOString().split('T')[0]
              : '',
          },
        };
      }

      // 2. Fallback: check User table (has name + phone, but no passport)
      const user = await prisma.user.findUnique({
        where: { email: emailLower },
      });

      if (user) {
        return {
          found: true,
          source: 'user',
          data: {
            firstName: user.firstName,
            middleName: '',
            lastName: user.lastName,
            phone: user.phone ?? '',
            gender: '',
            dateOfBirth: '',
            nationality: '',
            passportCountry: '',
            passportNumber: '',
            passportExpiry: '',
          },
        };
      }

      return { found: false };
    } catch (err) {
      fastify.log.error({ err }, '[checkout] POST /passengers/lookup-by-email error');
      reply.code(500).send({ error: 'Internal server error' });
    }
  });

  // ── Passenger Lookup: by name (Traveler 2+ auto-fill) ─────────────────────
  fastify.post('/passengers/lookup-by-name', async (request, reply) => {
    try {
      const { firstName, lastName } = request.body as { firstName?: string; lastName?: string };
      if (!firstName || !lastName || firstName.length < 2 || lastName.length < 2) {
        return reply.code(400).send({ error: 'firstName and lastName (min 2 chars each) are required' });
      }

      const bookingPax = await prisma.bookingPassenger.findFirst({
        where: {
          firstName: { equals: firstName.trim(), mode: 'insensitive' },
          lastName: { equals: lastName.trim(), mode: 'insensitive' },
        },
        orderBy: { createdAt: 'desc' },
      });

      if (bookingPax) {
        return {
          found: true,
          data: {
            middleName: bookingPax.middleName ?? '',
            email: bookingPax.email ?? '',
            phone: bookingPax.phone ?? '',
            gender: bookingPax.gender ?? '',
            dateOfBirth: bookingPax.dateOfBirth
              ? bookingPax.dateOfBirth.toISOString().split('T')[0]
              : '',
            nationality: normaliseCountry(bookingPax.nationality),
            passportCountry: normaliseCountry(bookingPax.passportCountry),
            passportNumber: bookingPax.passportNumber ?? '',
            passportExpiry: bookingPax.passportExpiry
              ? bookingPax.passportExpiry.toISOString().split('T')[0]
              : '',
          },
        };
      }

      return { found: false };
    } catch (err) {
      fastify.log.error({ err }, '[checkout] POST /passengers/lookup-by-name error');
      reply.code(500).send({ error: 'Internal server error' });
    }
  });

  fastify.get('/seats/map', async (request, reply) => {
    try {
      const { origin, destination, flightNumber } = request.query as Record<string, string>;
      if (!origin || !destination || !flightNumber) return reply.code(400).send({ error: 'origin, destination, and flightNumber are required' });

      const seatLetters = ['A', 'B', 'C', 'D', 'E', 'F'];
      const seatTypes: Record<string, 'window' | 'middle' | 'aisle'> = { A: 'window', B: 'middle', C: 'aisle', D: 'aisle', E: 'middle', F: 'window' };

      const rows = [];
      for (let row = 1; row <= 30; row++) {
        let priceUsd = 0;
        if (row <= 5) priceUsd = 25;
        else if (row <= 10) priceUsd = 15;
        rows.push({ row, seats: seatLetters.map((letter) => ({ seat: `${row}${letter}`, available: Math.random() > 0.3, type: seatTypes[letter], priceUsd })) });
      }

      return { cabin: 'economy', rows };
    } catch (err) {
      console.error('[checkout] GET /seats/map error:', err);
      reply.code(500).send({ error: 'Internal server error' });
    }
  });

  fastify.post('/seats/select', async (request, reply) => {
    try {
      const { sessionId, selections } = request.body as any;
      if (!sessionId) return reply.code(400).send({ error: 'sessionId is required' });
      if (!Array.isArray(selections)) return reply.code(400).send({ error: 'selections must be an array' });
      return { success: true, selections };
    } catch (err) {
      console.error('[checkout] POST /seats/select error:', err);
      reply.code(500).send({ error: 'Internal server error' });
    }
  });

  fastify.post('/meals/select', async (request, reply) => {
    try {
      const { sessionId, meals } = request.body as any;
      if (!sessionId) return reply.code(400).send({ error: 'sessionId is required' });
      if (!Array.isArray(meals)) return reply.code(400).send({ error: 'meals must be an array' });
      return { success: true };
    } catch (err) {
      console.error('[checkout] POST /meals/select error:', err);
      reply.code(500).send({ error: 'Internal server error' });
    }
  });

  fastify.post('/baggage/select', async (request, reply) => {
    try {
      const { sessionId, extraBags } = request.body as any;
      if (!sessionId) return reply.code(400).send({ error: 'sessionId is required' });
      if (typeof extraBags !== 'number' || extraBags < 0) return reply.code(400).send({ error: 'extraBags must be a non-negative number' });
      return { success: true, extraBags, baggageFee: extraBags * 35 };
    } catch (err) {
      console.error('[checkout] POST /baggage/select error:', err);
      reply.code(500).send({ error: 'Internal server error' });
    }
  });

  fastify.post('/protection/select', async (request, reply) => {
    try {
      const { sessionId, travelInsurance, totalFare } = request.body as any;
      if (!sessionId) return reply.code(400).send({ error: 'sessionId is required' });
      // FAREMIND_BUNDLE gate: zero out when disabled
      if (!isBundleEnabled()) return { success: true, protectionFee: 0, insuranceFee: 0 };
      const insuranceFee = travelInsurance && totalFare ? Math.round(totalFare * 0.04) : 0;
      return { success: true, protectionFee: 0, insuranceFee };
    } catch (err) {
      console.error('[checkout] POST /protection/select error:', err);
      reply.code(500).send({ error: 'Internal server error' });
    }
  });

  fastify.post('/pricing/recalculate', async (request, reply) => {
    try {
      const { selectedFare, passengers, extraBags, priceProtection, travelInsurance, seatSelections, currency } = request.body as any;
      if (!selectedFare || !Array.isArray(passengers) || passengers.length === 0) return reply.code(400).send({ error: 'selectedFare and passengers are required' });

      // Use actual provider base fare / tax split when available, else fall back to estimated rate
      const perPersonBase: number = selectedFare.basePrice ?? 0;
      const providerBase: number | undefined = selectedFare.providerBaseFare;
      const providerTax: number | undefined = selectedFare.providerTaxAmount;

      const perPassenger = (passengers as PassengerPricing[]).map((pax, idx) => {
        const effectiveBase = perPersonBase;
        // Use real provider split if available
        const baseFare = providerBase != null ? providerBase : Math.round(effectiveBase * 0.844);
        const taxes = providerTax != null ? providerTax : Math.round(effectiveBase * 0.156);
        return {
          passengerId: pax.id ?? `pax_${idx}`,
          type: pax.type ?? 'adult',
          baseFare,
          taxes,
          subtotal: Math.round(effectiveBase),
        };
      });

      const seatFees: number = Array.isArray(seatSelections) ? (seatSelections as { priceUsd: number }[]).reduce((sum, s) => sum + (s.priceUsd ?? 0), 0) : 0;
      const baggageFees: number = typeof extraBags === 'number' && extraBags > 0 ? extraBags * 35 : 0;
      // FAREMIND_BUNDLE gate: zero out protection/insurance when disabled
      const protectionFee: number = !isBundleEnabled() ? 0 : priceProtection ? (selectedFare.protectionFee ?? 0) : 0;
      const insuranceFee: number = !isBundleEnabled() ? 0 : travelInsurance ? Math.round((selectedFare.totalPrice ?? 0) * 0.04) : 0;
      const serviceFee: number = Math.round((selectedFare.totalPrice ?? 0) * 0.015);
      const passengerSubtotal = perPassenger.reduce((sum, p) => sum + p.subtotal, 0);
      const subtotal = passengerSubtotal + seatFees + baggageFees + protectionFee + insuranceFee + serviceFee;

      return { perPassenger, seatFees, mealFees: 0, baggageFees, protectionFee, insuranceFee, serviceFee, subtotal, total: subtotal, currency: currency ?? 'USD' };
    } catch (err) {
      console.error('[checkout] POST /pricing/recalculate error:', err);
      reply.code(500).send({ error: 'Internal server error' });
    }
  });

  // ── Payment and booking routes removed ───────────────────────────────────
  // Payment processing (Stripe) and booking confirmation (Duffel) are handled
  // by the Next.js API routes at:
  //   POST /api/checkout/payment/create-intent  → real Stripe PaymentIntent
  //   POST /api/checkout/payment/confirm        → real Stripe confirmation
  //   POST /api/checkout/bookings/confirm       → real Duffel order + Stripe capture


  fastify.post('/notifications/booking-confirm', async (request, reply) => {
    try {
      const {
        email, pnr, bookingId, paymentIntentId,
        customerName, passengerNames, passengers: passengersDetail,
        total, currency, routeLabel,
        airline, fareClass, last4,
        pricing: pricingInput,
        agentEmail, agentName,
      } = request.body as any;
      // Only pnr is required — customer email can be absent and admin still gets notified
      if (!pnr) return reply.code(400).send({ error: 'pnr is required' });

      // Parse origin / destination from routeLabel (e.g. "DFW ⇄ DEL" or "JFK → LHR")
      const routeParts = (routeLabel ?? '').split(/\s*[⇄→]\s*/);
      const origin      = routeParts[0]?.trim() ?? '';
      const destination = routeParts[1]?.trim() ?? '';

      const cur = currency ?? 'USD';
      const fmt = (n: number) => new Intl.NumberFormat('en-US', {
        style: 'currency', currency: cur, maximumFractionDigits: 0,
      }).format(n || 0);

      const totalAmount = fmt(Number(total) || 0);

      const confirmedAt = new Date().toLocaleString('en-US', {
        dateStyle: 'medium', timeStyle: 'short',
      });

      // Build passengers array expected by templates — use full detail if provided
      const passengersArr = Array.isArray(passengersDetail) && passengersDetail.length > 0
        ? passengersDetail
        : (Array.isArray(passengerNames) ? passengerNames : [passengerNames])
            .filter(Boolean)
            .map((name: string) => ({ name, type: 'Adult' }));

      // ── Build structured price breakdown for email templates ──────────────
      const pricePerPassenger = (pricingInput?.perPassenger ?? []).map((p: any, i: number) => ({
        name:  p.name ?? passengersArr[i]?.name ?? `Passenger ${i + 1}`,
        type:  p.type === 'child' ? 'Child' : 'Adult',
        fare:  fmt(Number(p.fare) || 0),
      }));

      const addOns: { label: string; amount: string; highlight?: boolean }[] = [];
      if ((pricingInput?.seatFees      ?? 0) > 0) addOns.push({ label: 'Seat fees',             amount: fmt(pricingInput.seatFees) });
      if ((pricingInput?.mealFees      ?? 0) > 0) addOns.push({ label: 'Meal fees',              amount: fmt(pricingInput.mealFees) });
      if ((pricingInput?.baggageFees   ?? 0) > 0) addOns.push({ label: 'Extra bags',             amount: fmt(pricingInput.baggageFees) });
      if ((pricingInput?.protectionFee ?? 0) > 0) addOns.push({ label: 'Price Drop Protection',  amount: fmt(pricingInput.protectionFee), highlight: true });
      if ((pricingInput?.insuranceFee  ?? 0) > 0) addOns.push({ label: 'Travel insurance',       amount: fmt(pricingInput.insuranceFee) });
      if ((pricingInput?.serviceFee    ?? 0) > 0) addOns.push({ label: 'Service fee',            amount: fmt(pricingInput.serviceFee) });

      const hasPriceBreakdown = pricePerPassenger.length > 0;

      // Fire via direct Brevo — no Python micro-service dependency
      fireNotification({
        event_type: 'BOOKING_CONFIRMED',
        booking_id: bookingId ?? pnr,
        customer_email: email,
        data: {
          booking_reference: pnr,
          pnr,
          provider_booking_id: bookingId ?? pnr,
          customer_name:  customerName ?? passengersArr[0]?.name ?? 'Traveler',
          customer_email: email,
          origin,
          destination,
          route:          routeLabel ?? `${origin} → ${destination}`,
          airline:        airline ?? '',
          fare_class:     fareClass ?? '',
          passengers:     passengersArr,
          total_amount:   totalAmount,
          total_charged:  total,
          currency:       cur,
          card_last4:     `•••• ${last4 ?? '****'}`,
          confirmed_at:   confirmedAt,
          payment_intent_id: paymentIntentId ?? '',
          has_price_breakdown:   hasPriceBreakdown,
          price_per_passenger:   pricePerPassenger,
          price_add_ons:         addOns,
          // Agent attribution — notify.ts sends CC to agent if present
          ...(agentEmail ? { agent_email: agentEmail, agent_name: agentName ?? 'Agent' } : {}),
        },
      });

      return { success: true, message: 'Notification queued' };
    } catch (err) {
      fastify.log.error({ err }, '[checkout] POST /notifications/booking-confirm error');
      reply.code(500).send({ error: 'Internal server error' });
    }
  });
};

export default plugin;
