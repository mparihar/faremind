import { NextRequest, NextResponse } from 'next/server';
import { withAdmin } from '@/lib/admin-rbac';
import { getTravelDnaConfig, updateTravelDnaConfig } from '@/lib/services/travel-dna-service';

/**
 * GET /api/admin/travel-dna/config
 * Admin retrieves Travel DNA configuration.
 */
export const GET = withAdmin(async () => {
  try {
    const config = await getTravelDnaConfig();
    return NextResponse.json({ config });
  } catch (err: any) {
    console.error('[admin/travel-dna/config] GET error:', err);
    return NextResponse.json({ error: err.message ?? 'Internal server error' }, { status: 500 });
  }
}, 'OPS_ADMIN');

/**
 * PUT /api/admin/travel-dna/config
 * Admin updates Travel DNA configuration.
 */
export const PUT = withAdmin(async (req: NextRequest, { admin }) => {
  try {
    const body = await req.json();
    const {
      travelDnaEnabled,
      minConfirmedBookingsRequired,
      domesticRequiredBookings,
      internationalRequiredBookings,
      domesticProfileEnabled,
      internationalProfileEnabled,
      showLearningState,
      showConfidenceScore,
    } = body;

    // Validate booking thresholds
    const validateThreshold = (val: any, name: string) => {
      if (val !== undefined) {
        const num = parseInt(val, 10);
        if (isNaN(num) || num < 1 || num > 50) {
          return `${name} must be between 1 and 50`;
        }
      }
      return null;
    };

    const domErr = validateThreshold(domesticRequiredBookings, 'domesticRequiredBookings');
    if (domErr) return NextResponse.json({ error: domErr }, { status: 400 });

    const intErr = validateThreshold(internationalRequiredBookings, 'internationalRequiredBookings');
    if (intErr) return NextResponse.json({ error: intErr }, { status: 400 });

    // Legacy field validation
    const minErr = validateThreshold(minConfirmedBookingsRequired, 'minConfirmedBookingsRequired');
    if (minErr) return NextResponse.json({ error: minErr }, { status: 400 });

    const config = await updateTravelDnaConfig(
      {
        travelDnaEnabled,
        minConfirmedBookingsRequired: minConfirmedBookingsRequired !== undefined
          ? parseInt(minConfirmedBookingsRequired, 10)
          : undefined,
        domesticRequiredBookings: domesticRequiredBookings !== undefined
          ? parseInt(domesticRequiredBookings, 10)
          : undefined,
        internationalRequiredBookings: internationalRequiredBookings !== undefined
          ? parseInt(internationalRequiredBookings, 10)
          : undefined,
        domesticProfileEnabled,
        internationalProfileEnabled,
        showLearningState,
        showConfidenceScore,
      },
      admin.id,
      admin.email,
    );

    console.log(`[FAREMIND DNA Config] Updated by ${admin.email}`);
    return NextResponse.json({ config });
  } catch (err: any) {
    console.error('[admin/travel-dna/config] PUT error:', err);
    return NextResponse.json({ error: err.message ?? 'Internal server error' }, { status: 500 });
  }
}, 'OPS_ADMIN');
