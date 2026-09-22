'use client';

import React, { useState, useEffect } from 'react';
import { authService } from '@/services/authService';
import { AppUser } from '@/types';
import { Eye, EyeOff, AlertCircle, Loader2, CheckCircle2 } from 'lucide-react';

interface AuthScreenProps {
  onAuthenticated: (user: AppUser) => void;
}

export function AuthScreen({ onAuthenticated }: AuthScreenProps) {
  const [mode, setMode] = useState<'login' | 'signup'>('login');

  // Login form state
  const [loginIdentifier, setLoginIdentifier] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [keepConnected, setKeepConnected] = useState(true);

  // Signup form state
  const [signupName, setSignupName] = useState('');
  const [signupUsername, setSignupUsername] = useState('');
  const [signupEmail, setSignupEmail] = useState('');
  const [signupPassword, setSignupPassword] = useState('');
  const [signupConfirmPassword, setSignupConfirmPassword] = useState('');

  // Username validation state
  const [isCheckingUsername, setIsCheckingUsername] = useState(false);
  const [usernameStatus, setUsernameStatus] = useState<'available' | 'unavailable' | null>(null);
  const [usernameMessage, setUsernameMessage] = useState<string | null>(null);

  // UI state
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const resetErrors = () => {
    setErrorMessage(null);
  };

  const handleSwitchTab = (newMode: 'login' | 'signup') => {
    setMode(newMode);
    resetErrors();
    setLoading(false);
    setGoogleLoading(false);
    setIsCheckingUsername(false);
  };

  // Validação derivada síncrona do nome de usuário
  const cleanSignupUsername = signupUsername.trim().toLowerCase();
  const isUsernameEmpty = cleanSignupUsername.length === 0;
  const hasInvalidUsernameChars = !isUsernameEmpty && !/^[a-zA-Z0-9_.]+$/.test(cleanSignupUsername);
  const isUsernameTooShort = !isUsernameEmpty && !hasInvalidUsernameChars && cleanSignupUsername.length < 3;
  const isUsernameSyntaxValid = !isUsernameEmpty && !hasInvalidUsernameChars && !isUsernameTooShort;

  // Debounced username availability validation via RPC
  useEffect(() => {
    const trimmed = signupUsername.trim().toLowerCase();
    if (!trimmed || !/^[a-zA-Z0-9_.]+$/.test(trimmed) || trimmed.length < 3) {
      return;
    }

    let isMounted = true;
    const timer = setTimeout(async () => {
      if (!isMounted) return;
      setIsCheckingUsername(true);
      try {
        const check = await authService.isUsernameAvailable(trimmed);
        if (!isMounted) return;
        if (check.available) {
          setUsernameStatus('available');
          setUsernameMessage('Login disponível');
        } else {
          setUsernameStatus('unavailable');
          setUsernameMessage(check.error || 'Este usuário já está em uso.');
        }
      } catch (err) {
        console.warn('Falha na checagem de username:', err);
        if (isMounted) {
          setUsernameStatus('available');
          setUsernameMessage(null);
        }
      } finally {
        if (isMounted) {
          setIsCheckingUsername(false);
        }
      }
    }, 400);

    return () => {
      isMounted = false;
      clearTimeout(timer);
    };
  }, [signupUsername]);

  // Validações do formulário de cadastro
  const isNameValid = signupName.trim().length > 0;
  const isUsernameReady =
    isUsernameSyntaxValid &&
    usernameStatus !== 'unavailable' &&
    !isCheckingUsername;
  const isEmailValid = signupEmail.trim().length > 0 && signupEmail.includes('@');
  const isPasswordValid = signupPassword.length >= 6;
  const doPasswordsMatch = signupPassword.length >= 6 && signupPassword === signupConfirmPassword;

  const isSignupFormValid =
    isNameValid &&
    isUsernameReady &&
    isEmailValid &&
    isPasswordValid &&
    doPasswordsMatch;

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    resetErrors();

    if (!loginIdentifier.trim()) {
      setErrorMessage('Informe seu e-mail ou login.');
      return;
    }
    if (!loginPassword) {
      setErrorMessage('Informe sua senha.');
      return;
    }

    setLoading(true);
    try {
      const res = await authService.signInWithIdentifier(
        loginIdentifier.trim(),
        loginPassword,
        keepConnected
      );

      if (res.error) {
        setErrorMessage(res.error);
      } else if (res.user) {
        onAuthenticated(res.user);
      }
    } catch (err: any) {
      setErrorMessage(err?.message || 'Erro inesperado ao realizar login.');
    } finally {
      setLoading(false);
    }
  };

  const handleSignupSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    resetErrors();

    const cleanName = signupName.trim();
    const cleanUsername = signupUsername.trim().toLowerCase();
    const cleanEmail = signupEmail.trim();

    if (!cleanName) {
      setErrorMessage('Por favor, informe seu nome.');
      return;
    }

    if (!cleanUsername) {
      setErrorMessage('Por favor, escolha um login.');
      return;
    }

    if (!/^[a-zA-Z0-9_.]+$/.test(cleanUsername)) {
      setErrorMessage('O login deve conter apenas letras, números, ponto ou sublinhado, sem espaços.');
      return;
    }

    if (cleanUsername.length < 3) {
      setErrorMessage('O login deve ter no mínimo 3 caracteres.');
      return;
    }

    if (!cleanEmail || !cleanEmail.includes('@')) {
      setErrorMessage('Por favor, informe um endereço de e-mail válido.');
      return;
    }

    if (!signupPassword || signupPassword.length < 6) {
      setErrorMessage('A senha deve conter no mínimo 6 caracteres.');
      return;
    }

    if (signupPassword !== signupConfirmPassword) {
      setErrorMessage('Os campos de senha não são iguais.');
      return;
    }

    setLoading(true);
    try {
      const res = await authService.signUp({
        name: cleanName,
        username: cleanUsername,
        email: cleanEmail,
        password: signupPassword,
        keepConnected,
      });

      if (res.error) {
        setErrorMessage(res.error);
      } else if (res.user) {
        onAuthenticated(res.user);
      }
    } catch (err: any) {
      setErrorMessage(err?.message || 'Erro inesperado ao criar conta.');
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    resetErrors();
    setGoogleLoading(true);
    try {
      const res = await authService.signInWithGoogle();
      if (res.error) {
        setErrorMessage(res.error);
        setGoogleLoading(false);
      } else {
        // Redirecionamento OAuth: se não redirecionar imediatamente (ex: iframe sandbox), libera o estado
        setTimeout(() => {
          setGoogleLoading(false);
        }, 3500);
      }
    } catch (err: any) {
      setErrorMessage(err?.message || 'Erro ao conectar com Google.');
      setGoogleLoading(false);
    }
  };

  return (
    <div
      id="auth-screen-container"
      className="min-h-screen w-full flex items-center justify-center bg-[#F9F7F2] p-4 sm:p-6 text-[#3D352E] select-none"
    >
      <div className="w-full max-w-md bg-[#FEFDFA] border border-[#E3DCD2] rounded-2xl shadow-xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        {/* Header with App Identity */}
        <div className="pt-8 pb-6 px-6 sm:px-8 text-center border-b border-[#E3DCD2]/50 bg-gradient-to-b from-[#FAF7F2] to-[#FEFDFA]">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-[#8C7B6E] text-[#F9F7F2] font-serif font-bold text-2xl shadow-md mb-3">
            T
          </div>
          <h1 className="font-serif text-2xl font-bold tracking-tight text-[#8C7B6E]">
            Tá na nota
          </h1>
          <p className="text-xs text-[#8C7B6E]/80 mt-1 font-sans">
            Seu caderno digital de notas, ideias e conhecimentos
          </p>
        </div>

        {/* Form Body */}
        <div className="p-6 sm:p-8">
          {/* Error Banner */}
          {errorMessage && (
            <div
              id="auth-error-banner"
              className="flex items-start gap-2.5 p-3 mb-5 rounded-lg bg-red-50/90 border border-red-200 text-red-700 text-xs animate-in fade-in duration-150"
            >
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-red-600" />
              <div className="flex-1 font-medium">{errorMessage}</div>
            </div>
          )}

          {/* MODE: LOGIN */}
          {mode === 'login' && (
            <form onSubmit={handleLoginSubmit} className="space-y-4">
              <div>
                <label
                  htmlFor="input-login-identifier"
                  className="block text-xs font-medium text-[#8C7B6E] mb-1.5"
                >
                  E-mail ou login
                </label>
                <input
                  id="input-login-identifier"
                  type="text"
                  autoComplete="username"
                  required
                  value={loginIdentifier}
                  onChange={(e) => setLoginIdentifier(e.target.value)}
                  placeholder="seu@email.com ou seu_username"
                  className="w-full px-3.5 py-2.5 text-sm bg-[#FFFFFF] border border-[#E3DCD2] rounded-lg text-[#3D352E] placeholder:text-[#8C7B6E]/50 focus:outline-none focus:border-[#8C7B6E] focus:ring-1 focus:ring-[#8C7B6E] transition-all"
                />
              </div>

              <div>
                <label
                  htmlFor="input-login-password"
                  className="block text-xs font-medium text-[#8C7B6E] mb-1.5"
                >
                  Senha
                </label>
                <div className="relative">
                  <input
                    id="input-login-password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    required
                    value={loginPassword}
                    onChange={(e) => setLoginPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full pl-3.5 pr-10 py-2.5 text-sm bg-[#FFFFFF] border border-[#E3DCD2] rounded-lg text-[#3D352E] placeholder:text-[#8C7B6E]/50 focus:outline-none focus:border-[#8C7B6E] focus:ring-1 focus:ring-[#8C7B6E] transition-all"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((prev) => !prev)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[#8C7B6E] hover:text-[#3D352E] cursor-pointer p-1"
                    title={showPassword ? 'Ocultar senha' : 'Ver senha'}
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {/* Manter conectado Checkbox */}
              <div className="flex items-center justify-between pt-1">
                <label className="flex items-center gap-2 cursor-pointer select-none text-xs text-[#8C7B6E]">
                  <input
                    type="checkbox"
                    id="checkbox-keep-connected"
                    checked={keepConnected}
                    onChange={(e) => setKeepConnected(e.target.checked)}
                    className="w-4 h-4 rounded border-[#D9C5B2] text-[#8C7B6E] focus:ring-[#8C7B6E] cursor-pointer accent-[#8C7B6E]"
                  />
                  <span>Manter conectado</span>
                </label>
              </div>

              {/* Submit Button */}
              <button
                type="submit"
                id="btn-login-submit"
                disabled={loading}
                className="w-full py-2.5 px-4 rounded-lg bg-[#8C7B6E] hover:bg-[#7b6a5d] text-[#F9F7F2] font-medium text-sm transition-colors cursor-pointer flex items-center justify-center gap-2 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                <span>Entrar</span>
              </button>
            </form>
          )}

          {/* MODE: SIGNUP (CADASTRO) */}
          {mode === 'signup' && (
            <form onSubmit={handleSignupSubmit} className="space-y-3.5">
              <div>
                <label
                  htmlFor="input-signup-name"
                  className="block text-xs font-medium text-[#8C7B6E] mb-1"
                >
                  Nome
                </label>
                <input
                  id="input-signup-name"
                  type="text"
                  required
                  value={signupName}
                  onChange={(e) => setSignupName(e.target.value)}
                  placeholder="Seu nome completo"
                  className="w-full px-3.5 py-2 text-sm bg-[#FFFFFF] border border-[#E3DCD2] rounded-lg text-[#3D352E] placeholder:text-[#8C7B6E]/50 focus:outline-none focus:border-[#8C7B6E] focus:ring-1 focus:ring-[#8C7B6E] transition-all"
                />
              </div>

              <div>
                <label
                  htmlFor="input-signup-username"
                  className="block text-xs font-medium text-[#8C7B6E] mb-1"
                >
                  Login / Usuário
                </label>
                <div className="relative flex items-center">
                  <span className="absolute left-3 text-[#8C7B6E]/60 text-sm select-none font-mono">@</span>
                  <input
                    id="input-signup-username"
                    type="text"
                    required
                    value={signupUsername}
                    onChange={(e) => {
                      setSignupUsername(e.target.value.replace(/\s+/g, ''));
                      setUsernameStatus(null);
                      setUsernameMessage(null);
                    }}
                    placeholder="seu_username"
                    className="w-full pl-8 pr-9 py-2 text-sm bg-[#FFFFFF] border border-[#E3DCD2] rounded-lg text-[#3D352E] font-mono placeholder:font-sans placeholder:text-[#8C7B6E]/50 focus:outline-none focus:border-[#8C7B6E] focus:ring-1 focus:ring-[#8C7B6E] transition-all"
                  />
                  {/* Status Indicator Icon */}
                  <div className="absolute right-3 flex items-center pointer-events-none">
                    {isCheckingUsername && (
                      <Loader2 className="w-4 h-4 text-[#8C7B6E] animate-spin" />
                    )}
                    {!isCheckingUsername && usernameStatus === 'available' && !hasInvalidUsernameChars && !isUsernameTooShort && (
                      <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                    )}
                    {!isCheckingUsername && (usernameStatus === 'unavailable' || hasInvalidUsernameChars || isUsernameTooShort) && (
                      <AlertCircle className="w-4 h-4 text-red-500" />
                    )}
                  </div>
                </div>

                {/* Feedback de disponibilidade e formato */}
                <div className="mt-1 min-h-4">
                  {isCheckingUsername && (
                    <span className="text-[11px] text-[#8C7B6E] flex items-center gap-1">
                      Verificando disponibilidade...
                    </span>
                  )}
                  {!isCheckingUsername && hasInvalidUsernameChars && (
                    <span className="text-[11px] text-red-600">
                      O login deve conter apenas letras, números, ponto ou sublinhado.
                    </span>
                  )}
                  {!isCheckingUsername && !hasInvalidUsernameChars && isUsernameTooShort && (
                    <span className="text-[11px] text-red-600">
                      O login deve ter no mínimo 3 caracteres.
                    </span>
                  )}
                  {!isCheckingUsername && usernameStatus === 'unavailable' && (
                    <span className="text-[11px] text-red-600 font-medium">
                      {usernameMessage || 'Este usuário já está em uso.'}
                    </span>
                  )}
                  {!isCheckingUsername && usernameStatus === 'available' && !hasInvalidUsernameChars && !isUsernameTooShort && (
                    <span className="text-[11px] text-emerald-700 font-medium">
                      ✓ Login disponível
                    </span>
                  )}
                  {!isCheckingUsername && isUsernameEmpty && (
                    <span className="text-[10px] text-[#8C7B6E]/70 block">
                      Apenas letras, números, ponto ou sublinhado (mínimo 3 caracteres)
                    </span>
                  )}
                </div>
              </div>

              <div>
                <label
                  htmlFor="input-signup-email"
                  className="block text-xs font-medium text-[#8C7B6E] mb-1"
                >
                  E-mail
                </label>
                <input
                  id="input-signup-email"
                  type="email"
                  required
                  value={signupEmail}
                  onChange={(e) => setSignupEmail(e.target.value)}
                  placeholder="seu@email.com"
                  className="w-full px-3.5 py-2 text-sm bg-[#FFFFFF] border border-[#E3DCD2] rounded-lg text-[#3D352E] placeholder:text-[#8C7B6E]/50 focus:outline-none focus:border-[#8C7B6E] focus:ring-1 focus:ring-[#8C7B6E] transition-all"
                />
              </div>

              <div>
                <label
                  htmlFor="input-signup-password"
                  className="block text-xs font-medium text-[#8C7B6E] mb-1"
                >
                  Senha
                </label>
                <input
                  id="input-signup-password"
                  type={showPassword ? 'text' : 'password'}
                  required
                  value={signupPassword}
                  onChange={(e) => setSignupPassword(e.target.value)}
                  placeholder="Mínimo 6 caracteres"
                  className="w-full px-3.5 py-2 text-sm bg-[#FFFFFF] border border-[#E3DCD2] rounded-lg text-[#3D352E] placeholder:text-[#8C7B6E]/50 focus:outline-none focus:border-[#8C7B6E] focus:ring-1 focus:ring-[#8C7B6E] transition-all"
                />
              </div>

              <div>
                <label
                  htmlFor="input-signup-confirm-password"
                  className="block text-xs font-medium text-[#8C7B6E] mb-1"
                >
                  Confirmar senha
                </label>
                <input
                  id="input-signup-confirm-password"
                  type={showPassword ? 'text' : 'password'}
                  required
                  value={signupConfirmPassword}
                  onChange={(e) => setSignupConfirmPassword(e.target.value)}
                  placeholder="Repita a senha"
                  className="w-full px-3.5 py-2 text-sm bg-[#FFFFFF] border border-[#E3DCD2] rounded-lg text-[#3D352E] placeholder:text-[#8C7B6E]/50 focus:outline-none focus:border-[#8C7B6E] focus:ring-1 focus:ring-[#8C7B6E] transition-all"
                />
                {signupConfirmPassword.length > 0 && signupPassword !== signupConfirmPassword && (
                  <span className="text-[11px] text-red-600 block mt-1">
                    Os campos de senha não são iguais.
                  </span>
                )}
              </div>

              {/* Submit Button */}
              <button
                type="submit"
                id="btn-signup-submit"
                disabled={loading || !isSignupFormValid}
                className="w-full mt-2 py-2.5 px-4 rounded-lg bg-[#8C7B6E] hover:bg-[#7b6a5d] text-[#F9F7F2] font-medium text-sm transition-colors cursor-pointer flex items-center justify-center gap-2 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                <span>Criar conta</span>
              </button>
            </form>
          )}

          {/* Divider */}
          <div className="relative flex items-center justify-center my-5">
            <div className="border-t border-[#E3DCD2] w-full" />
            <span className="bg-[#FEFDFA] px-3 text-[11px] font-medium uppercase tracking-wider text-[#8C7B6E]/60 absolute select-none">
              ou
            </span>
          </div>

          {/* Google OAuth Button */}
          <button
            type="button"
            id="btn-google-auth"
            disabled={googleLoading}
            onClick={handleGoogleLogin}
            className="w-full py-2.5 px-4 rounded-lg bg-[#FFFFFF] hover:bg-[#F9F7F2] border border-[#D9C5B2] text-[#3D352E] font-medium text-xs sm:text-sm transition-colors cursor-pointer flex items-center justify-center gap-3 shadow-2xs disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {googleLoading ? (
              <Loader2 className="w-4 h-4 animate-spin text-[#8C7B6E]" />
            ) : (
              <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24">
                <path
                  fill="#4285F4"
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                />
                <path
                  fill="#34A853"
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                />
                <path
                  fill="#EA4335"
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                />
              </svg>
            )}
            <span>Continuar com Google</span>
          </button>

          {/* Toggle link below */}
          <div className="mt-5 text-center text-xs text-[#8C7B6E]">
            {mode === 'login' ? (
              <span>
                Não tem uma conta?{' '}
                <button
                  type="button"
                  id="link-to-signup"
                  onClick={() => handleSwitchTab('signup')}
                  className="font-semibold text-[#8C7B6E] hover:text-[#3D352E] hover:underline cursor-pointer ml-1"
                >
                  Criar conta
                </button>
              </span>
            ) : (
              <span>
                Já possui uma conta?{' '}
                <button
                  type="button"
                  id="link-to-login"
                  onClick={() => handleSwitchTab('login')}
                  className="font-semibold text-[#8C7B6E] hover:text-[#3D352E] hover:underline cursor-pointer ml-1"
                >
                  Entrar
                </button>
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
