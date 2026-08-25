# Melinna

CLI pessoal que orquestra ferramentas de terceiros (`caveman-code`, `spec-kit`), skills locais em Markdown e agentes de IA — sua "máquina de engenharia".

## Instalação

Como qualquer CLI de agente (`caveman`, `claude`, `codex`), a Melinna se instala globalmente direto do git — não é preciso clonar nem publicar no npm:

```bash
npm install -g git+https://github.com/Davii-code/agente-melinna.git
melinna install         # clona caveman-code e spec-kit em ~/.melinna/tools
melinna skills install  # baixa as skills da stack deste diretório + arquitetura/revisão
melinna doctor          # confere o ambiente e lista os agentes disponíveis
```

### Onde fica cada coisa

Nada que o usuário acumula é gravado dentro do pacote: o npm apaga e recria o diretório do pacote a cada `npm install -g`, então qualquer skill, memória ou clone escrito lá se perderia no próximo upgrade (e instalações system-wide costumam ser somente-leitura).

| O quê | Onde | Criado por |
|---|---|---|
| Clones de `caveman-code` e `spec-kit` | `~/.melinna/tools/` | `melinna install` |
| Repositórios de skills do registry | `~/.melinna/skills/` | `melinna skills install` |
| Suas skills pessoais | `~/.melinna/custom/` | você |
| Memória e skills de um projeto | `<projeto>/.melinna/` | `melinna init-project` |

`$MELINNA_HOME` move a raiz `~/.melinna` inteira (útil em CI). Os clones de terceiros são resolvidos nesta ordem: `$MELINNA_HOME/tools` → `<repo>/tools` (num clone de desenvolvimento já populado) → `~/.melinna/tools`.

### Desenvolvimento (a partir de um clone)

```bash
git clone https://github.com/Davii-code/agente-melinna.git && cd agente-melinna
node bin/cli.js install
node bin/cli.js init      # roda `npm link` e depois o doctor
```

`melinna init` só roda `npm link` quando detecta um clone de desenvolvimento (existe um `.git/`); numa instalação global ele apenas roda o `doctor`.

Os testes não precisam de rede nem de agente instalado:

```bash
npm test
```

### Atualizar

```bash
melinna upgrade         # git pull --ff-only nos clones de terceiros
melinna skills update   # git pull nos repositórios de skills instalados
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

Monta e imprime um prompt pronto para colar em um agente de IA, combinando: skills (escolhidas automaticamente pela stack detectada) → contexto comprimido do diretório atual → descrição da tarefa.

```bash
# sem flags: detecta a stack e escolhe as skills sozinho
melinna quick-task "Refatorar o módulo de autenticação"

