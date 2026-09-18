import type { Metadata, Viewport } from 'next';
import { Caveat } from 'next/font/google';
import './globals.css';

const caveat = Caveat({
  subsets: ['latin'],
  weight: ['600', '700'],
  variable: '--font-caveat',
  display: 'swap',
});

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export const metadata: Metadata = {
  title: 'Tá na nota',
  description: 'Tá na nota — Seu espaço pessoal de organização de conhecimento, anotações e ideias.',
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
        {children}
      </body>
    </html>
  );
}
