# Melinna

CLI pessoal que orquestra ferramentas de terceiros (`caveman-code`, `spec-kit`), skills locais em Markdown e agentes de IA — sua "máquina de engenharia".

## Instalação

```bash
npm install
git clone https://github.com/JuliusBrussee/caveman-code tools/caveman-code
git clone https://github.com/github/spec-kit tools/spec-kit
npm link
```

Depois disso o comando `melinna` fica disponível globalmente no shell atual.

> `tools/caveman-code` e `tools/spec-kit` são ignorados pelo git (ver `.gitignore`) — são clones de repositórios de terceiros, não código deste projeto. Rode os dois `git clone` acima sempre que configurar a Melinna em uma máquina nova.

### Nota sobre a compressão de contexto

O CLI completo do `caveman-code` (`cave`) é um monorepo TypeScript que precisa ser compilado e usa dependências nativas (SQLite, processamento de imagem) para funcionalidades de sessão/TUI que a Melinna não usa. Em vez de buildar o monorepo inteiro, a Melinna importa diretamente o módulo de compressão real do caveman-code — `packages/agent/src/repomap` (TypeScript puro, sem dependências nativas) — via [`tsx`](https://github.com/privatenumber/tsx), que resolve os imports do pacote sem precisar de um passo de build. Essa ponte está em [`lib/caveman.js`](lib/caveman.js) e [`lib/compress-runner.mjs`](lib/compress-runner.mjs).

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
- `start-feature` não preenche automaticamente os placeholders de princípios da constituição (`[PRINCIPLE_1_NAME]` etc.) — isso fica para revisão manual ou uma etapa futura de IA.
- Não há testes automatizados ainda; os três comandos foram validados manualmente.
- `quick-task`/`explain-project` truncam o snapshot pelo orçamento de tokens (`tokenBudget`); em repositórios muito grandes pode valer expor isso como flag no futuro.
