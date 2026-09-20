import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-[#F9F7F2] text-[#3D352E]">
      <div className="max-w-md w-full bg-[#FEFDFA] border border-[#E3DCD2] rounded-xl shadow-xs p-6 text-center space-y-4">
        <h2 className="text-xl font-serif font-semibold text-[#8C7B6E]">
          Página não encontrada
        </h2>
        <p className="text-xs text-[#8C7B6E]/90 leading-relaxed">
          O endereço solicitado não foi encontrado no Tá na nota.
        </p>
        <div className="pt-2 flex justify-center">
          <Link
            href="/"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#8C7B6E] hover:bg-[#796A5E] text-[#F9F7F2] text-xs font-medium transition-colors cursor-pointer"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Voltar ao Tá na nota
          </Link>
        </div>
      </div>
    </div>
  );
}
