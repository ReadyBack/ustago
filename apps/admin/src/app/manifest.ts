import type { MetadataRoute } from 'next';

/** Installable admin panel (PWA) with the official UstaBulHemen app icon. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'UstaBulHemen Yönetim',
    short_name: 'UstaBulHemen',
    description: 'UstaBulHemen yönetim paneli',
    start_url: '/',
    display: 'standalone',
    background_color: '#FFFFFF',
    theme_color: '#051B33',
    icons: [
      { src: '/brand/app-icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/brand/app-icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
  };
}
