// src/app/checkout/passengers/page.tsx
'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft,
  Lock,
  ChevronRight,
  User,
  AlertCircle,
  Check,
  Loader2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useCheckoutStore } from '@/store/useCheckoutStore';
import type { PassengerInfo } from '@/store/useCheckoutStore';
import { apiFetch } from '@/lib/api-client';

// ─── Constants ────────────────────────────────────────────────────────────────

const STEPS = ['Itinerary', 'Passengers', 'Seats', 'Meals', 'Add-ons', 'Review', 'Payment'] as const;
const STEP_INDEX = 1;

const GENDERS = [
  { value: 'male', label: 'Male' },
  { value: 'female', label: 'Female' },
  { value: 'other', label: 'Other / Prefer not to say' },
] as const;

const COUNTRIES = [
  'Australia', 'Brazil', 'Canada', 'China', 'France', 'Germany',
  'India', 'Italy', 'Japan', 'Mexico', 'Netherlands', 'New Zealand',
  'Singapore', 'South Korea', 'Spain', 'Sweden', 'Switzerland',
  'UAE', 'United Kingdom', 'United States',
];

// ─── Validation ───────────────────────────────────────────────────────────────

interface PassengerErrors {
  firstName?: string;
  lastName?: string;
  dateOfBirth?: string;
  nationality?: string;
  passportCountry?: string;
  passportNumber?: string;
  passportExpiry?: string;
  email?: string;
  phone?: string;
}

function validatePassenger(pax: PassengerInfo): PassengerErrors {
  const errors: PassengerErrors = {};
  if (!pax.firstName.trim()) errors.firstName = 'First name is required';
  if (!pax.lastName.trim()) errors.lastName = 'Last name is required';
  if (!pax.dateOfBirth) errors.dateOfBirth = 'Date of birth is required';
  if (!pax.nationality) errors.nationality = 'Nationality is required';
  if (!pax.passportCountry) errors.passportCountry = 'Passport country is required';
  if (pax.nationality && pax.passportCountry && pax.nationality !== pax.passportCountry)
    errors.passportCountry = 'Passport country must match nationality';
  if (!pax.passportNumber.trim()) errors.passportNumber = 'Passport number is required';
  if (!pax.passportExpiry) {
    errors.passportExpiry = 'Passport expiry is required';
  } else {
    const expiry = new Date(pax.passportExpiry);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const year = expiry.getFullYear();
    const maxYear = today.getFullYear() + 20;
    if (isNaN(expiry.getTime()) || year < 2000 || year > maxYear) {
      errors.passportExpiry = `Enter a valid expiry date (year between 2000 and ${maxYear})`;
    } else if (expiry < today) {
      errors.passportExpiry = 'Passport is expired — please use a valid passport';
    } else {
      const sixMonthsOut = new Date(today);
      sixMonthsOut.setMonth(sixMonthsOut.getMonth() + 6);
      if (expiry < sixMonthsOut) {
        errors.passportExpiry = 'Passport must be valid for at least 6 months from today';
      }
    }
  }
  if (pax.isContact) {
    if (!pax.email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(pax.email))
      errors.email = 'Valid email is required';
    if (!pax.phone.trim()) errors.phone = 'Phone number is required';
  }
  return errors;
}

function isFormValid(passengers: PassengerInfo[]): boolean {
  return passengers.every(p => Object.keys(validatePassenger(p)).length === 0);
}

// ─── Primitives ───────────────────────────────────────────────────────────────

function FieldLabel({ children, required }: { children: React.ReactNode; required?: boolean }) {
  return (
    <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
      {children}
      {required && <span className="text-red-500 ml-1">*</span>}
    </label>
  );
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p className="mt-1 flex items-center gap-1 text-xs text-red-500">
      <AlertCircle className="w-3 h-3 flex-shrink-0" />
      {message}
    </p>
  );
}

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  hasError?: boolean;
}

function Input({ hasError, className = '', ...props }: InputProps) {
  return (
    <input
      {...props}
      className={`w-full px-4 py-3 rounded-xl bg-slate-50 border text-slate-900 placeholder-slate-400 text-sm focus:outline-none focus:bg-white transition-all ${
        hasError
          ? 'border-red-400 focus:border-red-400'
          : 'border-slate-200 focus:border-[#1ABC9C]/50'
      } ${className}`}
    />
  );
}

