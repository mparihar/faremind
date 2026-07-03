import type {
  PricingBreakdown,
  PerPassengerPrice,
  BookingConfirmation,
  PassengerInfo,
  SeatSelection,
  MealSelection,
} from '@/store/useCheckoutStore';
import type { SelectedFare, FareOption } from '@/lib/fare-types';
import type { RoundTripOption } from '@/lib/round-trip-types';
import type { UnifiedFlight, FlightSegment } from '@/lib/types';

// ─── Currency ─────────────────────────────────────────────────────────────────

export function formatCurrency(amount: number, currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency, maximumFractionDigits: 0,
  }).format(amount);
}

// ─── Date / time formatters ───────────────────────────────────────────────────

export function formatDate(dateStr: string | Date): string {
  if (!dateStr) return '';
  try {
    const s = typeof dateStr === 'string' ? dateStr : dateStr.toISOString();
    const [y, mo, d] = s.split('T')[0].split('-').map(Number);
    return new Date(Date.UTC(y, mo - 1, d)).toLocaleDateString('en-US', {
      month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC',
    });
  } catch { return String(dateStr); }
}

export function formatShortDate(dateStr: string | Date): string {
  if (!dateStr) return '';
  try {
    const s = typeof dateStr === 'string' ? dateStr : dateStr.toISOString();
    const [y, mo, d] = s.split('T')[0].split('-').map(Number);
    return new Date(Date.UTC(y, mo - 1, d)).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC',
    });
  } catch { return String(dateStr); }
}

// Reads h:mm directly from ISO string so times stay in airport-local timezone
export function formatTime(dateStr: string | Date): string {
  if (!dateStr) return '';
  try {
    const s = typeof dateStr === 'string' ? dateStr : dateStr.toISOString();
    const tPart = s.includes('T') ? s.split('T')[1] : '';
    const m = tPart.match(/^(\d{1,2}):(\d{2})/);
    if (m) {
      const h = parseInt(m[1], 10);
      const min = parseInt(m[2], 10);
      const ap = h >= 12 ? 'PM' : 'AM';
      const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
      return `${h12}:${min.toString().padStart(2, '0')} ${ap}`;
    }
  } catch { /* fall through */ }
  return String(dateStr);
}

export function formatDurationMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  return `${m}m`;
}

export function calculateTripDurationDays(dep: string, ret: string): number {
  try {
    const strip = (s: string) => s.split('T')[0] + 'T00:00:00Z';
    return Math.round((new Date(strip(ret)).getTime() - new Date(strip(dep)).getTime()) / 86_400_000);
  } catch { return 0; }
}

export function maskPaymentMethod(last4?: string): string {
  return `Card •••• ${last4 ?? '4242'}`;
}

// ─── Fare breakdown ───────────────────────────────────────────────────────────

export interface BreakdownLine { label: string; amount: number; muted?: boolean; }

export function buildFareBreakdown(pricing: PricingBreakdown): BreakdownLine[] {
  const lines: BreakdownLine[] = [];
  const byType = pricing.perPassenger.reduce<Record<string, PerPassengerPrice[]>>(
    (acc, p) => { (acc[p.type] ??= []).push(p); return acc; }, {},
  );
  for (const type of ['adult', 'child', 'infant'] as const) {
    const group = byType[type];
    if (!group?.length) continue;
    lines.push({
      label: type === 'adult' ? `Adult fare × ${group.length}` :
             type === 'child' ? `Child fare × ${group.length}` : `Infant fare × ${group.length}`,
      amount: group.reduce((s, p) => s + p.baseFare, 0),
    });
  }
  const taxes = pricing.perPassenger.reduce((s, p) => s + p.taxes, 0);
  if (taxes > 0)                lines.push({ label: 'Taxes & government fees', amount: taxes });
  if (pricing.seatFees > 0)     lines.push({ label: 'Seat selection', amount: pricing.seatFees });
  if (pricing.mealFees > 0)     lines.push({ label: 'Meals', amount: pricing.mealFees });
  if (pricing.baggageFees > 0)  lines.push({ label: 'Extra baggage', amount: pricing.baggageFees });
  if (pricing.protectionFee > 0) lines.push({ label: 'Price drop protection', amount: pricing.protectionFee });
  if (pricing.insuranceFee > 0)  lines.push({ label: 'Travel insurance', amount: pricing.insuranceFee });
  if (pricing.serviceFee > 0)    lines.push({ label: 'FAREMIND service fee', amount: pricing.serviceFee, muted: true });
  return lines;
}

export function validateFareBreakdown(pricing: PricingBreakdown): boolean {
  return Math.abs(buildFareBreakdown(pricing).reduce((s, l) => s + l.amount, 0) - pricing.total) < 2;
}

// ─── Passenger service types ──────────────────────────────────────────────────

export interface SegmentService {
  segmentId: string;
  route: string;
  flightNumber: string;
  seat: string;
  seatStatus: string;
  meal: string;
}

export interface DirectionServices {
  label: string;           // "Outbound Flight" | "Return Flight"
  route: string;           // "DFW → DEL"
  seat: string;            // direction-level summary (when 1 segment)
  seatStatus: string;
  meal: string;
  baggage: string;
  segments: SegmentService[]; // populated only when >1 segment in the leg
}

export interface PassengerServices {
  passengerId: string;
  passengerName: string;
  passengerType: string;
  isLeadPassenger: boolean;
  directions: DirectionServices[];
}

// ─── Service value helpers ────────────────────────────────────────────────────

const MEAL_SSR: Record<string, string> = {
  STANDARD: 'Standard meal',
  VGML: 'Vegetarian', MOML: 'Muslim meal', HNML: 'Hindu meal',
  KSML: 'Kosher', DBML: 'Diabetic', GFML: 'Gluten-free',
  VGNL: 'Vegan', CHML: 'Child meal', SPML: 'Special meal',
};

export function getSeatValue(seatSel?: SeatSelection): string {
  if (!seatSel) return 'Not selected';
  if (seatSel.seatNumber) return seatSel.seatNumber;
  return 'Pending airline assignment';
}

export function getSeatStatus(seatSel?: SeatSelection): string {
  if (!seatSel) return 'Available at check-in';
  if (seatSel.seatNumber && seatSel.serviceId) return 'Confirmed';
  if (seatSel.seatNumber) return 'Pending airline confirmation';
  return 'Pending airline assignment';
}

export function getMealValue(mealSel?: MealSelection): string {
  if (!mealSel || mealSel.mealType === 'NONE') return 'Not selected';
  if (mealSel.mealLabel) return mealSel.mealLabel;
  return MEAL_SSR[mealSel.mealType] ?? mealSel.mealType;
}

export function getBaggageValue(includedChecked: number, extraBags: number): string {
  const total = includedChecked + extraBags;
  if (total === 0) return 'Carry-on only';
  return `${total} checked bag${total > 1 ? 's' : ''}`;
}

// ─── Build passenger services data ───────────────────────────────────────────

