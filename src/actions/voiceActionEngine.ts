/**
 * Voice Action Engine
 *
 * Converts structured JSON from the voice parser into data that can
 * populate the existing Hero Search Form fields.
 *
 * Does NOT manipulate DOM, simulate clicks, or create hidden forms.
 * Just produces a typed data object the SearchForm can consume.
 */

import { AIRPORTS } from '@/data/airports';
import type { CabinClass, TripType } from '@/lib/types';
import type { VoiceSearchParams } from '@/services/voiceParserService';
import { isActionSupported, type PageContext } from '@/contexts/pageContextRegistry';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface VoiceFormData {
  origin: string;         // Display name e.g. "Dallas, TX (DFW)"
  originCode: string;     // IATA code e.g. "DFW"
  destination: string;    // Display name
  destCode: string;       // IATA code
  departureDate: string;  // YYYY-MM-DD
  returnDate: string;     // YYYY-MM-DD
  passengers: {
    adults: number;
    children: number;
    infants: number;
  };
  cabinClass: CabinClass;
  tripType: TripType;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Look up an IATA code in the airport database and return a display string.
 * Returns the code itself if not found.
 */
function airportDisplayName(code: string): string {
  const airport = AIRPORTS.find((a) => a.code === code);
  if (!airport) return code;
  const parts = [airport.city];
  if (airport.state) parts.push(airport.state);
  return `${parts.join(', ')} (${airport.code})`;
}

/**
 * Map the GPT cabin class string to the SearchForm's CabinClass type.
 */
function mapCabinClass(cabin: string | null | undefined): CabinClass {
  switch (cabin?.toUpperCase()) {
    case 'PREMIUM_ECONOMY': return 'premium_economy';
    case 'BUSINESS': return 'business';
    case 'FIRST': return 'first';
    default: return 'economy';
  }
}

/**
 * Map the GPT trip type string to the SearchForm's TripType type.
 */
function mapTripType(trip: string | null | undefined): TripType {
  switch (trip?.toUpperCase()) {
    case 'ONE_WAY': return 'one_way';
    case 'ROUND_TRIP': return 'round_trip';
    default: return 'round_trip';
  }
}

// ─── Page context validation ────────────────────────────────────────────────

/**
 * Check if a parsed voice action is valid for the current page context.
 */
export function validateActionForContext(
  action: string,
  pageContext: PageContext,
): { valid: boolean; message: string } {
  if (isActionSupported(pageContext, action)) {
    return { valid: true, message: '' };
  }

  if (pageContext === 'HOME_SEARCH') {
    return { valid: false, message: 'Only flight search commands are supported right now.' };
  }

  return {
    valid: false,
    message: 'Voice commands for this page are coming soon. Navigate to the home page to search flights by voice.',
  };
}

// ─── Main conversion ────────────────────────────────────────────────────────

/**
 * Convert parsed voice search parameters into form-ready data.
 *
 * Missing values get sensible defaults:
 * - origin/destination: empty string (form will show validation error)
 * - dates: tomorrow / next week
 * - passengers: 1 adult
 * - cabin: economy
 */
export function buildVoiceFormData(params: VoiceSearchParams): VoiceFormData {
  const now = new Date();
  const tomorrow = new Date(now.getTime() + 86400000).toISOString().split('T')[0];
  const nextWeek = new Date(now.getTime() + 7 * 86400000).toISOString().split('T')[0];

  const originCode = params.origin ?? '';
  const destCode = params.destination ?? '';
  const tripType = mapTripType(params.tripType);

  return {
    origin: originCode ? airportDisplayName(originCode) : '',
    originCode,
    destination: destCode ? airportDisplayName(destCode) : '',
    destCode,
    departureDate: params.departureDate ?? tomorrow,
    returnDate: params.returnDate ?? (tripType === 'round_trip' ? nextWeek : ''),
    passengers: {
      adults: params.adults ?? 1,
      children: params.children ?? 0,
      infants: params.infants ?? 0,
    },
    cabinClass: mapCabinClass(params.cabinClass),
    tripType,
  };
}

// ─── Validation ─────────────────────────────────────────────────────────────

export interface VoiceValidation {
  isValid: boolean;
  missingFields: string[];
}

/**
 * Check whether the parsed voice data has enough information to search.
 */
export function validateVoiceFormData(data: VoiceFormData): VoiceValidation {
  const missingFields: string[] = [];

  if (!data.destCode) missingFields.push('destination');
  if (!data.originCode) missingFields.push('origin');
  if (!data.departureDate) missingFields.push('departure date');

  return {
    isValid: missingFields.length === 0,
    missingFields,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Phase 2: Passenger Details Voice Fill
// ═══════════════════════════════════════════════════════════════════════════════

import type { VoicePassengerResult, VoicePassengerParams } from '@/services/voiceParserService';
import type { PassengerInfo } from '@/store/useCheckoutStore';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface FilledField {
  field: string;
  label: string;
  value: string;
  displayValue: string; // masked for sensitive fields
}

export interface FieldConflict {
  field: string;
  label: string;
  existingValue: string;
  newValue: string;
}

export interface PassengerFillResult {
  success: boolean;
  targetLabel: string;           // e.g. "Traveler 1" or "Primary Contact"
  targetIndex: number;           // passengers array index (0-based)
  filledFields: FilledField[];
  conflicts: FieldConflict[];
  missingFields: string[];
  validationErrors: string[];
  pendingUpdates?: Partial<PassengerInfo>;
  passengerId?: string;
}

/**
 * Commit pending voice-parsed data to the checkout store.
 * Call this ONLY when the user confirms the voice fill.
 */
export function commitVoiceData(
  result: PassengerFillResult,
  updatePassenger: (id: string, updates: Partial<PassengerInfo>) => void,
) {
  if (result.passengerId && result.pendingUpdates && Object.keys(result.pendingUpdates).length > 0) {
    updatePassenger(result.passengerId, result.pendingUpdates);
    console.log('[Voice] ✅ Committed pending voice data for', result.targetLabel);
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

const FIELD_LABELS: Record<string, string> = {
  firstName: 'First Name',
  middleName: 'Middle Name',
  lastName: 'Last Name',
  gender: 'Gender',
  dateOfBirth: 'Date of Birth',
  nationality: 'Nationality',
  passportCountry: 'Passport Country',
  passportNumber: 'Passport Number',
  passportExpiry: 'Passport Expiry',
  email: 'Email',
  phone: 'Phone',
};

function maskPassportDisplay(pp: string): string {
  if (pp.length < 3) return '***';
  return pp.slice(0, 1) + '•'.repeat(pp.length - 3) + pp.slice(-2);
}

function formatDateDisplay(dateStr: string): string {
  if (!dateStr) return '—';
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function capitalizeGender(g: string): string {
  return g.charAt(0).toUpperCase() + g.slice(1);
}

function calculateAgeOnDate(dob: string, refDate: string): number {
  const birth = new Date(dob + 'T00:00:00');
  const ref = new Date(refDate + 'T00:00:00');
  if (isNaN(birth.getTime()) || isNaN(ref.getTime())) return -1;
  let age = ref.getFullYear() - birth.getFullYear();
  const monthDiff = ref.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && ref.getDate() < birth.getDate())) {
    age--;
  }
  return age;
}

function getPassengerTypeByAge(age: number): 'adult' | 'child' | 'infant' {
  if (age < 0) return 'adult';
  if (age < 2) return 'infant';
  if (age < 12) return 'child';
  return 'adult';
}

function typeLabel(type: string): string {
  switch (type) {
    case 'adult': return 'Adult';
    case 'child': return 'Child (2-11)';
    case 'infant': return 'Infant (under 2)';
    default: return type;
  }
}

// ─── Main function ──────────────────────────────────────────────────────────

/**
 * Collapse spaced-out characters from voice transcription.
 * Speech-to-text sometimes returns single letters separated by spaces,
 * e.g. "p a r i h a r" → "parihar".
 */
function collapseSpacedLetters(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;
  if (/^\S(\s\S)+$/.test(trimmed)) {
    return trimmed.replace(/\s/g, '');
  }
  const parts = trimmed.split(/\s{2,}/);
  if (parts.length > 1 && parts.every(p => /^\S(\s\S)+$/.test(p))) {
    return parts.map(p => p.replace(/\s/g, '')).join(' ');
  }
  return trimmed;
}

// Fields where spaced-letter collapsing should be applied
const COLLAPSE_FIELDS = new Set<string>([
  'firstName', 'middleName', 'lastName', 'gender',
  'nationality', 'passportCountry', 'passportNumber',
]);

/**
 * Apply voice-parsed passenger data to the checkout store.
 *
 * Does NOT overwrite existing non-empty fields unless `forceOverwrite` is true.
 * Returns a result with filled fields, conflicts, and validation errors.
 *
 * This function calls updatePassenger() for fields that can be applied,
 * and returns conflicts for fields that already have different values.
 */
export function applyPassengerVoiceData(
  parsed: VoicePassengerResult,
  passengers: PassengerInfo[],
  updatePassenger: (id: string, updates: Partial<PassengerInfo>) => void,
  departureDate?: string,
  forceOverwrite: boolean = false,
  dryRun: boolean = false,
): PassengerFillResult {
  const isPrimaryContact = parsed.action === 'FILL_PRIMARY_CONTACT';

  // Resolve target passenger
  let targetIndex: number;
  let targetLabel: string;

  if (isPrimaryContact) {
    // Primary contact is always passengers[0]
    targetIndex = 0;
    targetLabel = 'Primary Contact';
  } else {
    // travelerIndex is 1-based from GPT
    const ti = parsed.travelerIndex ?? 1;
    targetIndex = ti - 1;
    targetLabel = `Traveler ${ti}`;

    // Validate index
    if (targetIndex < 0 || targetIndex >= passengers.length) {
      return {
        success: false,
        targetLabel: `Traveler ${ti}`,
        targetIndex: -1,
        filledFields: [],
        conflicts: [],
        missingFields: [],
        validationErrors: [`Traveler ${ti} is not available on this booking. This booking has ${passengers.length} traveler${passengers.length > 1 ? 's' : ''}.`],
      };
    }
  }

  const passenger = passengers[targetIndex];
  if (!passenger) {
    return {
      success: false,
      targetLabel,
      targetIndex: -1,
      filledFields: [],
      conflicts: [],
      missingFields: [],
      validationErrors: ['Could not find the target passenger.'],
    };
  }

  const params = parsed.params;
  const filledFields: FilledField[] = [];
  const conflicts: FieldConflict[] = [];
  const validationErrors: string[] = [];
  const updates: Partial<PassengerInfo> = {};

  // ── Map param fields to passenger fields ──────────────────────────────

  type FieldMapping = {
    paramKey: keyof VoicePassengerParams;
    passengerKey: keyof PassengerInfo;
    transform?: (val: string) => string;
    displayTransform?: (val: string) => string;
  };

  const fieldMappings: FieldMapping[] = [
    { paramKey: 'firstName', passengerKey: 'firstName' },
    { paramKey: 'middleName', passengerKey: 'middleName' },
    { paramKey: 'lastName', passengerKey: 'lastName' },
    { paramKey: 'gender', passengerKey: 'gender', displayTransform: capitalizeGender },
    { paramKey: 'dateOfBirth', passengerKey: 'dateOfBirth', displayTransform: formatDateDisplay },
    { paramKey: 'nationality', passengerKey: 'nationality' },
    { paramKey: 'passportCountry', passengerKey: 'passportCountry' },
    { paramKey: 'passportNumber', passengerKey: 'passportNumber', transform: (v) => v.replace(/[^A-Za-z0-9]/g, '').toUpperCase(), displayTransform: maskPassportDisplay },
    { paramKey: 'passportExpiry', passengerKey: 'passportExpiry', displayTransform: formatDateDisplay },
    { paramKey: 'email', passengerKey: 'email' },
  ];

  for (const mapping of fieldMappings) {
    const newValue = params[mapping.paramKey];
    if (newValue === null || newValue === undefined) continue;

    const newStr = String(newValue).trim();
    if (!newStr) continue;

    // Collapse spaced-out letters from voice input (e.g. "p a r i h a r" → "parihar")
    const collapsed = COLLAPSE_FIELDS.has(mapping.paramKey) ? collapseSpacedLetters(newStr) : newStr;

    const existingValue = String(passenger[mapping.passengerKey] ?? '').trim();
    const transformedValue = mapping.transform ? mapping.transform(collapsed) : collapsed;
    const displayValue = mapping.displayTransform ? mapping.displayTransform(transformedValue) : transformedValue;
    const label = FIELD_LABELS[mapping.passengerKey] ?? mapping.passengerKey;

    if (existingValue && existingValue !== transformedValue && !forceOverwrite) {
      // Conflict — existing value differs
      conflicts.push({
        field: mapping.passengerKey,
        label,
        existingValue: mapping.displayTransform ? mapping.displayTransform(existingValue) : existingValue,
        newValue: displayValue,
      });
    } else {
      // Can fill — either empty or same value or forceOverwrite
      (updates as any)[mapping.passengerKey] = transformedValue;
      filledFields.push({ field: mapping.passengerKey, label, value: transformedValue, displayValue });
    }
  }

  // ── Handle phone (special: combine countryCode + number into E.164) ───

  if (params.phoneCountryCode || params.phoneNumber) {
    const cc = (params.phoneCountryCode ?? '').replace(/[^0-9+]/g, '');
    const num = (params.phoneNumber ?? '').replace(/\D/g, '');
    if (cc || num) {
      const phone = (cc.startsWith('+') ? cc : '+' + cc) + num;
      const existingPhone = passenger.phone?.trim() ?? '';
      const label = FIELD_LABELS.phone ?? 'Phone';

      if (existingPhone && existingPhone !== phone && !forceOverwrite) {
        conflicts.push({ field: 'phone', label, existingValue: existingPhone, newValue: phone });
      } else {
        updates.phone = phone;
        filledFields.push({ field: 'phone', label, value: phone, displayValue: phone });
      }
    }
  }

  // ── Validation ────────────────────────────────────────────────────────

  // DOB / passenger type check
  const dobToCheck = (updates.dateOfBirth as string) ?? passenger.dateOfBirth;
  if (dobToCheck && departureDate) {
    const age = calculateAgeOnDate(dobToCheck, departureDate);
    if (age >= 0) {
      const computedType = getPassengerTypeByAge(age);
      if (computedType !== passenger.type) {
        validationErrors.push(
          `${targetLabel} is listed as ${typeLabel(passenger.type)}, but the date of birth indicates ${typeLabel(computedType)} (age ${age}) on the travel date. Please correct the date of birth or restart search with correct traveler type.`
        );
      }
    }
  }

  // Passport expiry check
  const expiryToCheck = (updates.passportExpiry as string) ?? passenger.passportExpiry;
  if (expiryToCheck) {
    const expiry = new Date(expiryToCheck + 'T00:00:00');
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (expiry < today) {
      validationErrors.push('Passport expiry appears to be in the past. Please verify.');
    } else if (departureDate) {
      const travelDate = new Date(departureDate + 'T00:00:00');
      if (expiry < travelDate) {
        validationErrors.push('Passport expiry appears to be before the travel date. Please verify.');
      }
    }
  }

  // Check missing required fields for the target
  const missingFields: string[] = [];
  if (!isPrimaryContact) {
    const checkField = (key: keyof PassengerInfo, label: string) => {
      const hasNew = (updates as any)[key];
      const hasExisting = passenger[key];
      if (!hasNew && !hasExisting) missingFields.push(label);
    };
    checkField('firstName', 'First Name');
    checkField('lastName', 'Last Name');
    checkField('dateOfBirth', 'Date of Birth');
    checkField('nationality', 'Nationality');
    checkField('passportNumber', 'Passport Number');
    checkField('passportExpiry', 'Passport Expiry');
  }

  // ── Apply updates to store (skip if dryRun) ───────────────────────────

  if (!dryRun && Object.keys(updates).length > 0) {
    updatePassenger(passenger.id, updates);
  }

  return {
    success: filledFields.length > 0 || conflicts.length > 0,
    targetLabel,
    targetIndex,
    filledFields,
    conflicts,
    missingFields,
    validationErrors,
    pendingUpdates: updates,
    passengerId: passenger.id,
  };
}

/**
 * Force-apply all conflicting fields (user chose "Replace All").
 */
export function forceApplyConflicts(
  conflicts: FieldConflict[],
  passenger: PassengerInfo,
  updatePassenger: (id: string, updates: Partial<PassengerInfo>) => void,
  originalParams: VoicePassengerParams,
): FilledField[] {
  const updates: Partial<PassengerInfo> = {};
  const filledFields: FilledField[] = [];

  for (const conflict of conflicts) {
    const paramKey = conflict.field as keyof VoicePassengerParams;
    let value: string;

    if (conflict.field === 'phone') {
      const cc = (originalParams.phoneCountryCode ?? '').replace(/[^0-9+]/g, '');
      const num = (originalParams.phoneNumber ?? '').replace(/\D/g, '');
      value = (cc.startsWith('+') ? cc : '+' + cc) + num;
    } else {
      value = String(originalParams[paramKey] ?? '').trim();
    }

    if (value) {
      (updates as any)[conflict.field] = value;
      const displayValue = conflict.field === 'passportNumber'
        ? maskPassportDisplay(value)
        : conflict.field === 'dateOfBirth' || conflict.field === 'passportExpiry'
          ? formatDateDisplay(value)
          : conflict.field === 'gender'
            ? capitalizeGender(value)
            : value;
      filledFields.push({
        field: conflict.field,
        label: conflict.label,
        value,
        displayValue,
      });
    }
  }

  if (Object.keys(updates).length > 0) {
    updatePassenger(passenger.id, updates);
  }

  return filledFields;
}