interface SelectFieldProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  hasError?: boolean;
}

function SelectField({ hasError, className = '', children, ...props }: SelectFieldProps) {
  return (
    <select
      {...props}
      className={`w-full px-4 py-3 rounded-xl bg-slate-50 border text-slate-900 text-sm focus:outline-none focus:bg-white transition-all appearance-none cursor-pointer ${
        hasError
          ? 'border-red-400 focus:border-red-400'
          : 'border-slate-200 focus:border-[#1ABC9C]/50'
      } ${className}`}
    >
      {children}
    </select>
  );
}

// ─── Primary Contact Box ──────────────────────────────────────────────────────

interface PrimaryContactProps {
  pax: PassengerInfo;
  errors: PassengerErrors;
  touched: boolean;
  onChange: (field: keyof PassengerInfo, value: string) => void;
}

function PrimaryContactBox({ pax, errors, touched, onChange }: PrimaryContactProps) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 mb-6">
      <div className="flex items-center gap-3 mb-5">
        <div className="w-8 h-8 rounded-full bg-[#1ABC9C]/10 flex items-center justify-center">
          <User className="w-4 h-4 text-[#1ABC9C]" />
        </div>
        <div>
          <h3 className="text-sm font-bold text-slate-900">Primary Contact</h3>
          <p className="text-xs text-slate-500 mt-0.5">Booking confirmation will be sent to this email</p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <FieldLabel required>First Name</FieldLabel>
          <Input
            type="text"
            placeholder="John"
            value={pax.firstName}
            onChange={e => onChange('firstName', e.target.value)}
            hasError={touched && !!errors.firstName}
          />
          {touched && <FieldError message={errors.firstName} />}
        </div>

        <div>
          <FieldLabel required>Last Name</FieldLabel>
          <Input
            type="text"
            placeholder="Doe"
            value={pax.lastName}
            onChange={e => onChange('lastName', e.target.value)}
            hasError={touched && !!errors.lastName}
          />
          {touched && <FieldError message={errors.lastName} />}
        </div>

        <div>
          <FieldLabel required>Email Address</FieldLabel>
          <Input
            type="email"
            placeholder="john.doe@example.com"
            value={pax.email}
            onChange={e => onChange('email', e.target.value)}
            hasError={touched && !!errors.email}
          />
          {touched && <FieldError message={errors.email} />}
        </div>

        <div>
          <FieldLabel required>Phone Number</FieldLabel>
          <Input
            type="tel"
            placeholder="+1 555 000 0000"
            value={pax.phone}
            onChange={e => onChange('phone', e.target.value)}
            hasError={touched && !!errors.phone}
          />
          {touched && <FieldError message={errors.phone} />}
        </div>
      </div>
    </div>
  );
}

// ─── Passenger Card ───────────────────────────────────────────────────────────

interface PassengerCardProps {
  pax: PassengerInfo;
  index: number;
  errors: PassengerErrors;
  touched: boolean;
  onChange: (field: keyof PassengerInfo, value: string) => void;
}

