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

**Ou, sem sair do seu agente.** Configurada como servidor MCP, a Melinna vira ferramenta dentro do Claude Code, Cursor, Codex e Antigravity — você conversa normalmente e o agente carrega as skills certas sozinho:

```
você:    implementa validação de e-mail no cadastro
agente:  [chama melinna_task]
         → stack: java, spring (backend/)
         → skills: java-architect, spring-boot, code-review
         (implementa já com as convenções da stack)
```

Também para entender antes de mexer:

```bash
melinna ask "como funciona a autenticação nesse projeto?"
```

Os dois caminhos convivem. Veja [Usando dentro do seu agente](#usando-dentro-do-seu-agente).

---

## Índice

- [Começando](#começando)
- [Modo agente: `melinna run`](#modo-agente-melinna-run)
- [Usando dentro do seu agente](#usando-dentro-do-seu-agente)
- [Os quatro comandos parecidos](#os-quatro-comandos-parecidos)
- [Todos os comandos](#todos-os-comandos)
- [Como a Melinna escolhe as skills](#como-a-melinna-escolhe-as-skills)
  - [Monorepos](#monorepos-rode-na-raiz-uma-vez-só)
- [Instalando skills](#instalando-skills)
- [Escrevendo suas próprias skills](#escrevendo-suas-próprias-skills)
- [Vault: segundo cérebro por projeto](#vault-segundo-cérebro-por-projeto)
- [Diário de bordo](#diário-de-bordo)
- [Economia de token](#economia-de-token)
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

Num monorepo, rode na raiz: ele detecta os módulos e baixa as skills de todas as stacks de uma vez. Veja [Monorepos](#monorepos-rode-na-raiz-uma-vez-só).

### 5. Confira

```bash
melinna doctor
```

Mostra o que está instalado e o que falta. Se ele diz `✔ Ambiente pronto.`, você terminou:

```bash
melinna task "sua tarefa aqui"
```

### 6. Ligue no seu agente

Para usar a Melinna de dentro do Claude Code, Cursor ou Codex em vez do terminal:

```bash
claude mcp add --scope user melinna -- melinna mcp   # Claude Code
melinna mcp --setup                                  # os demais agentes
```

Reinicie o agente. Depois é só conversar: peça *"implementa X"* e ele carrega as skills da stack sozinho. Detalhes em [Usando dentro do seu agente](#usando-dentro-do-seu-agente).

### Opcional: memória do projeto

```bash
melinna init-project
```

Cria `.melinna/` no repositório para você guardar contexto que não dá para deduzir do código (decisões, convenções, restrições). Versione junto com o projeto.

---

## Modo agente: `melinna run`

`melinna task` dispara **uma vez** e espera. `melinna run` **conduz**: encadeia etapas, carrega em cada uma só as skills daquela etapa, e para quando um portão reprova.

```bash
melinna run "adicionar desconto por cupom no carrinho"
```

```
Execução run-20260903-150215
Stack: node, react, frontend
Modo: assistido | etapas: entender → especificar → planejar → tarefas → implementar → revisar → verificar
Teto: US$ 20.00

▶ Entender...
✔ Entender (5 turnos, US$ 0.2982, acumulado US$ 0.2982)
```

### As etapas

Dois eixos que não competem: o **spec-kit** entrega artefatos versionáveis, o **superpowers** entrega método.

| Etapa | Artefato (spec-kit) | Método (superpowers) | |
|---|---|---|---|
| `entender` | — | `brainstorming` | leitura |
| `especificar` | `/speckit.specify` | — | escrita |
| `planejar` | `/speckit.plan` | `writing-plans` | escrita |
| `tarefas` | `/speckit.tasks` | — | escrita |
| `implementar` | `/speckit.implement` | `test-driven-development`, `systematic-debugging` | escrita |
| `revisar` | `/speckit.analyze` | `requesting-code-review` | **portão** |
| `verificar` | — | `verification-before-completion` | **portão** |

**Portão que reprova interrompe** — não é aviso. É o que impede o agente de afirmar que terminou sem ter testado.

```bash
melinna run-stages   # detalha cada etapa
```

O método vem do [superpowers](https://github.com/obra/superpowers), já no catálogo:

```bash
melinna skills install superpowers
```

### Três modos

| Modo | Quem decide avançar |
|---|---|
| `assistido` *(padrão)* | você, a cada etapa |
| `supervisionado` | a Melinna, parando nos portões |
| `autonomo` | vai até o fim, ou até bater um limite |

```bash
melinna run "..." --mode supervisionado
melinna run "..." --auto             # sozinho, sem perguntar nada
melinna run "..." --dry-run          # mostra o plano, não executa
melinna run "..." --only implementar # uma etapa só
melinna run "..." --from revisar     # retoma do meio
```

### `--auto`: decide em vez de perguntar

O problema do autônomo não é a confirmação inicial — é que o agente **pergunta e espera**. Sem ninguém do outro lado, cada pergunta vira uma etapa parada que gastou token para devolver *"qual das duas opções você prefere?"*.

`--auto` trata as três causas de uma vez:

1. **Instrui a decidir** — afirma que não há usuário, manda escolher a opção mais consistente com o código existente, e **registrar** cada escolha com o porquê.
2. **Dá as ferramentas da stack** — sem `mvn` no allowlist, um projeto Java falha na verificação *por permissão*, e o sintoma engana (parece teste quebrado).
3. **Dispensa a confirmação** — liga o autônomo e segue.

Na prática:

```bash
melinna run "adicionar frete no carrinho" --auto
```

```
▶ Implementar...
    ⓘ decidiu: `total(itens, frete = 0)` em vez de novo módulo `frete.js` —
      carrinho tem um arquivo só; módulo separado seria estrutura sem uso.
    ⓘ decidiu: testes em `test/`, `node --test` acha por padrão.
      Não havia convenção no repo.
✔ Implementar (14 turnos, US$ 0.6228)

Decisões tomadas sozinho (3)
  · ...
```

As decisões vão para o terminal, o estado e o registro — é o que você revisa depois, mais útil que o diff, porque explicam *por que* o diff ficou daquele jeito.

**Ele ainda para quando deve.** Decidir sozinho não é chutar em coisa irreversível. Diante de apagar dados, mudar contrato de API pública ou requisito de negócio ausente, o agente responde `BLOQUEADO:` com o motivo:

```
⚠ Parou em "Implementar": apagar a tabela de pedidos é irreversível e não foi pedido.
  O agente não chutou numa ambiguidade irreversível — isso é o comportamento certo.
```

Decidir *como* implementar é dele. Decidir *o que o produto faz*, não.

### Envelope do modo autônomo

Autônomo escreve **sem ninguém olhando**. Os limites não dependem de o agente cooperar:

| Proteção | Como |
|---|---|
| Isolamento | worktree próprio — nunca toca sua árvore de trabalho |
| Gasto | teto em dólar, medido no `total_cost_usd` que a CLI reporta |
| Ferramentas | `git push`, `reset --hard`, `rm -rf`, `npm publish` bloqueados pela própria CLI |
| Parada | `melinna run-stop <id>` — funciona de outro terminal |
| Auditoria | estado e registro em `~/.melinna/runs/` |

```bash
melinna run-list          # execuções e custo
melinna run-show <id>     # detalhe por etapa
melinna run-stop <id>     # para na próxima fronteira de etapa
```

O padrão no autônomo é apertado (US$ 5, 30 turnos por etapa, 15 min) — mais fácil afrouxar depois de ver o comportamento do que explicar um gasto inesperado.

### Dentro do Claude: `/melinna-agente`

O mesmo pipeline, sem sair da conversa:

```
/melinna-agente adicionar validação de e-mail no cadastro
```

O Claude carrega as etapas, puxa a skill do método de cada uma no momento de usar, respeita os portões e grava o resultado no vault ao final.

**Ele não roda `melinna run`.** Isso dispararia um segundo agente por baixo — recursão sem ganho, ao dobro do custo. O agente da conversa já tem o contexto; o slash o instrui a seguir o pipeline ele mesmo.

| Onde | O que acontece |
|---|---|
| Terminal (`melinna run`) | a Melinna conduz e chama o agente por subprocesso |
| Claude (`/melinna-agente`) | o Claude conduz a si mesmo, seguindo as etapas |

Se você pedir autonomia na conversa — *"faz sozinho, sem me perguntar"* — o comando instrui a decidir em vez de perguntar, e a registrar cada escolha.

### O que fica no vault

Ao terminar, a execução grava sozinha (quando o vault está configurado):

```
📓 vault: ~/Obsidian/projetos/rv-code.md
   diário: ~/Obsidian/diario/2026-09-03.md
```

```markdown
## Decisões
- parâmetro em vez de módulo novo — o arquivo tem uma função só
- testes em test/, não havia convenção no repo

## Histórico
- [[2026-09-03]] — concluído a execução "adicionar frete no carrinho"
  (implementar → verificar), US$ 0.6228
```

As decisões que o agente tomou **sozinho** entram como decisões do projeto — são do mesmo tipo: escolhas com um porquê que o código não explica. Acumulam entre execuções, sem duplicar.

Diferente do hook de fim de sessão, aqui não há interrupção: a gravação é o desfecho de um comando que você disparou. `--no-vault` desliga.

### Por que subprocesso, e não SDK

A Melinna dirige o agente por `claude -p --output-format json`, não pelo Agent SDK. A documentação oficial é explícita: o SDK **exige chave de API própria** e não pode usar o login do Claude Code — cobrança separada, por token.

A CLI expõe o mesmo laço pela assinatura que você já tem. Sem credencial nova, sem dependência nova, sem chave em repositório público. E o JSON traz o que o orquestrador precisa:

```json
{"session_id": "...", "total_cost_usd": 0.2982, "num_turns": 5, "stop_reason": "end_turn"}
```

`session_id` encadeia as etapas sem reenviar contexto — é o que torna o pipeline viável em custo.

Vale para qualquer CLI que a Melinna suporta. Com `--agent codex` o pipeline roda, só sem retomada nem envelope fino (essas flags são do Claude Code).

---

## Usando dentro do seu agente

Ninguém abre um terminal para rodar `melinna task` quando já está dentro do Claude ou do Cursor. Por isso há duas portas de entrada, e elas compartilham o mesmo acervo de skills.

### Opção A — servidor MCP (recomendado)

A Melinna expõe **todos os seus comandos como ferramentas MCP**. O agente as chama sozinho durante a conversa, e a autodetecção roda na hora.

```bash
melinna mcp --setup   # imprime o trecho de configuração de cada agente
```

Para o Claude Code é um comando só:

```bash
claude mcp add --scope user melinna -- melinna mcp
```

> **Não esqueça o `--scope user`.** Sem ele o Claude Code registra em escopo *local*: a Melinna só aparece na pasta onde você rodou o comando, e some quando você abre qualquer outro projeto — que é justamente onde você vai querer usá-la.

Confira com `claude mcp list` — deve aparecer `melinna: melinna mcp - ✔ Connected`. **Reinicie o agente depois de configurar**: os servidores MCP são lidos na inicialização.

Para Cursor (`.cursor/mcp.json`), Codex (`~/.codex/config.toml`) e os demais, `melinna mcp --setup` imprime o formato certo.

**Ferramentas expostas** — os mesmos comandos do CLI:

| Ferramenta MCP | Equivale a |
|---|---|
| `melinna_task` | `melinna task` |
| `melinna_stages` | `melinna run-stages` |
| `melinna_runs` | `melinna run-list` |
| `melinna_ask` | `melinna ask` |
| `melinna_review` | `melinna review` |
| `melinna_detect_stack` | a detecção usada por todos os comandos |
| `melinna_explain_project` | `melinna explain-project` |
| `melinna_skills_list` | `melinna skills list --detect` |
| `melinna_get_skill` | lê uma skill inteira pelo id |
| `melinna_skills_install` | `melinna skills install` |
| `melinna_skills_registry` | `melinna skills registry` |
| `melinna_skills_update` | `melinna skills update` |
| `melinna_init_project` | `melinna init-project` |
| `melinna_speckit` | `melinna speckit` |
| `melinna_vault_save` | `melinna vault save` |
| `melinna_vault_read` | `melinna vault show` |
| `melinna_journal_add` | `melinna journal add` |
| `melinna_config` | `melinna config` |
| `melinna_doctor` | `melinna doctor` |

> **Diferença deliberada:** dentro de um agente, `melinna_task` e `melinna_review` **preparam** o material (stack, skills, contexto comprimido, diff) e devolvem ao agente que já está rodando — em vez de disparar um segundo agente por baixo. O agente já é o executor; subprocessar outro seria recursão sem ganho e o dobro do custo. No terminal, `melinna task` continua executando de ponta a ponta.

#### Como usar depois de conectar

**Você não chama as ferramentas pelo nome.** Trabalhe normalmente — o agente as chama sozinho quando a tarefa pede.

Primeira vez em um projeto de uma stack que você ainda não baixou:

```
instala as skills da melinna pra esse projeto
```

Depois disso, é só conversar:

| Você pede | O agente chama |
|---|---|
| "implementa validação de e-mail no cadastro" | `melinna_task` |
| "como funciona a autenticação aqui?" | `melinna_ask` |
| "me explica esse projeto" | `melinna_ask` |
| "revisa minhas mudanças pendentes" | `melinna_review` |
| "que stack é esse projeto?" | `melinna_detect_stack` |
| "me dá o contexto geral do projeto" | `melinna_explain_project` |
| "que skills você usaria aqui?" | `melinna_skills_list` |
| "o que você já sabe sobre esse projeto?" | `melinna_vault_read` |
| "salva o contexto no vault" | `melinna_vault_save` |
| "anota no diário que terminei o checkout" | `melinna_journal_add` |
| "muda a economia pra lean" | `melinna_config` |

Se ele não chamar sozinho, force pelo nome:

```
chama melinna_detect_stack
usa melinna_review
```

**Teste rápido** — num projeto Fluig, Spring ou Flutter de verdade:

```
que stack é esse projeto e quais skills você usaria?
```

Respondeu com a stack e a lista de skills? Está funcionando ponta a ponta.

Se disser que nenhuma skill casou, as daquela stack ainda não foram baixadas — peça `instala as skills da melinna` e repita.

### Opção B — `melinna sync` (sem MCP)

Escreve as skills no formato nativo de cada agente. Serve para quem não usa MCP, ou para ter as skills disponíveis no menu do próprio agente.

```bash
cd meu-projeto
melinna sync
```

```
Stack detectada: java, spring
Sincronizando 12 skill(s): java-architect, spring-boot, code-review, ...

✔ Claude Code   (.claude/skills/)
✔ Cursor        (.cursor/rules/)
✔ AGENTS.md     (bloco criado)
```

| Alvo | O que escreve |
|---|---|
| `claude` | `.claude/skills/<id>/SKILL.md` (ou `~/.claude/skills/` com `--global`) |
| `cursor` | `.cursor/rules/<id>.mdc` |
| `agents` | Bloco gerenciado dentro de `AGENTS.md` — lido por Codex, Antigravity e Cursor |
| `claude-md` | Bloco em `CLAUDE.md` com `@AGENTS.md` |

> **Por que o `claude-md`:** `AGENTS.md` virou padrão cross-tool e é lido por dezenas de agentes, mas o Claude Code carrega `CLAUDE.md`. Escrever só no `AGENTS.md` deixava justamente ele de fora. A ponte é um import de uma linha, então as instruções não ficam duplicadas em dois arquivos.

```bash
melinna sync --target claude cursor   # só alguns alvos
melinna sync --all                    # todas as skills, não só as da stack
melinna sync --global                 # Claude Code: no HOME em vez do projeto
melinna sync --clean                  # apaga o destino antes de escrever
```

Por padrão sincroniza até 12 skills — as que casam com a stack. Despejar as 200+ do registry deixaria o menu do agente inutilizável.

As skills são **copiadas**, não linkadas: symlink no Windows exige modo desenvolvedor ou privilégio de administrador, e falhar na metade seria pior. Rode `melinna sync` de novo depois de `melinna skills update` ou ao trocar de stack.

O bloco em `AGENTS.md` fica entre marcadores `<!-- BEGIN MELINNA -->` e `<!-- END MELINNA -->`; o resto do arquivo é preservado.

### MCP ou sync?

| | MCP | sync |
|---|---|---|
| Autodetecção em tempo real | Sim | Não (congelada na hora do sync) |
| Precisa configurar por agente | Sim, uma vez | Não |
| Funciona sem suporte a MCP | Não | Sim |
| Contexto comprimido sob demanda | Sim | Não |
| Precisa re-rodar ao mudar de stack | Não | Sim |

Dá para usar os dois ao mesmo tempo — é o que eu recomendo: MCP para o cérebro dinâmico, sync para as skills ficarem visíveis no menu do agente.

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

Cada comando tem **duas formas**: no terminal, e de dentro do agente (Claude Code, Cursor, Codex) via MCP. As duas usam o mesmo motor — mesma detecção de stack, mesmas skills, mesma configuração.

No agente você **não digita o nome da ferramenta**: pede em português e ele escolhe. A coluna "no agente" mostra o que dizer e qual ferramenta é acionada.

### Trabalho do dia a dia

#### `melinna task` — implementar

Detecta a stack, carrega as skills, monta o contexto e implementa no diretório atual. Valida com `npm test` se houver um script real.

```bash
melinna task "Adicionar validação de e-mail no cadastro"
melinna task "Refatorar o módulo de autenticação" --agent codex
melinna task "Ajuste pontual" --skill java-architect --economy lean
melinna task "Migrar config" --yolo    # auto-aprova tudo, inclusive shell
```

No agente:

```
implementa validação de e-mail no cadastro
```
→ chama `melinna_task`. Dentro do agente ele **prepara** (skills + contexto) e devolve para o agente que já está rodando implementar — não dispara um segundo agente.

#### `melinna ask` — entender

Analisa o projeto e explica, em modo somente-leitura. Para entender antes de mexer.

```bash
melinna ask "como funciona a autenticação nesse projeto?"
melinna ask "me explica a arquitetura" --deep    # dobra o mapa do repositório
melinna ask "onde fica o tratamento de erro?" --economy lean
```

A resposta vem estruturada: resposta direta → como funciona (com `arquivo:linha`) → pontos de atenção.

No agente:

```
como funciona a autenticação nesse projeto?
me explica esse projeto
por que essa classe existe?
```
→ chama `melinna_ask`.

#### `melinna review` — revisar

Revisa `git diff` (staged + unstaged) com as skills de revisão e arquitetura, mais as da stack. Somente leitura.

```bash
melinna review
melinna review --agent agy --economy lean
```

No agente:

```
revisa minhas mudanças pendentes
```
→ chama `melinna_review`.

#### `melinna quick-task` — só o prompt

Igual ao `task`, mas **imprime** o prompt em vez de executar. Para colar em outro lugar ou inspecionar o que seria enviado.

```bash
melinna quick-task "Refatorar o módulo de autenticação"
melinna quick-task "Ver o contexto puro" --no-skill
melinna quick-task "..." --economy max | wc -c    # medir o tamanho
```

No agente não há equivalente direto — `melinna_task` já devolve o material montado, que é o mesmo conteúdo.

#### `melinna explain-project` — contexto persistente

Memória do projeto (`.melinna/memory/`) + snapshot comprimido do repositório.

```bash
melinna explain-project
melinna explain-project > contexto.md
```

No agente:

```
me dá o contexto geral desse projeto
```
→ chama `melinna_explain_project`.

### Skills

#### `melinna skills install`

```bash
melinna skills install                    # autodetecta a stack e instala o que serve
melinna skills install fluig advpl        # escolhe explicitamente
melinna skills install --all              # tudo do catálogo
melinna skills install fullstack --full   # clone completo, sem --depth 1
```

No agente:

```
instala as skills da melinna pra esse projeto
instala as skills de fluig e advpl
```
→ chama `melinna_skills_install`.

#### `melinna skills list`

```bash
melinna skills list             # tudo que está visível
melinna skills list --detect    # e quais seriam escolhidas aqui
```

No agente:

```
que skills você usaria nesse projeto?
```
→ chama `melinna_skills_list`.

#### `melinna skills registry` e `update`

```bash
melinna skills registry   # catálogo e o que já está instalado
melinna skills update     # git pull em cada repositório instalado
```

No agente:

```
que skills a melinna tem disponíveis?
atualiza as skills da melinna
```
→ chamam `melinna_skills_registry` e `melinna_skills_update`.

#### `melinna skills add` — seus próprios repositórios

O catálogo embutido é fixo no código. Para usar um repositório fora dele:

```bash
melinna skills add meu-repo https://github.com/acme/skills --tag java
melinna skills install meu-repo
melinna skills remove meu-repo   # tira do catálogo; o clone fica no disco
```

Ficam em `~/.melinna/config.json` e valem como qualquer outra entrada.

#### `melinna skills pin` — fixar uma versão

Skills viram **instrução para o agente**, às vezes com permissão de escrita. Um `skills update` traz o que o autor publicou desde ontem, sem ninguém revisar. Fixar o commit torna a atualização uma decisão explícita:

```bash
melinna skills pin meu-repo              # fixa no commit instalado agora
melinna skills pin meu-repo abc123def    # ou num commit específico
```

Repositório fixado é pulado pelo update:

```
⊙ meu-repo fixado em abc123de — não atualizado
```

Só entradas suas guardam pin. Para fixar um do catálogo embutido, registre uma cópia sua apontando para a mesma URL — o `skills pin` imprime o comando pronto.

> Instale só repositórios de quem você confia: o conteúdo deles entra no prompt do agente.

#### Lendo uma skill inteira

Só existe no agente — no terminal, o conteúdo já entra no prompt dos outros comandos.

```
me mostra a skill java-architect por completo
```
→ chama `melinna_get_skill`.

### Configuração

#### `melinna config economy` — quanto token gastar

```bash
melinna config economy         # escolhe na lista
melinna config economy lean    # ou direto
melinna config show            # o que está valendo e de onde veio
```

No agente:

```
muda a economia da melinna pra lean
qual a configuração da melinna?
```
→ chama `melinna_config`.

Detalhes e números medidos em [Economia de token](#economia-de-token).

### Spec-Driven Development

#### `melinna speckit`

Chama a CLI real do spec-kit e gera a estrutura completa.

```bash
melinna speckit "checkout-com-pix"
melinna speckit "checkout-com-pix" --integration claude
```

No agente:

```
inicializa spec-driven development pra feature checkout-com-pix
```
→ chama `melinna_speckit`.

#### `melinna start-feature`

Alternativa mais simples, sem depender do `specify`: gera `.speckit/` a partir dos templates locais. Interativo — pergunta nome, descrição e skills.

```bash
melinna start-feature
```

Sem equivalente MCP: o fluxo é interativo por natureza.

### Projeto e ambiente

#### `melinna init-project`

Cria `.melinna/` no repositório (memória + skills do projeto) e mostra a stack detectada.

```bash
melinna init-project
```

No agente:

```
prepara a estrutura da melinna nesse projeto
```
→ chama `melinna_init_project`.

#### `melinna doctor`

```bash
melinna doctor
```

No agente:

```
o ambiente da melinna está ok?
```
→ chama `melinna_doctor`.

#### `melinna detect` (só no agente)

A detecção de stack é usada por todos os comandos, mas dá para consultá-la isolada:

```
que stack é esse projeto?
```
→ chama `melinna_detect_stack`. No terminal, o equivalente é `melinna skills list --detect`.

#### `melinna install` e `melinna upgrade`

```bash
melinna install          # baixa caveman-code e spec-kit (uma vez por máquina)
melinna install --full   # clone completo dos repositórios de terceiros

melinna upgrade          # atualiza tudo: Melinna, ferramentas e skills
melinna upgrade --no-self --no-tools   # só as skills
```

Sem equivalente MCP para `install`/`upgrade`: são operações de ambiente, melhores no terminal onde você vê a saída do git e do npm.

#### `melinna mcp` e `melinna sync`

```bash
melinna mcp --setup      # imprime a configuração de cada agente
melinna mcp              # sobe o servidor (quem chama é o agente, não você)

melinna sync                          # escreve as skills no formato de cada agente
melinna sync --target claude cursor   # só alguns alvos
melinna sync --all --global           # todas as skills, no HOME
```

Veja [Usando dentro do seu agente](#usando-dentro-do-seu-agente).

#### `melinna init`

Só em clone de desenvolvimento: roda `npm link` e depois o `doctor`.

```bash
melinna init
```

### Referência rápida

| Terminal | Ferramenta MCP | O que faz |
|---|---|---|
| `melinna task <desc>` | `melinna_task` | Implementa (um disparo) |
| `melinna run <tarefa>` | — | Modo agente: conduz pelas etapas |
| `melinna run-stages` | `melinna_stages` | Lista as etapas do pipeline |
| `melinna run-list/show/stop` | `melinna_runs` | Execuções: custo, detalhe, parada |
| `melinna ask <pergunta>` | `melinna_ask` | Analisa e explica |
| `melinna review` | `melinna_review` | Revisa o diff pendente |
| `melinna quick-task <desc>` | — | Imprime o prompt |
| `melinna explain-project` | `melinna_explain_project` | Memória + snapshot |
| `melinna skills install` | `melinna_skills_install` | Baixa skills |
| `melinna skills list --detect` | `melinna_skills_list` | Lista e mostra a escolha |
| `melinna skills registry` | `melinna_skills_registry` | Catálogo |
| `melinna skills update` | `melinna_skills_update` | Atualiza skills |
| — | `melinna_get_skill` | Lê uma skill inteira |
| — | `melinna_detect_stack` | Só a detecção de stack |
| `melinna vault save` | `melinna_vault_save` | Grava o contexto da sessão |
| `melinna vault show` | `melinna_vault_read` | Lê o contexto salvo |
| `melinna journal add <linha>` | `melinna_journal_add` | Uma linha no diário |
| `melinna vault enable/disable/status` | — | Liga, desliga, diagnostica |
| `melinna journal show [dia]` | — | Mostra o diário |
| `melinna slash install/list/remove` | — | Slash commands no Claude Code |
| `melinna config economy` | `melinna_config` | Perfil de economia |
| `melinna speckit <feature>` | `melinna_speckit` | Spec-driven development |
| `melinna init-project` | `melinna_init_project` | Cria `.melinna/` |
| `melinna doctor` | `melinna_doctor` | Diagnóstico |
| `melinna start-feature` | — | Fluxo interativo |
| `melinna install` / `upgrade` | — | Ambiente |
| `melinna sync` / `mcp` | — | Ligar no agente |

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

As regras estão em [`lib/detect.js`](lib/detect.js).

### Monorepos: rode na raiz, uma vez só

Num monolito, os marcadores não ficam na raiz — ficam em cada módulo. A detecção olha a raiz **e** os módulos: subdiretórios de primeiro nível, mais os filhos das pastas-contêiner convencionais (`apps/`, `packages/`, `services/`, `modules/`, `libs/`, `projects/`).

```
meu-monolito/
├── backend/pom.xml            → java, spring
└── frontend/package.json      → node, react, nextjs
```

Rodando na **raiz**:

```
stack: java, spring (backend/) · node, nextjs, react, frontend (frontend/)
módulos: backend/, frontend/
✔ java-architect   ✔ spring-boot   ✔ spring-boot-engineer
✔ react-expert     ✔ nextjs-developer   ✔ code-review
```

Você **não** precisa entrar em cada pasta. As duas stacks são detectadas e cada família de stack ganha vaga reservada — senão as skills de Java, que pontuam mais, tomariam todas as vagas e o React ficaria de fora. O limite de skills cresce com o número de famílias detectadas (4 para uma stack, +2 por família extra).

O mesmo vale para instalar:

```bash
cd meu-monolito
melinna skills install   # baixa as skills de Java E de React de uma vez
```

`node_modules/`, `target/`, `dist/`, `.git/` e afins são ignorados na varredura — senão uma dependência com `pom.xml` faria seu projeto Node virar Java.

**Quando ainda vale entrar na pasta:** se a tarefa é claramente de um módulo só, rodar dentro dele dá um contexto comprimido menor e mais focado, já que a compressão parte do diretório atual.

```bash
cd backend && melinna task "adicionar índice na tabela de pedidos"
```

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

## Vault: segundo cérebro por projeto

O código o agente relê sozinho na próxima sessão. **A intenção, não.** Por que a arquitetura é assim, que regra foi combinada, o que já foi tentado e descartado — isso se perde quando o chat fecha.

O vault guarda exatamente isso, em notas Obsidian ligadas entre si.

```bash
melinna vault enable ~/Obsidian/SegundoCerebro
```

Fica ligado até você desligar — independente de abrir ou fechar chat.

### Como gravar

**Sob demanda, com o slash command.** Você decide a hora.

```bash
melinna slash install
```

Reinicie o Claude Code e digite `/`:

| Comando | O que faz |
|---|---|
| `/melinna-agente` | Conduz a tarefa pelo pipeline, sem sair do Claude |
| `/melinna-salvar` | Grava a nota do projeto **e** a linha do diário |
| `/melinna-diario` | Só a linha do diário |
| `/melinna-contexto` | Carrega o que sessões anteriores registraram |

Uma chamada escreve os dois: o `resumo` alimenta a nota do projeto e o diário do dia.

```
você:    /melinna-salvar
agente:  [chama melinna_vault_save]
         ✔ projetos/meu-projeto.md atualizado
         ✔ diario/2026-08-28.md — "migrou o auth para JWT"
```

Na conversa seguinte o contexto volta sozinho — o hook `SessionStart` injeta antes da sua primeira mensagem. `/melinna-contexto` força a recarga quando você quiser.

Existe também gravação automática, **desligada por padrão**. Leia [Sobre os hooks](#sobre-os-hooks) antes de ligá-la: o evento disponível não é "chat fechado", e isso tem consequência.

### Estrutura

```
~/Obsidian/SegundoCerebro/
├── projetos.md             índice: lista e linka todos os projetos
├── projetos/
│   └── meu-projeto.md      nota viva, atualizada a cada sessão
└── diario/
    └── 2026-08-28.md       uma linha por sessão
```

O `projetos.md` é regenerado a cada gravação. Sem ele, `projetos/` vira uma pilha plana e o agente precisa varrer o diretório para descobrir o que existe — o modo de falha mais comum de vaults de segundo cérebro.

A nota do projeto:

```markdown
---
projeto: meu-projeto
caminho: C:/dev/meu-projeto
stack: [java, spring]
atualizado: 2026-08-28
tags: [melinna/projeto]
---

# meu-projeto

## Arquitetura
Monolito Spring com módulos por domínio.

## Decisões
- Postgres em vez de Mongo — relatórios exigem join
- Sem ORM no módulo de faturamento — queries críticas escritas à mão

## Convenções e regras
- Nada de lógica de negócio em controller

## Pontos de atenção
- O cache de sessão não invalida em deploy

## Histórico
- [[2026-08-27]] — migrou o módulo de auth para JWT
- [[2026-08-28]] — corrigiu o vazamento no pool de conexão
```

**Prosa é substituída, listas acumulam.** `Arquitetura` e `Pontos de atenção` descrevem o estado atual — manter versões antigas empilhadas só poluiria. `Decisões` e `Regras` acumulam sem duplicar: uma decisão de março continua valendo em agosto.

Os `[[wikilinks]]` funcionam nos dois sentidos — do diário você chega ao projeto, do histórico volta ao dia. É o que faz o grafo do Obsidian valer a pena.

### Comandos

```bash
melinna slash install          # cria /melinna-salvar, /melinna-diario, /melinna-contexto
melinna slash list             # o que está instalado
melinna slash remove           # remove só o que a Melinna criou

melinna vault enable [pasta]   # liga e instala o hook de carga (pergunta antes)
melinna vault status           # ligado? gravação automática? hooks? projeto atual?
melinna vault show             # imprime o contexto salvo deste projeto
melinna vault disable          # desliga e remove os hooks; as notas permanecem

melinna vault auto-save on     # liga a gravação automática ao fim das sessões
melinna vault auto-save off    # desliga (padrão)

melinna vault enable ~/vault --no-hook        # sem hook nenhum, nem a carga
melinna vault enable ~/vault --auto-save      # já com gravação automática
melinna vault hook install                    # instala/atualiza os hooks
```

Gravação manual, sem esperar o hook:

```bash
melinna vault save "migrou o auth para JWT" \
  --arquitetura "Monolito Spring com módulos por domínio." \
  --decisao "Postgres em vez de Mongo — relatórios exigem join" \
  --regra "Nada de lógica de negócio em controller"
```

No agente:

```
salva o contexto desse projeto no vault
o que você já sabe sobre esse projeto?
```
→ `melinna_vault_save` e `melinna_vault_read`.

### Sobre os hooks

São dois, com papéis opostos — e só um vem ligado:

| Evento | O que faz | Padrão |
|---|---|---|
| `SessionStart` | Injeta o contexto salvo no **início** da conversa | **ligado** |
| `Stop` | Pede a gravação ao **fim** de cada resposta do agente | desligado |

O `SessionStart` é passivo: você não percebe, só ganha um agente que já sabe do projeto. Sem ele o vault acumularia conhecimento que ninguém lê — capturar sem carregar é metade do trabalho, e depender de o agente lembrar de chamar `melinna_vault_read` não funciona.

A nota é truncada em ~6.000 caracteres antes de entrar no contexto: ela cresce a cada sessão e isso entraria em **toda** conversa. Para desligar só o carregamento, ponha `"autoLoad": false` no bloco `vault` de `~/.melinna/config.json`.

O `Stop` fica **desligado por padrão**. Ele dispara ao fim de cada resposta do agente — não quando o chat fecha — então pede a gravação já no primeiro comando e interrompe a conversa. O atrito não compensa a conveniência: `/melinna-salvar` grava quando você decide, e pega tudo até ali.

Se quiser mesmo a gravação automática:

```bash
melinna vault auto-save on    # liga
melinna vault auto-save off   # desliga (padrão)
```

Ou já ao ligar o vault: `melinna vault enable ~/vault --auto-save`.

Ligar instala o hook `Stop`; desligar o remove do settings — não fica hook instalado sem função. Vale entender o que ele consegue e o que não consegue.

**Não existe evento de "chat fechado" que consiga falar com o modelo.** O Claude Code tem `SessionEnd`, mas quando ele dispara o modelo já saiu — dá para rodar um comando, não para pedir um resumo. Só o `Stop` devolve o controle ao agente, e ele dispara **a cada resposta**, não no fim da conversa.

Consequência prática, numa sessão de 40 minutos:

```
min 5    você edita, agente responde  → hook dispara, grava        ✔
min 8    outra resposta               → cooldown, não grava
min 22   mais trabalho                → hook dispara, regrava      ✔
min 38   últimos ajustes              → cooldown, não grava
você fecha                            → os últimos 16 min ficaram de fora
```

Ou seja: **o hook grava várias vezes ao longo da sessão e mantém a nota atualizada, mas a cauda pode escapar.** Por isso o `/melinna-salvar` é o caminho principal — ele grava na hora, sem cooldown, pegando tudo até ali.

Sem controle, uma conversa de vinte turnos pediria vinte gravações. Por isso o hook só age quando:

1. o vault está ligado;
2. a sessão usou ferramenta de escrita (uma conversa que só leu não muda o entendimento);
3. passou o intervalo mínimo desde a última gravação na mesma sessão (padrão: 15 min);
4. não é a própria injeção do hook voltando (`stop_hook_active`).

A instalação altera `~/.claude/settings.json`. A Melinna **pergunta antes**, faz backup em `settings.json.melinna-backup`, e marca a entrada com `--melinna-vault` para que `vault disable` remova só o que é dela — hooks seus ficam intactos.

O comando gravado é `melinna vault hook-run`, resolvido pelo **PATH**. Versões anteriores gravavam o caminho absoluto do script, que quebrava em silêncio quando o pacote mudava de lugar. `melinna upgrade` avisa se seus hooks estão nesse formato antigo; `melinna vault hook install` migra.

Se o hook falhar por qualquer motivo, ele deixa a sessão seguir. Um hook quebrado não pode travar seu trabalho.

> **Só no Claude Code por enquanto.** O hook depende do sistema de hooks dele. Em Cursor e Codex, o vault funciona — mas a gravação acontece quando você pede, não automaticamente.

---

## Diário de bordo

Uma linha por sessão, para responder *"o que eu fiz na terça?"* de relance. Usa a mesma pasta do vault.

Dentro do Claude Code:

```
/melinna-diario terminei o refactor do checkout
```

No terminal:

```bash
melinna journal add "corrigiu o spawn do npm no Windows"
melinna journal show              # hoje
melinna journal show 2026-08-27   # outro dia
```

```markdown
---
data: 2026-08-28
tags: [melinna/diario]
---

# 2026-08-28

- [[agente-melinna]] — corrigiu o spawn do npm no Windows
- [[loja-online]] — migrou o checkout para Pix
```

Cada linha liga ao projeto. A frase é **normalizada para uma linha só** — quebras viram espaço, porque o diário é para bater o olho, não para guardar detalhe. O detalhe mora na nota do projeto.

O `melinna vault save` já escreve no diário automaticamente: o `resumo` que você passa vai para os dois lugares.

No agente:

```
anota no diário que terminei o refactor do checkout
```
→ `melinna_journal_add`.

---

## Economia de token

Você escolhe quanto gastar por tarefa. O padrão é o mais caro e o mais completo.

```bash
melinna config economy        # escolhe na lista
melinna config economy lean   # ou direto
melinna config show           # o que está valendo e de onde veio
```

A escolha fica em `~/.melinna/config.json` e vale para **todos os comandos e também dentro do agente**, via MCP.

### Os três perfis

Medido com `quick-task` num mesmo projeto Java/Spring:

| Perfil | Prompt | Diferença | O que muda |
|---|---|---|---|
| `full` *(padrão)* | ~36.700 tokens | — | Todas as skills escolhidas, com os arquivos de referência |
| `lean` | ~8.600 tokens | **−77%** | Só o `SKILL.md` de cada skill, sem as referências |
| `max` | ~4.500 tokens | **−88%** | Duas skills, sem referências, mapa menor e comprimido |

O corte vem de onde o custo está: **o pacote de skills domina o prompt**, e o mapa do repositório é ruído perto disso. Por isso os perfis mexem primeiro em quantas skills entram e se as referências vão junto — não na compressão do contexto.

### Sobrepondo pontualmente

```bash
melinna task "..." --economy max      # só nesta execução
melinna review --economy lean
MELINNA_ECONOMY=lean melinna task ...  # útil em CI
```

Precedência: `--economy` → `MELINNA_ECONOMY` → config salva → `full`.

Dentro do agente, a mesma escolha:

```
usa a melinna em modo econômico pra implementar X
muda a economia da melinna pra lean
```

O agente chama `melinna_config`, ou passa `economy` direto em `melinna_task` / `melinna_review`.

### Sobre a compressão do caveman-code

O `caveman-code` tem um módulo de compressão além do repomap. A Melinna o usa **só no perfil `max`, e só no mapa do repositório** — nunca no texto das skills.

O motivo é o algoritmo:

```js
// Single line: drop every Nth word, preserving inter-word whitespace
const keepEvery = Math.round(1 / clamped);
```

Ele descarta linhas de menor peso e, em linha única, uma palavra a cada N. No mapa de símbolos isso degrada de forma aceitável — perde as entradas menos relevantes. Numa instrução de skill, **corromperia a instrução**. Há um teste que trava essa separação.

O caminho de qualidade desse módulo é o LLMLingua-2 real, que exige ONNX runtime e download de modelo — a dependência nativa pesada que a Melinna evita de propósito.

### Quando usar qual

- **`full`** — o padrão. Use enquanto o custo não incomodar.
- **`lean`** — corta 77% e mantém todas as skills. É o melhor custo-benefício: as referências costumam ser detalhe que o agente busca só quando precisa. Via MCP ele ainda pode puxá-las com `melinna_get_skill`.
- **`max`** — quando o custo importa mais que o acerto de primeira. Duas skills e mapa comprimido: o agente pode perder contexto.

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
| Stack não detectada | Confira se o arquivo-marca existe (veja a [tabela de detecção](#o-que-é-detectado)). Em monorepo, ele pode estar fundo demais: a varredura vai até os filhos das pastas-contêiner (`apps/`, `packages/`, ...), não além. |
| Monorepo só carrega as skills de uma stack | Deve estar corrigido — `melinna skills list --detect` mostra os módulos encontrados. Se um módulo não aparece, ele está mais fundo que o alcance da varredura; rode dentro dele. |
| Agente não vê as ferramentas da Melinna | Confira o registro: `claude mcp list` deve mostrar `melinna: melinna mcp - ✔ Connected`. Reinicie o agente depois de configurar. |
| Melinna aparece numa pasta mas some em outra | Foi registrada em escopo local. Registre de novo com `claude mcp add --scope user melinna -- melinna mcp`. |
| Conectada, mas o agente não chama as ferramentas | Force pelo nome: *"chama melinna_detect_stack"*. Se funcionar, o servidor está bem — o agente só não julgou necessário. |
| No agente: "nenhuma skill casou" | As skills daquela stack não foram baixadas ainda. Peça *"instala as skills da melinna"* (ou rode `melinna skills install` no projeto). |
| `melinna mcp` parece travado no terminal | Correto — é um servidor que fala JSON-RPC pela stdio, não uma ferramenta interativa. Quem chama é o agente. Use `melinna mcp --setup` para ver como configurar. |
| Skills sincronizadas ficaram desatualizadas | `melinna sync` é estático. Rode de novo após `melinna skills update` ou ao trocar de stack. |
| Prompt grande demais / custo alto | `melinna config economy lean` corta ~77%. Veja [Economia de token](#economia-de-token). |
| Agente perdendo contexto | Se você está em `max`, volte para `lean` ou `full`: `melinna config economy lean`. |

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
melinna upgrade
```

Um comando só, que atualiza tudo:

1. **A própria Melinna** — busca o commit mais recente do git. Numa instalação global roda o `npm install -g` por você; num clone de desenvolvimento faz `git pull` + `npm install`.
2. **Os clones de terceiros** — `caveman-code` e `spec-kit`.
3. **Os repositórios de skills** instalados.

Você não precisa lembrar da URL do repositório nem rodar `npm install -g` na mão. Publicou uma mudança? Quem usa roda `melinna upgrade` e pega.

```bash
melinna upgrade --no-self     # só ferramentas e skills
melinna upgrade --no-skills   # pula os repositórios de skills
melinna upgrade --no-tools    # pula caveman-code/spec-kit
```

> Se você usa a Melinna via MCP, **reinicie o agente** depois do upgrade — o servidor é carregado na inicialização.

---

## Limitações conhecidas

- **A validação de `melinna task` é só `npm test`** (quando existe um script real). Não roda lint/typecheck, e não conhece `mvn test`, `gradle test`, `flutter test` nem os equivalentes das outras stacks que a detecção já identifica.
- **A autodetecção de skills é lexical**: casa as tags da stack contra id, `metadata.triggers` e descrição. Funciona bem quando a skill se nomeia pela tecnologia, e erra quando não — `melinna skills list --detect` mostra a escolha antes de gastar uma execução de agente.
- **A compressão usa o parser regex de fallback** do caveman-code (a dependência opcional `web-tree-sitter` não está instalada), então o snapshot lista até declarações locais dentro de funções, não só símbolos de topo. Funcional, mas mais verboso que o modo com tree-sitter.
- **`start-feature` não preenche os placeholders** de princípios da constituição (`[PRINCIPLE_1_NAME]` etc.) — fica para revisão manual. Para o fluxo completo e já preenchido, use `melinna speckit`.
- **Das cinco integrações de agente, só `claude` e `agy` foram executadas de verdade nesta máquina.** As receitas de `caveman`, `cursor-agent` e `codex` em [`lib/agents.js`](lib/agents.js) vieram da documentação oficial de cada CLI e ainda não foram exercitadas end-to-end. Se alguma flag mudar, é só ajustar o registro — os comandos não precisam saber.
- **Os testes cobrem detecção de stack, seleção de skills, o registry e a resolução de binários.** Os comandos que executam agentes ainda são validados só manualmente.
- **`quick-task`/`explain-project` truncam o snapshot** pelo orçamento de tokens (`tokenBudget`); em repositórios muito grandes pode valer expor isso como flag.
