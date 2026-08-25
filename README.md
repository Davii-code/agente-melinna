# Melinna

CLI pessoal de engenharia. Você descreve a tarefa; a Melinna descobre em que stack você está, carrega as skills certas, comprime o código do projeto em contexto e entrega tudo para um agente de IA executar.

```bash
cd meu-projeto-spring
melinna task "Adicionar validação de e-mail no cadastro"
```

```
Stack detectada: java, spring
Skills: java-architect, spring-boot, spring-boot-engineer, code-review
Comprimindo diretório atual com caveman-code...
Executando `claude` para implementar a tarefa...
```

Você não escolheu skill, não escolheu agente, não montou prompt.

---

## Índice

- [Começando](#começando)
- [Os quatro comandos parecidos](#os-quatro-comandos-parecidos)
- [Todos os comandos](#todos-os-comandos)
- [Como a Melinna escolhe as skills](#como-a-melinna-escolhe-as-skills)
- [Instalando skills](#instalando-skills)
- [Escrevendo suas próprias skills](#escrevendo-suas-próprias-skills)
- [Memória do projeto](#memória-do-projeto)
- [Agentes de IA](#agentes-de-ia)
- [Onde fica cada coisa](#onde-fica-cada-coisa)
- [Solução de problemas](#solução-de-problemas)
- [Como funciona por dentro](#como-funciona-por-dentro)
- [Limitações conhecidas](#limitações-conhecidas)

---

## Começando

### 1. Instale a Melinna

Como qualquer CLI de agente (`caveman`, `claude`, `codex`), ela se instala globalmente direto do git — não precisa clonar nem publicar no npm.

```bash
npm install -g git+https://github.com/Davii-code/agente-melinna.git
```

### 2. Prepare o ambiente

```bash
melinna install
```

Clona `caveman-code` (o motor de compressão de contexto) e `spec-kit` em `~/.melinna/tools`. **Roda uma vez por máquina.**

### 3. Tenha um agente de IA no PATH

A Melinna não fala com nenhuma API: ela delega para uma CLI de agente que você já usa. Instale ao menos uma:

```bash
npm install -g @anthropic-ai/claude-code   # ou codex, cursor-agent, caveman, agy
```

### 4. Baixe as skills do seu projeto

```bash
cd meu-projeto
melinna skills install
```

Detecta a stack do diretório e baixa as skills daquela tecnologia, mais as de arquitetura e revisão (que valem para qualquer linguagem). **Rode uma vez por stack** — as skills ficam em `~/.melinna/skills` e servem todos os seus projetos daquela tecnologia.

### 5. Confira

```bash
melinna doctor
```

Mostra o que está instalado e o que falta. Se ele diz `✔ Ambiente pronto.`, você terminou:

```bash
melinna task "sua tarefa aqui"
```

### Opcional: memória do projeto

```bash
melinna init-project
```

Cria `.melinna/` no repositório para você guardar contexto que não dá para deduzir do código (decisões, convenções, restrições). Versione junto com o projeto.

---

## Os quatro comandos parecidos

Quatro comandos têm nomes que se confundem. A diferença:

| Comando | O que faz | Quando rodar |
|---|---|---|
| `melinna install` | Baixa **as ferramentas** (caveman-code, spec-kit) | Uma vez por máquina |
| `melinna skills install` | Baixa **as skills** da stack para `~/.melinna/skills` | Uma vez por stack |
| `melinna init` | Linka o comando `melinna` no PATH (`npm link`) | Só em clone de desenvolvimento |
| `melinna init-project` | Cria `.melinna/` **dentro do seu projeto** | Uma vez por projeto, opcional |

Resumindo: `install` = ferramentas, `skills install` = skills, `init` = desenvolvimento da própria Melinna, `init-project` = seu repositório.

---

## Todos os comandos

**Trabalho do dia a dia**

| Comando | O que faz | Executa agente? |
|---|---|---|
| `melinna task <descrição>` | Implementa a tarefa no diretório atual e valida com os testes | Sim, com escrita |
| `melinna review` | Revisa as mudanças pendentes (`git diff`) | Sim, somente leitura |
| `melinna quick-task <descrição>` | Só **imprime** o prompt, para você colar onde quiser | Não |
| `melinna explain-project` | Imprime um System Prompt com memória + snapshot do repositório | Não |

**Spec-Driven Development**

| Comando | O que faz |
|---|---|
| `melinna speckit <feature>` | Chama a CLI real do spec-kit e gera a estrutura completa |
| `melinna start-feature` | Alternativa mais simples: gera `.speckit/` a partir dos templates locais |

**Skills**

| Comando | O que faz |
|---|---|
| `melinna skills install [nomes...]` | Baixa repositórios de skills (sem argumentos, autodetecta) |
| `melinna skills list [--detect]` | Lista as skills disponíveis; `--detect` mostra quais seriam escolhidas aqui |
| `melinna skills registry` | Mostra o catálogo e o que já está instalado |
| `melinna skills update` | `git pull` em cada repositório de skills |

**Ambiente**

| Comando | O que faz |
|---|---|
| `melinna doctor` | Diagnóstico completo do ambiente |
| `melinna install` | Baixa caveman-code e spec-kit |
| `melinna upgrade` | Atualiza os clones de terceiros e as dependências |
| `melinna init-project` | Cria `.melinna/` no repositório atual |
| `melinna init` | `npm link` num clone de desenvolvimento |

Ajuda detalhada de qualquer comando:

```bash
melinna <comando> --help
```

---

## Como a Melinna escolhe as skills

Esta é a ideia central: **você não escolhe a skill**.

### O que é detectado

`task`, `quick-task`, `review` e `start-feature` olham os arquivos-marca do diretório:

| Stack detectada | Pelo quê |
|---|---|
| `java` | `pom.xml`, `build.gradle`, `build.gradle.kts` |
| `spring` | menção a Spring dentro do `pom.xml`/`build.gradle` |
| `node` | `package.json` |
| `react`, `nextjs`, `vue`, `nestjs` | dependências no `package.json` |
| `angular` | `angular.json` ou `@angular/core` |
| `dart`, `flutter` | `pubspec.yaml` (e se ele declara `flutter:`) |
| `fluig` | `application.info`, `fluig.json`, `.fluig`, `wcm` |
| `advpl`, `protheus` | fontes `.prw`, `.tlpp`, `.ch`, `.prx` |
| `python`, `go`, `rust` | `pyproject.toml`/`requirements.txt`, `go.mod`, `Cargo.toml` |

Só a raiz do projeto é examinada (e um nível abaixo, no caso do Fluig): marcadores de build ficam no topo, e varrer a árvore inteira faria um monorepo casar com todas as stacks de uma vez. As regras estão em [`lib/detect.js`](lib/detect.js).

### Como as skills são casadas

A stack detectada é comparada com o `name`, o `metadata.triggers` e a descrição de cada skill disponível. Skills amarradas a **outra** stack são descartadas — `python-architecture-review` não entra num projeto Java, por mais genérico que o nome pareça.

**Arquitetura e revisão têm vaga reservada.** Elas entram sempre, mesmo quando as skills da stack já encheriam o limite. Um projeto Fluig recebe as skills de Fluig *e* a validação arquitetural:

| Projeto | Skills carregadas |
|---|---|
| Java/Spring | `java-architect`, `spring-boot`, `spring-boot-engineer`, `code-review` |
| Fluig | `fluig-best-practices`, `fluig-code-review`, `fluig-dark-mode`, `architecture-designer` |
| Flutter | `flutter-expert`, `flutter`, `architecture-designer`, `code-review` |
| ADVPL/Protheus | `advpl-tlpp-sdd`, `advpl-tlpp-compile`, `architecture-designer`, `code-review` |

### Vendo e sobrescrevendo a escolha

Antes de gastar uma execução de agente, veja o que seria carregado:

```bash
melinna skills list --detect
```

Para forçar ou desligar:

```bash
melinna task "..." --skill java-architect   # só essa skill
melinna task "..." --no-skill               # nenhuma skill
```

---

## Instalando skills

As skills não vêm embutidas: você baixa os repositórios que interessam. O catálogo está em [`lib/registry.js`](lib/registry.js).

```bash
melinna skills registry   # o que existe e o que já está instalado
melinna skills install    # autodetecta a stack e instala o que serve
melinna skills update     # atualiza tudo que está instalado
```

Para escolher explicitamente, use os nomes da coluna **Nome** abaixo:

```bash
melinna skills install fluig advpl        # o ecossistema TOTVS
melinna skills install fullstack flutter  # multi-stack + Flutter
melinna skills install --all              # tudo
```

### Catálogo

| Nome | Cobre | Origem |
|---|---|---|
| `architecture` *(sempre)* | Revisão arquitetural, microserviços, cloud | [keez97/claude-architecture-skills](https://github.com/keez97/claude-architecture-skills) |
| `code-review` *(sempre)* | Review multi-stack | [tt-a1i/code-review-skill](https://github.com/tt-a1i/code-review-skill) |
| `fluig` | Widgets Fluig, i18n, acessibilidade, code review | [totvs/fluig-agent-skills](https://github.com/totvs/fluig-agent-skills) |
| `advpl` | ADVPL/TLPP, ecossistema Protheus | [totvs/engpro-advpl-tlpp-skills](https://github.com/totvs/engpro-advpl-tlpp-skills) |
| `spring-optimization` | Spring Boot, migração Java 17→21 | [claudioed/claude-skills](https://github.com/claudioed/claude-skills) |
| `spring-template` | Design patterns, clean code, JPA | [piomin/claude-ai-spring-boot](https://github.com/piomin/claude-ai-spring-boot) |
| `spring-marketplace` | CRUD vs DDD/CQRS conforme a complexidade | [a-pavithraa/springboot-skills-marketplace](https://github.com/a-pavithraa/springboot-skills-marketplace) |
| `spring-mcp` | Spring Boot + MCP servers com Spring AI | [rrezartprebreza/spring-boot-skills](https://github.com/rrezartprebreza/spring-boot-skills) |
| `fullstack` | 67 skills: `java-architect`, `angular-architect`, NestJS, React | [Jeffallan/claude-skills](https://github.com/Jeffallan/claude-skills) |
| `frontend-design` | Skill oficial da Anthropic contra "AI slop" visual | [anthropics/claude-code](https://github.com/anthropics/claude-code) |
| `cloudflare-react` | Cloudflare + React + Tailwind v4 | [jezweb/claude-skills](https://github.com/jezweb/claude-skills) |
| `flutter` | BLoC/Cubit, Firebase, Material 3, testes | [Arcturus91/claude-flutter-skill](https://github.com/Arcturus91/claude-flutter-skill) |
| `flutter-pipeline` | Flutter do Figma ao deploy | [cleydson/flutter-claude-code](https://github.com/cleydson/flutter-claude-code) |

As marcadas *(sempre)* entram em qualquer projeto, independente da stack.

Os repositórios são **clonados**, não copiados arquivo a arquivo: as skills referenciam `references/` e `assets/` vizinhos por caminho relativo, e clonar mantém esses links, a autoria e a licença de cada projeto intactos.

---

## Escrevendo suas próprias skills

Uma skill é um arquivo Markdown com frontmatter YAML:

```markdown
---
name: minha-skill
description: Quando usar esta skill e o que ela faz.
metadata:
  triggers: Java, Spring Boot, JPA
---

# Minha Skill

Instruções para a IA...
```

Dois formatos são aceitos:

- `<nome>/SKILL.md` — a convenção do Claude Code. O nome do diretório vira o id.
- `minha-skill.md` — um arquivo solto. O nome do arquivo vira o id.

O frontmatter é opcional; sem ele, o id vem do nome do arquivo. Mas preencher `metadata.triggers` **melhora a autodetecção**: as palavras ali são casadas contra a stack detectada.

### Onde colocar

As raízes são procuradas nesta ordem, e a primeira que tiver o id ganha:

| Ordem | Diretório | Escopo |
|---|---|---|
| 1 | `<projeto>/.melinna/skills/` | Só este repositório |
| 2 | `~/.melinna/custom/` | Suas skills pessoais, em todo projeto |
| 3 | `skills/custom/` do pacote | As que vêm junto com a Melinna |
| 4 | `~/.melinna/skills/` | Repositórios instalados pelo registry |

O projeto vem primeiro para que um repositório possa sobrescrever uma skill genérica pela sua própria versão sem renomear nada.

---

## Memória do projeto

Contexto que não dá para deduzir lendo o código — decisões arquiteturais, convenções, restrições de negócio.

```bash
melinna init-project   # cria .melinna/memory/project-context.md
```

Edite esse arquivo (ou adicione outros `.md` na mesma pasta). `melinna explain-project` lê todos eles.

A memória mora **no projeto**, não no pacote da Melinna: ela descreve aquele repositório específico, é diferente para cada um, e assim pode ser versionada junto com o código.

> Em versões anteriores a memória ficava em `memory/` dentro do pacote, onde era a mesma para todos os projetos e se perdia a cada `npm install -g`. Se você tinha conteúdo lá, mova para `.melinna/memory/` do projeto correspondente.

---

## Agentes de IA

A Melinna não fala com nenhuma API. Ela monta o prompt e delega para uma CLI de agente que já esteja no seu PATH, autodetectando nesta ordem:

| `--agent` | Ferramenta | Instalação |
|---|---|---|
| `caveman` | caveman-code | `npm install -g @juliusbrussee/caveman-code` |
| `claude` | Claude Code | `npm install -g @anthropic-ai/claude-code` |
| `cursor-agent` | Cursor CLI | [docs](https://cursor.com/docs/cli/overview) |
| `codex` | OpenAI Codex CLI | `npm install -g @openai/codex` |
| `agy` | Google Antigravity CLI | [docs](https://antigravity.google/product/antigravity-cli) |

Use `--agent <nome>` para forçar um específico. `melinna doctor` mostra quais estão instalados.

Sem nenhum agente no PATH, `task` e `review` não falham: eles imprimem o prompt para você colar manualmente.

### Modos de execução

As flags **não** são uniformes entre as CLIs — cada agente tem sua receita em [`lib/agents.js`](lib/agents.js), com dois modos:

| Agente | `task` (pode escrever) | `review` (só lê) |
|---|---|---|
| `caveman` | `-p` (autopilot, sem permissões) | `-p` |
| `claude` | `-p --permission-mode acceptEdits` | `-p --permission-mode plan` |
| `cursor-agent` | `-p --force` | `-p` (só propõe mudanças) |
| `codex` | `exec --sandbox workspace-write` | `exec --sandbox read-only` |
| `agy` | `-p` | `-p` |

O prompt completo vai por **stdin**, e só uma instrução curta vai como argumento — assim o tamanho do prompt não esbarra no limite de argumentos da linha de comando.

> **`--yolo`**: `melinna task --yolo` liga a auto-aprovação total do agente (`--dangerously-skip-permissions` no Claude/Antigravity, `--dangerously-bypass-approvals-and-sandbox` no Codex). É opt-in explícito porque autoriza também **execução de shell arbitrário**. Sem a flag, cada agente roda no modo mais contido que oferece.

> **Nota sobre `agy`**: o Antigravity CLI não tem um meio-termo como o `acceptEdits` do Claude — ou pergunta, ou pula todas as permissões. Sem `--yolo`, uma task que precise editar pode parar pedindo confirmação.

> `task` e `review` rodam o agente **sem revisão humana no meio**. Use em diretório sob controle de versão e confira o diff antes de aceitar.

---

## Onde fica cada coisa

Nada que você acumula é gravado dentro do pacote: o npm apaga e recria o diretório do pacote a cada `npm install -g`, então skills, memória ou clones escritos lá se perderiam no próximo upgrade (e instalações system-wide costumam ser somente-leitura).

| O quê | Onde | Criado por |
|---|---|---|
| Clones de `caveman-code` e `spec-kit` | `~/.melinna/tools/` | `melinna install` |
| Repositórios de skills do registry | `~/.melinna/skills/` | `melinna skills install` |
| Suas skills pessoais | `~/.melinna/custom/` | você |
| Memória e skills de um projeto | `<projeto>/.melinna/` | `melinna init-project` |

`$MELINNA_HOME` move a raiz `~/.melinna` inteira (útil em CI). Os clones de terceiros são resolvidos nesta ordem: `$MELINNA_HOME/tools` → `<repo>/tools` (num clone de desenvolvimento já populado) → `~/.melinna/tools`.

---

## Solução de problemas

**Comece sempre por `melinna doctor`** — ele diagnostica a maioria dos casos abaixo.

| Sintoma | Causa e correção |
|---|---|
| `Nenhum agente de IA encontrado no PATH` | Nenhuma CLI de agente instalada. Instale uma da tabela de [agentes](#agentes-de-ia). A Melinna imprime o prompt como fallback. |
| `Nenhuma skill casou com este projeto` | Ou a stack não foi reconhecida, ou as skills dela não estão instaladas. Rode `melinna skills list --detect` para ver qual dos dois. |
| `skills sempre-ativas faltando` no doctor | Rode `melinna skills install architecture code-review`. |
| `Módulo de compressão do caveman-code não encontrado` | Falta rodar `melinna install`. |
| `Binário 'specify' não encontrado` | O `melinna speckit` precisa da CLI do spec-kit: `uv tool install specify-cli`. |
| Skill errada sendo escolhida | `melinna skills list --detect` mostra a escolha. Force com `--skill <id>` e considere melhorar o `metadata.triggers` da sua skill. |
| Stack não detectada | Confira se o arquivo-marca está na **raiz** do diretório onde você rodou o comando (veja a [tabela de detecção](#o-que-é-detectado)). |

---

## Como funciona por dentro

### Compressão de contexto

O CLI completo do `caveman-code` é um monorepo TypeScript que precisa ser compilado e usa dependências nativas (SQLite, processamento de imagem) para funcionalidades de sessão/TUI que a Melinna não usa. Em vez de buildar o monorepo inteiro, a Melinna importa direto o módulo de compressão — `packages/agent/src/repomap`, TypeScript puro sem dependências nativas — via [`tsx`](https://github.com/privatenumber/tsx), que resolve os imports sem precisar de build. A ponte está em [`lib/caveman.js`](lib/caveman.js) e [`lib/compress-runner.mjs`](lib/compress-runner.mjs).

### Desenvolvimento a partir de um clone

```bash
git clone https://github.com/Davii-code/agente-melinna.git && cd agente-melinna
node bin/cli.js install
node bin/cli.js init      # roda `npm link` e depois o doctor
npm test                  # não precisa de rede nem de agente instalado
```

`melinna init` só roda `npm link` quando detecta um clone de desenvolvimento (existe um `.git/`); numa instalação global ele apenas roda o `doctor`.

### Atualizando

```bash
melinna upgrade         # clones de terceiros + dependências
melinna skills update   # repositórios de skills
npm install -g git+https://github.com/Davii-code/agente-melinna.git   # a própria Melinna
```

---

## Limitações conhecidas

- **A validação de `melinna task` é só `npm test`** (quando existe um script real). Não roda lint/typecheck, e não conhece `mvn test`, `gradle test`, `flutter test` nem os equivalentes das outras stacks que a detecção já identifica.
- **A autodetecção de skills é lexical**: casa as tags da stack contra id, `metadata.triggers` e descrição. Funciona bem quando a skill se nomeia pela tecnologia, e erra quando não — `melinna skills list --detect` mostra a escolha antes de gastar uma execução de agente.
- **A compressão usa o parser regex de fallback** do caveman-code (a dependência opcional `web-tree-sitter` não está instalada), então o snapshot lista até declarações locais dentro de funções, não só símbolos de topo. Funcional, mas mais verboso que o modo com tree-sitter.
- **`start-feature` não preenche os placeholders** de princípios da constituição (`[PRINCIPLE_1_NAME]` etc.) — fica para revisão manual. Para o fluxo completo e já preenchido, use `melinna speckit`.
- **Das cinco integrações de agente, só `claude` e `agy` foram executadas de verdade nesta máquina.** As receitas de `caveman`, `cursor-agent` e `codex` em [`lib/agents.js`](lib/agents.js) vieram da documentação oficial de cada CLI e ainda não foram exercitadas end-to-end. Se alguma flag mudar, é só ajustar o registro — os comandos não precisam saber.
- **Os testes cobrem detecção de stack, seleção de skills, o registry e a resolução de binários.** Os comandos que executam agentes ainda são validados só manualmente.
- **`quick-task`/`explain-project` truncam o snapshot** pelo orçamento de tokens (`tokenBudget`); em repositórios muito grandes pode valer expor isso como flag.
