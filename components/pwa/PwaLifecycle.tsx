'use client';

import { useEffect } from 'react';

export function PwaLifecycle() {
  useEffect(() => {
    if (typeof window === 'undefined') return;

    // 1. Logs de conectividade
    const handleOnline = () => {
      console.info('[PWA ONLINE]');
    };

    const handleOffline = () => {
      console.info('[PWA OFFLINE]');
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // 2. Registro do Service Worker somente em browser e quando suportado
    if ('serviceWorker' in navigator) {
      // Evita registrar múltiplos ou em ambiente não compatível
      const registerServiceWorker = async () => {
        try {
          const registration = await navigator.serviceWorker.register('/sw.js', {
            scope: '/',
          });

          console.info('[PWA REGISTERED]');

          navigator.serviceWorker.ready.then(() => {
            console.info('[PWA READY]');
          });

          // Monitora atualizações do Service Worker
          registration.addEventListener('updatefound', () => {
            const newWorker = registration.installing;
            if (newWorker) {
              newWorker.addEventListener('statechange', () => {
                if (newWorker.state === 'installed') {
                  if (navigator.serviceWorker.controller) {
                    console.info('[PWA UPDATE AVAILABLE]');
                  } else {
                    console.info('[PWA INSTALLED]');
                  }
                }
              });
            }
          });

          if (registration.installing) {
            registration.installing.addEventListener('statechange', (e: any) => {
              if (e.target?.state === 'installed') {
                if (navigator.serviceWorker.controller) {
                  console.info('[PWA UPDATE AVAILABLE]');
                } else {
                  console.info('[PWA INSTALLED]');
                }
              }
            });
          }
        } catch (err) {
          // Em desenvolvimento sem build ou contexto restrito, não impede o app de funcionar
          if (process.env.NODE_ENV === 'production') {
            console.warn('[PWA Registration Warning]:', err);
          }
        }
      };

      // Inicia registro após o carregamento da janela para não impactar initial paint
      if (document.readyState === 'complete') {
        registerServiceWorker();
      } else {
        window.addEventListener('load', registerServiceWorker, { once: true });
      }

      // Evento de ativação de novo controller
      const handleControllerChange = () => {
        console.info('[PWA UPDATE ACTIVATED]');
      };

      navigator.serviceWorker.addEventListener('controllerchange', handleControllerChange);

      return () => {
        window.removeEventListener('online', handleOnline);
        window.removeEventListener('offline', handleOffline);
        navigator.serviceWorker.removeEventListener('controllerchange', handleControllerChange);
      };
    }

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return null;
}