export function buildPassengerServices(params: {
  passengers: PassengerInfo[];
  passengerNames: string[];
  seatSelections: SeatSelection[];
  mealSelections: MealSelection[];
  extraBags: number;
  fareOption: FareOption | null;
  sourceRoundTrip: RoundTripOption | null;
  sourceFlight: UnifiedFlight | null;
}): PassengerServices[] {
  const { passengers, passengerNames, seatSelections, mealSelections, extraBags, fareOption, sourceRoundTrip, sourceFlight } = params;

  const includedChecked =
    fareOption?.baggage.checked ??
    (sourceRoundTrip as { baggage?: { checked?: number } } | null)?.baggage?.checked ??
    sourceFlight?.baggage.checked ?? 0;
  const baggage = getBaggageValue(includedChecked, extraBags);

  // seatKeys: per-segment keys matching seats page  → out_0, ret_0, seg_0
  // mealKey:  per-journey key matching meals page   → outbound, return, seg_0
  type SegSetWithKeys = { label: string; route: string; segs: FlightSegment[]; seatKeys: string[]; mealKey: string };
  const allDirs: SegSetWithKeys[] = [];

  if (sourceRoundTrip) {
    const ob = sourceRoundTrip.outboundJourney;
    const rt = sourceRoundTrip.returnJourney;
    allDirs.push({
      label: 'Outbound Flight',
      route: `${ob.departureAirport} → ${ob.arrivalAirport}`,
      segs:     ob.segments,
      seatKeys: ob.segments.map((_, i) => `out_${i}`),
      mealKey:  'outbound',
    });
    allDirs.push({
      label: 'Return Flight',
      route: `${rt.departureAirport} → ${rt.arrivalAirport}`,
      segs:     rt.segments,
      seatKeys: rt.segments.map((_, i) => `ret_${i}`),
      mealKey:  'return',
    });
  } else if (sourceFlight?.segments.length) {
    const first = sourceFlight.segments[0];
    const last  = sourceFlight.segments[sourceFlight.segments.length - 1];
    // One-way: both seats and meals use seg_N keys
    allDirs.push({
      label: 'Outbound Flight',
      route: `${first.departure.airport} → ${last.arrival.airport}`,
      segs:     sourceFlight.segments,
      seatKeys: sourceFlight.segments.map((_, i) => `seg_${i}`),
      mealKey:  'seg_0',
    });
  }

  return passengers.map((pax, idx) => {
    const fullName = [pax.firstName, pax.middleName, pax.lastName].filter(Boolean).join(' ')
      || passengerNames[idx] || 'Passenger';

    // Lap infants (under 2) sit on a parent's lap — no seat or meal assignment
    if (pax.type === 'infant') {
      const directions: DirectionServices[] = allDirs.map(({ label, route }) => ({
        label, route,
        seat: 'Lap infant — no seat required',
        seatStatus: 'N/A',
        meal: 'N/A',
        baggage,
        segments: [],
      }));
      return { passengerId: pax.id, passengerName: fullName, passengerType: pax.type, isLeadPassenger: pax.isContact, directions };
    }

    const directions: DirectionServices[] = allDirs.map(({ label, route, segs, seatKeys, mealKey }) => {
      // Meal is stored at journey level — look it up once per direction
      const dirMeal = mealSelections.find(m => m.passengerId === pax.id && m.segmentKey === mealKey);
      const segServices: SegmentService[] = segs.map((seg, si) => {
        const seatKey = seatKeys[si];
        const ss = seatSelections.find(s => s.passengerId === pax.id && s.segmentKey === seatKey);
        const ms = dirMeal; // same meal selection applies to all segments in this direction
        return {
          segmentId: seg.id,
          route: `${seg.departure.airport} → ${seg.arrival.airport}`,
          flightNumber: seg.flightNumber,
          seat: getSeatValue(ss),
          seatStatus: getSeatStatus(ss),
          meal: getMealValue(ms),
        };
      });
      const first = segServices[0];
      return {
        label, route,
        seat: first?.seat ?? 'Not selected',
        seatStatus: first?.seatStatus ?? 'Available at check-in',
        meal: first?.meal ?? 'Not selected',
        baggage,
        segments: segs.length > 1 ? segServices : [],
      };
    });

    return { passengerId: pax.id, passengerName: fullName, passengerType: pax.type, isLeadPassenger: pax.isContact, directions };
  });
}

// ─── Itinerary HTML ───────────────────────────────────────────────────────────

export interface ItineraryParams {
  confirmation: BookingConfirmation;
  routeLabel: string;
  airlineName: string;
  selectedFare: SelectedFare | null;
  passengers: PassengerInfo[];
  pricing: PricingBreakdown | null;
  priceProtection: boolean;
  sourceRoundTrip?: RoundTripOption | null;
  sourceFlight?: UnifiedFlight | null;
  seatSelections?: SeatSelection[];
  mealSelections?: MealSelection[];
  extraBags?: number;
  fareOption?: FareOption | null;
}

function seatStatusColor(status: string): string {
  if (status === 'Confirmed') return '#10b981';
  if (status.startsWith('Pending')) return '#f59e0b';
  return '#94a3b8';
}

function renderPassengerServicesHtml(services: PassengerServices[]): string {
  return services.map((pax, pi) => {
    const dirHtml = pax.directions.map(dir => {
      const isOutbound = dir.label === 'Outbound Flight';
      const headerBg = isOutbound ? '#f0fdf4' : '#fff7ed';
      const headerColor = isOutbound ? '#059669' : '#d97706';

      const renderServiceRows = (seat: string, seatStatus: string, meal: string) => `
        <tr><td style="padding:5px 0;color:#64748b;font-size:13px;width:130px;">Seat</td><td style="padding:5px 0;font-size:13px;font-weight:600;color:#1e293b;">${seat}</td></tr>
        <tr><td style="padding:5px 0;color:#64748b;font-size:13px;">Seat status</td><td style="padding:5px 0;"><span style="font-size:12px;font-weight:700;color:${seatStatusColor(seatStatus)};background:${seatStatusColor(seatStatus)}18;padding:2px 8px;border-radius:20px;">${seatStatus}</span></td></tr>
        <tr><td style="padding:5px 0;color:#64748b;font-size:13px;">Meal</td><td style="padding:5px 0;font-size:13px;color:#1e293b;">${meal}</td></tr>`;

      const segHtml = dir.segments.length > 0
        ? dir.segments.map(seg => `
          <div style="margin-bottom:14px;padding-bottom:14px;border-bottom:1px solid #f1f5f9;">
            <div style="display:flex;align-items:center;gap:6px;margin-bottom:10px;">
              <span style="font-size:11px;font-weight:700;color:#0f172a;">${seg.route}</span>
              <span style="font-size:11px;font-family:'Courier New',monospace;color:#94a3b8;">· ${seg.flightNumber}</span>
            </div>
            <table style="width:100%;border-collapse:collapse;">
              ${renderServiceRows(seg.seat, seg.seatStatus, seg.meal)}
            </table>
          </div>`).join('')
          + `<div style="border-top:1px solid #f1f5f9;padding-top:10px;"><table style="width:100%;border-collapse:collapse;"><tr><td style="padding:5px 0;color:#64748b;font-size:13px;">Baggage</td><td style="padding:5px 0;font-size:13px;color:#1e293b;font-weight:600;">${dir.baggage}</td></tr></table></div>`
        : `<table style="width:100%;border-collapse:collapse;">
            ${renderServiceRows(dir.seat, dir.seatStatus, dir.meal)}
            <tr><td style="padding:5px 0;color:#64748b;font-size:13px;">Baggage</td><td style="padding:5px 0;font-size:13px;color:#1e293b;font-weight:600;">${dir.baggage}</td></tr>
          </table>`;

      return `
        <div style="margin-bottom:12px;border-radius:10px;overflow:hidden;border:1px solid #e2e8f0;">
          <div style="padding:10px 14px;background:${headerBg};border-bottom:1px solid #e2e8f0;display:flex;justify-content:space-between;align-items:center;">
            <span style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:1px;color:${headerColor};">${dir.label}</span>
            <span style="font-size:12px;font-weight:600;color:#475569;">${dir.route}</span>
          </div>
          <div style="padding:14px;">${segHtml}</div>
        </div>`;
    }).join('');

    return `
      <div style="margin-bottom:${pi < services.length - 1 ? '20px' : '0'};padding-bottom:${pi < services.length - 1 ? '20px' : '0'};border-bottom:${pi < services.length - 1 ? '2px solid #f1f5f9' : 'none'};">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px;">
          <div>
            <p style="font-size:15px;font-weight:700;color:#0f172a;margin-bottom:2px;">${pax.passengerName}</p>
            <p style="font-size:12px;color:#94a3b8;text-transform:capitalize;">${pax.passengerType}</p>
          </div>
          ${pax.isLeadPassenger ? `<span style="font-size:10px;font-weight:700;color:#1abc9c;background:#f0fdf4;border:1px solid #d1fae5;padding:3px 10px;border-radius:20px;">Lead passenger</span>` : ''}
        </div>
        ${dirHtml}
      </div>`;
  }).join('');
}

