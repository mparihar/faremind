'use client';

import { create } from 'zustand';
import { apiUrl } from '@/lib/api-client';

// ═══════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════

export interface MasterBookingSummary {
  id: string;
  masterBookingReference: string;
  masterPnr?: string;
  customerEmail: string;
  customerName: string;
  tripType: string;
  originAirport: string;
  originCity: string;
  destinationAirport: string;
  destinationCity: string;
  departureDate: string;
  returnDate?: string;
  bookingStatus: string;
  paymentStatus: string;
  ticketingStatus: string;
  totalAmount: string;
  currency: string;
  primaryProvider: string;
  journeys: any[];
  passengers: any[];
  pnrs: any[];
}

export interface BookingAction {
  key: string;
  label: string;
  available: boolean;
  disabled?: boolean;
  data?: any;
}

export interface StoredFareRules {
  refundable: boolean;
  changeable: boolean;
  cancellationFee: number | null;
  changeFee: number | null;
  seatSelection: string | null;
  seatSelectionFee: number | null;
  milesEarning: string | null;
}

export interface CancelQuoteData {
  quoteId: string;
  bookingReference: string;
  bookingStatus?: string;
  cancellationAllowed: boolean;
  cancelAnywayAllowed?: boolean;
  airlinePermitted: boolean | null;
  refundability: 'FULL_REFUND' | 'PARTIAL_REFUND' | 'NON_REFUNDABLE';
  originalAmount: number;
  airlinePenalty: number;
  fareMindFee: number;
  penaltyAmount: number;
  estimatedRefund: number;
  refundAmount: number;
  refundCurrency: string;
  refundTo: string;
  refundMethod: string;
  refundTimeline: string;
  warningMessage?: string;
  expiresAt: string;
  currency: string;
  pnrs: { pnrCode: string; status: string }[];
}

export interface CancelSuccessData {
  cancellationId: string;
  bookingReference: string;
  refundAmount: number;
  refundCurrency: string;
  refundTimeline: string;
  refundMethod: string;
}

export interface SeatMapData {
  sliceId: string;
  segmentId: string;
  cabin: string;
  rows: { row: number; seats: { designator: string; available: boolean; type: string; price: number; currency: string; cabinClass: string; isExitRow: boolean; hasExtraLegroom: boolean }[] }[];
}

export interface TimelineEvent {
  id: string;
  eventType: string;
  eventTitle: string;
  eventDescription?: string;
  actorType: string;
  createdAt: string;
}

// ═══════════════════════════════════════════════
// Store
// ═══════════════════════════════════════════════

interface ManageBookingStore {
  // Entry
  lookupRef: string;
  lookupLastName: string;
  lookupLoading: boolean;
  lookupError: string | null;
  guestToken: string | null;
  maskedEmail: string | null;
  otpSent: boolean;
  otpVerifying: boolean;

  // Bookings list
  bookings: MasterBookingSummary[];
  bookingCounts: { upcoming: number; past: number; cancelled: number; total: number };
  bookingsFilter: 'upcoming' | 'past' | 'cancelled' | 'all';
  bookingsLoading: boolean;

  // Booking detail
  booking: any | null;
  bookingLoading: boolean;

  // Actions
  actions: BookingAction[];
  actionsLoading: boolean;
  fareRules: StoredFareRules | null;

  // Cancel
  cancelQuote: CancelQuoteData | null;
  cancelSuccess: CancelSuccessData | null;
  cancelLoading: boolean;
  cancelError: string | null;
  setCancelSuccess: (s: CancelSuccessData | null) => void;

  // Seat map
  seatMaps: SeatMapData[];
  seatMapLoading: boolean;

  // Timeline
  timeline: TimelineEvent[];
  timelineLoading: boolean;

  // E-ticket
  eticket: any | null;
  eticketLoading: boolean;
  eticketError: string | null;

  // Date change
  dateChangeLoading: boolean;
  dateChangeError: string | null;

  // Change search (Duffel order changes)
  changeOffers: any[];
  changeSearchLoading: boolean;
  changeSearchError: string | null;
  changeConfirmLoading: boolean;
  changeConfirmError: string | null;
  changeConfirmResult: any | null;

  // Capabilities
  capabilities: any | null;
  capabilitiesLoading: boolean;

