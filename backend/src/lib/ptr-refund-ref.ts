/**
 * The reference that ties a BookingRefund back to the provider PTR it came from.
 *
 * `BookingRefund.providerRefundRequestId` is written when a void or refund is
 * submitted and read hours later by the reconciliation cron, which needs three
 * things back out of it to call Search/PostTicketingRequest: the PTR type, the
 * PTR id, and the Mystifly reference.
 *
 * Those two ends live in different files (routes/mystifly-ptr.ts writes,
 * services/provider-adapter.ts reads) and used to encode the format by hand at
 * each end. A format that is built in one place and parsed in another by two
 * independent string expressions drifts silently — and the failure is invisible,
 * because a mis-parse yields ptrId 0 and the poll simply finds nothing rather
 * than erroring. Both ends now go through here.
 *
 * Historic shapes still in the wild, all parsed:
 *   mystifly_void_{mfRef}_{ptrId}       mystifly_refund_{mfRef}_{ptrId}
 *   mystifly_void_unticketed_{mfRef}    mystifly_cancel_norefund_{mfRef}
 *
 * The last two have no PTR — nothing was raised with the provider — so they
 * parse to a null ptrId and must never be scheduled for polling.
 */

export type PtrRefundKind = 'VOID' | 'REFUND';

export interface ParsedPtrRefundRef {
  ptrType: 'Void' | 'Refund';
  ptrId: number | null;
  mfRef: string;
}

/**
 * Build the reference. Returns null when there is no PTR to chase, which is the
 * caller's signal to leave the refund at NOT_STARTED rather than scheduling a
 * poll that can never resolve.
 */
export function buildPtrRefundRef(
  kind: PtrRefundKind,
  mfRef: string,
  ptrId: number | null | undefined,
): string | null {
  if (!mfRef || ptrId == null || !Number.isFinite(Number(ptrId)) || Number(ptrId) <= 0) return null;
  return `mystifly_${kind === 'VOID' ? 'void' : 'refund'}_${mfRef}_${Number(ptrId)}`;
}

/**
 * Read it back. `fallbackMfRef` is the refund row's providerPnr, which is the
 * reliable source; the reference is only mined for the MF ref on older rows that
 * predate that column being populated.
 */
export function parsePtrRefundRef(ref: string, fallbackMfRef?: string | null): ParsedPtrRefundRef {
  const raw = String(ref ?? '');
  const ptrType: 'Void' | 'Refund' = raw.includes('_refund_') ? 'Refund' : 'Void';

  // Anchored at the end, so an MF ref that itself ends in digits
  // ("mystifly_void_MF35566326_12345") still yields 12345 and not the reference.
  const m = /_(\d+)$/.exec(raw);
  const ptrId = m ? parseInt(m[1], 10) : null;

  const mfRef = (fallbackMfRef && fallbackMfRef.trim())
    || raw
      .replace(/^mystifly_(void|refund|cancel)_/, '')
      .replace(/^(unticketed|norefund)_/, '')
      .replace(/_\d+$/, '');

  return { ptrType, ptrId: ptrId && ptrId > 0 ? ptrId : null, mfRef };
}
