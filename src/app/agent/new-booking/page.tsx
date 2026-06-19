'use client';

import { useState, useMemo } from 'react';
import { useAuthStore } from '@/store/useAuthStore';
import {
  PlaneTakeoff,
  Users,
  Info,
  AlertCircle,
  Check,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import SearchForm from '@/components/search/SearchForm';

// ─── Country Codes (same as passenger form) ─────────────────────────────────

interface CountryCode {
  code: string;
  flag: string;
  name: string;
  localDigits: number;
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

function parsePhone(phone: string): { countryCode: string; localNumber: string } {
  const digits = phone.replace(/\D/g, '');
  const sorted = [...COUNTRY_CODES].sort((a, b) => b.code.length - a.code.length);
  for (const cc of sorted) {
    if (digits.startsWith(cc.code)) {
      return { countryCode: cc.code, localNumber: digits.slice(cc.code.length) };
    }
  }
  return { countryCode: '', localNumber: digits };
}

// ─── Validation (same rules as passenger form) ──────────────────────────────

interface CustomerErrors {
  name?: string;
  email?: string;
  phone?: string;
}

function validateCustomer(name: string, email: string, phone: string): CustomerErrors {
  const errors: CustomerErrors = {};
  if (!name.trim()) errors.name = 'Customer name is required';

  if (!email.trim()) {
    errors.email = 'Email is required';
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.email = 'Enter a valid email address';
  }

  if (phone.trim()) {
    const { countryCode, localNumber } = parsePhone(phone);
    if (!countryCode) {
      errors.phone = 'Select a country code';
    } else {
      const cc = getCountryByCode(countryCode);
      if (!cc) {
        errors.phone = 'Invalid country code';
      } else if (localNumber.length === 0) {
        errors.phone = 'Enter phone number';
      } else if (localNumber.length < cc.localDigits - 1) {
        errors.phone = `Too short — ${cc.name} numbers need ${cc.localDigits} digits (entered ${localNumber.length})`;
      } else if (localNumber.length > cc.localDigits + 1) {
        errors.phone = `Too long — ${cc.name} numbers need ${cc.localDigits} digits (entered ${localNumber.length})`;
      } else {
        const totalDigits = countryCode.length + localNumber.length;
        if (totalDigits < 8 || totalDigits > 15) {
          errors.phone = 'Invalid phone number length';
        }
      }
    }
  }

  return errors;
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AgentNewBookingPage() {
  const { user } = useAuthStore();
  const [customerName, setCustomerName] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [phoneCountryCode, setPhoneCountryCode] = useState('1'); // default US
  const [phoneLocal, setPhoneLocal] = useState('');
  const [touched, setTouched] = useState(false);

  const fullPhone = phoneCountryCode && phoneLocal ? `+${phoneCountryCode}${phoneLocal}` : '';

  const errors = useMemo(
    () => validateCustomer(customerName, customerEmail, fullPhone),
    [customerName, customerEmail, fullPhone]
  );

  const selectedCC = getCountryByCode(phoneCountryCode);

  // Phone helper
  const phoneHelper = useMemo(() => {
    if (!selectedCC || !phoneLocal) return null;
    const remaining = selectedCC.localDigits - phoneLocal.length;
    if (remaining > 0) return { type: 'info' as const, msg: `${remaining} digit${remaining !== 1 ? 's' : ''} remaining` };
    if (remaining === 0) return { type: 'valid' as const, msg: 'Valid phone number' };
    return null;
  }, [selectedCC, phoneLocal]);

  // Email helper
  const emailValid = customerEmail.trim().length > 0 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail);

  /** Store agent booking context in sessionStorage before search navigates */
  function handleBeforeSearch() {
    setTouched(true);
    if (Object.keys(errors).length > 0) return;

    sessionStorage.setItem('agentBookingContext', JSON.stringify({
      agentUserId: user?.id,
      agentName: user?.name,
      agentEmail: user?.email,
      customerName: customerName.trim(),
      customerEmail: customerEmail.trim().toLowerCase(),
      customerPhone: fullPhone.trim(),
      createdByRole: 'AGENT',
    }));
  }

  const isCustomerInfoValid = customerName.trim().length > 0 && emailValid;

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-black text-white flex items-center gap-3">
          <PlaneTakeoff className="w-6 h-6 text-[#1ABC9C]" />
          New Booking
        </h1>
        <p className="text-sm text-slate-400 mt-1">Book a flight on behalf of a customer</p>
      </div>

      {/* Info banner */}
      <div className="flex items-start gap-2.5 p-4 rounded-xl bg-[#1ABC9C]/10 border border-[#1ABC9C]/20 mb-6">
        <Info className="w-4 h-4 text-[#1ABC9C] shrink-0 mt-0.5" />
        <p className="text-xs text-[#1ABC9C]">
          Enter customer details below, then search for flights. The booking will be created under your agent account with the customer&apos;s contact information.
        </p>
      </div>

      <div className="space-y-6">
        {/* Customer Details */}
        <div className="bg-slate-900/80 border border-white/[0.06] rounded-2xl p-6">
          <h3 className="text-sm font-bold text-white mb-4 flex items-center gap-2">
            <Users className="w-4 h-4 text-[#1ABC9C]" /> Customer Details
          </h3>

          {/* Row 1: Name */}
          <div className="mb-4">
            <label className="block text-[10px] text-slate-500 uppercase font-bold mb-1.5">
              Full Name <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              placeholder="John Doe"
              className={cn(
                'w-full px-4 py-3 rounded-xl bg-slate-800/50 border text-white text-sm placeholder-slate-500 focus:outline-none transition-all',
                touched && errors.name
                  ? 'border-red-400 focus:border-red-400'
                  : 'border-white/10 focus:border-[#1ABC9C]/50'
              )}
            />
            {touched && errors.name && (
              <p className="mt-1 flex items-center gap-1 text-xs text-red-400">
                <AlertCircle className="w-3 h-3 shrink-0" /> {errors.name}
              </p>
            )}
          </div>

          {/* Row 2: Email + Phone */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Email */}
            <div>
              <label className="block text-[10px] text-slate-500 uppercase font-bold mb-1.5">
                Email <span className="text-red-400">*</span>
              </label>
              <input
                type="email"
                value={customerEmail}
                onChange={(e) => setCustomerEmail(e.target.value)}
                placeholder="customer@email.com"
                className={cn(
                  'w-full px-4 py-3 rounded-xl bg-slate-800/50 border text-white text-sm placeholder-slate-500 focus:outline-none transition-all',
                  touched && errors.email
                    ? 'border-red-400 focus:border-red-400'
                    : emailValid
                      ? 'border-[#1ABC9C]/50'
                      : 'border-white/10 focus:border-[#1ABC9C]/50'
                )}
              />
              {touched && errors.email && (
                <p className="mt-1 flex items-center gap-1 text-xs text-red-400">
                  <AlertCircle className="w-3 h-3 shrink-0" /> {errors.email}
                </p>
              )}
              {emailValid && (
                <p className="mt-1 text-xs text-emerald-400 font-medium flex items-center gap-1">
                  <Check className="w-3 h-3" /> Valid email
                </p>
              )}
            </div>

            {/* Phone */}
            <div>
              <label className="block text-[10px] text-slate-500 uppercase font-bold mb-1.5">Phone</label>
              <div className="grid grid-cols-[1fr_1.5fr] gap-2">
                {/* Country Code Selector */}
                <select
                  value={phoneCountryCode}
                  onChange={(e) => setPhoneCountryCode(e.target.value)}
                  className="w-full px-3 py-3 rounded-xl bg-slate-800/50 border border-white/10 text-white text-sm focus:outline-none focus:border-[#1ABC9C]/50 transition-all cursor-pointer"
                >
                  {COUNTRY_CODES.map((cc, i) => (
                    <option key={`${cc.code}-${cc.name}-${i}`} value={cc.code}>
                      {cc.name} +{cc.code}
                    </option>
                  ))}
                </select>
                {/* Local Number */}
                <input
                  type="tel"
                  placeholder={selectedCC ? `Enter ${selectedCC.localDigits} digits` : 'Phone number'}
                  value={phoneLocal}
                  onChange={(e) => setPhoneLocal(e.target.value.replace(/\D/g, ''))}
                  className={cn(
                    'w-full px-4 py-3 rounded-xl bg-slate-800/50 border text-white text-sm placeholder-slate-500 focus:outline-none transition-all',
                    touched && errors.phone
                      ? 'border-red-400 focus:border-red-400'
                      : phoneHelper?.type === 'valid'
                        ? 'border-[#1ABC9C]/50'
                        : 'border-white/10 focus:border-[#1ABC9C]/50'
                  )}
                />
              </div>
              {touched && errors.phone && (
                <p className="mt-1 flex items-center gap-1 text-xs text-red-400">
                  <AlertCircle className="w-3 h-3 shrink-0" /> {errors.phone}
                </p>
              )}
              {phoneHelper?.type === 'info' && (
                <p className="mt-1 text-xs text-slate-500">{phoneHelper.msg}</p>
              )}
              {phoneHelper?.type === 'valid' && (
                <p className="mt-1 text-xs text-emerald-400 font-medium flex items-center gap-1">
                  <Check className="w-3 h-3" /> {phoneHelper.msg}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Flight Search — Reuses customer-facing SearchForm */}
        <div className="relative">
          {/* Overlay to disable SearchForm until customer info is filled */}
          {!isCustomerInfoValid && (
            <div className="absolute inset-0 z-10 bg-slate-900/60 backdrop-blur-[2px] rounded-2xl flex items-center justify-center">
              <p className="text-sm text-slate-400 font-medium bg-slate-900/90 px-6 py-3 rounded-xl border border-white/10">
                Please fill in customer name and email first
              </p>
            </div>
          )}
          <div className="bg-white rounded-2xl border border-slate-200/60 shadow-xl">
            <SearchForm
              variant="hero"
              onBeforeSearch={handleBeforeSearch}
              additionalSearchParams={{ agentMode: '1' }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