  // Active modal
  activeModal: string | null;

  // Methods
  setLookupRef: (v: string) => void;
  setLookupLastName: (v: string) => void;
  setBookingsFilter: (f: 'upcoming' | 'past' | 'cancelled' | 'all') => void;
  setActiveModal: (m: string | null) => void;

  lookupBooking: () => Promise<boolean>;
  sendLookupOtp: () => Promise<boolean>;
  verifyLookupOtp: (otp: string) => Promise<string | null>;
  loadUserBookings: (userId: string, includeAgentBookings?: boolean) => Promise<void>;
  loadBookingDetail: (bookingId: string) => Promise<void>;
  loadActions: (bookingId: string) => Promise<void>;
  loadCancelQuote: (bookingId: string) => Promise<void>;
  confirmCancel: (bookingId: string, quoteId: string, refundMethod?: string) => Promise<boolean>;
  loadSeatMap: (bookingId: string, sliceId: string) => Promise<void>;
  selectSeat: (bookingId: string, data: any) => Promise<boolean>;
  updatePassenger: (bookingId: string, passengerId: string, updates: Record<string, string>) => Promise<boolean>;
  loadTimeline: (bookingId: string) => Promise<void>;
  loadETicket: (bookingId: string) => Promise<void>;
  requestDateChange: (bookingId: string, newDepartureDate: string, newReturnDate?: string, reason?: string) => Promise<boolean>;
  searchChangeOptions: (bookingId: string, newDepartureDate: string, sliceIndex?: number) => Promise<boolean>;
  confirmChangeOption: (bookingId: string, changeOfferId: string, paymentAmount?: number, paymentCurrency?: string) => Promise<boolean>;
  loadCapabilities: (bookingId: string) => Promise<void>;
  resetChangeState: () => void;
  reset: () => void;
}

async function api<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(apiUrl(path), { ...opts, headers: { 'Content-Type': 'application/json', ...opts?.headers } });
  
  if (res.status === 401) {
    if (typeof window !== 'undefined') {
      const { useAuthStore } = require('@/store/useAuthStore');
      useAuthStore.getState().logout();
      window.location.href = '/';
    }
    throw new Error('Session expired');
  }

  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

