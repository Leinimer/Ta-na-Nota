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
        className="w-full max-w-md bg-[#ffffff] dark:bg-[#23221e] border border-[#d1c4bc] dark:border-[#44403a] rounded-xl shadow-xl p-6 sm:p-8 text-[#1b1c19] dark:text-[#f2f1ec] relative animate-in fade-in zoom-in-95 duration-150"
      >
        <button
          id="close-auth-modal"
          onClick={onClose}
          className="absolute top-4 right-4 text-[#7f756e] hover:text-[#1b1c19] dark:hover:text-[#ffffff] p-1 rounded-md transition-colors"
          aria-label="Fechar"
        >
          <X className="w-5 h-5" />
        </button>

        {currentUser && currentUser.id !== 'demo-user-tactility-1' ? (
          <div className="space-y-4 text-center">
            <div className="w-14 h-14 bg-[#f4dfcb] dark:bg-[#3c3328] text-[#68594d] dark:text-[#d7c3b4] rounded-full mx-auto flex items-center justify-center font-bold text-xl">
              {currentUser.displayName?.[0]?.toUpperCase() || 'U'}
            </div>
            <h3 className="text-xl font-medium tracking-tight">Sua Conta</h3>
            <p className="text-sm text-[#7f756e]">{currentUser.email}</p>
            <div className="pt-4 border-t border-[#eae8e3] dark:border-[#2f2d29]">
              <button
                id="btn-signout"
                onClick={handleLogout}
                className="w-full py-2.5 px-4 rounded-lg bg-[#eae8e3] hover:bg-[#d1c4bc] dark:bg-[#2c2a26] dark:hover:bg-[#36342f] text-sm font-medium transition-colors cursor-pointer"
              >
                Encerrar Sessão
              </button>
            </div>
          </div>
        ) : (
          <div>
            <div className="text-center mb-6">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-[#f5f3ee] dark:bg-[#2c2a26] text-[#68594d] dark:text-[#d7c3b4] mb-3">
                <Shield className="w-3.5 h-3.5" />
                {isSupabaseConfigured ? 'Supabase Conectado' : 'Modo Offline Ativo'}
              </span>
              <h2 className="text-2xl font-serif font-medium tracking-tight">Digital Tactility</h2>
              <p className="text-sm text-[#7f756e] mt-1">Um espaço silencioso para sua escrita e conhecimento</p>
            </div>

            {error && (
              <div className="p-3 mb-4 text-xs bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-300 rounded-lg border border-red-200 dark:border-red-900">
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-3.5">
              {isSignUp && (
                <div>
                  <label className="block text-xs font-medium text-[#7f756e] mb-1">Nome ou Apelido</label>
                  <input
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Seu nome"
                    className="w-full px-3 py-2 rounded-lg border border-[#d1c4bc] dark:border-[#44403a] bg-transparent text-sm focus:outline-none focus:border-[#68594d]"
                  />
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-[#7f756e] mb-1">Email</label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="voce@exemplo.com"
                  className="w-full px-3 py-2 rounded-lg border border-[#d1c4bc] dark:border-[#44403a] bg-transparent text-sm focus:outline-none focus:border-[#68594d]"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-[#7f756e] mb-1">Senha</label>
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full px-3 py-2 rounded-lg border border-[#d1c4bc] dark:border-[#44403a] bg-transparent text-sm focus:outline-none focus:border-[#68594d]"
                />
              </div>

              <button
                id="btn-auth-submit"
                type="submit"
                disabled={loading}
                className="w-full mt-2 py-2.5 px-4 rounded-lg bg-[#68594d] hover:bg-[#574a3f] text-white font-medium text-sm transition-colors flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
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
                className="text-xs text-[#68594d] dark:text-[#d7c3b4] hover:underline cursor-pointer"
              >
                {isSignUp ? 'Já possui uma conta? Entrar' : 'Não tem uma conta? Criar nova conta'}
              </button>
            </div>

            <div className="mt-6 pt-4 border-t border-[#eae8e3] dark:border-[#2f2d29] flex items-center justify-between text-xs text-[#7f756e]">
              <span>Modo Convidado / Offline</span>
              <button
                type="button"
                onClick={onClose}
                className="font-medium text-[#68594d] dark:text-[#d7c3b4] hover:underline flex items-center gap-1 cursor-pointer"
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
