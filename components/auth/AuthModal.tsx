'use client';

import React, { useState } from 'react';
import { AppUser } from '@/types';
import { authService } from '@/services/authService';
import { isSupabaseConfigured } from '@/lib/supabase/client';
import { LogIn, UserPlus, Shield, Sparkles, X } from 'lucide-react';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: AppUser | null;
  onUserChanged: (user: AppUser | null) => void;
}

export function AuthModal({ isOpen, onClose, currentUser, onUserChanged }: AuthModalProps) {
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      if (isSignUp) {
        const res = await authService.signUpWithEmail(email, password, name);
        if (res.error) {
          setError(res.error);
        } else if (res.user) {
          onUserChanged(res.user);
          onClose();
        }
      } else {
        const res = await authService.signInWithEmail(email, password);
        if (res.error) {
          setError(res.error);
        } else if (res.user) {
          onUserChanged(res.user);
          onClose();
        }
      }
    } catch (err: any) {
      setError(err.message || 'Erro durante a autenticação');
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    await authService.signOut();
    onUserChanged(null);
    onClose();
  };

  return (
    <div id="auth-modal-overlay" className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
      <div
        id="auth-modal-card"
        className="w-full max-w-md bg-[#FEFDFA] border border-[#E3DCD2] rounded-xl shadow-xl p-6 sm:p-8 text-[#3D352E] relative animate-in fade-in zoom-in-95 duration-150"
      >
        <button
          id="close-auth-modal"
          onClick={onClose}
          className="absolute top-4 right-4 text-[#8C7B6E] hover:text-[#3D352E] p-1 rounded-md transition-colors cursor-pointer"
          aria-label="Fechar"
        >
          <X className="w-5 h-5" />
        </button>

        {currentUser ? (
          <div className="space-y-4 text-center">
            <div className="w-14 h-14 bg-[#D9C5B2] text-[#3D352E] rounded-full mx-auto flex items-center justify-center font-bold text-xl border border-[#8C7B6E]/30">
              {currentUser.displayName?.[0]?.toUpperCase() || currentUser.name?.[0]?.toUpperCase() || currentUser.username?.[0]?.toUpperCase() || 'U'}
            </div>
            <div>
              <h3 className="text-lg font-serif font-semibold tracking-tight text-[#3D352E]">
                {currentUser.displayName || currentUser.name || 'Usuário'}
              </h3>
              {currentUser.username && (
                <p className="text-xs font-mono text-[#8C7B6E] mt-0.5">@{currentUser.username}</p>
              )}
              {currentUser.email && (
                <p className="text-xs text-[#8C7B6E]/80 mt-1">{currentUser.email}</p>
              )}
            </div>
            <div className="pt-4 border-t border-[#E3DCD2]">
              <button
                id="btn-signout"
                onClick={handleLogout}
                className="w-full py-2.5 px-4 rounded-lg bg-[#E3DCD2] hover:bg-[#D9C5B2] text-xs font-medium transition-colors cursor-pointer text-[#3D352E]"
              >
                Encerrar Sessão (Sair)
              </button>
            </div>
          </div>
        ) : (
          <div>
            <div className="text-center mb-6">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-[#E3DCD2] border border-[#D9C5B2] text-[#8C7B6E] mb-3">
                <Shield className="w-3.5 h-3.5" />
                {isSupabaseConfigured ? 'Supabase Conectado' : 'Modo Offline Ativo'}
              </span>
              <h2 className="text-2xl font-serif font-medium tracking-tight text-[#8C7B6E]">Tá na nota</h2>
              <p className="text-sm text-[#8C7B6E]/80 mt-1">Seu espaço pessoal de organização de conhecimento e anotações</p>
            </div>

            {error && (
              <div className="p-3 mb-4 text-xs bg-red-50 text-red-700 rounded-lg border border-red-200">
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-3.5">
              {isSignUp && (
                <div>
                  <label className="block text-xs font-medium text-[#8C7B6E] mb-1">Nome ou Apelido</label>
                  <input
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Seu nome"
                    className="w-full px-3 py-2 rounded-lg border border-[#E3DCD2] bg-[#FFFFFF] text-sm focus:outline-none focus:border-[#8C7B6E] text-[#3D352E]"
                  />
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-[#8C7B6E] mb-1">Email</label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="voce@exemplo.com"
                  className="w-full px-3 py-2 rounded-lg border border-[#E3DCD2] bg-[#FFFFFF] text-sm focus:outline-none focus:border-[#8C7B6E] text-[#3D352E]"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-[#8C7B6E] mb-1">Senha</label>
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full px-3 py-2 rounded-lg border border-[#E3DCD2] bg-[#FFFFFF] text-sm focus:outline-none focus:border-[#8C7B6E] text-[#3D352E]"
                />
              </div>

              <button
                id="btn-auth-submit"
                type="submit"
                disabled={loading}
                className="w-full mt-2 py-2.5 px-4 rounded-lg bg-[#8C7B6E] hover:bg-[#796A5E] text-[#F9F7F2] font-medium text-sm transition-colors flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 shadow-xs"
              >
                {loading ? (
                  <span>Processando...</span>
                ) : isSignUp ? (
                  <>
                    <UserPlus className="w-4 h-4" /> Criar Conta
                  </>
                ) : (
                  <>
                    <LogIn className="w-4 h-4" /> Entrar
                  </>
                )}
              </button>
            </form>

            <div className="mt-4 text-center">
              <button
                type="button"
                onClick={() => {
                  setIsSignUp(!isSignUp);
                  setError(null);
                }}
                className="text-xs text-[#8C7B6E] hover:underline cursor-pointer"
              >
                {isSignUp ? 'Já possui uma conta? Entrar' : 'Não tem uma conta? Criar nova conta'}
              </button>
            </div>

            <div className="mt-6 pt-4 border-t border-[#E3DCD2] flex items-center justify-between text-xs text-[#8C7B6E]">
              <span>Modo Convidado / Offline</span>
              <button
                type="button"
                onClick={onClose}
                className="font-medium text-[#8C7B6E] hover:underline flex items-center gap-1 cursor-pointer"
              >
                <Sparkles className="w-3 h-3" /> Continuar navegando
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