export function generateItineraryHtml(p: ItineraryParams): string {
  const { confirmation, routeLabel, airlineName, selectedFare, passengers, pricing, priceProtection,
          sourceRoundTrip, sourceFlight, seatSelections = [], mealSelections = [], extraBags = 0, fareOption = null } = p;

  const cur = pricing?.currency ?? confirmation.currency ?? 'USD';
  const breakdown = pricing ? buildFareBreakdown(pricing) : null;
  const confirmedAt = new Date(confirmation.confirmedAt).toLocaleString('en-US', { dateStyle: 'full', timeStyle: 'short' });

  const depDate = sourceRoundTrip ? formatDate(sourceRoundTrip.outboundJourney.departureTime)
    : (sourceFlight?.segments[0]?.departure.time ? formatDate(sourceFlight.segments[0].departure.time) : '');
  const retDate = sourceRoundTrip ? formatDate(sourceRoundTrip.returnJourney.departureTime) : '';
  const tripType = sourceRoundTrip ? 'Round Trip' : 'One Way';

  const paxServices = buildPassengerServices({
    passengers,
    passengerNames: confirmation.passengerNames,
    seatSelections,
    mealSelections,
    extraBags,
    fareOption,
    sourceRoundTrip: sourceRoundTrip ?? null,
    sourceFlight: sourceFlight ?? null,
  });

  const renderSegmentsHtml = (segs: FlightSegment[], layovers: import('@/lib/round-trip-types').Layover[]) =>
    segs.map((seg, i) => `
      <div style="margin-bottom:16px;">
        <div style="background:#ffffff;border-radius:12px;border:1px solid #e2e8f0;">
          <!-- Header -->
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border-bottom:1px solid #e2e8f0;border-top-left-radius:12px;border-top-right-radius:12px;">
            <tr>
              <td style="padding:12px 16px;font-size:13px;font-weight:700;color:#1e293b;">
                ✈️ ${seg.airline.name || ''}
              </td>
              <td style="padding:12px 16px;text-align:right;font-size:12px;color:#64748b;font-family:'Courier New',monospace;font-weight:600;">
                ${seg.flightNumber || ''} &nbsp;•&nbsp; <span style="text-transform:uppercase;">${fareOption?.cabinClass || 'ECONOMY'}</span>
              </td>
            </tr>
          </table>
          
          <!-- Body -->
          <table width="100%" cellpadding="0" cellspacing="0" style="padding:16px;">
            <tr>
              <!-- Origin -->
              <td width="35%" valign="top" style="text-align:left;">
                <div style="font-size:18px;font-weight:800;color:#0f172a;">${formatTime(seg.departure.time)}</div>
                <div style="font-size:12px;color:#64748b;margin-top:4px;">
                   <span style="font-size:14px;font-weight:700;color:#1abc9c;">${seg.departure.airport}</span> &nbsp;•&nbsp; ${seg.departure.city}
                </div>
                ${seg.departure.terminal ? `<div style="font-size:11px;color:#94a3b8;margin-top:2px;">Terminal ${seg.departure.terminal}</div>` : ''}
              </td>
              
              <!-- Duration/Line -->
              <td width="30%" valign="top" style="text-align:center;padding-top:8px;">
                <div style="font-size:10px;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:1px;">${formatDurationMinutes(seg.duration)}</div>
                <div style="margin-top:6px;font-size:14px;color:#cbd5e1;">────── ✈ ──────</div>
              </td>
              
              <!-- Destination -->
              <td width="35%" valign="top" style="text-align:right;">
                <div style="font-size:18px;font-weight:800;color:#0f172a;">${formatTime(seg.arrival.time)}</div>
                <div style="font-size:12px;color:#64748b;margin-top:4px;">
                   ${seg.arrival.city} &nbsp;•&nbsp; <span style="font-size:14px;font-weight:700;color:#1abc9c;">${seg.arrival.airport}</span>
                </div>
                ${seg.arrival.terminal ? `<div style="font-size:11px;color:#94a3b8;margin-top:2px;">Terminal ${seg.arrival.terminal}</div>` : ''}
              </td>
            </tr>
          </table>
        </div>
        ${layovers[i] ? `<div style="margin:4px 12px;padding:8px 12px;background:#fffbeb;border:1px solid #fde68a;border-radius:6px;font-size:12px;color:#92400e;text-align:center;">⏱ ${formatDurationMinutes(layovers[i].durationMinutes)} layover · ${layovers[i].airportName} (${layovers[i].airport})${layovers[i].terminalChange ? ' · Terminal change' : ''}</div>` : ''}
      </div>`).join('');

  const outSegs = sourceRoundTrip ? renderSegmentsHtml(sourceRoundTrip.outboundJourney.segments, sourceRoundTrip.outboundJourney.layovers) : (sourceFlight ? renderSegmentsHtml(sourceFlight.segments, []) : '');
  const retSegs = sourceRoundTrip ? renderSegmentsHtml(sourceRoundTrip.returnJourney.segments, sourceRoundTrip.returnJourney.layovers) : '';

  const flightSectionHtml = (outSegs || retSegs) ? `
    <div class="section">
      <div class="sec-title">Flight Details</div>
      ${outSegs ? `<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#94a3b8;margin-bottom:8px;">Outbound · ${depDate}</div>${outSegs}` : ''}
      ${retSegs ? `<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#94a3b8;margin:14px 0 8px;">Return · ${retDate}</div>${retSegs}` : ''}
    </div>` : '';

  const breakdownRows = breakdown ? breakdown.map(l => `
    <tr>
      <td style="padding:5px 0;color:${l.muted ? '#94a3b8' : '#475569'};font-size:13px;">${l.label}</td>
      <td style="padding:5px 0;text-align:right;color:${l.muted ? '#94a3b8' : '#1e293b'};font-size:13px;">${formatCurrency(l.amount, cur)}</td>
    </tr>`).join('') : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" /><meta name="viewport" content="width=device-width,initial-scale=1.0" />
  <title>FAREMIND Itinerary — ${confirmation.masterBookingReference || confirmation.pnr}</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;background:#f8fafc;color:#1e293b;padding:40px 20px}
    .doc{max-width:640px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 32px rgba(0,0,0,.08)}
    .hdr{display:none}
    .brand{font-size:22px;font-weight:900;letter-spacing:1px}
    .tagline{color:#64748b;font-size:12px;margin-top:4px}
    .body{padding:28px 36px}
    .section{margin-bottom:24px}
    .sec-title{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#94a3b8;margin-bottom:12px;border-bottom:1px solid #f1f5f9;padding-bottom:6px}
    .pnr-box{background:linear-gradient(135deg,#0f172a 0%,#1e293b 60%,#0f3460 100%);border-radius:0;padding:32px 36px;text-align:center;position:relative;overflow:hidden}
    .pnr-box::before{content:'';position:absolute;top:-40px;right:-40px;width:120px;height:120px;border-radius:50%;background:rgba(26,188,156,0.06)}
    .pnr{font-family:'Courier New',monospace;font-size:32px;font-weight:900;letter-spacing:8px;color:#fff}
    .pnr-label{font-size:10px;text-transform:uppercase;letter-spacing:3px;font-weight:700;margin-bottom:8px}
    table{width:100%;border-collapse:collapse}
    .total-row td{padding-top:12px;border-top:2px solid #e2e8f0;font-weight:700}
    .total-amt{font-size:18px;color:#f97316;text-align:right}
    .confirmed{color:#10b981;font-weight:700}
    .note{background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px 16px;font-size:12px;color:#64748b;line-height:1.6;margin-top:16px}
    .ftr{background:#f8fafc;border-top:1px solid #e2e8f0;padding:18px 36px;text-align:center;color:#94a3b8;font-size:11px;line-height:1.6}
    @media print{
      body{background:#fff;padding:0;-webkit-print-color-adjust:exact;print-color-adjust:exact}
      .doc{box-shadow:none;border-radius:0;max-width:100%}
      .hdr{-webkit-print-color-adjust:exact;print-color-adjust:exact}
      .section{page-break-inside:avoid}
      .ftr{position:fixed;bottom:0;width:100%}
      @page{size:A4;margin:12mm 10mm}
    }
  </style>
</head>
<body>
  <div class="doc">
    <div class="pnr-box">
        <div style="display:inline-flex;align-items:center;gap:6px;background:rgba(16,185,129,0.15);border:1px solid rgba(16,185,129,0.25);border-radius:20px;padding:4px 12px;margin-bottom:12px;">
          <div style="width:6px;height:6px;border-radius:50%;background:#10b981;"></div>
          <span style="font-size:11px;font-weight:700;color:#10b981;letter-spacing:0.5px;">Confirmed</span>
        </div>
        <div class="pnr-label"><span style="color:#ffffff;">FARE</span><span style="color:#009CA6;">MIND</span> <span style="color:#64748b;">BOOKING REFERENCE</span></div>
        <div class="pnr">${confirmation.masterBookingReference || confirmation.pnr}</div>
        ${(confirmation.pnrs && confirmation.pnrs.length > 0) ? `<div style="margin-top:14px;">${confirmation.pnrs.map((pnr: any) => `<div style="display:inline-flex;align-items:center;gap:8px;margin:4px 0;"><span style="font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:3px;font-weight:700;">AIRLINE PNR</span><span style="font-family:'Courier New',monospace;font-size:16px;font-weight:900;color:#1abc9c;letter-spacing:3px;">${pnr.pnrCode}</span></div>`).join('<br/>')}</div>` : ''}
    </div>
    <div class="body">
      <div class="section">
        <div class="sec-title">Itinerary Summary</div>
        <table>
          <tr><td style="padding:5px 0;color:#64748b;font-size:13px;">Route</td><td style="padding:5px 0;text-align:right;font-weight:600;font-size:13px;">${routeLabel}</td></tr>
          <tr><td style="padding:5px 0;color:#64748b;font-size:13px;">Trip type</td><td style="padding:5px 0;text-align:right;font-size:13px;">${tripType}</td></tr>
          ${depDate ? `<tr><td style="padding:5px 0;color:#64748b;font-size:13px;">Departure</td><td style="padding:5px 0;text-align:right;font-size:13px;">${depDate}</td></tr>` : ''}
          ${retDate ? `<tr><td style="padding:5px 0;color:#64748b;font-size:13px;">Return</td><td style="padding:5px 0;text-align:right;font-size:13px;">${retDate}</td></tr>` : ''}
          ${airlineName ? `<tr><td style="padding:5px 0;color:#64748b;font-size:13px;">Airline</td><td style="padding:5px 0;text-align:right;font-size:13px;">${airlineName}</td></tr>` : ''}
          ${selectedFare ? `<tr><td style="padding:5px 0;color:#64748b;font-size:13px;">Fare</td><td style="padding:5px 0;text-align:right;font-size:13px;">${selectedFare.name} · ${selectedFare.cabin.replace(/_/g, ' ')}</td></tr>` : ''}
          <tr><td style="padding:5px 0;color:#64748b;font-size:13px;">Status</td><td style="padding:5px 0;text-align:right;font-size:13px;" class="confirmed">Confirmed</td></tr>
          ${(confirmation.pnrs && confirmation.pnrs.length > 0) ? confirmation.pnrs.map((pnr: any) => `<tr><td style="padding:5px 0;font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:3px;font-weight:700;">AIRLINE PNR</td><td style="padding:5px 0;text-align:right;font-family:monospace;font-size:14px;font-weight:700;color:#1abc9c;">${pnr.pnrCode}</td></tr>`).join('') : ''}
        </table>
      </div>

      ${flightSectionHtml}

      <div class="section">
        <div class="sec-title">Passenger Details</div>
        ${renderPassengerServicesHtml(paxServices)}
        <div class="note">
          ℹ Seat assignments, boarding passes, terminal, and gate information may be updated by the airline closer to departure.
          Please check airline check-in before travel.
          ${retDate ? ' Return flight is confirmed. Seat assignment and boarding pass may be available closer to departure or during airline check-in.' : ''}
        </div>
      </div>

      <div class="section">
        <div class="sec-title">Fare Breakdown</div>
        <table>
          ${breakdownRows}
          <tr class="total-row">
            <td style="font-size:14px;">Total Charged</td>
            <td class="total-amt">${formatCurrency(confirmation.totalCharged, cur)}</td>
          </tr>
        </table>
      </div>

      <div class="section">
        <div class="sec-title">Payment</div>
        <table>
          <tr><td style="padding:5px 0;color:#64748b;font-size:13px;">Payment method</td><td style="padding:5px 0;text-align:right;font-size:13px;">Card •••• 4242</td></tr>
          <tr><td style="padding:5px 0;color:#64748b;font-size:13px;">Confirmed at</td><td style="padding:5px 0;text-align:right;font-size:12px;color:#475569;">${confirmedAt}</td></tr>
          ${priceProtection ? `<tr><td style="padding:5px 0;color:#64748b;font-size:13px;">Price protection</td><td style="padding:5px 0;text-align:right;font-size:13px;color:#1abc9c;">Active</td></tr>` : ''}
        </table>
      </div>
    </div>
    <div class="ftr">
      <p>Generated by FAREMIND · faremind.ai</p>
      <p style="margin-top:4px;">Keep this document for your records. Questions? Email support@faremind.ai</p>
    </div>
  </div>
</body>
</html>`;
}

