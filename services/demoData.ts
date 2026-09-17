import { TreeNode, NoteRecord, TagRecord, AppUser } from '@/types';
import { MarkdownService } from './markdownService';

export const DEMO_USER: AppUser = {
  id: 'demo-user-tactility-1',
  email: 'usuario@tactility.notes',
  displayName: 'Meu Segundo Cérebro',
};

export function createInitialDemoData(userId: string = DEMO_USER.id): {
  nodes: TreeNode[];
  notes: NoteRecord[];
  tags: TagRecord[];
} {
  const now = new Date().toISOString();

  // Nodes hierarchy
  // Folders:
  const folderEstudos: TreeNode = {
    id: 'folder-estudos',
    userId,
    parentId: null,
    type: 'folder',
    name: 'Estudos',
    position: 1000,
    createdAt: now,
    updatedAt: now,
  };

  const folderDireito: TreeNode = {
    id: 'folder-direito',
    userId,
    parentId: 'folder-estudos',
    type: 'folder',
    name: 'Direito',
    position: 1000,
    createdAt: now,
    updatedAt: now,
  };

  const folderConstitucional: TreeNode = {
    id: 'folder-constitucional',
    userId,
    parentId: 'folder-direito',
    type: 'folder',
    name: 'Constitucional',
    position: 1000,
    createdAt: now,
    updatedAt: now,
  };

  const folderAdministrativo: TreeNode = {
    id: 'folder-administrativo',
    userId,
    parentId: 'folder-direito',
    type: 'folder',
    name: 'Administrativo',
    position: 2000,
    createdAt: now,
    updatedAt: now,
  };

  const folderFinancas: TreeNode = {
    id: 'folder-financas',
    userId,
    parentId: null,
    type: 'folder',
    name: 'Finanças',
    position: 2000,
    createdAt: now,
    updatedAt: now,
  };

  const folderLivros: TreeNode = {
    id: 'folder-livros',
    userId,
    parentId: null,
    type: 'folder',
    name: 'Livros',
    position: 3000,
    createdAt: now,
    updatedAt: now,
  };

  const folderVideos: TreeNode = {
    id: 'folder-videos',
    userId,
    parentId: null,
    type: 'folder',
    name: 'Vídeos',
    position: 4000,
    createdAt: now,
    updatedAt: now,
  };

  // Notes:
  const nodeControle: TreeNode = {
    id: 'node-controle',
    userId,
    parentId: 'folder-constitucional',
    type: 'note',
    name: 'Controle de Constitucionalidade',
    position: 1000,
    createdAt: now,
    updatedAt: now,
  };

  const nodeDireitos: TreeNode = {
    id: 'node-direitos',
    userId,
    parentId: 'folder-constitucional',
    type: 'note',
    name: 'Direitos Fundamentais',
    position: 2000,
    createdAt: now,
    updatedAt: now,
  };

  const nodeInvestimentos: TreeNode = {
    id: 'node-investimentos',
    userId,
    parentId: 'folder-financas',
    type: 'note',
    name: 'Investimentos',
    position: 1000,
    createdAt: now,
    updatedAt: now,
  };

  const nodeAposentadoria: TreeNode = {
    id: 'node-aposentadoria',
    userId,
    parentId: 'folder-financas',
    type: 'note',
    name: 'Aposentadoria',
    position: 2000,
    createdAt: now,
    updatedAt: now,
  };

  const nodeSolta: TreeNode = {
    id: 'node-solta',
    userId,
    parentId: null,
    type: 'note',
    name: 'Minha anotação solta',
    position: 5000,
    createdAt: now,
    updatedAt: now,
  };

  // Note Contents
  const noteControleMd = `# Controle de Constitucionalidade

O controle de constitucionalidade é o mecanismo de verificação da conformidade das normas infraconstitucionais com a Constituição.

Este tema se relaciona intrinsecamente com a garantia dos [[Direitos Fundamentais]].

## Modelos Principais

1. **Controle Difuso**: exercido por qualquer juiz ou tribunal no caso concreto.
2. **Controle Concentrado**: exercido perante o STF mediante ações específicas:
   - ADI (Ação Direta de Inconstitucionalidade)
   - ADC (Ação Declaratória de Constitucionalidade)
   - ADPF (Arguição de Descumprimento de Preceito Fundamental)

> "A Constituição é a lei suprema do país e nenhuma lei ordinária incompatível com ela pode subsistir."

### Checklist de Revisão

- [x] Ler jurisprudência vinculante do STF
- [x] Resolver 20 questões da OAB/concursos
- [ ] Mapear modulação de efeitos temporais

### Tabela Comparativa de Ações

| Ação | Competência | Legitimados | Efeito |
|---|---|---|---|
| ADI | STF | Art. 103 CF | Erga omnes e vinculante |
| ADC | STF | Art. 103 CF | Erga omnes e vinculante |
| ADPF | STF | Art. 103 CF | Eficácia contra todos |

#estudos #direito #constitucional`;

  const noteDireitosMd = `# Direitos Fundamentais

Os direitos e garantias fundamentais constituem o núcleo protetivo da dignidade humana no ordenamento jurídico brasileiro.

Estes direitos são resguardados pelo [[Controle de Constitucionalidade]].

## Dimensões dos Direitos

1. **Primeira Dimensão**: Liberdades clássicas negativas (civis e políticas).
2. **Segunda Dimensão**: Direitos sociais, econômicos e culturais (prestações positivas do Estado).
3. **Terceira Dimensão**: Direitos difusos e coletivos (meio ambiente, paz, desenvolvimento).

- [x] Revisar Artigo 5º da CF/88
- [ ] Resumir tratados internacionais de Direitos Humanos

#estudos #direito`;

  const noteInvestimentosMd = `# Estratégia de Investimentos

Alocação balanceada de ativos para preservação de capital e crescimento a longo prazo, visando a futura [[Aposentadoria]].

## Alocação Alvo

| Classe de Ativo | Percentual Alvo | Propósito |
|---|---|---|
| Renda Fixa Pós-Fixada | 30% | Reserva de oportunidade e liquidez |
| Renda Fixa IPCA+ | 30% | Proteção contra inflação |
| Ações Brasil | 20% | Crescimento de capital |
| Ativos Globais | 20% | Diversificação cambial |

Equação de Juros Compostos:

$$
M = C \\cdot (1 + i)^t
$$

- [x] Rebalanceamento trimestral concluído
- [ ] Aporte mensal em fundos de índice

#financas #investimentos`;

  const noteAposentadoriaMd = `# Planejamento de Aposentadoria

Metas e marcos para independência financeira sustentável. Relacionado à pasta [[Investimentos]].

> "O melhor momento para plantar uma árvore foi há 20 anos. O segundo melhor é agora."

- [x] Definir despesas estimadas pós-trabalho
- [ ] Simular taxas de retirada segura (Regra dos 4%)

#financas #planejamento`;

  const noteSoltaMd = `# Ideias e Pensamentos Livres

Espaço para capturar pensamentos instantâneos, referências e insights rápidos do dia a dia.

[YouTube](https://www.youtube.com/watch?v=dQw4w9WgXcQ)

- Leitura recomendada: "Building a Second Brain" de Tiago Forte
- Filosofia do conhecimento:
  - A Árvore organiza.
  - A Nota armazena.
  - Os Links conectam.
  - As Tags categorizam.
  - A Busca encontra.

#ideias #livros`;

  const notes: NoteRecord[] = [
    {
      id: 'note-controle',
      nodeId: nodeControle.id,
      userId,
      markdownContent: noteControleMd,
      editorContent: MarkdownService.markdownToVisual(noteControleMd),
      isFavorite: true,
      lastOpenedAt: now,
      version: 1,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'note-direitos',
      nodeId: nodeDireitos.id,
      userId,
      markdownContent: noteDireitosMd,
      editorContent: MarkdownService.markdownToVisual(noteDireitosMd),
      isFavorite: false,
      lastOpenedAt: new Date(Date.now() - 3600000).toISOString(),
      version: 1,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'note-investimentos',
      nodeId: nodeInvestimentos.id,
      userId,
      markdownContent: noteInvestimentosMd,
      editorContent: MarkdownService.markdownToVisual(noteInvestimentosMd),
      isFavorite: true,
      lastOpenedAt: new Date(Date.now() - 7200000).toISOString(),
      version: 1,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'note-aposentadoria',
      nodeId: nodeAposentadoria.id,
      userId,
      markdownContent: noteAposentadoriaMd,
      editorContent: MarkdownService.markdownToVisual(noteAposentadoriaMd),
      isFavorite: false,
      lastOpenedAt: new Date(Date.now() - 14400000).toISOString(),
      version: 1,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'note-solta',
      nodeId: nodeSolta.id,
      userId,
      markdownContent: noteSoltaMd,
      editorContent: MarkdownService.markdownToVisual(noteSoltaMd),
      isFavorite: false,
      lastOpenedAt: new Date(Date.now() - 28800000).toISOString(),
      version: 1,
      createdAt: now,
      updatedAt: now,
    },
  ];

  const tags: TagRecord[] = [
    { id: 'tag-estudos', userId, name: 'estudos', normalizedName: 'estudos', createdAt: now, count: 2 },
    { id: 'tag-direito', userId, name: 'direito', normalizedName: 'direito', createdAt: now, count: 2 },
    { id: 'tag-constitucional', userId, name: 'constitucional', normalizedName: 'constitucional', createdAt: now, count: 1 },
    { id: 'tag-financas', userId, name: 'financas', normalizedName: 'financas', createdAt: now, count: 2 },
    { id: 'tag-investimentos', userId, name: 'investimentos', normalizedName: 'investimentos', createdAt: now, count: 1 },
    { id: 'tag-livros', userId, name: 'livros', normalizedName: 'livros', createdAt: now, count: 1 },
    { id: 'tag-ideias', userId, name: 'ideias', normalizedName: 'ideias', createdAt: now, count: 1 },
  ];

  const nodes = [
    folderEstudos,
    folderDireito,
    folderConstitucional,
    folderAdministrativo,
    folderFinancas,
    folderLivros,
    folderVideos,
    nodeControle,
    nodeDireitos,
    nodeInvestimentos,
    nodeAposentadoria,
    nodeSolta,
  ];

  return { nodes, notes, tags };
}
