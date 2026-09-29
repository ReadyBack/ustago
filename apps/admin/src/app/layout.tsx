import type { Metadata } from 'next';

import './globals.css';

export const metadata: Metadata = {
  title: 'UstaGO Admin',
  description: 'UstaGO yönetim paneli',
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="tr">
      <body>{children}</body>
    </html>
  );
}