// ─── Generate itinerary HTML from a manage-booking record ─────────────────────
// Produces the same rich HTML as generateItineraryHtml so both the checkout
// confirmation and manage-booking "Download Full Itinerary" are identical.

export function generateItineraryHtmlFromBooking(booking: any): string {
  try {
    return _generateItineraryHtmlFromBookingInner(booking);
  } catch (err) {
    // Top-level safety net: return a minimal but valid HTML so the email
    // is ALWAYS sent, even if the detailed template generation crashes.
    const ref = booking?.masterBookingReference || booking?.masterPnr || 'N/A';
    const name = booking?.passengers?.[0]?.firstName || 'Traveler';
    const route = `${booking?.originAirport || ''} → ${booking?.destinationAirport || ''}`;
    console.error('[fare-utils] ❌ generateItineraryHtmlFromBooking crashed — returning minimal fallback:', err instanceof Error ? `${err.message}\n${err.stack}` : err);
    return `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="font-family:sans-serif;padding:40px 20px;background:#f8fafc;">
      <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;padding:32px;border:1px solid #e2e8f0;">
        <h2 style="margin:0 0 8px;color:#0f172a;">Booking Confirmed ✈️</h2>
        <p style="color:#64748b;margin:0 0 16px;">Hi ${name}, your flight has been booked successfully!</p>
        <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:16px;margin-bottom:16px;">
          <p style="margin:0;font-size:13px;color:#64748b;">Booking Reference: <strong style="color:#0f172a;">${ref}</strong></p>
          <p style="margin:4px 0 0;font-size:13px;color:#64748b;">Route: <strong style="color:#0f172a;">${route}</strong></p>
        </div>
        <p style="color:#64748b;font-size:13px;">View and manage your booking at <a href="${process.env.NEXT_PUBLIC_APP_URL || 'https://faremind.ai'}/manage-booking" style="color:#1abc9c;">Manage Booking</a>.</p>
        <p style="margin-top:24px;color:#94a3b8;font-size:11px;">© ${new Date().getFullYear()} FAREMIND · support@faremind.ai</p>
      </div>
    </body></html>`;
  }
}