export const useManageBookingStore = create<ManageBookingStore>((set, get) => ({
  lookupRef: '', lookupLastName: '', lookupLoading: false, lookupError: null,
  guestToken: null, maskedEmail: null, otpSent: false, otpVerifying: false,
  bookings: [], bookingCounts: { upcoming: 0, past: 0, cancelled: 0, total: 0 },
  bookingsFilter: 'all', bookingsLoading: false,
  booking: null, bookingLoading: false,
  actions: [], actionsLoading: false, fareRules: null,
  cancelQuote: null, cancelSuccess: null, cancelLoading: false, cancelError: null,
  seatMaps: [], seatMapLoading: false,
  timeline: [], timelineLoading: false,
  eticket: null, eticketLoading: false, eticketError: null,
  dateChangeLoading: false, dateChangeError: null,
  changeOffers: [], changeSearchLoading: false, changeSearchError: null,
  changeConfirmLoading: false, changeConfirmError: null, changeConfirmResult: null,
  capabilities: null, capabilitiesLoading: false,
  activeModal: null,

  setLookupRef: (v) => set({ lookupRef: v }),
  setLookupLastName: (v) => set({ lookupLastName: v }),
  setBookingsFilter: (f) => set({ bookingsFilter: f }),
  setActiveModal: (m) => set({ activeModal: m }),
  setCancelSuccess: (s) => set({ cancelSuccess: s }),

  lookupBooking: async () => {
    const { lookupRef, lookupLastName } = get();
    set({ lookupLoading: true, lookupError: null });
    try {
      const data = await api<any>('/api/manage-booking/lookup', { method: 'POST', body: JSON.stringify({ bookingRef: lookupRef, lastName: lookupLastName }) });
      set({ lookupLoading: false, maskedEmail: data.customerEmail });
      return true;
    } catch (e: any) { set({ lookupLoading: false, lookupError: e.message }); return false; }
  },

  sendLookupOtp: async () => {
    const { lookupRef, lookupLastName } = get();
    set({ lookupLoading: true, lookupError: null });
    try {
      await api('/api/manage-booking/lookup/send-otp', { method: 'POST', body: JSON.stringify({ bookingRef: lookupRef, lastName: lookupLastName }) });
      set({ lookupLoading: false, otpSent: true });
      return true;
    } catch (e: any) { set({ lookupLoading: false, lookupError: e.message }); return false; }
  },

  verifyLookupOtp: async (otp) => {
    const { lookupRef, lookupLastName } = get();
    set({ otpVerifying: true, lookupError: null });
    try {
      const data = await api<any>('/api/manage-booking/lookup/verify-otp', { method: 'POST', body: JSON.stringify({ bookingRef: lookupRef, lastName: lookupLastName, otp }) });
      set({ otpVerifying: false, guestToken: data.guestToken });

      // Sync with main auth store so Navbar shows user as signed in
      if (data.customerName && data.customerEmail) {
        const session = {
          user: { id: `guest_${data.bookingId}`, email: data.customerEmail, name: data.customerName },
          token: data.guestToken,
        };
        localStorage.setItem('faremind_session', JSON.stringify(session));
        // Trigger Navbar to pick up the new session
        const { useAuthStore } = require('@/store/useAuthStore');
        useAuthStore.getState().loadSession();
      }

      return data.bookingId;
    } catch (e: any) { set({ otpVerifying: false, lookupError: e.message }); return null; }
  },

  loadUserBookings: async (userId, includeAgentBookings) => {
    set({ bookingsLoading: true });
    try {
      const agentParam = includeAgentBookings ? '&agent=true' : '';
      const data = await api<any>(`/api/manage-booking/user/${userId}/bookings?filter=${get().bookingsFilter}${agentParam}`);
      set({ bookings: data.bookings, bookingCounts: data.counts, bookingsLoading: false });
    } catch { set({ bookingsLoading: false }); }
  },

  loadBookingDetail: async (bookingId) => {
    set({ bookingLoading: true });
    try {
      const data = await api<any>(`/api/manage-booking/${bookingId}`);
      set({ booking: data.booking, bookingLoading: false });
    } catch { set({ bookingLoading: false }); }
  },

  loadActions: async (bookingId) => {
    set({ actionsLoading: true });
    try {
      const data = await api<any>(`/api/manage-booking/${bookingId}/actions`);
      set({ actions: data.actions, fareRules: data.fareRules ?? null, actionsLoading: false });
    } catch { set({ actionsLoading: false }); }
  },

  loadCancelQuote: async (bookingId) => {
    set({ cancelLoading: true, cancelError: null, cancelQuote: null });
    try {
      const data = await api<CancelQuoteData>(`/api/manage-booking/${bookingId}/cancel/quote`, { method: 'POST', body: JSON.stringify({}) });
      set({ cancelQuote: data, cancelLoading: false });
    } catch (e: any) { set({ cancelLoading: false, cancelError: e.message }); }
  },

  confirmCancel: async (bookingId, quoteId, refundMethod) => {
    set({ cancelLoading: true, cancelError: null });
    try {
      const data = await api<any>(`/api/manage-booking/${bookingId}/cancel/confirm`, { method: 'POST', body: JSON.stringify({ quoteId, refundMethod }) });
      set({
        cancelLoading: false,
        cancelSuccess: {
          cancellationId: data.cancellationId,
          bookingReference: data.bookingReference,
          refundAmount: data.refundAmount,
          refundCurrency: data.refundCurrency,
          refundTimeline: data.refundTimeline || '5–10 business days',
          refundMethod: data.refundMethod || 'ORIGINAL_PAYMENT',
        },
      });
      return true;
    } catch (e: any) { set({ cancelLoading: false, cancelError: e.message }); return false; }
  },

  loadSeatMap: async (bookingId, sliceId) => {
    set({ seatMapLoading: true });
    try {
      const data = await api<any>(`/api/manage-booking/${bookingId}/seats/${sliceId}`);
      set({ seatMaps: data.seatMaps, seatMapLoading: false });
    } catch { set({ seatMapLoading: false }); }
  },

  selectSeat: async (bookingId, data) => {
    try {
      await api(`/api/manage-booking/${bookingId}/seats/select`, { method: 'POST', body: JSON.stringify(data) });
      return true;
    } catch { return false; }
  },

  updatePassenger: async (bookingId, passengerId, updates) => {
    try {
      await api(`/api/manage-booking/${bookingId}/passenger/update`, { method: 'POST', body: JSON.stringify({ passengerId, updates }) });
      return true;
    } catch { return false; }
  },

  loadTimeline: async (bookingId) => {
    set({ timelineLoading: true });
    try {
      const data = await api<any>(`/api/manage-booking/${bookingId}/timeline`);
      set({ timeline: data.events, timelineLoading: false });
    } catch { set({ timelineLoading: false }); }
  },

  loadETicket: async (bookingId) => {
    set({ eticketLoading: true, eticketError: null });
    try {
      const data = await api<any>(`/api/manage-booking/${bookingId}/eticket`);
      set({ eticket: data.eticket, eticketLoading: false });
    } catch (e: any) { set({ eticketLoading: false, eticketError: e.message }); }
  },

  requestDateChange: async (bookingId, newDepartureDate, newReturnDate, reason) => {
    set({ dateChangeLoading: true, dateChangeError: null });
    try {
      await api(`/api/manage-booking/${bookingId}/change/request`, {
        method: 'POST',
        body: JSON.stringify({ newDepartureDate, newReturnDate, reason }),
      });
      set({ dateChangeLoading: false });
      return true;
    } catch (e: any) { set({ dateChangeLoading: false, dateChangeError: e.message }); return false; }
  },

  searchChangeOptions: async (bookingId, newDepartureDate, sliceIndex) => {
    set({ changeSearchLoading: true, changeSearchError: null, changeOffers: [] });
    try {
      const data = await api<any>(`/api/manage-booking/${bookingId}/change/search`, {
        method: 'POST',
        body: JSON.stringify({ newDepartureDate, sliceIndex }),
      });
      if (!data.supported) {
        const msg = data.message || 'Change not available online.';
        const ticketNotice = data.supportTicketCreated ? '\n\nA support ticket has been created. Our team will follow up within 24 hours.' : '';
        set({
          changeSearchLoading: false,
          changeSearchError: msg + ticketNotice,
          changeOffers: [],
        });
        return false;
      }
      set({ changeSearchLoading: false, changeOffers: data.offers || [] });
      return true;
    } catch (e: any) { set({ changeSearchLoading: false, changeSearchError: e.message }); return false; }
  },

  confirmChangeOption: async (bookingId, changeOfferId, paymentAmount, paymentCurrency) => {
    set({ changeConfirmLoading: true, changeConfirmError: null });
    try {
      const data = await api<any>(`/api/manage-booking/${bookingId}/change/confirm`, {
        method: 'POST',
        body: JSON.stringify({ changeOfferId, paymentAmount, paymentCurrency }),
      });
      set({ changeConfirmLoading: false, changeConfirmResult: data });
      return true;
    } catch (e: any) { set({ changeConfirmLoading: false, changeConfirmError: e.message }); return false; }
  },

  loadCapabilities: async (bookingId) => {
    set({ capabilitiesLoading: true });
    try {
      const data = await api<any>(`/api/manage-booking/${bookingId}/capabilities`);
      set({ capabilities: data, capabilitiesLoading: false });
    } catch { set({ capabilitiesLoading: false }); }
  },

  resetChangeState: () => set({
    changeOffers: [], changeSearchLoading: false, changeSearchError: null,
    changeConfirmLoading: false, changeConfirmError: null, changeConfirmResult: null,
  }),

  reset: () => set({
    lookupRef: '', lookupLastName: '', lookupLoading: false, lookupError: null,
    guestToken: null, maskedEmail: null, otpSent: false, otpVerifying: false,
    bookings: [], bookingsFilter: 'all', bookingsLoading: false,
    booking: null, bookingLoading: false, actions: [], actionsLoading: false, fareRules: null,
    cancelQuote: null, cancelSuccess: null, cancelLoading: false, cancelError: null,
    seatMaps: [], seatMapLoading: false, timeline: [], timelineLoading: false,
    eticket: null, eticketLoading: false, eticketError: null,
    dateChangeLoading: false, dateChangeError: null,
    changeOffers: [], changeSearchLoading: false, changeSearchError: null,
    changeConfirmLoading: false, changeConfirmError: null, changeConfirmResult: null,
    capabilities: null, capabilitiesLoading: false,
    activeModal: null,
  }),
}));
