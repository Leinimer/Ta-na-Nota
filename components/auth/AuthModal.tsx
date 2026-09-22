'use client';

import React, { useState } from 'react';
import { AppUser, SyncStatus } from '@/types';
import { authService } from '@/services/authService';
import { isSupabaseConfigured } from '@/lib/supabase/client';
import { syncEngine } from '@/services/syncEngine';
import {
  LogIn,
  UserPlus,
  Shield,
  Sparkles,
  X,
  Settings,
  User as UserIcon,
  RefreshCw,
  Download,
  CheckCircle2,
  WifiOff,
  AlertCircle,
} from 'lucide-react';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: AppUser | null;
  onUserChanged: (user: AppUser | null) => void;
  syncStatus?: SyncStatus;
  onExportAll?: () => void;
}

export function AuthModal({
  isOpen,
  onClose,
  currentUser,
  onUserChanged,
  syncStatus = 'saved',
  onExportAll,
}: AuthModalProps) {
  const [activeTab, setActiveTab] = useState<'account' | 'sync' | 'export'>('account');
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [syncingNow, setSyncingNow] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

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

  const handleLogout = () => {
    onUserChanged(null);
    onClose();
    authService.signOut().catch((err) => {
      console.warn('Erro ao deslogar do Supabase em background:', err);
    });
  };

  const handleManualSync = async () => {
    if (!currentUser) return;
    setSyncingNow(true);
    setSyncMessage(null);
    try {
      await syncEngine.processPersistentQueue();
      await syncEngine.hydrateFromRemote(currentUser.id);
      setSyncMessage('Sincronização concluída com sucesso!');
    } catch (err: any) {
      setSyncMessage(err.message || 'Erro ao sincronizar.');
    } finally {
      setSyncingNow(false);
    }
  };

  return (
    <div id="auth-modal-overlay" className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
      <div
        id="auth-modal-card"
        className="w-full max-w-md bg-[#FEFDFA] border border-[#E3DCD2] rounded-xl shadow-xl text-[#3D352E] relative animate-in fade-in zoom-in-95 duration-150 overflow-hidden flex flex-col max-h-[90vh]"
      >
        {/* Cabeçalho do Modal: Ajustes */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#E3DCD2] bg-[#F9F7F2]">
          <div className="flex items-center gap-2">
            <Settings className="w-5 h-5 text-[#8C7B6E]" />
            <h2 className="text-base font-serif font-semibold text-[#8C7B6E]">Ajustes</h2>
          </div>
          <button
            id="close-auth-modal"
            onClick={onClose}
            className="text-[#8C7B6E] hover:text-[#3D352E] p-1 rounded-md transition-colors cursor-pointer"
            aria-label="Fechar"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Abas de Navegação interna em Ajustes */}
        <div className="flex border-b border-[#E3DCD2] bg-[#FEFDFA] px-5 pt-2 gap-2 text-xs">
          <button
            type="button"
            onClick={() => setActiveTab('account')}
            className={`pb-2.5 px-2 border-b-2 font-medium flex items-center gap-1.5 transition-colors cursor-pointer ${
              activeTab === 'account'
                ? 'border-[#8C7B6E] text-[#8C7B6E]'
                : 'border-transparent text-[#8C7B6E]/70 hover:text-[#3D352E]'
            }`}
          >
            <UserIcon className="w-3.5 h-3.5" />
            <span>Conta</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('sync')}
            className={`pb-2.5 px-2 border-b-2 font-medium flex items-center gap-1.5 transition-colors cursor-pointer ${
              activeTab === 'sync'
                ? 'border-[#8C7B6E] text-[#8C7B6E]'
                : 'border-transparent text-[#8C7B6E]/70 hover:text-[#3D352E]'
            }`}
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Sincronização</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('export')}
            className={`pb-2.5 px-2 border-b-2 font-medium flex items-center gap-1.5 transition-colors cursor-pointer ${
              activeTab === 'export'
                ? 'border-[#8C7B6E] text-[#8C7B6E]'
                : 'border-transparent text-[#8C7B6E]/70 hover:text-[#3D352E]'
            }`}
          >
            <Download className="w-3.5 h-3.5" />
            <span>Exportar tudo</span>
          </button>
        </div>

        {/* Conteúdo da Aba */}
        <div className="p-5 sm:p-6 overflow-y-auto custom-scrollbar flex-1">
          {/* ABA 1: CONTA */}
          {activeTab === 'account' && (
            <div>
              {currentUser ? (
                <div className="space-y-4 text-center">
                  <div className="w-14 h-14 bg-[#D9C5B2] text-[#3D352E] rounded-full mx-auto flex items-center justify-center font-bold text-xl border border-[#8C7B6E]/30">
                    {currentUser.displayName?.[0]?.toUpperCase() || currentUser.name?.[0]?.toUpperCase() || currentUser.username?.[0]?.toUpperCase() || 'U'}
                  </div>
                  <div>
                    <h3 className="text-base font-serif font-semibold tracking-tight text-[#3D352E]">
                      {currentUser.displayName || currentUser.name || 'Usuário'}
                    </h3>
                    {currentUser.username && (
                      <p className="text-xs font-mono text-[#8C7B6E] mt-0.5">@{currentUser.username}</p>
                    )}
                    {currentUser.email && (
                      <p className="text-xs text-[#8C7B6E]/80 mt-1">{currentUser.email}</p>
                    )}
                  </div>

                  <div className="p-3 rounded-lg bg-[#F9F7F2] border border-[#E3DCD2] text-left text-xs text-[#8C7B6E] space-y-1">
                    <div className="flex items-center justify-between">
                      <span>Ambiente:</span>
                      <span className="font-medium text-[#3D352E]">
                        {isSupabaseConfigured ? 'Supabase Nuvem' : 'Local (IndexedDB)'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>ID da Conta:</span>
                      <span className="font-mono text-[11px] text-[#3D352E] truncate max-w-[180px]">
                        {currentUser.id}
                      </span>
                    </div>
                  </div>

                  <div className="pt-3 border-t border-[#E3DCD2]">
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
                  <div className="text-center mb-5">
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-[#E3DCD2] border border-[#D9C5B2] text-[#8C7B6E] mb-2.5">
                      <Shield className="w-3.5 h-3.5" />
                      {isSupabaseConfigured ? 'Supabase Conectado' : 'Modo Offline Ativo'}
                    </span>
                    <h3 className="text-xl font-handwritten font-bold text-[#8C7B6E]">Tá na nota</h3>
                    <p className="text-xs text-[#8C7B6E]/80 mt-0.5">Acesse suas notas sincronizadas em qualquer dispositivo</p>
                  </div>

                  {error && (
                    <div className="p-3 mb-4 text-xs bg-red-50 text-red-700 rounded-lg border border-red-200">
                      {error}
                    </div>
                  )}

                  <form onSubmit={handleSubmit} className="space-y-3">
                    {isSignUp && (
                      <div>
                        <label className="block text-xs font-medium text-[#8C7B6E] mb-1">Nome ou Apelido</label>
                        <input
                          type="text"
                          required
                          value={name}
                          onChange={(e) => setName(e.target.value)}
                          placeholder="Seu nome"
                          className="w-full px-3 py-2 rounded-lg border border-[#E3DCD2] bg-[#FFFFFF] text-xs focus:outline-none focus:border-[#8C7B6E] text-[#3D352E]"
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
                        className="w-full px-3 py-2 rounded-lg border border-[#E3DCD2] bg-[#FFFFFF] text-xs focus:outline-none focus:border-[#8C7B6E] text-[#3D352E]"
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
                        className="w-full px-3 py-2 rounded-lg border border-[#E3DCD2] bg-[#FFFFFF] text-xs focus:outline-none focus:border-[#8C7B6E] text-[#3D352E]"
                      />
                    </div>

                    <button
                      id="btn-auth-submit"
                      type="submit"
                      disabled={loading}
                      className="w-full mt-2 py-2.5 px-4 rounded-lg bg-[#8C7B6E] hover:bg-[#796A5E] text-[#F9F7F2] font-medium text-xs transition-colors flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 shadow-xs"
                    >
                      {loading ? (
                        <span>Processando...</span>
                      ) : isSignUp ? (
                        <>
                          <UserPlus className="w-3.5 h-3.5" /> Criar Conta
                        </>
                      ) : (
                        <>
                          <LogIn className="w-3.5 h-3.5" /> Entrar
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
                </div>
              )}
            </div>
          )}

          {/* ABA 2: SINCRONIZAÇÃO */}
          {activeTab === 'sync' && (
            <div className="space-y-4 text-xs">
              <div className="p-3.5 rounded-lg bg-[#F9F7F2] border border-[#E3DCD2] space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-[#3D352E]">Status Atual:</span>
                  <span className="flex items-center gap-1.5 font-medium">
                    {syncStatus === 'saving' && (
                      <span className="text-amber-700 flex items-center gap-1">
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" /> Sincronizando...
                      </span>
                    )}
                    {syncStatus === 'saved' && (
                      <span className="text-emerald-700 flex items-center gap-1">
                        <CheckCircle2 className="w-3.5 h-3.5" /> Sincronizado
                      </span>
                    )}
                    {syncStatus === 'offline' && (
                      <span className="text-[#8C7B6E] flex items-center gap-1">
                        <WifiOff className="w-3.5 h-3.5" /> Offline (salvo localmente)
                      </span>
                    )}
                    {syncStatus === 'error' && (
                      <span className="text-rose-700 flex items-center gap-1">
                        <AlertCircle className="w-3.5 h-3.5" /> Erro de sincronização
                      </span>
                    )}
                  </span>
                </div>

                <div className="text-[11px] text-[#8C7B6E] leading-relaxed pt-1 border-t border-[#E3DCD2]">
                  Suas notas são sempre salvas primeiro no dispositivo local (IndexedDB) e sincronizadas automaticamente via fila transacional e Realtime.
                </div>
              </div>

              {syncMessage && (
                <div className="p-3 rounded-lg bg-emerald-50 text-emerald-800 border border-emerald-200 text-xs">
                  {syncMessage}
                </div>
              )}

              {currentUser && (
                <button
                  type="button"
                  onClick={handleManualSync}
                  disabled={syncingNow}
                  className="w-full py-2.5 px-4 rounded-lg bg-[#8C7B6E] hover:bg-[#796A5E] text-[#F9F7F2] font-medium transition-colors flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 shadow-xs"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${syncingNow ? 'animate-spin' : ''}`} />
                  <span>{syncingNow ? 'Sincronizando fila...' : 'Sincronizar Agora'}</span>
                </button>
              )}
            </div>
          )}

          {/* ABA 3: EXPORTAR TUDO */}
          {activeTab === 'export' && (
            <div className="space-y-4 text-xs">
              <div className="p-3.5 rounded-lg bg-[#F9F7F2] border border-[#E3DCD2] space-y-2">
                <h4 className="font-serif font-semibold text-[#3D352E] text-sm flex items-center gap-1.5">
                  <Download className="w-4 h-4 text-[#8C7B6E]" /> Backup Completo
                </h4>
                <p className="text-[#8C7B6E] leading-relaxed text-[11px]">
                  Baixe todas as suas pastas e notas estruturadas em um único arquivo compactado (.ZIP). Cada nota é exportada em formato Markdown puro (.md) com suas tags preservadas.
                </p>
              </div>

              <button
                type="button"
                id="btn-modal-export-all"
                onClick={() => {
                  if (onExportAll) {
                    onExportAll();
                    onClose();
                  }
                }}
                className="w-full py-2.5 px-4 rounded-lg bg-[#8C7B6E] hover:bg-[#796A5E] text-[#F9F7F2] font-medium transition-colors flex items-center justify-center gap-2 cursor-pointer shadow-xs"
              >
                <Download className="w-4 h-4" />
                <span>Baixar Todas as Notas (.ZIP)</span>
              </button>
            </div>
          )}
        </div>

        {/* Rodapé do Modal */}
        <div className="px-5 py-3 border-t border-[#E3DCD2] bg-[#F9F7F2] flex items-center justify-between text-xs text-[#8C7B6E]">
          <span>Tá na nota v1.0</span>
          <button
            type="button"
            onClick={onClose}
            className="font-medium text-[#8C7B6E] hover:underline flex items-center gap-1 cursor-pointer"
          >
            <Sparkles className="w-3 h-3" /> Concluir
          </button>
        </div>
      </div>
    </div>
  );
}
