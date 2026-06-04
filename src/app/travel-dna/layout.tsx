import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Travel DNA | FareMind',
  description: 'Your personalized travel profile, built from your confirmed booking history.',
};

export default function TravelDnaLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
