/**
 * Next-side reader for the admin-configurable wallet recharge / auto-recharge
 * policy (SystemConfig — never hard-coded, changeable without a deploy).
 * Mirrors the backend getWalletPolicy but includes the recharge-specific keys.
 */
import { prisma } from '@/lib/db';

export interface RechargePolicy {
  currency: string;
  defaultBalance: number;
  lowThreshold: number;
  disableThreshold: number;
  minimumRechargeAmount: number;
  automaticRechargeAmount: number;
  automaticRechargeTargetBalance: number;
  reactivationThreshold: number;
  autoRechargeGloballyEnabled: boolean;
  termsVersion: string;
  otherPaymentNoteMin: number;
  otherPaymentNoteMax: number;
  otherPaymentMaxAmount: number;
}

const KEYS = [
  'wallet_currency', 'wallet_default_balance', 'wallet_low_threshold', 'wallet_disable_threshold',
  'minimum_wallet_recharge_amount', 'automatic_recharge_amount', 'automatic_recharge_target_balance',
  'wallet_reactivation_threshold', 'auto_recharge_globally_enabled', 'wallet_auto_recharge_terms_version',
  'other_payment_note_min_length', 'other_payment_note_max_length', 'other_payment_max_amount',
];

export async function getRechargePolicy(): Promise<RechargePolicy> {
  const rows = await prisma.systemConfig.findMany({ where: { key: { in: KEYS } } });
  const m = new Map(rows.map((r) => [r.key, r.value]));
  const num = (k: string, d: number) => { const v = parseFloat(m.get(k) ?? ''); return Number.isFinite(v) ? v : d; };
  const bool = (k: string, d: boolean) => { const v = m.get(k); return v == null ? d : v === 'true' || v === '1'; };
  return {
    currency: m.get('wallet_currency') || 'USD',
    defaultBalance: num('wallet_default_balance', 3000),
    lowThreshold: num('wallet_low_threshold', 1000),
    disableThreshold: num('wallet_disable_threshold', 500),
    minimumRechargeAmount: num('minimum_wallet_recharge_amount', 500),
    automaticRechargeAmount: num('automatic_recharge_amount', 2000),
    automaticRechargeTargetBalance: num('automatic_recharge_target_balance', 3000),
    reactivationThreshold: num('wallet_reactivation_threshold', 1000),
    autoRechargeGloballyEnabled: bool('auto_recharge_globally_enabled', true),
    termsVersion: m.get('wallet_auto_recharge_terms_version') || 'v1',
    otherPaymentNoteMin: num('other_payment_note_min_length', 5),
    otherPaymentNoteMax: num('other_payment_note_max_length', 500),
    otherPaymentMaxAmount: num('other_payment_max_amount', 10000),
  };
}
