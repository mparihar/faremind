// ─────────────────────────────────────────────────────────────────────────────
// PNR Strategy Module
// Determines booking reference / PNR structure from provider responses and
// classifies the itinerary for display, risk labelling, and connection
// protection purposes.
// ─────────────────────────────────────────────────────────────────────────────

export type PnrStrategy =
  | 'SINGLE_PNR'
  | 'DIRECTION_PNR'
  | 'SEGMENT_PNR'
  | 'PROVIDER_SPLIT'
  | 'UNKNOWN';

export type PnrType =
  | 'MASTER_AIRLINE_PNR'
  | 'AIRLINE_PNR'
  | 'PROVIDER_PNR'
  | 'SPLIT_TICKET_PNR'
  | 'SUB_PNR';

export type PnrStatus = 'ACTIVE' | 'PENDING' | 'CANCELLED' | 'EXCHANGED' | 'UNKNOWN';

export type PnrDirection = 'ALL' | 'OUTBOUND' | 'RETURN';

export type ConnProtStatus =
  | 'PROTECTED'
  | 'PARTIALLY_PROTECTED'
  | 'NOT_PROTECTED'
  | 'UNKNOWN';

export interface PnrEntry {
  pnrCode: string | null;       // null = provider hasn't returned it yet
  provider: string;             // 'duffel' | 'amadeus' | 'airline_direct' etc.
  airlineCode?: string | null;
  airlineName?: string | null;
  journeyDirection: PnrDirection;
  journeyId?: string | null;    // will be set after journey rows are created
  segmentId?: string | null;
  pnrType: PnrType;
  isPrimary: boolean;
  status: PnrStatus;
  providerOrderId?: string | null;
  displayLabel: string;         // human-readable label e.g. "Full Trip PNR" / "Outbound PNR (DFW→DEL)"
}

