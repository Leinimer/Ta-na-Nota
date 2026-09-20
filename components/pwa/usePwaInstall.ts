'use client';

import { useState, useEffect, useCallback } from 'react';

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{
    outcome: 'accepted' | 'dismissed';
    platform: string;
  }>;
  prompt(): Promise<void>;
}

let globalDeferredPrompt: BeforeInstallPromptEvent | null = null;
const promptListeners = new Set<(canInstall: boolean) => void>();

export function usePwaInstall() {
  const [canInstall, setCanInstall] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as any).standalone === true;
    return !isStandalone && Boolean(globalDeferredPrompt);
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handlePromptChange = (installable: boolean) => {
      setCanInstall(installable);
    };

    promptListeners.add(handlePromptChange);

    const onBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      globalDeferredPrompt = e as BeforeInstallPromptEvent;
      for (const listener of promptListeners) {
        listener(true);
      }
    };

    const onAppInstalled = () => {
      console.info('[PWA INSTALLED]');
      globalDeferredPrompt = null;
      for (const listener of promptListeners) {
        listener(false);
      }
    };

    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    window.addEventListener('appinstalled', onAppInstalled);

    return () => {
      promptListeners.delete(handlePromptChange);
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
      window.removeEventListener('appinstalled', onAppInstalled);
    };
  }, []);

  const installApp = useCallback(async () => {
    if (!globalDeferredPrompt) return;

    try {
      await globalDeferredPrompt.prompt();
      const choice = await globalDeferredPrompt.userChoice;
      if (choice.outcome === 'accepted') {
        console.info('[PWA INSTALLED]');
        globalDeferredPrompt = null;
        for (const listener of promptListeners) {
          listener(false);
        }
      }
    } catch (err) {
      console.warn('Erro ao disparar prompt de instalação:', err);
    }
  }, []);

  return {
    canInstall,
    installApp,
  };
}