function _generateItineraryHtmlFromBookingInner(booking: any): string {
  const cur = booking.currency || 'USD';
  const fmtCur = (n: number) => formatCurrency(n, cur);
  const ref = booking.masterBookingReference || booking.masterPnr || 'N/A';
  const isRT = (booking.tripType || '').toLowerCase().includes('round');
  const routeLabel = `${booking.originAirport || ''} ${isRT ? '⇄' : '→'} ${booking.destinationAirport || ''}`;
  const depDate = booking.departureDate ? formatDate(booking.departureDate) : '';
  const retDate = booking.returnDate ? formatDate(booking.returnDate) : '';
  const tripType = isRT ? 'Round Trip' : 'One Way';
  const confirmedAt = booking.createdAt
    ? new Date(booking.createdAt).toLocaleString('en-US', { dateStyle: 'full', timeStyle: 'short' })
    : '';

  // Airline name from first PNR or first segment
  const journeys: any[] = booking.journeys || [];
  const firstPnr = (booking.pnrs || [])[0];
  const firstSeg = journeys[0]?.segments?.[0];
  const airlineName = firstPnr?.airlineName || firstSeg?.airlineName || booking.primaryProvider || '';
  const fareClass = firstSeg?.cabin || firstSeg?.cabinClass || '';

  // ─── Flight Segments ─────────────────────────────────────────
  const renderSegs = (segs: any[]) => segs.map((seg: any) => {
    const depTime = seg.departureDateTime || seg.departureTime || '';
    const arrTime = seg.arrivalDateTime || seg.arrivalTime || '';
    const depAirport = seg.originAirport || seg.departureAirport || '';
    const arrAirport = seg.destinationAirport || seg.arrivalAirport || '';
    const depCity = seg.originCity || seg.departureCity || '';
    const arrCity = seg.destinationCity || seg.arrivalCity || '';
    const depTerminal = seg.originTerminal || seg.departureTerminal || '';
    const arrTerminal = seg.destinationTerminal || seg.arrivalTerminal || '';
    const aircraft = seg.aircraftType || seg.aircraft || '';
    return `
    <div style="margin-bottom:16px;background:#ffffff;border-radius:12px;border:1px solid #e2e8f0;">
      <!-- Header -->
      <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border-bottom:1px solid #e2e8f0;border-top-left-radius:12px;border-top-right-radius:12px;">
        <tr>
          <td style="padding:12px 16px;font-size:13px;font-weight:700;color:#1e293b;">
            ✈️ ${seg.airlineName || ''}
          </td>
          <td style="padding:12px 16px;text-align:right;font-size:12px;color:#64748b;font-family:'Courier New',monospace;font-weight:600;">
            ${seg.flightNumber || seg.marketingFlightNumber || ''} &nbsp;•&nbsp; <span style="text-transform:uppercase;">${seg.cabin || seg.cabinClass || fareClass || 'ECONOMY'}</span>
          </td>
        </tr>
      </table>
      
      <!-- Body -->
      <table width="100%" cellpadding="0" cellspacing="0" style="padding:16px;">
        <tr>
          <!-- Origin -->
          <td width="35%" valign="top" style="text-align:left;">
            <div style="font-size:18px;font-weight:800;color:#0f172a;">${depTime ? formatTime(depTime) : ''}</div>
            <div style="font-size:12px;color:#64748b;margin-top:4px;">
               <span style="font-size:14px;font-weight:700;color:#1abc9c;">${depAirport}</span> &nbsp;•&nbsp; ${depCity}
            </div>
            ${depTerminal ? `<div style="font-size:11px;color:#94a3b8;margin-top:2px;">Terminal ${depTerminal}</div>` : ''}
          </td>
          
          <!-- Duration/Line -->
          <td width="30%" valign="top" style="text-align:center;padding-top:8px;">
            <div style="font-size:10px;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:1px;">${seg.durationMinutes ? formatDurationMinutes(seg.durationMinutes) : ''}</div>
            <div style="margin-top:6px;font-size:14px;color:#cbd5e1;">────── ✈ ──────</div>
          </td>
          
          <!-- Destination -->
          <td width="35%" valign="top" style="text-align:right;">
            <div style="font-size:18px;font-weight:800;color:#0f172a;">${arrTime ? formatTime(arrTime) : ''}</div>
            <div style="font-size:12px;color:#64748b;margin-top:4px;">
               ${arrCity} &nbsp;•&nbsp; <span style="font-size:14px;font-weight:700;color:#1abc9c;">${arrAirport}</span>
            </div>
            ${arrTerminal ? `<div style="font-size:11px;color:#94a3b8;margin-top:2px;">Terminal ${arrTerminal}</div>` : ''}
          </td>
        </tr>
      </table>
    </div>
  `; }).join('');

  let flightSectionHtml = '';
  if (journeys.length > 0) {
    flightSectionHtml = `<div class="section"><div class="sec-title">Flight Details</div>`;
    for (const j of journeys) {
      const dir = j.direction === 'RETURN' ? 'Return' : 'Outbound';
      const jDate = (j.departureDateTime || j.departureDate) ? formatDate(j.departureDateTime || j.departureDate) : depDate;
      flightSectionHtml += `<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#94a3b8;margin-bottom:8px;${journeys.indexOf(j) > 0 ? 'margin-top:14px;' : ''}">${dir} · ${jDate}</div>`;
      flightSectionHtml += renderSegs(j.segments || []);
    }
    flightSectionHtml += `</div>`;
  }

  // ─── Passenger Details with Services ─────────────────────────
  const passengers: any[] = booking.passengers || [];
  const allSeats: any[] = booking.seats || [];
  const allMeals: any[] = booking.meals || [];
  const allBaggage: any[] = booking.baggage || [];

  const _seatStatusColor = (status: string): string => {
    if (!status) return '#94a3b8';
    const s = status.toLowerCase();
    if (s === 'confirmed' || s === 'booked') return '#10b981';
    if (s.startsWith('pending') || s === 'selected' || s === 'requested') return '#f59e0b';
    return '#94a3b8';
  };

  const _seatStatusLabel = (status: string): string => {
    if (!status) return 'Available at check-in';
    const s = status.toLowerCase();
    if (s === 'confirmed' || s === 'booked') return 'Confirmed';
    if (s === 'selected' || s === 'requested') return 'Pending airline confirmation';
    return status.replace(/_/g, ' ');
  };

  const paxHtml = passengers.map((p: any, pi: number) => {
    // Build per-direction service cards for this passenger
    const paxSeats = allSeats.filter((s: any) => s.passengerId === p.id);
    const paxMeals = allMeals.filter((m: any) => m.passengerId === p.id);
    const paxBags = allBaggage.filter((b: any) => !b.passengerId || b.passengerId === p.id);

    // Personal details section
    const hasPersonal = p.gender || p.dateOfBirth || p.email || p.phone;
    const hasDocs = p.nationality || p.passportNumber || p.passportExpiry || p.passportIssuingCountry;

    const personalHtml = (hasPersonal || hasDocs) ? `
      <div style="border-radius:10px;border:1px solid #e2e8f0;background:#fafafa;padding:14px;margin-bottom:12px;">
        ${hasPersonal ? `
          <p style="font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:1.5px;color:#94a3b8;margin:0 0 8px;">Personal Details</p>
          <table style="width:100%;border-collapse:collapse;">
            ${p.gender ? `<tr><td style="padding:4px 0;color:#64748b;font-size:13px;width:130px;">Gender</td><td style="padding:4px 0;font-size:13px;color:#1e293b;text-transform:capitalize;">${p.gender}</td></tr>` : ''}
            ${p.dateOfBirth ? `<tr><td style="padding:4px 0;color:#64748b;font-size:13px;">Date of Birth</td><td style="padding:4px 0;font-size:13px;color:#1e293b;">${p.dateOfBirth}</td></tr>` : ''}
            ${p.email ? `<tr><td style="padding:4px 0;color:#64748b;font-size:13px;">Email</td><td style="padding:4px 0;font-size:13px;color:#1e293b;">${p.email}</td></tr>` : ''}
            ${p.phone ? `<tr><td style="padding:4px 0;color:#64748b;font-size:13px;">Phone</td><td style="padding:4px 0;font-size:13px;color:#1e293b;">${p.phone}</td></tr>` : ''}
          </table>
        ` : ''}
        ${hasDocs ? `
          <p style="font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:1.5px;color:#94a3b8;margin:${hasPersonal ? '12px' : '0'} 0 8px;">Travel Documents</p>
          <table style="width:100%;border-collapse:collapse;">
            ${p.nationality ? `<tr><td style="padding:4px 0;color:#64748b;font-size:13px;width:130px;">Nationality</td><td style="padding:4px 0;font-size:13px;color:#1e293b;">${p.nationality}</td></tr>` : ''}
            ${p.passportNumber ? `<tr><td style="padding:4px 0;color:#64748b;font-size:13px;">Passport No.</td><td style="padding:4px 0;font-size:13px;font-family:'Courier New',monospace;color:#1e293b;">${p.passportNumber}</td></tr>` : ''}
            ${p.passportExpiry ? `<tr><td style="padding:4px 0;color:#64748b;font-size:13px;">Expiry</td><td style="padding:4px 0;font-size:13px;color:#1e293b;">${p.passportExpiry}</td></tr>` : ''}
            ${p.passportIssuingCountry ? `<tr><td style="padding:4px 0;color:#64748b;font-size:13px;">Issuing Country</td><td style="padding:4px 0;font-size:13px;color:#1e293b;">${p.passportIssuingCountry}</td></tr>` : ''}
          </table>
        ` : ''}
      </div>
    ` : '';

    const dirCards = journeys.map((j: any) => {
      const isOutbound = j.direction !== 'RETURN';
      const headerBg = isOutbound ? '#f0fdf4' : '#fff7ed';
      const headerColor = isOutbound ? '#059669' : '#d97706';
      const dirLabel = isOutbound ? 'Outbound Flight' : 'Return Flight';
      const dirRoute = `${j.originAirport || booking.originAirport} → ${j.destinationAirport || booking.destinationAirport}`;

      // Find seat for this passenger in this journey
      const journeySeats = paxSeats.filter((s: any) => s.journeyId === j.id);
      const seat = journeySeats[0];
      const seatVal = seat?.seatNumber || 'Not selected';
      const seatStatus = seat ? _seatStatusLabel(seat.seatStatus) : 'Available at check-in';

      // Find meal for this passenger in this journey
      // Try journeyId match first, then direction match, then any meal for this passenger
      let journeyMeals = paxMeals.filter((m: any) => m.journeyId === j.id);
      if (journeyMeals.length === 0) {
        const dir = isOutbound ? 'OUTBOUND' : 'RETURN';
        journeyMeals = paxMeals.filter((m: any) => m.direction === dir);
      }
      if (journeyMeals.length === 0 && journeys.length === 1) {
        // Single journey — use any meal
        journeyMeals = paxMeals;
      }
      const meal = journeyMeals[0];
      const mealVal = meal?.mealLabel || meal?.mealCode || 'Not selected';

      // Find baggage for this journey
      const journeyBags = paxBags.filter((b: any) => !b.journeyId || b.journeyId === j.id);
      const checkedCount = journeyBags.reduce((sum: number, b: any) => sum + (b.quantity || 1), 0);
      const bagVal = checkedCount > 0 ? `${checkedCount} checked bag${checkedCount > 1 ? 's' : ''}` : '1 checked bag';

      return `
        <div style="margin-bottom:12px;border-radius:10px;overflow:hidden;border:1px solid #e2e8f0;">
          <div style="padding:10px 14px;background:${headerBg};border-bottom:1px solid #e2e8f0;display:flex;justify-content:space-between;align-items:center;">
            <span style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:1px;color:${headerColor};">${dirLabel}</span>
            <span style="font-size:12px;font-weight:600;color:#475569;">${dirRoute}</span>
          </div>
          <div style="padding:14px;">
            <table style="width:100%;border-collapse:collapse;">
              <tr><td style="padding:5px 0;color:#64748b;font-size:13px;width:130px;">Seat</td><td style="padding:5px 0;font-size:13px;font-weight:600;color:#1e293b;">${seatVal}</td></tr>
              <tr><td style="padding:5px 0;color:#64748b;font-size:13px;">Seat status</td><td style="padding:5px 0;"><span style="font-size:12px;font-weight:700;color:${_seatStatusColor(seat?.seatStatus)};background:${_seatStatusColor(seat?.seatStatus)}18;padding:2px 8px;border-radius:20px;">${seatStatus}</span></td></tr>
              <tr><td style="padding:5px 0;color:#64748b;font-size:13px;">Meal</td><td style="padding:5px 0;font-size:13px;color:#1e293b;">${mealVal}</td></tr>
              <tr><td style="padding:5px 0;color:#64748b;font-size:13px;">Baggage</td><td style="padding:5px 0;font-size:13px;color:#1e293b;font-weight:600;">${bagVal}</td></tr>
            </table>
          </div>
        </div>`;
    }).join('');

    return `
    <div style="margin-bottom:${pi < passengers.length - 1 ? '20px' : '0'};padding-bottom:${pi < passengers.length - 1 ? '20px' : '0'};border-bottom:${pi < passengers.length - 1 ? '2px solid #f1f5f9' : 'none'};">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px;">
        <div>
          <p style="font-size:15px;font-weight:700;color:#0f172a;margin-bottom:2px;">${p.firstName} ${p.lastName}</p>
          <p style="font-size:12px;color:#94a3b8;text-transform:capitalize;">${(p.passengerType || 'Adult').toLowerCase()}</p>
        </div>
        ${pi === 0 ? `<span style="font-size:10px;font-weight:700;color:#1abc9c;background:#f0fdf4;border:1px solid #d1fae5;padding:3px 10px;border-radius:20px;">Lead passenger</span>` : ''}
      </div>
      ${personalHtml}
      ${dirCards}
    </div>`;
  }).join('');

  // ─── Fare Breakdown ──────────────────────────────────────────
  const totalAmount = Number(booking.totalAmount) || 0;

  // Compute fare breakdown from stored data
  const totalSeatFees = allSeats.reduce((s: number, st: any) => s + Number(st.seatPrice || 0), 0);
  const totalMealFees = allMeals.reduce((s: number, ml: any) => s + Number(ml.mealPrice || 0), 0);
  const totalBagFees = allBaggage.reduce((s: number, bg: any) => s + Number(bg.baggagePrice || 0), 0);

  const addons: any[] = booking.addons || [];
  const protectionAddon = addons.find((a: any) => (a.addonType || '').toLowerCase().includes('protection') || (a.addonName || '').toLowerCase().includes('protection'));
  const protectionFee = protectionAddon ? Number(protectionAddon.amount || 0) : 0;
  const insuranceAddon = addons.find((a: any) => (a.addonType || '').toLowerCase().includes('insurance'));
  const insuranceFee = insuranceAddon ? Number(insuranceAddon.amount || 0) : 0;

  // Service fee addons
  const serviceFeeAddon = addons.find((a: any) => (a.addonType || '').toLowerCase().includes('service_fee') || (a.addonName || '').toLowerCase().includes('service fee'));
  const serviceFee = serviceFeeAddon ? Number(serviceFeeAddon.amount || 0) : 0;

  // Base fare = total - seats - meals - bags - addons  (approximation, with taxes estimated at ~15%)
  const knownExtras = totalSeatFees + totalMealFees + totalBagFees + protectionFee + insuranceFee + serviceFee;
  const basePlusTax = totalAmount - knownExtras;
  const estimatedBase = Math.round(basePlusTax * 0.85);
  const estimatedTax = basePlusTax - estimatedBase;

  const breakdownRows: string[] = [];
  const paxCount = passengers.length || 1;
  breakdownRows.push(`<tr><td style="padding:5px 0;color:#475569;font-size:13px;">Adult fare × ${paxCount}</td><td style="padding:5px 0;text-align:right;color:#1e293b;font-size:13px;">${fmtCur(estimatedBase)}</td></tr>`);
  if (estimatedTax > 0) breakdownRows.push(`<tr><td style="padding:5px 0;color:#475569;font-size:13px;">Taxes & government fees</td><td style="padding:5px 0;text-align:right;color:#1e293b;font-size:13px;">${fmtCur(estimatedTax)}</td></tr>`);
  if (totalSeatFees > 0) breakdownRows.push(`<tr><td style="padding:5px 0;color:#475569;font-size:13px;">Seat selection</td><td style="padding:5px 0;text-align:right;color:#1e293b;font-size:13px;">${fmtCur(totalSeatFees)}</td></tr>`);
  if (totalMealFees > 0) breakdownRows.push(`<tr><td style="padding:5px 0;color:#475569;font-size:13px;">Meals</td><td style="padding:5px 0;text-align:right;color:#1e293b;font-size:13px;">${fmtCur(totalMealFees)}</td></tr>`);
  if (totalBagFees > 0) breakdownRows.push(`<tr><td style="padding:5px 0;color:#475569;font-size:13px;">Extra baggage</td><td style="padding:5px 0;text-align:right;color:#1e293b;font-size:13px;">${fmtCur(totalBagFees)}</td></tr>`);
  if (protectionFee > 0) breakdownRows.push(`<tr><td style="padding:5px 0;color:#475569;font-size:13px;">Price drop protection</td><td style="padding:5px 0;text-align:right;color:#1e293b;font-size:13px;">${fmtCur(protectionFee)}</td></tr>`);
  if (insuranceFee > 0) breakdownRows.push(`<tr><td style="padding:5px 0;color:#475569;font-size:13px;">Travel insurance</td><td style="padding:5px 0;text-align:right;color:#1e293b;font-size:13px;">${fmtCur(insuranceFee)}</td></tr>`);
  if (serviceFee > 0) breakdownRows.push(`<tr><td style="padding:5px 0;color:#94a3b8;font-size:13px;">FAREMIND service fee</td><td style="padding:5px 0;text-align:right;color:#94a3b8;font-size:13px;">${fmtCur(serviceFee)}</td></tr>`);

  // ─── Payment info ────────────────────────────────────────────
  const payments: any[] = booking.payments || [];
  const firstPayment = payments[0];
  const paymentMethod = firstPayment?.last4 ? `Card •••• ${firstPayment.last4}` : 'Card •••• 4242';
  const hasPriceProtection = protectionFee > 0;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" /><meta name="viewport" content="width=device-width,initial-scale=1.0" />
  <title>FAREMIND Itinerary — ${ref}</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;background:#f8fafc;color:#1e293b;padding:40px 20px}
    .doc{max-width:640px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 32px rgba(0,0,0,.08)}
    .hdr{background:linear-gradient(135deg,#0f172a 0%,#1e293b 60%,#0f3460 100%);padding:28px 36px;text-align:center}
    .brand{font-size:22px;font-weight:900;letter-spacing:1px}
    .tagline{color:#64748b;font-size:12px;margin-top:4px}
    .body{padding:28px 36px}
    .section{margin-bottom:24px}
    .sec-title{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#94a3b8;margin-bottom:12px;border-bottom:1px solid #f1f5f9;padding-bottom:6px}
    .pnr-box{background:linear-gradient(135deg,#0f172a 0%,#1e293b 60%,#0f3460 100%);border-radius:0;padding:32px 36px;text-align:center;position:relative;overflow:hidden}
    .pnr-box::before{content:'';position:absolute;top:-40px;right:-40px;width:120px;height:120px;border-radius:50%;background:rgba(26,188,156,0.06)}
    .pnr{font-family:'Courier New',monospace;font-size:32px;font-weight:900;letter-spacing:8px;color:#fff}
    .pnr-label{font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:3px;font-weight:700;margin-bottom:8px}
    table{width:100%;border-collapse:collapse}
    .total-row td{padding-top:12px;border-top:2px solid #e2e8f0;font-weight:700}
    .total-amt{font-size:18px;color:#f97316;text-align:right}
    .confirmed{color:#10b981;font-weight:700}
    .note{background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px 16px;font-size:12px;color:#64748b;line-height:1.6;margin-top:16px}
    .ftr{background:#f8fafc;border-top:1px solid #e2e8f0;padding:18px 36px;text-align:center;color:#94a3b8;font-size:11px;line-height:1.6}
    @media print{
      body{background:#fff;padding:0;-webkit-print-color-adjust:exact;print-color-adjust:exact}
      .doc{box-shadow:none;border-radius:0;max-width:100%}
      .hdr{-webkit-print-color-adjust:exact;print-color-adjust:exact}
      .section{page-break-inside:avoid}
      .ftr{position:fixed;bottom:0;width:100%}
      @page{size:A4;margin:12mm 10mm}
    }
  </style>
</head>
<body>
  <div class="doc">
    <div class="pnr-box">
        <div style="display:inline-flex;align-items:center;gap:6px;background:rgba(16,185,129,0.15);border:1px solid rgba(16,185,129,0.25);border-radius:20px;padding:4px 12px;margin-bottom:12px;">
          <div style="width:6px;height:6px;border-radius:50%;background:#10b981;"></div>
          <span style="font-size:11px;font-weight:700;color:#10b981;letter-spacing:0.5px;">${booking.bookingStatus === 'CANCELLED' ? 'Cancelled' : 'Confirmed'}</span>
        </div>
        <div class="pnr-label"><span style="color:#ffffff;">FARE</span><span style="color:#009CA6;">MIND</span> <span style="color:#64748b;">BOOKING REFERENCE</span></div>
        <div class="pnr">${ref}</div>
        ${(booking.pnrs || []).length > 0 ? `<div style="margin-top:14px;">${(booking.pnrs || []).map((pnr: any) => `<div style="display:inline-flex;align-items:center;gap:8px;margin:4px 0;"><span style="font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:3px;font-weight:700;">AIRLINE PNR</span><span style="font-family:'Courier New',monospace;font-size:16px;font-weight:900;color:#1abc9c;letter-spacing:3px;">${pnr.pnrCode}</span></div>`).join('<br/>')}</div>` : (booking.masterPnr && booking.masterPnr !== ref ? `<div style="margin-top:14px;"><div style="display:inline-flex;align-items:center;gap:8px;"><span style="font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:3px;font-weight:700;">AIRLINE PNR</span><span style="font-family:'Courier New',monospace;font-size:16px;font-weight:900;color:#1abc9c;letter-spacing:3px;">${booking.masterPnr}</span></div></div>` : '')}}
    </div>
    <div class="body">
      <div class="section">
        <div class="sec-title">Itinerary Summary</div>
        <table>
          <tr><td style="padding:5px 0;color:#64748b;font-size:13px;">Route</td><td style="padding:5px 0;text-align:right;font-weight:600;font-size:13px;">${routeLabel}</td></tr>
          <tr><td style="padding:5px 0;color:#64748b;font-size:13px;">Trip type</td><td style="padding:5px 0;text-align:right;font-size:13px;">${tripType}</td></tr>
          ${depDate ? `<tr><td style="padding:5px 0;color:#64748b;font-size:13px;">Departure</td><td style="padding:5px 0;text-align:right;font-size:13px;">${depDate}</td></tr>` : ''}
          ${retDate ? `<tr><td style="padding:5px 0;color:#64748b;font-size:13px;">Return</td><td style="padding:5px 0;text-align:right;font-size:13px;">${retDate}</td></tr>` : ''}
          ${airlineName ? `<tr><td style="padding:5px 0;color:#64748b;font-size:13px;">Airline</td><td style="padding:5px 0;text-align:right;font-size:13px;">${airlineName}</td></tr>` : ''}
          ${fareClass ? `<tr><td style="padding:5px 0;color:#64748b;font-size:13px;">Fare</td><td style="padding:5px 0;text-align:right;font-size:13px;text-transform:capitalize;">${fareClass}</td></tr>` : ''}
          <tr><td style="padding:5px 0;color:#64748b;font-size:13px;">Status</td><td style="padding:5px 0;text-align:right;font-size:13px;" class="confirmed">${booking.bookingStatus === 'CANCELLED' ? 'Cancelled' : 'Confirmed'}</td></tr>
          ${(booking.pnrs || []).map((pnr: any) => `<tr><td style="padding:5px 0;color:#64748b;font-size:13px;">AIRLINE PNR</td><td style="padding:5px 0;text-align:right;font-family:monospace;font-size:14px;font-weight:700;color:#1abc9c;">${pnr.pnrCode}</td></tr>`).join('')}
        </table>
      </div>

      ${flightSectionHtml}

      <div class="section">
        <div class="sec-title">Passenger Details</div>
        ${paxHtml || '<p style="color:#94a3b8;font-size:13px;">No passenger details available.</p>'}
        <div class="note">
          ℹ Seat assignments, boarding passes, terminal, and gate information may be updated by the airline closer to departure.
          Please check airline check-in before travel.${isRT ? ' Return flight is confirmed. Seat assignment and boarding pass may be available closer to departure or during airline check-in.' : ''}
        </div>
      </div>

      <div class="section">
        <div class="sec-title">Fare Breakdown</div>
        <table>
          ${breakdownRows.join('')}
          <tr class="total-row">
            <td style="font-size:14px;">Total Charged</td>
            <td class="total-amt">${fmtCur(totalAmount)}</td>
          </tr>
        </table>
      </div>

      <div class="section">
        <div class="sec-title">Payment</div>
        <table>
          <tr><td style="padding:5px 0;color:#64748b;font-size:13px;">Payment method</td><td style="padding:5px 0;text-align:right;font-size:13px;">${paymentMethod}</td></tr>
          ${confirmedAt ? `<tr><td style="padding:5px 0;color:#64748b;font-size:13px;">Confirmed at</td><td style="padding:5px 0;text-align:right;font-size:12px;color:#475569;">${confirmedAt}</td></tr>` : ''}
          ${hasPriceProtection ? `<tr><td style="padding:5px 0;color:#64748b;font-size:13px;">Price protection</td><td style="padding:5px 0;text-align:right;font-size:13px;color:#1abc9c;">Active</td></tr>` : ''}
        </table>
      </div>
    </div>
    <div class="ftr">
      <p>Generated by FAREMIND · faremind.ai</p>
      <p style="margin-top:4px;">Keep this document for your records. Questions? Email support@faremind.ai</p>
    </div>
  </div>
</body>
</html>`;
}


