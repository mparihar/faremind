'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function TravelDnaRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/account/travel-dna');
  }, [router]);
  return null;
}
