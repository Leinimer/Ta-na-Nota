import type { Metadata, Viewport } from 'next';
import { Caveat } from 'next/font/google';
import './globals.css';
import { PwaLifecycle } from '@/components/pwa/PwaLifecycle';

const caveat = Caveat({
  subsets: ['latin'],
  weight: ['600', '700'],
  variable: '--font-caveat',
  display: 'swap',
});

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#8C7B6E',
};

export const metadata: Metadata = {
  title: 'Tá na nota',
  description: 'Tá na nota — Seu espaço pessoal de organização de conhecimento, anotações e ideias.',
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Tá na nota',
  },
  icons: {
    icon: [
      { url: '/favicon.ico' },
      { url: '/icons/icon-192x192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icons/icon-512x512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [
      { url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' },
    ],
  },
  openGraph: {
    title: 'Tá na nota',
    description: 'Tá na nota — Seu espaço pessoal de organização de conhecimento, anotações e ideias.',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Tá na nota',
    description: 'Tá na nota — Seu espaço pessoal de organização de conhecimento, anotações e ideias.',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className={caveat.variable}>
      <body suppressHydrationWarning className="antialiased paper-texture selection:bg-[#D9C5B2] selection:text-[#3D352E]">
        <PwaLifecycle />
        {children}
      </body>
    </html>
  );
}
