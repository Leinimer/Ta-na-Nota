'use client';

import React from 'react';
import Link from 'next/link';
import { WifiOff, ArrowLeft, RefreshCw } from 'lucide-react';

export default function OfflineFallbackPage() {
  return (
    <main className="min-h-screen w-full flex items-center justify-center bg-[#F9F7F2] p-4 text-[#3D352E]">
      <div className="max-w-md w-full bg-[#FEFDFA] border border-[#E3DCD2] rounded-2xl p-8 text-center shadow-xs">
        <div className="w-16 h-16 mx-auto mb-5 rounded-2xl bg-[#E3DCD2]/50 text-[#8C7B6E] flex items-center justify-center">
          <WifiOff className="w-8 h-8 stroke-[1.75]" />
        </div>

        <h1 className="font-handwritten text-3xl font-bold text-[#8C7B6E] mb-2">
          Você está offline
        </h1>

        <p className="text-sm text-[#8C7B6E] leading-relaxed mb-6">
          Suas alterações continuam sendo salvas neste dispositivo e serão sincronizadas quando a conexão voltar.
        </p>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
          <Link
            href="/"
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg bg-[#8C7B6E] hover:bg-[#796A5E] text-[#F9F7F2] text-sm font-medium transition-colors cursor-pointer shadow-xs"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Voltar ao editor</span>
          </Link>
          <button
            type="button"
            onClick={() => {
              if (typeof window !== 'undefined') {
                window.location.reload();
              }
            }}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg border border-[#E3DCD2] bg-[#FEFDFA] hover:bg-[#E3DCD2] text-sm font-medium text-[#3D352E] transition-colors cursor-pointer"
          >
            <RefreshCw className="w-4 h-4 text-[#8C7B6E]" />
            <span>Tentar reconectar</span>
          </button>
        </div>
      </div>
    </main>
  );
}
