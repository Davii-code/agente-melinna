# Melinna

CLI pessoal que orquestra ferramentas de terceiros (`caveman-code`, `spec-kit`), skills locais em Markdown e agentes de IA — sua "máquina de engenharia".

## Instalação

Como qualquer CLI de agente (`caveman`, `claude`, `codex`), a Melinna se instala globalmente direto do git — não é preciso clonar nem publicar no npm:

```bash
npm install -g git+https://github.com/Davii-code/agente-melinna.git
melinna install   # clona caveman-code e spec-kit em ~/.melinna/tools
melinna doctor    # confere o ambiente e lista os agentes disponíveis
```

### Onde ficam os clones de terceiros

`caveman-code` e `spec-kit` são clones de repositórios de terceiros (ignorados pelo git, ver `.gitignore`), então **não** viajam dentro do pacote npm. `melinna install` os baixa para um diretório fora do pacote, resolvido nesta ordem:

1. `$MELINNA_HOME/tools` — se a variável estiver definida.
2. `<repo>/tools` — num clone de desenvolvimento, quando já populado ali.
3. `~/.melinna/tools` — o padrão numa instalação global.

Eles ficam no HOME em vez de dentro do `node_modules` global porque o npm apaga o diretório do pacote a cada upgrade (e instalações system-wide costumam ser somente-leitura).

### Desenvolvimento (a partir de um clone)

```bash
git clone https://github.com/Davii-code/agente-melinna.git && cd agente-melinna
node bin/cli.js install
node bin/cli.js init      # roda `npm link` e depois o doctor
```

`melinna init` só roda `npm link` quando detecta um clone de desenvolvimento (existe um `.git/`); numa instalação global ele apenas roda o `doctor`.

### Atualizar

```bash
melinna upgrade   # git pull --ff-only nos clones de terceiros
npm install -g git+https://github.com/Davii-code/agente-melinna.git   # atualiza a própria Melinna
```

### Nota sobre a compressão de contexto

