// src/app/checkout/passengers/page.tsx
'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Lock,
  ChevronRight,
  User,
  AlertCircle,
  Check,
  Loader2,
} from 'lucide-react';
import { CheckoutHeader } from '@/components/checkout/CheckoutStepNav';
import { cn } from '@/lib/utils';
import { useCheckoutStore } from '@/store/useCheckoutStore';
import type { PassengerInfo } from '@/store/useCheckoutStore';
import { apiFetch } from '@/lib/api-client';

// ─── Constants ────────────────────────────────────────────────────────────────

const STEP_INDEX = 1;

// ─── Country Codes ────────────────────────────────────────────────────────────

interface CountryCode {
  code: string;
  flag: string;
  name: string;
  localDigits: number; // expected digits in local number
}

const COUNTRY_CODES: CountryCode[] = [
  { code: '93',   flag: '🇦🇫', name: 'Afghanistan',             localDigits: 9  },
  { code: '355',  flag: '🇦🇱', name: 'Albania',                 localDigits: 9  },
  { code: '213',  flag: '🇩🇿', name: 'Algeria',                 localDigits: 9  },
  { code: '376',  flag: '🇦🇩', name: 'Andorra',                 localDigits: 9  },
  { code: '244',  flag: '🇦🇴', name: 'Angola',                  localDigits: 9  },
  { code: '54',   flag: '🇦🇷', name: 'Argentina',               localDigits: 10 },
  { code: '374',  flag: '🇦🇲', name: 'Armenia',                 localDigits: 8  },
  { code: '61',   flag: '🇦🇺', name: 'Australia',               localDigits: 9  },
  { code: '43',   flag: '🇦🇹', name: 'Austria',                 localDigits: 10 },
  { code: '994',  flag: '🇦🇿', name: 'Azerbaijan',              localDigits: 9  },
  { code: '973',  flag: '🇧🇭', name: 'Bahrain',                 localDigits: 8  },
  { code: '880',  flag: '🇧🇩', name: 'Bangladesh',              localDigits: 10 },
  { code: '375',  flag: '🇧🇾', name: 'Belarus',                 localDigits: 10 },
  { code: '32',   flag: '🇧🇪', name: 'Belgium',                 localDigits: 9  },
  { code: '501',  flag: '🇧🇿', name: 'Belize',                  localDigits: 7  },
  { code: '591',  flag: '🇧🇴', name: 'Bolivia',                 localDigits: 8  },
  { code: '55',   flag: '🇧🇷', name: 'Brazil',                  localDigits: 11 },
  { code: '673',  flag: '🇧🇳', name: 'Brunei',                  localDigits: 7  },
  { code: '359',  flag: '🇧🇬', name: 'Bulgaria',                localDigits: 9  },
  { code: '855',  flag: '🇰🇭', name: 'Cambodia',                localDigits: 9  },
  { code: '237',  flag: '🇨🇲', name: 'Cameroon',                localDigits: 9  },
  { code: '56',   flag: '🇨🇱', name: 'Chile',                   localDigits: 9  },
  { code: '86',   flag: '🇨🇳', name: 'China',                   localDigits: 11 },
  { code: '57',   flag: '🇨🇴', name: 'Colombia',                localDigits: 10 },
  { code: '506',  flag: '🇨🇷', name: 'Costa Rica',              localDigits: 8  },
  { code: '385',  flag: '🇭🇷', name: 'Croatia',                 localDigits: 9  },
  { code: '53',   flag: '🇨🇺', name: 'Cuba',                    localDigits: 8  },
  { code: '357',  flag: '🇨🇾', name: 'Cyprus',                  localDigits: 8  },
  { code: '420',  flag: '🇨🇿', name: 'Czech Republic',          localDigits: 9  },
  { code: '45',   flag: '🇩🇰', name: 'Denmark',                 localDigits: 8  },
  { code: '593',  flag: '🇪🇨', name: 'Ecuador',                 localDigits: 9  },
  { code: '20',   flag: '🇪🇬', name: 'Egypt',                   localDigits: 10 },
  { code: '503',  flag: '🇸🇻', name: 'El Salvador',             localDigits: 8  },
  { code: '372',  flag: '🇪🇪', name: 'Estonia',                 localDigits: 8  },
  { code: '251',  flag: '🇪🇹', name: 'Ethiopia',                localDigits: 9  },
  { code: '679',  flag: '🇫🇯', name: 'Fiji',                    localDigits: 7  },
  { code: '358',  flag: '🇫🇮', name: 'Finland',                 localDigits: 10 },
  { code: '33',   flag: '🇫🇷', name: 'France',                  localDigits: 9  },
  { code: '995',  flag: '🇬🇪', name: 'Georgia',                 localDigits: 9  },
  { code: '49',   flag: '🇩🇪', name: 'Germany',                 localDigits: 11 },
  { code: '233',  flag: '🇬🇭', name: 'Ghana',                   localDigits: 9  },
  { code: '30',   flag: '🇬🇷', name: 'Greece',                  localDigits: 10 },
  { code: '502',  flag: '🇬🇹', name: 'Guatemala',               localDigits: 8  },
  { code: '504',  flag: '🇭🇳', name: 'Honduras',                localDigits: 8  },
  { code: '852',  flag: '🇭🇰', name: 'Hong Kong',               localDigits: 8  },
  { code: '36',   flag: '🇭🇺', name: 'Hungary',                 localDigits: 9  },
  { code: '354',  flag: '🇮🇸', name: 'Iceland',                 localDigits: 7  },
  { code: '91',   flag: '🇮🇳', name: 'India',                   localDigits: 10 },
  { code: '62',   flag: '🇮🇩', name: 'Indonesia',               localDigits: 10 },
  { code: '98',   flag: '🇮🇷', name: 'Iran',                    localDigits: 10 },
  { code: '964',  flag: '🇮🇶', name: 'Iraq',                    localDigits: 10 },
  { code: '353',  flag: '🇮🇪', name: 'Ireland',                 localDigits: 9  },
  { code: '972',  flag: '🇮🇱', name: 'Israel',                  localDigits: 9  },
  { code: '39',   flag: '🇮🇹', name: 'Italy',                   localDigits: 10 },
  { code: '81',   flag: '🇯🇵', name: 'Japan',                   localDigits: 10 },
  { code: '962',  flag: '🇯🇴', name: 'Jordan',                  localDigits: 9  },
  { code: '7',    flag: '🇰🇿', name: 'Kazakhstan / Russia',     localDigits: 10 },
  { code: '254',  flag: '🇰🇪', name: 'Kenya',                   localDigits: 9  },
  { code: '965',  flag: '🇰🇼', name: 'Kuwait',                  localDigits: 8  },
  { code: '856',  flag: '🇱🇦', name: 'Laos',                    localDigits: 10 },
  { code: '371',  flag: '🇱🇻', name: 'Latvia',                  localDigits: 8  },
  { code: '961',  flag: '🇱🇧', name: 'Lebanon',                 localDigits: 8  },
  { code: '370',  flag: '🇱🇹', name: 'Lithuania',               localDigits: 8  },
  { code: '352',  flag: '🇱🇺', name: 'Luxembourg',              localDigits: 9  },
  { code: '853',  flag: '🇲🇴', name: 'Macau',                   localDigits: 8  },
  { code: '60',   flag: '🇲🇾', name: 'Malaysia',                localDigits: 10 },
  { code: '960',  flag: '🇲🇻', name: 'Maldives',                localDigits: 7  },
  { code: '356',  flag: '🇲🇹', name: 'Malta',                   localDigits: 8  },
  { code: '52',   flag: '🇲🇽', name: 'Mexico',                  localDigits: 10 },
  { code: '373',  flag: '🇲🇩', name: 'Moldova',                 localDigits: 8  },
  { code: '976',  flag: '🇲🇳', name: 'Mongolia',                localDigits: 8  },
  { code: '212',  flag: '🇲🇦', name: 'Morocco',                 localDigits: 9  },
  { code: '258',  flag: '🇲🇿', name: 'Mozambique',              localDigits: 9  },
  { code: '95',   flag: '🇲🇲', name: 'Myanmar',                 localDigits: 10 },
  { code: '977',  flag: '🇳🇵', name: 'Nepal',                   localDigits: 10 },
  { code: '31',   flag: '🇳🇱', name: 'Netherlands',             localDigits: 9  },
  { code: '64',   flag: '🇳🇿', name: 'New Zealand',             localDigits: 9  },
  { code: '505',  flag: '🇳🇮', name: 'Nicaragua',               localDigits: 8  },
  { code: '234',  flag: '🇳🇬', name: 'Nigeria',                 localDigits: 10 },
  { code: '47',   flag: '🇳🇴', name: 'Norway',                  localDigits: 8  },
  { code: '968',  flag: '🇴🇲', name: 'Oman',                    localDigits: 8  },
  { code: '92',   flag: '🇵🇰', name: 'Pakistan',                localDigits: 10 },
  { code: '507',  flag: '🇵🇦', name: 'Panama',                  localDigits: 8  },
  { code: '595',  flag: '🇵🇾', name: 'Paraguay',                localDigits: 9  },
  { code: '51',   flag: '🇵🇪', name: 'Peru',                    localDigits: 9  },
  { code: '63',   flag: '🇵🇭', name: 'Philippines',             localDigits: 10 },
  { code: '48',   flag: '🇵🇱', name: 'Poland',                  localDigits: 9  },
  { code: '351',  flag: '🇵🇹', name: 'Portugal',                localDigits: 9  },
  { code: '974',  flag: '🇶🇦', name: 'Qatar',                   localDigits: 8  },
  { code: '40',   flag: '🇷🇴', name: 'Romania',                 localDigits: 10 },
  { code: '966',  flag: '🇸🇦', name: 'Saudi Arabia',            localDigits: 9  },
  { code: '381',  flag: '🇷🇸', name: 'Serbia',                  localDigits: 9  },
  { code: '65',   flag: '🇸🇬', name: 'Singapore',               localDigits: 8  },
  { code: '421',  flag: '🇸🇰', name: 'Slovakia',                localDigits: 9  },
  { code: '386',  flag: '🇸🇮', name: 'Slovenia',                localDigits: 8  },
  { code: '27',   flag: '🇿🇦', name: 'South Africa',            localDigits: 9  },
  { code: '82',   flag: '🇰🇷', name: 'South Korea',             localDigits: 10 },
  { code: '34',   flag: '🇪🇸', name: 'Spain',                   localDigits: 9  },
  { code: '94',   flag: '🇱🇰', name: 'Sri Lanka',               localDigits: 9  },
  { code: '46',   flag: '🇸🇪', name: 'Sweden',                  localDigits: 9  },
  { code: '41',   flag: '🇨🇭', name: 'Switzerland',             localDigits: 9  },
  { code: '963',  flag: '🇸🇾', name: 'Syria',                   localDigits: 9  },
  { code: '886',  flag: '🇹🇼', name: 'Taiwan',                  localDigits: 9  },
  { code: '992',  flag: '🇹🇯', name: 'Tajikistan',              localDigits: 9  },
  { code: '255',  flag: '🇹🇿', name: 'Tanzania',                localDigits: 9  },
  { code: '66',   flag: '🇹🇭', name: 'Thailand',                localDigits: 9  },
  { code: '216',  flag: '🇹🇳', name: 'Tunisia',                 localDigits: 8  },
  { code: '90',   flag: '🇹🇷', name: 'Turkey',                  localDigits: 10 },
  { code: '993',  flag: '🇹🇲', name: 'Turkmenistan',            localDigits: 8  },
  { code: '256',  flag: '🇺🇬', name: 'Uganda',                  localDigits: 9  },
  { code: '380',  flag: '🇺🇦', name: 'Ukraine',                 localDigits: 9  },
  { code: '971',  flag: '🇦🇪', name: 'United Arab Emirates',    localDigits: 9  },
  { code: '44',   flag: '🇬🇧', name: 'United Kingdom',          localDigits: 10 },
  { code: '1',    flag: '🇺🇸', name: 'United States / Canada',  localDigits: 10 },
  { code: '598',  flag: '🇺🇾', name: 'Uruguay',                 localDigits: 8  },
  { code: '998',  flag: '🇺🇿', name: 'Uzbekistan',              localDigits: 9  },
  { code: '58',   flag: '🇻🇪', name: 'Venezuela',               localDigits: 10 },
  { code: '84',   flag: '🇻🇳', name: 'Vietnam',                 localDigits: 10 },
  { code: '967',  flag: '🇾🇪', name: 'Yemen',                   localDigits: 9  },
  { code: '260',  flag: '🇿🇲', name: 'Zambia',                  localDigits: 9  },
  { code: '263',  flag: '🇿🇼', name: 'Zimbabwe',                localDigits: 9  },
];