function PassengerCard({ pax, index, errors, touched, onChange }: PassengerCardProps) {
  const typeLabel = pax.type === 'adult' ? 'Adult' : pax.type === 'child' ? 'Child' : 'Infant';

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 mb-4">
      <div className="flex items-center gap-3 mb-5">
        <div className="w-8 h-8 rounded-full bg-[#0F172A] flex items-center justify-center text-white text-xs font-bold">
          {index + 1}
        </div>
        <h3 className="text-sm font-bold text-slate-900">
          Traveler {index + 1}{' '}
          <span className="text-slate-400 font-normal">({typeLabel})</span>
        </h3>
      </div>

      {/* Name row */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
        <div>
          <FieldLabel required>First Name</FieldLabel>
          <Input
            type="text"
            placeholder="John"
            value={pax.firstName}
            onChange={e => onChange('firstName', e.target.value)}
            hasError={touched && !!errors.firstName}
          />
          {touched && <FieldError message={errors.firstName} />}
        </div>
        <div>
          <FieldLabel>Middle Name</FieldLabel>
          <Input
            type="text"
            placeholder="Optional"
            value={pax.middleName}
            onChange={e => onChange('middleName', e.target.value)}
          />
        </div>
        <div>
          <FieldLabel required>Last Name</FieldLabel>
          <Input
            type="text"
            placeholder="Doe"
            value={pax.lastName}
            onChange={e => onChange('lastName', e.target.value)}
            hasError={touched && !!errors.lastName}
          />
          {touched && <FieldError message={errors.lastName} />}
        </div>
      </div>

      {/* Personal info row */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
        <div>
          <FieldLabel required>Gender</FieldLabel>
          <SelectField
            value={pax.gender}
            onChange={e => onChange('gender', e.target.value)}
          >
            {GENDERS.map(g => (
              <option key={g.value} value={g.value}>{g.label}</option>
            ))}
          </SelectField>
        </div>
        <div>
          <FieldLabel required>Date of Birth</FieldLabel>
          <Input
            type="date"
            value={pax.dateOfBirth}
            onChange={e => onChange('dateOfBirth', e.target.value)}
            hasError={touched && !!errors.dateOfBirth}
            max={new Date().toISOString().split('T')[0]}
          />
          {touched && <FieldError message={errors.dateOfBirth} />}
        </div>
        <div>
          <FieldLabel required>Nationality</FieldLabel>
          <SelectField
            value={pax.nationality}
            onChange={e => onChange('nationality', e.target.value)}
            hasError={touched && !!errors.nationality}
          >
            <option value="">Select country</option>
            {COUNTRIES.map(c => (
              <option key={c} value={c}>{c}</option>
            ))}
          </SelectField>
          {touched && <FieldError message={errors.nationality} />}
        </div>
      </div>

      {/* Passport row */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div>
          <FieldLabel required>Passport Country</FieldLabel>
          <SelectField
            value={pax.passportCountry}
            onChange={e => onChange('passportCountry', e.target.value)}
            hasError={touched && !!errors.passportCountry}
          >
            <option value="">Select country</option>
            {COUNTRIES.map(c => (
              <option key={c} value={c}>{c}</option>
            ))}
          </SelectField>
          {touched && <FieldError message={errors.passportCountry} />}
        </div>
        <div>
          <FieldLabel required>Passport Number</FieldLabel>
          <Input
            type="text"
            placeholder="A12345678"
            value={pax.passportNumber}
            onChange={e => onChange('passportNumber', e.target.value.toUpperCase())}
            hasError={touched && !!errors.passportNumber}
          />
          {touched && <FieldError message={errors.passportNumber} />}
        </div>
        <div>
          <FieldLabel required>Passport Expiry</FieldLabel>
          <Input
            type="date"
            value={pax.passportExpiry}
            onChange={e => onChange('passportExpiry', e.target.value)}
            hasError={touched && !!errors.passportExpiry}
            min={new Date().toISOString().split('T')[0]}
            max={`${new Date().getFullYear() + 20}-12-31`}
          />
          {touched && <FieldError message={errors.passportExpiry} />}
        </div>
      </div>
    </div>
  );
}

// ─── Sub-header ───────────────────────────────────────────────────────────────

function StepChips({ currentStep }: { currentStep: number }) {
  return (
    <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-hide w-full">
      {STEPS.map((step, i) => {
        const isDone = i < currentStep;
        const isActive = i === currentStep;
        return (
          <div key={step} className="flex items-center gap-1.5 flex-none">
            <div className={cn(
              'flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold transition-all',
              isActive && 'bg-[#1ABC9C] text-white',
              isDone && 'bg-emerald-100 text-emerald-700',
              !isActive && !isDone && 'bg-slate-100 text-slate-400',
            )}>
              {isDone ? <Check className="w-3 h-3" strokeWidth={3} /> : (
                <span className="w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-bold bg-white/20">{i + 1}</span>
              )}
              <span className="hidden sm:inline">{step}</span>
            </div>
            {i < STEPS.length - 1 && (
              <div className={cn('w-4 h-px flex-none', i < currentStep ? 'bg-emerald-300' : 'bg-slate-200')} />
            )}
          </div>
        );
      })}
    </div>
  );
}

function CheckoutHeader({ stepIndex }: { stepIndex: number }) {
  const router = useRouter();
  const progressPct = Math.round(((stepIndex + 1) / STEPS.length) * 100);
  return (
    <div className="sticky top-16 z-10 bg-[#1a1a2e]/95 backdrop-blur-xl border-b border-white/[0.06] shadow-lg">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-[90px] flex items-center justify-between gap-4">
        <button onClick={() => router.back()} className="flex items-center gap-2 text-slate-400 hover:text-white transition-colors text-sm font-medium flex-none">
          <ArrowLeft className="w-4 h-4" />
          <span className="hidden sm:inline">Book Your Flight</span>
        </button>
        <div className="flex-1 overflow-hidden">
          <StepChips currentStep={stepIndex} />
        </div>
        <div className="flex items-center gap-1.5 text-slate-400 text-xs font-semibold flex-none">
          <Lock className="w-3 h-3" />
          <span className="hidden sm:inline">Secure Checkout</span>
          <span className="text-slate-600 mx-1">·</span>
          <span className="text-slate-300">Step {stepIndex + 1} of 7</span>
        </div>
      </div>
      <div className="h-0.5 bg-slate-800">
        <div className="h-full bg-[#1ABC9C] transition-all duration-500" style={{ width: `${progressPct}%` }} />
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function PassengersPage() {
  const router = useRouter();
  const passengers = useCheckoutStore(s => s.passengers);
  const selectedFare = useCheckoutStore(s => s.selectedFare);
  const sessionId = useCheckoutStore(s => s.sessionId);
  const updatePassenger = useCheckoutStore(s => s.updatePassenger);

  const [touched, setTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedFare || !sessionId) {
      router.replace('/');
    }
  }, [selectedFare, sessionId, router]);

  const allErrors = passengers.map(p => validatePassenger(p));
  const valid = isFormValid(passengers);

  const handleChange = useCallback(
    (paxId: string, field: keyof PassengerInfo, value: string) => {
      updatePassenger(paxId, { [field]: value } as Partial<PassengerInfo>);
    },
    [updatePassenger],
  );

  const handleSubmit = async () => {
    if (!sessionId) { router.replace('/'); return; }
    setTouched(true);
    if (!valid) return;

    setSubmitting(true);
    setSubmitError(null);

    try {
      await apiFetch('/api/checkout/passengers/save', {
        method: 'POST',
        body: JSON.stringify({ sessionId, passengers }),
      });
      router.push('/checkout/seats');
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
      setSubmitting(false);
    }
  };

  if (!selectedFare || !sessionId) return null;

  const primaryPax = passengers[0];
  const primaryErrors = allErrors[0] ?? {};

  return (
    <div className="min-h-screen bg-slate-50">
      <CheckoutHeader stepIndex={STEP_INDEX} />

      <main className="max-w-7xl mx-auto px-4 py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-[#0F172A]">Passenger Details</h1>
          <p className="text-sm text-slate-500 mt-1">
            Enter details exactly as they appear on each traveler&apos;s passport.
          </p>
        </div>

        {/* Primary Contact (passengers[0]) */}
        {primaryPax && (
          <PrimaryContactBox
            pax={primaryPax}
            errors={primaryErrors}
            touched={touched}
            onChange={(field, value) => handleChange(primaryPax.id, field, value)}
          />
        )}

        {/* All passenger cards */}
        {passengers.map((pax, i) => (
          <PassengerCard
            key={pax.id}
            pax={pax}
            index={i}
            errors={allErrors[i] ?? {}}
            touched={touched}
            onChange={(field, value) => handleChange(pax.id, field, value)}
          />
        ))}

        {/* Validation summary */}
        {touched && !valid && (
          <div className="mb-4 flex items-start gap-3 p-4 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm">
            <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
            <span>Please fill in all required fields for every traveler before continuing.</span>
          </div>
        )}

        {/* API error */}
        {submitError && (
          <div className="mb-4 flex items-start gap-3 p-4 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm">
            <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
            <span>{submitError}</span>
          </div>
        )}

        {/* CTA */}
        <button
          onClick={handleSubmit}
          disabled={submitting || (touched && !valid)}
          className="w-full py-4 rounded-2xl bg-[#1ABC9C] hover:bg-emerald-500 text-white font-bold text-sm shadow-lg shadow-[#1ABC9C]/25 transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none"
        >
          {submitting ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Saving...
            </>
          ) : (
            <>
              Continue to Seats
              <ChevronRight className="w-4 h-4" />
            </>
          )}
        </button>

        <p className="text-center text-xs text-slate-400 mt-4">
          <Lock className="w-3 h-3 inline mr-1" />
          Your personal data is encrypted and never shared with third parties.
        </p>
      </main>
    </div>
  );
}
