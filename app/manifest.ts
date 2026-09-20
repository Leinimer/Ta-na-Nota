import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Tá na nota',
    short_name: 'Tá na nota',
    description: 'Seu Segundo Cérebro Digital',
    start_url: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#F7F4EE',
    theme_color: '#8C7B6E',
    categories: ['productivity', 'utilities', 'notes'],
    icons: [
      {
        src: '/icons/icon-192x192.png',
        sizes: '192x192',
        type: 'image/png',
      },
      {
        src: '/icons/icon-512x512.png',
        sizes: '512x512',
        type: 'image/png',
      },
      {
        src: '/icons/icon-maskable-512x512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