function getCountryByCode(code: string): CountryCode | undefined {
  return COUNTRY_CODES.find(c => c.code === code);
}

// Extract country code and local number from stored E.164 phone
function parsePhone(phone: string): { countryCode: string; localNumber: string } {
  const digits = phone.replace(/\D/g, '');
  // Try longest codes first (3-digit, then 2-digit, then 1-digit)
  const sorted = [...COUNTRY_CODES].sort((a, b) => b.code.length - a.code.length);
  for (const cc of sorted) {
    if (digits.startsWith(cc.code)) {
      return { countryCode: cc.code, localNumber: digits.slice(cc.code.length) };
    }
  }
  return { countryCode: '', localNumber: digits };
}

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
    
    // Phone validation: must have country code + correct local number length
    const { countryCode, localNumber } = parsePhone(pax.phone);
    if (!pax.phone.trim() || !countryCode) {
      errors.phone = 'Select a country code and enter your phone number';
    } else {
      const cc = getCountryByCode(countryCode);
      if (!cc) {
        errors.phone = 'Invalid country code';
      } else if (localNumber.length === 0) {
        errors.phone = 'Enter your phone number';
      } else if (localNumber.length < cc.localDigits - 1) {
        errors.phone = `Phone number too short — ${cc.name} numbers need ${cc.localDigits} digits (you entered ${localNumber.length})`;
      } else if (localNumber.length > cc.localDigits + 1) {
        errors.phone = `Phone number too long — ${cc.name} numbers need ${cc.localDigits} digits (you entered ${localNumber.length})`;
      }
      // Final E.164 total check
      const totalDigits = countryCode.length + localNumber.length;
      if (!errors.phone && (totalDigits < 8 || totalDigits > 15)) {
        errors.phone = 'Invalid phone number length for E.164 format';
      }
    }
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
          <div className="grid grid-cols-[1fr_1.5fr] gap-2">
            {/* Country Code */}
            <select
              value={parsePhone(pax.phone).countryCode || ''}
              onChange={e => {
                const newCode = e.target.value;
                const { localNumber } = parsePhone(pax.phone);
                onChange('phone', '+' + newCode + localNumber);
              }}
              className={cn(
                'w-full px-3 py-3 rounded-xl bg-slate-50 border text-slate-900 text-sm focus:outline-none focus:bg-white transition-all cursor-pointer',
                touched && !parsePhone(pax.phone).countryCode
                  ? 'border-red-400 focus:border-red-400'
                  : 'border-slate-200 focus:border-[#1ABC9C]/50'
              )}
            >
              <option value="" disabled>Select code</option>
              {COUNTRY_CODES.map((cc, i) => (
                <option key={`${cc.code}-${cc.name}-${i}`} value={cc.code}>
                  {cc.name} +{cc.code}
                </option>
              ))}
            </select>
            {/* Phone Number */}
            <div>
              <Input
                type="tel"
                placeholder={parsePhone(pax.phone).countryCode
                  ? `Enter ${getCountryByCode(parsePhone(pax.phone).countryCode)?.localDigits ?? 10} digits`
                  : 'Select code first'
                }
                disabled={!parsePhone(pax.phone).countryCode}
                value={parsePhone(pax.phone).localNumber}
                onChange={e => {
                  const local = e.target.value.replace(/\D/g, '');
                  const { countryCode } = parsePhone(pax.phone);
                  onChange('phone', '+' + countryCode + local);
                }}
                hasError={touched && !!errors.phone}
              />
            </div>
          </div>
          {/* Validation error */}
          {touched && <FieldError message={errors.phone} />}
          {/* Helper: show expected digit count */}
          {(() => {
            const { countryCode, localNumber } = parsePhone(pax.phone);
            const cc = getCountryByCode(countryCode);
            if (!cc || localNumber.length === 0) return null;
            const remaining = cc.localDigits - localNumber.length;
            if (remaining > 0) {
              return <p className="mt-1 text-xs text-slate-400">{remaining} digit{remaining !== 1 ? 's' : ''} remaining</p>;
            }
            if (remaining === 0) {
              return <p className="mt-1 text-xs text-emerald-500 font-medium flex items-center gap-1"><Check className="w-3 h-3" /> Valid phone number</p>;
            }
            return null;
          })()}
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
