'use client';

import { useAuthStore } from '@/store/useAuthStore';

/**
 * Returns true when the current platform user is also an active Admin/Support
 * and should see internal AI/DNA scores on flight cards.
 */
export function useShowScores(): boolean {
  const user = useAuthStore((s) => s.user);
  return !!user?.isAdminViewer;
}
