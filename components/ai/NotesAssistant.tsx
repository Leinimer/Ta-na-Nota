"use client";

import React, { FormEvent, KeyboardEvent, useMemo, useState } from "react";
import {
  Bot,
  Check,
  ChevronDown,
  Loader2,
  MessageCircle,
  Send,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { getSupabase } from "@/lib/supabase/client";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  citations?: Array<{ title: string; url: string }>;
};

type PendingAction = {
  type: "delete_note";
  nodeId: string;
  title: string;
};

type Props = {
  onDataChanged: (nodeId?: string) => Promise<void> | void;
};

const QUICK_PROMPTS = [
  "Quais foram minhas últimas notas?",
  "Encontre minhas notas sobre estudos",
  "Crie uma nota com este assunto...",
];

export function NotesAssistant({ onDataChanged }: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "assistant",
      content: "Olá! Sou o assistente do Tá na nota. Posso pesquisar, criar, organizar e atualizar suas notas. O que vamos fazer?",
    },
  ]);
  const [isSending, setIsSending] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [isConfirming, setIsConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const history = useMemo(
    () => messages.slice(-10).map((item) => ({ role: item.role, content: item.content })),
    [messages],
  );

  async function getAccessToken() {
    const supabase = getSupabase();
    if (!supabase) throw new Error("O Supabase não está configurado neste navegador.");
    const { data, error: sessionError } = await supabase.auth.getSession();
    if (sessionError || !data.session?.access_token) {
      throw new Error("Sua sessão expirou. Entre novamente no aplicativo.");
    }
    return data.session.access_token;
  }

  async function sendMessage(text: string) {
    const clean = text.trim();
    if (!clean || isSending || pendingAction) return;

    setError(null);
    setInput("");
    setIsSending(true);
    setMessages((current) => [...current, { role: "user", content: clean }]);

    try {
      const token = await getAccessToken();
      const response = await fetch("/api/assistant", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token,
        },
        body: JSON.stringify({
          message: clean,
          history,
        }),
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Não foi possível falar com o assistente.");

      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          content: payload.text || "Pedido processado.",
          citations: Array.isArray(payload.citations) ? payload.citations : [],
        },
      ]);

      if (payload.pendingAction?.type === "delete_note") {
        setPendingAction(payload.pendingAction);
      }
      if (payload.dataChanged) {
        await onDataChanged(payload.changedNodeId);
      }
    } catch (err: any) {
      setError(err?.message || "Ocorreu um erro inesperado.");
    } finally {
      setIsSending(false);
    }
  }

  async function confirmDelete() {
    if (!pendingAction || isConfirming) return;
    setIsConfirming(true);
    setError(null);

    try {
      const token = await getAccessToken();
      const response = await fetch("/api/assistant/confirm-delete", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token,
        },
        body: JSON.stringify({ nodeId: pendingAction.nodeId }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Não foi possível excluir a nota.");

      const deletedTitle = payload.title || pendingAction.title;
      setMessages((current) => [
        ...current,
        { role: "user", content: "Confirmei a exclusão de \"" + deletedTitle + "\"." },
        { role: "assistant", content: "A nota \"" + deletedTitle + "\" foi excluída. A árvore de notas foi atualizada." },
      ]);
      setPendingAction(null);
      await onDataChanged();
    } catch (err: any) {
      setError(err?.message || "Não foi possível concluir a exclusão.");
    } finally {
      setIsConfirming(false);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void sendMessage(input);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void sendMessage(input);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen((value) => !value)}
        className="fixed bottom-5 right-5 z-[70] flex items-center gap-2 rounded-full bg-[#8C7B6E] px-4 py-3 text-sm font-semibold text-white shadow-xl transition hover:bg-[#796A5E] focus:outline-none focus:ring-2 focus:ring-[#B9A18E] focus:ring-offset-2"
        aria-label={isOpen ? "Fechar assistente" : "Abrir assistente de notas"}
        title="Assistente de notas"
      >
        {isOpen ? <X className="h-4 w-4" /> : <Sparkles className="h-4 w-4" />}
        <span>Assistente</span>
      </button>

      {isOpen && (
        <section
          className="fixed bottom-[5.25rem] right-5 z-[70] flex h-[min(680px,calc(100vh-8rem))] w-[min(440px,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-[#DED5C9] bg-[#FEFDFA] text-[#3D352E] shadow-2xl"
          aria-label="Assistente de notas"
        >
          <header className="flex items-center gap-3 border-b border-[#E3DCD2] bg-[#F9F7F2] px-4 py-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#E7DED3] text-[#796A5E]">
              <Bot className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold">Assistente do Tá na nota</div>
              <div className="text-[11px] text-[#8C7B6E]">OpenAI API · pesquisa e organização por linguagem natural</div>
            </div>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="rounded-lg p-2 text-[#8C7B6E] hover:bg-[#E9E2D9]"
              aria-label="Minimizar assistente"
            >
              <ChevronDown className="h-4 w-4" />
            </button>
          </header>

          <div className="flex-1 space-y-3 overflow-y-auto px-3 py-4">
            {messages.map((message, index) => (
              <div key={index} className={"flex " + (message.role === "user" ? "justify-end" : "justify-start")}>
                <div
                  className={
                    "max-w-[90%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed " +
                    (message.role === "user"
                      ? "rounded-br-md bg-[#E8DED2] text-[#3D352E]"
                      : "rounded-bl-md border border-[#E8E0D7] bg-white text-[#40382F]")
                  }
                >
                  <div className="whitespace-pre-wrap break-words">{message.content}</div>
                  {message.citations && message.citations.length > 0 && (
                    <div className="mt-3 border-t border-[#E8E0D7] pt-2">
                      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-[#8C7B6E]">Fontes</div>
                      <div className="space-y-1">
                        {message.citations.map((citation, citationIndex) => (
                          <a
                            key={citation.url + citationIndex}
                            href={citation.url}
                            target="_blank"
                            rel="noreferrer noopener"
                            className="block break-all text-xs text-[#6F8290] underline hover:text-[#3D647A]"
                          >
                            {citation.title}
                          </a>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ))}

            {isSending && (
              <div className="flex items-center gap-2 px-2 text-xs text-[#8C7B6E]">
                <Loader2 className="h-4 w-4 animate-spin" />
                Consultando e executando...
              </div>
            )}

            {pendingAction && (
              <div className="rounded-xl border border-[#DCC5A9] bg-[#FBF5EB] p-3">
                <div className="flex items-center gap-2 text-sm font-semibold text-[#654E34]">
                  <Trash2 className="h-4 w-4" />
                  Confirmar exclusão
                </div>
                <p className="mt-1 text-xs leading-relaxed text-[#6D5A45]">
                  A nota <strong>{pendingAction.title}</strong> será removida do aplicativo. Esta ação não pode ser desfeita.
                </p>
                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    onClick={() => void confirmDelete()}
                    disabled={isConfirming}
                    className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-[#8C5548] px-3 py-2 text-xs font-semibold text-white hover:bg-[#754438] disabled:opacity-60"
                  >
                    {isConfirming ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                    Confirmar exclusão
                  </button>
                  <button
                    type="button"
                    onClick={() => setPendingAction(null)}
                    disabled={isConfirming}
                    className="rounded-lg border border-[#DCC5A9] px-3 py-2 text-xs font-medium text-[#654E34] hover:bg-white disabled:opacity-60"
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            )}

            {error && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                {error}
              </div>
            )}

            {messages.length === 1 && (
              <div className="space-y-2 pt-1">
                <div className="flex items-center gap-2 px-1 text-[11px] font-semibold uppercase tracking-wide text-[#9A8B7D]">
                  <MessageCircle className="h-3.5 w-3.5" />
                  Sugestões
                </div>
                {QUICK_PROMPTS.map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    onClick={() => setInput(prompt)}
                    className="block w-full rounded-xl border border-[#E8E0D7] bg-white px-3 py-2 text-left text-xs text-[#6D6054] hover:bg-[#F9F7F2]"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            )}
          </div>

          <form onSubmit={handleSubmit} className="border-t border-[#E3DCD2] bg-[#F9F7F2] p-3">
            <div className="flex items-end gap-2 rounded-xl border border-[#DED5C9] bg-white p-2 focus-within:border-[#A99988]">
              <textarea
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={pendingAction ? "Confirme ou cancele a operação acima..." : "Escreva um comando para suas notas..."}
                rows={2}
                maxLength={5000}
                disabled={isSending || Boolean(pendingAction)}
                className="max-h-32 min-h-[44px] flex-1 resize-y bg-transparent px-1 py-1 text-sm text-[#3D352E] outline-none placeholder:text-[#AA9E92] disabled:opacity-50"
              />
              <button
                type="submit"
                disabled={isSending || Boolean(pendingAction) || !input.trim()}
                className="mb-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#8C7B6E] text-white hover:bg-[#796A5E] disabled:cursor-not-allowed disabled:opacity-40"
                aria-label="Enviar mensagem"
              >
                {isSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </button>
            </div>
            <p className="mt-1.5 text-center text-[10px] text-[#9A8B7D]">
              O pedido e os trechos de notas necessários podem ser enviados à OpenAI API. Não envie conteúdo sigiloso sem autorização.
            </p>
          </form>
        </section>
      )}
    </>
  );
}
