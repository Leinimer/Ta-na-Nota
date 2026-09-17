import type { Metadata } from 'next';
import './globals.css';

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
    <html lang="pt-BR">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500&family=Roboto:ital,wght@0,300;0,400;0,500;0,700;1,400&family=Source+Serif+4:ital,opsz,wght@0,8..60,400;0,8..60,600;0,8..60,700;1,8..60,400&display=swap"
          rel="stylesheet"
        />
      </head>
      <body suppressHydrationWarning className="antialiased paper-texture selection:bg-[#D9C5B2] selection:text-[#3D352E]">
        {children}
      </body>
    </html>
  );
}