melinna quick-task "Validar e-mail no cadastro" --skill java-architect
melinna quick-task "Só o contexto, sem skill" --no-skill
```

### `melinna explain-project`

Gera um System Prompt combinando a memória do projeto (`.melinna/memory/*.md`) com um snapshot comprimido de todo o repositório atual, e imprime no terminal. Rode `melinna init-project` antes para criar a estrutura.

```bash
melinna explain-project
```

### `melinna init-project`

Cria `.melinna/` no repositório atual — `memory/` para a memória do projeto e `skills/` para skills específicas dele — e mostra a stack detectada. Ambos são versionáveis junto com o código.

```bash
melinna init-project
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

Task de ponta a ponta: detecta a stack, escolhe as skills, monta o prompt (skills + contexto comprimido + descrição) e roda o agente de IA para implementar de verdade no diretório atual. Depois, valida rodando `npm test` se o `package.json` tiver um script de teste real.

```bash
# a stack é detectada e as skills escolhidas sozinhas
melinna task "Adicionar validação de e-mail no formulário de cadastro"

melinna task "Refatorar o módulo de autenticação" --agent codex
melinna task "Ajuste pontual" --skill java-architect
```

### `melinna speckit <feature-name>`

Chama a CLI real do spec-kit (`specify init --here --integration <agente>`) para gerar a estrutura completa de spec-driven development no diretório atual — em vez do template manual e parcial usado por `start-feature`. O próprio `specify init` imprime os próximos passos (os slash commands `/speckit-*` a rodar dentro do seu agente de IA); o ciclo specify → plan → tasks → implement roda dentro do agente, não da Melinna.

```bash
melinna speckit "checkout-com-pix" --integration claude
```

### `melinna review`

Revisa as mudanças pendentes (staged + unstaged, via `git diff`) do repositório atual e roda o agente de IA em modo somente-leitura, sem alterar arquivos. Carrega sempre uma skill de revisão e uma de arquitetura, mais as da stack detectada — então um repositório Java é revisado com as regras de Java sem você pedir.

```bash
melinna review
melinna review --agent agy
```

### `melinna doctor`

Checa o ambiente e imprime o que está disponível: `git`, `npm`, `specify`, os clones de terceiros, as skills instaladas (avisando se as sempre-ativas faltam), a stack detectada aqui e cada agente de IA suportado.

```bash
melinna doctor
```

### Ajuda

```bash
melinna --help
melinna <comando> --help
```

## Skills

### Autodetecção: você não escolhe a skill

`task`, `quick-task` e `review` detectam a stack do diretório pelos arquivos-marca (`pom.xml`, `build.gradle`, `package.json`, `pubspec.yaml`, `angular.json`, `application.info`, fontes `.prw`/`.tlpp`) e carregam sozinhos as skills correspondentes. As regras estão em [`lib/detect.js`](lib/detect.js).

**Arquitetura e revisão entram sempre**, mesmo quando a stack já encheu as vagas — um projeto Fluig recebe as skills de Fluig *e* a validação arquitetural. Use `--skill <id>` para forçar uma específica ou `--no-skill` para desligar.

Veja o que seria escolhido aqui:

```bash
melinna skills list --detect
```

### Instalando skills

O catálogo em [`lib/registry.js`](lib/registry.js) reúne repositórios públicos de skills. `melinna skills install` sem argumentos instala as sempre-ativas (arquitetura e revisão) mais as que casam com a stack do diretório atual.

```bash
melinna skills registry          # vê o catálogo e o que já está instalado
melinna skills install           # autodetecta a stack e instala o que serve
melinna skills install fluig java # ou escolhe explicitamente
melinna skills install --all     # tudo
melinna skills update            # git pull em cada repositório instalado
```

Os repositórios são **clonados** para `~/.melinna/skills/`, não copiados arquivo a arquivo: as skills referenciam `references/` e `assets/` vizinhos por caminho relativo, e clonar mantém esses links, a autoria e a licença de cada projeto intactos.

| Nome | Cobre | Origem |
|---|---|---|
| `architecture` *(sempre)* | Revisão arquitetural, microserviços, cloud | [keez97/claude-architecture-skills](https://github.com/keez97/claude-architecture-skills) |
| `code-review` *(sempre)* | Review multi-stack | [tt-a1i/code-review-skill](https://github.com/tt-a1i/code-review-skill) |
| `fluig` | Widgets Fluig, i18n, a11y, code review | [totvs/fluig-agent-skills](https://github.com/totvs/fluig-agent-skills) |
| `advpl` | ADVPL/TLPP, Protheus | [totvs/engpro-advpl-tlpp-skills](https://github.com/totvs/engpro-advpl-tlpp-skills) |
| `spring-optimization` | Spring Boot, migração Java 17→21 | [claudioed/claude-skills](https://github.com/claudioed/claude-skills) |
| `spring-template` | Design patterns, clean code, JPA | [piomin/claude-ai-spring-boot](https://github.com/piomin/claude-ai-spring-boot) |
| `spring-marketplace` | CRUD vs DDD/CQRS por complexidade | [a-pavithraa/springboot-skills-marketplace](https://github.com/a-pavithraa/springboot-skills-marketplace) |
| `spring-mcp` | Spring Boot + MCP servers com Spring AI | [rrezartprebreza/spring-boot-skills](https://github.com/rrezartprebreza/spring-boot-skills) |
| `fullstack` | 67 skills: java-architect, angular, nestjs, react | [Jeffallan/claude-skills](https://github.com/Jeffallan/claude-skills) |
| `frontend-design` | Skill oficial da Anthropic contra "AI slop" visual | [anthropics/claude-code](https://github.com/anthropics/claude-code) |
| `cloudflare-react` | Cloudflare + React + Tailwind v4 | [jezweb/claude-skills](https://github.com/jezweb/claude-skills) |
| `flutter` | BLoC/Cubit, Firebase, Material 3, testes | [Arcturus91/claude-flutter-skill](https://github.com/Arcturus91/claude-flutter-skill) |
| `flutter-pipeline` | Flutter do Figma ao deploy | [cleydson/flutter-claude-code](https://github.com/cleydson/flutter-claude-code) |

### Escrevendo suas próprias

Uma skill é um `.md` com frontmatter YAML (`name`, `description`, opcionalmente `metadata.triggers`) — a convenção do Claude Code, `<nome>/SKILL.md`. Um `.md` solto também funciona: o nome do arquivo vira o id.

As raízes são procuradas nesta ordem, e a primeira que tiver o id ganha:

1. `<projeto>/.melinna/skills/` — skills deste repositório (criadas por `melinna init-project`).
2. `~/.melinna/custom/` — suas skills pessoais, valem em todo projeto.
3. `skills/custom/` e `skills/external/` do pacote — as que vêm junto.
4. `~/.melinna/skills/` — os repositórios instalados pelo registry.

O projeto vem primeiro para que um repositório possa sobrescrever uma skill genérica pela sua versão sem renomear nada.

`metadata.triggers` melhora a autodetecção: as palavras ali são casadas contra as tags da stack detectada.

## Memória do projeto

`melinna init-project` cria `.melinna/memory/project-context.md` no repositório atual. `melinna explain-project` lê todo `.md` dessa pasta como contexto persistente — decisões, convenções e histórico que não são óbvios a partir do código.

A memória mora **no projeto**, não no pacote da Melinna: ela descreve aquele repositório, é diferente para cada um, e assim pode ser versionada junto com o código. (Em versões anteriores ela ficava em `memory/` dentro do pacote, onde era compartilhada entre todos os projetos e se perdia a cada `npm install -g`.)

## Limitações conhecidas / próximos passos

- A compressão de contexto usa o parser regex de fallback do caveman-code (a dependência opcional `web-tree-sitter` não está instalada), então o snapshot lista até declarações locais dentro de funções, não só símbolos de topo — funcional, mas mais verboso do que o modo com tree-sitter.
- `start-feature` não preenche automaticamente os placeholders de princípios da constituição (`[PRINCIPLE_1_NAME]` etc.) — isso fica para revisão manual ou uma etapa futura de IA; para o fluxo completo e já preenchido, use `melinna speckit`.
- `task`/`review` rodam o agente em modo não interativo, sem revisão humana no meio — rode em um diretório sob controle de versão e confira o diff antes de aceitar.
- Das cinco integrações de agente, só `claude` e `agy` foram executadas de verdade nesta máquina; as receitas de `caveman`, `cursor-agent` e `codex` em [`lib/agents.js`](lib/agents.js) vieram da documentação oficial de cada CLI e ainda não foram exercitadas end-to-end. Se alguma flag mudar, é só ajustar o registro — os comandos não precisam saber.
- A validação de `melinna task` é só `npm test` (quando existe um script real) — não roda lint/typecheck, e não conhece `mvn test`, `gradle test`, `flutter test` nem os equivalentes das outras stacks que a detecção já identifica.
- A autodetecção de skills é lexical: casa as tags da stack contra id, `metadata.triggers` e descrição. Funciona bem quando a skill se nomeia pela tecnologia, e erra quando não — `melinna skills list --detect` mostra a escolha antes de gastar uma execução de agente.
- `quick-task`/`explain-project` truncam o snapshot pelo orçamento de tokens (`tokenBudget`); em repositórios muito grandes pode valer expor isso como flag no futuro.
- Os testes (`npm test`) cobrem detecção de stack, seleção de skills, o registry e a resolução de binários; os comandos que executam agentes ainda são validados só manualmente.
