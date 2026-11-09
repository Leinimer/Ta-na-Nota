# Assistente de IA — Tá na nota

Esta implementação adiciona um assistente de linguagem natural ao próprio aplicativo. Ela mantém Supabase Auth, RLS, IndexedDB, sincronização e Supabase Realtime existentes.

## Arquitetura

- A interface do chat fica no Next.js.
- A rota de servidor \`/api/assistant\` chama a OpenAI Responses API.
- As ferramentas do assistente consultam e alteram o Supabase usando o JWT da sessão do usuário.
- O banco aplica as políticas RLS atuais. A implementação não usa nem exige a chave \`service_role\`.
- A rota \`/api/assistant/confirm-delete\` executa a exclusão somente depois do clique explícito de confirmação.
- A camada de ferramentas está isolada em \`lib/ai-notes/tools.ts\`, podendo ser reaproveitada futuramente por um servidor MCP.

## Variáveis de ambiente

Configure estas variáveis no ambiente de hospedagem (por exemplo, Vercel):

- \`OPENAI_API_KEY\`: chave secreta de um projeto da OpenAI Platform. Somente no servidor.
- \`OPENAI_MODEL\`: opcional. Padrão atual: \`gpt-6-astra\`.
- \`NEXT_PUBLIC_SUPABASE_URL\`: URL do projeto Supabase já utilizada pelo aplicativo.
- \`NEXT_PUBLIC_SUPABASE_ANON_KEY\`: chave publicável/anon já utilizada pelo aplicativo.
- \`AI_ASSISTANT_DAILY_LIMIT\`: opcional. Chamadas máximas por usuário por dia; padrão 50, máximo 500.

Nunca coloque \`OPENAI_API_KEY\` em uma variável \`NEXT_PUBLIC_*\`, no navegador ou no GitHub. Não envie a chave por chat. Adicione-a diretamente nas variáveis de ambiente da Vercel e faça novo deploy.

## Migration necessária

Antes de testar a integração, execute o conteúdo de:

\`supabase/migrations/20261109000001_ai_note_delete_rpc.sql\`

no SQL Editor do projeto Supabase correto. A migration atualiza as RPCs transacionais necessárias para criação, gravação, movimentação e renomeação; adiciona a RPC de exclusão com confirmação, e cria um limitador diário de uso para controlar custos. A exclusão exige usuário autenticado, limita a operação a notas próprias e rejeita pastas. Ela cria um tombstone no nó e remove o conteúdo da nota na mesma transação.

O restante das ferramentas reutiliza as RPCs existentes \`create_note_atomic\`, \`save_note_versioned\` e \`move_node_atomic\`.

## Ferramentas disponíveis

- \`list_folders\`
- \`list_recent_notes\`
- \`search_notes\`
- \`read_note\`
- \`create_folder\`
- \`create_note\`
- \`append_to_note\`
- \`rename_note\`
- \`move_note\`
- \`request_delete_note\` (somente prepara confirmação)

Não há exclusão de pastas nem substituição integral de conteúdo nesta primeira versão, para evitar operações destrutivas acidentais.

## Privacidade e limites

- Cada chamada exige um JWT válido do Supabase. O ID do usuário é derivado da sessão validada, nunca do corpo enviado pelo navegador.
- As consultas também filtram por \`user_id\`, além de dependerem do RLS.
- O conteúdo de uma nota só é enviado à OpenAI quando o usuário pede para ler, resumir ou trabalhar com aquela nota. O assistente não envia toda a biblioteca de notas.
- O conteúdo necessário para executar cada comando é enviado à OpenAI API para processamento; não é enviada a biblioteca inteira de notas. A OpenAI API é cobrada separadamente da assinatura ChatGPT. Configure limites de orçamento e alertas no projeto da OpenAI Platform.
- Esta rota usa \`store: false\` na Responses API e mantém o histórico recente apenas no estado da interface durante a sessão. Isso evita criar uma conversa persistente da aplicação na API, mas não desativa os registros de monitoramento de abuso da plataforma.
- Respostas de pesquisa na web podem conter fontes. O assistente deve citar essas fontes quando registrar informações atuais em uma nota.

## Testes sugeridos

1. Entre no app com uma conta válida e abra o botão do assistente.
2. Peça: "Liste minhas pastas".
3. Peça: "Quais foram minhas três últimas notas criadas?"
4. Crie uma nota simples dentro de uma pasta existente.
5. Abra essa nota no editor e confirme que o conteúdo aparece corretamente.
6. Peça para acrescentar um parágrafo à nota e confirme que o texto anterior foi preservado.
7. Peça para excluir uma nota de teste. Confirme que nada é apagado antes do clique em "Confirmar exclusão".
8. Confirme a exclusão e verifique a atualização da árvore e dos outros dispositivos.

## Observações

- A primeira versão requer conexão com a internet para usar a IA. O restante do app mantém o comportamento offline-first.
- O assistente não é um canal de chat dentro do ChatGPT. Com o plano Go, ele funciona dentro do Tá na nota, usando uma chave de API independente.
- O serviço foi separado para futura exposição por MCP, caso o plano/cliente ChatGPT usado passe a suportar as ações desejadas.