O CLI completo do `caveman-code` (`caveman`) é um monorepo TypeScript que precisa ser compilado e usa dependências nativas (SQLite, processamento de imagem) para funcionalidades de sessão/TUI que a Melinna não usa. Em vez de buildar o monorepo inteiro, a Melinna importa diretamente o módulo de compressão real do caveman-code — `packages/agent/src/repomap` (TypeScript puro, sem dependências nativas) — via [`tsx`](https://github.com/privatenumber/tsx), que resolve os imports do pacote sem precisar de um passo de build. Essa ponte está em [`lib/caveman.js`](lib/caveman.js) e [`lib/compress-runner.mjs`](lib/compress-runner.mjs).

## Comandos

### `melinna start-feature`

Fluxo de Spec-Driven Development. Pergunta o nome e a descrição da feature, deixa você escolher skills para carregar, e gera em `.speckit/` (no diretório onde você rodou o comando):

- `constitution.md` — baseado em `.speckit-templates/constitution-template.md`, com as skills selecionadas e uma referência ao contexto comprimido anexados ao final.
- `specify.md` — baseado em `.speckit-templates/specify-template.md`, preenchido com nome/data/descrição da feature.
- `caveman-context.md` — snapshot comprimido do projeto atual.

```bash
melinna start-feature
```

### `melinna quick-task <descricao>`

Monta e imprime um prompt pronto para colar em um agente de IA, combinando: skill escolhida → contexto comprimido do diretório atual → descrição da tarefa.

```bash
melinna quick-task "Adicionar validação de e-mail no formulário de cadastro" --skill code-review.md

# sem --skill, lista as skills disponíveis interativamente
melinna quick-task "Refatorar o módulo de autenticação"
```

### `melinna explain-project`

Gera um System Prompt combinando os arquivos de `memory/` (contexto persistente da Melinna) com um snapshot comprimido de todo o repositório atual, e imprime no terminal.

```bash
melinna explain-project
```

### Executando de verdade: `caveman` e `specify`

`start-feature`, `quick-task` e `explain-project` acima só *imprimem* prompts/arquivos — não dependem de nada além do Node. `task` e `review` vão além: se um agente de IA real estiver no PATH, eles **executam a tarefa de verdade**; senão, caem de volta para apenas imprimir o prompt.

A Melinna é agnóstica de agente: ela monta o prompt e delega para qualquer uma destas CLIs, autodetectando na ordem abaixo (use `--agent <nome>` para forçar). Rode `melinna doctor` para ver quais estão instaladas.

| `--agent` | Ferramenta | Instalação |
|---|---|---|
| `caveman` | caveman-code | `npm install -g @juliusbrussee/caveman-code` |
| `claude` | Claude Code | `npm install -g @anthropic-ai/claude-code` |
| `cursor-agent` | Cursor CLI | [docs](https://cursor.com/docs/cli/overview) |
| `codex` | OpenAI Codex CLI | `npm install -g @openai/codex` |
| `agy` | Google Antigravity CLI | [docs](https://antigravity.google/product/antigravity-cli) |

As flags **não** são uniformes entre eles — por isso cada agente tem sua própria receita em [`lib/agents.js`](lib/agents.js), com dois modos: escrita (para `task`) e somente-leitura (para `review`).

| Agente | `task` (escrita) | `review` (leitura) |
|---|---|---|
| `caveman` | `-p` (autopilot, sem permissões) | `-p` |
| `claude` | `-p --permission-mode acceptEdits` | `-p --permission-mode plan` |
| `cursor-agent` | `-p --force` | `-p` (só propõe mudanças) |
| `codex` | `exec --sandbox workspace-write` | `exec --sandbox read-only` |
| `agy` | `-p` | `-p` |

Em todos os casos o prompt completo (skill + contexto + tarefa) vai por **stdin**, e só uma instrução curta vai como argumento — assim o tamanho do prompt não esbarra no limite de argumentos da linha de comando.

> **Nota sobre `agy`**: o Antigravity CLI não tem um meio-termo como o `acceptEdits` do Claude — ou ele pergunta, ou pula todas as permissões. Sem `--yolo`, uma task que precise editar arquivos pode parar pedindo confirmação.

> **`--yolo`**: `melinna task --yolo` liga a auto-aprovação total do agente (`--dangerously-skip-permissions` no Claude/Antigravity, `--dangerously-bypass-approvals-and-sandbox` no Codex). É opt-in explícito porque autoriza também execução de shell arbitrário — o padrão sem a flag é o modo mais contido que cada agente oferece.

### `melinna task <descricao>`

Task simples de ponta a ponta: monta o prompt (skill opcional + contexto comprimido + descrição) e roda o agente de IA para implementar de verdade no diretório atual. Depois, valida rodando `npm test` se o `package.json` tiver um script de teste real.

```bash
melinna task "Adicionar validação de e-mail no formulário de cadastro" --skill code-review.md
melinna task "Refatorar o módulo de autenticação" --agent codex
```

### `melinna speckit <feature-name>`

Chama a CLI real do spec-kit (`specify init --here --integration <agente>`) para gerar a estrutura completa de spec-driven development no diretório atual — em vez do template manual e parcial usado por `start-feature`. O próprio `specify init` imprime os próximos passos (os slash commands `/speckit-*` a rodar dentro do seu agente de IA); o ciclo specify → plan → tasks → implement roda dentro do agente, não da Melinna.

```bash
melinna speckit "checkout-com-pix" --integration claude
```

### `melinna review`

Revisa as mudanças pendentes (staged + unstaged, via `git diff`) do repositório atual usando a skill [`skills/custom/code-review.md`](skills/custom/code-review.md) e roda o agente de IA em modo somente-leitura para executar a revisão de verdade, sem alterar arquivos.

```bash
melinna review
melinna review --agent agy
```

### `melinna doctor`

Checa o ambiente e imprime o que está disponível: `git`, `specify`, os clones de terceiros (e onde eles foram resolvidos) e cada agente de IA suportado.

```bash
melinna doctor
```

### Ajuda

```bash
melinna --help
melinna <comando> --help
```

## Adicionando skills

Skills são arquivos `.md` livres — qualquer texto que sirva de instrução/persona para a IA. Coloque-os em:

- `skills/custom/` — skills escritas por você para este ambiente.
- `skills/external/` — skills importadas de outra fonte.

Não há um formato obrigatório rígido; os exemplos em `skills/custom/code-review.md` e `skills/custom/refactor.md` seguem o padrão: título, seção de diretrizes, seção de saída esperada. O nome do arquivo (ex.: `code-review.md`) é o identificador usado em `--skill` e nos seletores interativos.

## Memória do projeto

`memory/*.md` é lido pelo `melinna explain-project` como contexto persistente sobre você/seu ambiente de trabalho — edite `memory/project-context.md` manualmente (ou adicione novos arquivos `.md` na pasta) com decisões, convenções e histórico que não são óbvios a partir do código.

## Limitações conhecidas / próximos passos

- A compressão de contexto usa o parser regex de fallback do caveman-code (a dependência opcional `web-tree-sitter` não está instalada), então o snapshot lista até declarações locais dentro de funções, não só símbolos de topo — funcional, mas mais verboso do que o modo com tree-sitter.
- `start-feature` não preenche automaticamente os placeholders de princípios da constituição (`[PRINCIPLE_1_NAME]` etc.) — isso fica para revisão manual ou uma etapa futura de IA; para o fluxo completo e já preenchido, use `melinna speckit`.
- `task`/`review` rodam o agente em modo não interativo, sem revisão humana no meio — rode em um diretório sob controle de versão e confira o diff antes de aceitar.
- Das cinco integrações de agente, só `claude` e `agy` foram executadas de verdade nesta máquina; as receitas de `caveman`, `cursor-agent` e `codex` em [`lib/agents.js`](lib/agents.js) vieram da documentação oficial de cada CLI e ainda não foram exercitadas end-to-end. Se alguma flag mudar, é só ajustar o registro — os comandos não precisam saber.
- A validação de `melinna task` é só `npm test` (quando existe um script real) — não roda lint/typecheck nem detecta stacks não-Node.
- Não há testes automatizados para o código da própria Melinna ainda; os comandos foram validados manualmente.
- `quick-task`/`explain-project` truncam o snapshot pelo orçamento de tokens (`tokenBudget`); em repositórios muito grandes pode valer expor isso como flag no futuro.
