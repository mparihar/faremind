/**
 * POST /api/checkout/payment/confirm
 *
 * Confirms a Stripe PaymentIntent by creating a PaymentMethod from
 * the card details and attaching it to the intent.
 *
 * Request:  { paymentIntentId: string, card: { number, expiry, cvc, name },
 *             billing: { address, city, zip, country }, sessionId?: string }
 * Response: { success: boolean, status: string, last4: string }
 *
 * NOTE: Card details flow through our server. This works for Stripe test mode.
 * For production PCI compliance, consider migrating to Stripe Elements.
 */

import { NextRequest, NextResponse } from 'next/server';
import { stripe } from '@/lib/stripe';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { paymentIntentId, card, billing, sessionId } = body;

    if (!paymentIntentId) {
      return NextResponse.json(
        { error: 'paymentIntentId is required' },
        { status: 400 }
      );
    }

    // If this is a demo/fallback payment intent, skip Stripe
    if (paymentIntentId.startsWith('pi_demo_')) {
      console.log(`[Stripe] Skipping confirmation for demo intent: ${paymentIntentId}`);
      return NextResponse.json({
        success: true,
        status: 'demo',
        last4: card?.number?.replace(/\s/g, '').slice(-4) || '0000',
      });
    }

    if (!card?.number || !card?.expiry || !card?.cvc) {
      return NextResponse.json(
        { error: 'Card details (number, expiry, cvc) are required' },
        { status: 400 }
      );
    }

    // Parse expiry (MM/YY)
    const [expMonth, expYear] = card.expiry.split('/').map((s: string) => parseInt(s, 10));
    const fullYear = expYear < 100 ? 2000 + expYear : expYear;

    // Clean card number (remove spaces)
    const cleanNumber = card.number.replace(/\s/g, '');
    const last4 = cleanNumber.slice(-4);

    console.log(
      `[Stripe] Confirming PaymentIntent ${paymentIntentId} — card ending ${last4}`
    );

    // 1. Create a PaymentMethod from card details
    const paymentMethod = await stripe.paymentMethods.create({
      type: 'card',
      card: {
        number: cleanNumber,
        exp_month: expMonth,
        exp_year: fullYear,
        cvc: card.cvc,
      },
      billing_details: {
        name: card.name || undefined,
        address: billing ? {
          line1: billing.address || undefined,
          city: billing.city || undefined,
          postal_code: billing.zip || undefined,
          country: billing.country ? mapCountryToCode(billing.country) : undefined,
        } : undefined,
      },
    });

    console.log(`[Stripe] PaymentMethod created: ${paymentMethod.id} (${paymentMethod.card?.brand} ****${last4})`);

    // 2. Confirm the PaymentIntent with the PaymentMethod
    const confirmedIntent = await stripe.paymentIntents.confirm(paymentIntentId, {
      payment_method: paymentMethod.id,
    });

    console.log(`[Stripe] PaymentIntent confirmed: ${confirmedIntent.id} — status: ${confirmedIntent.status}`);

    // With capture_method: 'manual', confirming results in 'requires_capture'
    // (funds authorized but not yet captured). This is the expected status.
    // 'succeeded' would mean automatic capture — also valid.
    if (confirmedIntent.status === 'requires_capture' || confirmedIntent.status === 'succeeded') {
      return NextResponse.json({
        success: true,
        status: confirmedIntent.status,
        last4,
        paymentMethodId: paymentMethod.id,
      });
    }

    // Handle requires_action (3D Secure, etc.)
    if (confirmedIntent.status === 'requires_action') {
      return NextResponse.json({
        success: false,
        status: confirmedIntent.status,
        error: 'Additional authentication required. Please try a different card.',
        errorCode: 'REQUIRES_ACTION',
        last4,
      }, { status: 402 });
    }

    // Other non-success statuses
    return NextResponse.json({
      success: false,
      status: confirmedIntent.status,
      error: `Payment not completed. Status: ${confirmedIntent.status}`,
      last4,
    }, { status: 402 });

  } catch (err: any) {
    console.error('[Stripe] ❌ Payment confirmation failed:', err.message);

    // Stripe card errors have a specific type
    if (err.type === 'StripeCardError') {
      return NextResponse.json({
        success: false,
        error: err.message,
        errorCode: 'CARD_DECLINED',
        declineCode: err.decline_code || null,
      }, { status: 402 });
    }

    return NextResponse.json(
      { error: err.message || 'Payment failed' },
      { status: 500 }
    );
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Maps common country display names to ISO 3166-1 alpha-2 codes.
 * Stripe requires 2-letter country codes for billing addresses.
 */
function mapCountryToCode(country: string): string {
  const map: Record<string, string> = {
    'united states': 'US',
    'usa': 'US',
    'us': 'US',
    'united kingdom': 'GB',
    'uk': 'GB',
    'canada': 'CA',
    'australia': 'AU',
    'india': 'IN',
    'germany': 'DE',
    'france': 'FR',
    'japan': 'JP',
    'singapore': 'SG',
    'uae': 'AE',
    'united arab emirates': 'AE',
  };

  const normalized = country.toLowerCase().trim();
  return map[normalized] || (country.length === 2 ? country.toUpperCase() : 'US');
}
