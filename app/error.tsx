'use client';

import React, { useEffect } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[GlobalError] Exceção capturada na aplicação:', error);
  }, [error]);

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-[#F9F7F2] text-[#3D352E]">
      <div className="max-w-md w-full bg-[#FEFDFA] border border-[#E3DCD2] rounded-xl shadow-md p-6 text-center space-y-4">
        <div className="w-12 h-12 rounded-full bg-amber-100 text-amber-800 flex items-center justify-center mx-auto">
          <AlertTriangle className="w-6 h-6" />
        </div>
        <h2 className="text-xl font-serif font-semibold text-[#8C7B6E]">
          Ops! Algo inesperado aconteceu
        </h2>
        <p className="text-xs text-[#8C7B6E]/90 leading-relaxed">
          Ocorreu um erro temporário na interface. Seus dados estão salvos com segurança no armazenamento local.
        </p>
        <div className="pt-2 flex justify-center gap-3">
          <button
            onClick={() => reset()}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#8C7B6E] hover:bg-[#796A5E] text-[#F9F7F2] text-xs font-medium transition-colors cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" /> Tentar novamente
          </button>
          <button
            onClick={() => window.location.reload()}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-[#E3DCD2] bg-[#FFFFFF] hover:bg-[#E3DCD2] text-[#3D352E] text-xs font-medium transition-colors cursor-pointer"
          >
            Recarregar página
          </button>
        </div>
      </div>
    </div>
  );
}