export interface PnrStrategyResult {
  strategy: PnrStrategy;
  isSplitTicket: boolean;
  isSelfTransfer: boolean;
  connectionProtectionStatus: ConnProtStatus;
  providerMix: boolean;
  pnrCount: number;
  riskLabel: string | null;
  riskExplanation: string | null;
  pnrs: PnrEntry[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function buildDisplayLabel(
  direction: PnrDirection,
  origin: string,
  destination: string,
  segmentLabel?: boolean,
): string {
  if (segmentLabel) return 'Segment PNR';
  switch (direction) {
    case 'ALL':
      return 'Full Trip PNR';
    case 'OUTBOUND':
      return `Outbound PNR (${origin}→${destination})`;
    case 'RETURN':
      return `Return PNR (${destination}→${origin})`;
    default:
      return 'Full Trip PNR';
  }
}

function connProtForStrategy(strategy: PnrStrategy): ConnProtStatus {
  switch (strategy) {
    case 'SINGLE_PNR':
      return 'PROTECTED';
    case 'DIRECTION_PNR':
      return 'PARTIALLY_PROTECTED';
    case 'SEGMENT_PNR':
    case 'PROVIDER_SPLIT':
      return 'NOT_PROTECTED';
    default:
      return 'UNKNOWN';
  }
}

function riskForStrategy(strategy: PnrStrategy): {
  riskLabel: string | null;
  riskExplanation: string | null;
} {
  switch (strategy) {
    case 'DIRECTION_PNR':
      return {
        riskLabel: 'Split Ticket',
        riskExplanation:
          'Separate confirmation codes for outbound and return',
      };
    case 'SEGMENT_PNR':
      return {
        riskLabel: 'Multi-PNR',
        riskExplanation:
          'Multiple airline confirmation codes apply to different segments',
      };
    case 'PROVIDER_SPLIT':
      return {
        riskLabel: 'Multi-Provider',
        riskExplanation: 'This trip uses multiple booking providers',
      };
    default:
      return { riskLabel: null, riskExplanation: null };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main export
// ─────────────────────────────────────────────────────────────────────────────

export function determinePnrStrategy(
  providerResponse: {
    orderId?: string | null;
    bookingReferences?: Array<{ value: string; type?: string }> | null;
    slices?: Array<{
      segments?: Array<{
        id?: string;
        airline?: { iataCode?: string; name?: string };
      }>;
    }> | null;
    bookingReference?: string | null; // single top-level PNR from Duffel
  } | null,
  itinerary: {
    isRoundTrip: boolean;
    origin: string;
    destination: string;
    provider: string;
    outboundJourneyId?: string | null;
    returnJourneyId?: string | null;
    outboundAirlines?: string[];
    returnAirlines?: string[];
  },
): PnrStrategyResult {
  const origin = itinerary?.origin ?? '';
  const destination = itinerary?.destination ?? '';
  const provider = itinerary?.provider ?? '';

  // ── Rule 6: mixed provider takes priority ────────────────────────────────
  if (provider && (provider.includes(',') || provider.toLowerCase().includes('mixed'))) {
    const pnrs: PnrEntry[] = [
      {
        pnrCode: providerResponse?.bookingReference ?? null,
        provider,
        journeyDirection: 'ALL',
        journeyId: itinerary?.outboundJourneyId ?? null,
        segmentId: null,
        pnrType: 'PROVIDER_PNR',
        isPrimary: true,
        status: providerResponse?.bookingReference ? 'ACTIVE' : 'PENDING',
        providerOrderId: providerResponse?.orderId ?? null,
        displayLabel: buildDisplayLabel('ALL', origin, destination),
      },
    ];

    const { riskLabel, riskExplanation } = riskForStrategy('PROVIDER_SPLIT');

    return {
      strategy: 'PROVIDER_SPLIT',
      isSplitTicket: false,
      isSelfTransfer: false,
      connectionProtectionStatus: connProtForStrategy('PROVIDER_SPLIT'),
      providerMix: true,
      pnrCount: pnrs.length,
      riskLabel,
      riskExplanation,
      pnrs,
    };
  }

  // ── Rule 1: null / empty provider response ───────────────────────────────
  if (!providerResponse) {
    const pnrs: PnrEntry[] = [
      {
        pnrCode: null,
        provider,
        journeyDirection: 'ALL',
        journeyId: itinerary?.outboundJourneyId ?? null,
        segmentId: null,
        pnrType: 'PROVIDER_PNR',
        isPrimary: true,
        status: 'PENDING',
        providerOrderId: null,
        displayLabel: buildDisplayLabel('ALL', origin, destination),
      },
    ];

    return {
      strategy: 'UNKNOWN',
      isSplitTicket: false,
      isSelfTransfer: false,
      connectionProtectionStatus: connProtForStrategy('UNKNOWN'),
      providerMix: false,
      pnrCount: pnrs.length,
      riskLabel: null,
      riskExplanation: null,
      pnrs,
    };
  }

  const refs = providerResponse.bookingReferences;
  const hasRefs = Array.isArray(refs) && refs.length > 0;
  const singleTopLevel = providerResponse.bookingReference ?? null;

  // ── Rule 2: single top-level bookingReference, no array ─────────────────
  if (singleTopLevel && !hasRefs) {
    const pnrs: PnrEntry[] = [
      {
        pnrCode: singleTopLevel,
        provider,
        journeyDirection: 'ALL',
        journeyId: itinerary?.outboundJourneyId ?? null,
        segmentId: null,
        pnrType: 'MASTER_AIRLINE_PNR',
        isPrimary: true,
        status: 'ACTIVE',
        providerOrderId: providerResponse.orderId ?? null,
        displayLabel: buildDisplayLabel('ALL', origin, destination),
      },
    ];

    return {
      strategy: 'SINGLE_PNR',
      isSplitTicket: false,
      isSelfTransfer: false,
      connectionProtectionStatus: connProtForStrategy('SINGLE_PNR'),
      providerMix: false,
      pnrCount: pnrs.length,
      riskLabel: null,
      riskExplanation: null,
      pnrs,
    };
  }

  // ── Rules 3, 4, 5: bookingReferences array present ──────────────────────
  if (hasRefs && refs) {
    // Rule 3: exactly one entry
    if (refs.length === 1) {
      const ref = refs[0];
      const pnrs: PnrEntry[] = [
        {
          pnrCode: ref?.value ?? null,
          provider,
          journeyDirection: 'ALL',
          journeyId: itinerary?.outboundJourneyId ?? null,
          segmentId: null,
          pnrType: 'MASTER_AIRLINE_PNR',
          isPrimary: true,
          status: ref?.value ? 'ACTIVE' : 'PENDING',
          providerOrderId: providerResponse.orderId ?? null,
          displayLabel: buildDisplayLabel('ALL', origin, destination),
        },
      ];

      return {
        strategy: 'SINGLE_PNR',
        isSplitTicket: false,
        isSelfTransfer: false,
        connectionProtectionStatus: connProtForStrategy('SINGLE_PNR'),
        providerMix: false,
        pnrCount: pnrs.length,
        riskLabel: null,
        riskExplanation: null,
        pnrs,
      };
    }

    // Rule 4: exactly two entries (one per direction)
    if (refs.length === 2) {
      const [outRef, retRef] = refs;
      const pnrs: PnrEntry[] = [
        {
          pnrCode: outRef?.value ?? null,
          provider,
          journeyDirection: 'OUTBOUND',
          journeyId: itinerary?.outboundJourneyId ?? null,
          segmentId: null,
          pnrType: 'SPLIT_TICKET_PNR',
          isPrimary: true,
          status: outRef?.value ? 'ACTIVE' : 'PENDING',
          providerOrderId: providerResponse.orderId ?? null,
          displayLabel: buildDisplayLabel('OUTBOUND', origin, destination),
        },
        {
          pnrCode: retRef?.value ?? null,
          provider,
          journeyDirection: 'RETURN',
          journeyId: itinerary?.returnJourneyId ?? null,
          segmentId: null,
          pnrType: 'SPLIT_TICKET_PNR',
          isPrimary: false,
          status: retRef?.value ? 'ACTIVE' : 'PENDING',
          providerOrderId: providerResponse.orderId ?? null,
          displayLabel: buildDisplayLabel('RETURN', origin, destination),
        },
      ];

      const { riskLabel, riskExplanation } = riskForStrategy('DIRECTION_PNR');

      return {
        strategy: 'DIRECTION_PNR',
        isSplitTicket: true,
        isSelfTransfer: false,
        connectionProtectionStatus: connProtForStrategy('DIRECTION_PNR'),
        providerMix: false,
        pnrCount: pnrs.length,
        riskLabel,
        riskExplanation,
        pnrs,
      };
    }

    // Rule 5: 3+ entries → segment PNR
    // Attempt to map slices/segments for enriched data
    const slices = providerResponse.slices ?? [];
    const pnrs: PnrEntry[] = refs.map((ref, idx) => {
      // Try to pull airline info from the matching slice segment
      const slice = slices[idx];
      const firstSegment = slice?.segments?.[0];
      const airlineCode = firstSegment?.airline?.iataCode ?? null;
      const airlineName = firstSegment?.airline?.name ?? null;
      const segmentId = firstSegment?.id ?? null;

      // Direction: first half → OUTBOUND, second half → RETURN (best-effort)
      const midpoint = Math.ceil(refs.length / 2);
      const direction: PnrDirection = idx < midpoint ? 'OUTBOUND' : 'RETURN';
      const journeyId =
        direction === 'OUTBOUND'
          ? (itinerary?.outboundJourneyId ?? null)
          : (itinerary?.returnJourneyId ?? null);

      return {
        pnrCode: ref?.value ?? null,
        provider,
        airlineCode,
        airlineName,
        journeyDirection: direction,
        journeyId,
        segmentId,
        pnrType: 'AIRLINE_PNR',
        isPrimary: idx === 0,
        status: ref?.value ? 'ACTIVE' : 'PENDING',
        providerOrderId: providerResponse.orderId ?? null,
        displayLabel: buildDisplayLabel('ALL', origin, destination, true),
      };
    });

    const { riskLabel, riskExplanation } = riskForStrategy('SEGMENT_PNR');

    return {
      strategy: 'SEGMENT_PNR',
      isSplitTicket: true,
      isSelfTransfer: false,
      connectionProtectionStatus: connProtForStrategy('SEGMENT_PNR'),
      providerMix: false,
      pnrCount: pnrs.length,
      riskLabel,
      riskExplanation,
      pnrs,
    };
  }

  // ── Fallback: provider response present but no usable references ─────────
  const pnrs: PnrEntry[] = [
    {
      pnrCode: null,
      provider,
      journeyDirection: 'ALL',
      journeyId: itinerary?.outboundJourneyId ?? null,
      segmentId: null,
      pnrType: 'PROVIDER_PNR',
      isPrimary: true,
      status: 'PENDING',
      providerOrderId: providerResponse.orderId ?? null,
      displayLabel: buildDisplayLabel('ALL', origin, destination),
    },
  ];

  return {
    strategy: 'UNKNOWN',
    isSplitTicket: false,
    isSelfTransfer: false,
    connectionProtectionStatus: connProtForStrategy('UNKNOWN'),
    providerMix: false,
    pnrCount: pnrs.length,
    riskLabel: null,
    riskExplanation: null,
    pnrs,
  };
}
