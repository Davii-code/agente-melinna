#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Command } from "commander";
import chalk from "chalk";
import { startFeature } from "../lib/commands/start-feature.js";
import { quickTask } from "../lib/commands/quick-task.js";
import { explainProject } from "../lib/commands/explain-project.js";
import { task } from "../lib/commands/task.js";
import { speckit } from "../lib/commands/speckit.js";
import { review } from "../lib/commands/review.js";
import { ask } from "../lib/commands/ask.js";
import { run, runList, runShow, runStop, runStages } from "../lib/commands/run.js";
import { install } from "../lib/commands/install.js";
import { upgrade } from "../lib/commands/upgrade.js";
import { init } from "../lib/commands/init.js";
import { initProject } from "../lib/commands/init-project.js";
import { doctor } from "../lib/commands/doctor.js";
import {
  skillsInstall,
  skillsUpdate,
  skillsList,
  skillsRegistry,
  skillsAdd,
  skillsRemove,
  skillsPin,
} from "../lib/commands/skills.js";
import { sync } from "../lib/commands/sync.js";
import { configEconomy, configShow } from "../lib/commands/config.js";
import {
  vaultEnable,
  vaultDisable,
  vaultStatus,
  vaultHook,
  vaultShow,
  vaultSave,
  vaultAutoSave,
  journalAdd,
  journalShow,
} from "../lib/commands/vault.js";
import { slashInstall, slashRemove, slashList } from "../lib/commands/slash.js";
import { PROFILES } from "../lib/config.js";
import { AGENT_PRIORITY } from "../lib/agents.js";

const ECONOMY_OPT_DESC = `perfil de economia de token nesta execução (${Object.keys(PROFILES).join(", ")})`;

const AGENT_OPT_DESC = `força o agente a usar (${AGENT_PRIORITY.join(", ")}) em vez de autodetectar`;

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

/**
 * Instruções de configuração do servidor MCP em cada agente.
 *
 * Os agentes leem o servidor de arquivos de config diferentes, mas todos usam a
 * mesma forma: um comando a executar. Como a Melinna já está no PATH depois da
 * instalação global, o comando é sempre `melinna mcp`.
 */
function printMcpSetup() {
  const json = JSON.stringify(
    { mcpServers: { melinna: { command: "melinna", args: ["mcp"] } } },
    null,
    2,
  )
    .split("\n")
    .map((line) => `    ${line}`)
    .join("\n");

  console.log(chalk.bold("\nClaude Code"));
  console.log(chalk.dim("  Um comando, sem editar arquivo:"));
  console.log("    claude mcp add --scope user melinna -- melinna mcp");
  console.log(
    chalk.dim("  Sem `--scope user` o registro vale só na pasta atual, e some nos outros projetos."),
  );

  console.log(chalk.bold("\nCursor"));
  console.log(chalk.dim("  .cursor/mcp.json (no projeto) ou ~/.cursor/mcp.json (global):"));
  console.log(json);

  console.log(chalk.bold("\nCodex"));
  console.log(chalk.dim("  ~/.codex/config.toml:"));
  console.log('    [mcp_servers.melinna]\n    command = "melinna"\n    args = ["mcp"]');

  console.log(chalk.bold("\nOutros clientes MCP (Antigravity, Windsurf, Zed)"));
  console.log(chalk.dim("  Aponte para o mesmo comando:"));
  console.log("    melinna mcp");

  console.log(chalk.bold("\nDepois de configurar"));
  console.log(chalk.dim("  Reinicie o agente — os servidores MCP são lidos na inicialização."));
  console.log(chalk.dim("  Num projeto de stack nova, peça primeiro:"));
  console.log('    "instala as skills da melinna pra esse projeto"');
  console.log(chalk.dim("  Depois é só conversar normalmente:"));
  console.log('    "implementa validação de e-mail no cadastro"');
  console.log('    "revisa minhas mudanças pendentes"');
  console.log("");
}

const program = new Command();

program
  .name("melinna")
  .description(
    "Melinna — orquestrador pessoal de engenharia: combina caveman-code (compressão de contexto), " +
      "spec-kit (spec-driven development) e skills locais em Markdown.",
  )
  .version("1.0.0");

program
  .command("start-feature")
  .description(
    "Fluxo de Spec-Driven Development: cria .speckit/ com constitution.md, specify.md e um " +
      "snapshot comprimido do projeto (caveman-context.md).",
  )
  .action(async () => {
    try {
      await startFeature(ROOT, process.cwd());
    } catch (err) {
      console.log(chalk.red(`Erro: ${err.message}`));
      process.exitCode = 1;
    }
  });

program
  .command("quick-task <descricao>")
  .description(
    "Monta e imprime um prompt: skills (escolhidas pela stack detectada) + contexto comprimido " +
      "do diretório atual + descrição da tarefa. Não executa nenhum agente.",
  )
  .option("--skill <nome>", "força uma skill específica (id ou arquivo) em vez de autodetectar")
  .option("--no-skill", "não carrega skill nenhuma")
  .option("--economy <nivel>", ECONOMY_OPT_DESC)
  .action(async (descricao, options) => {
    try {
      await quickTask(ROOT, process.cwd(), descricao, options);
    } catch (err) {
      console.log(chalk.red(`Erro: ${err.message}`));
      process.exitCode = 1;
    }
  });

program
  .command("explain-project")
  .description("Gera um System Prompt combinando memory/ com um snapshot comprimido de todo o repositório.")
  .action(async () => {
    try {
      await explainProject(ROOT, process.cwd());
    } catch (err) {
      console.log(chalk.red(`Erro: ${err.message}`));
      process.exitCode = 1;
    }
  });

program
  .command("task <descricao>")
  .description(
    "Implementa uma task de ponta a ponta: detecta a stack do projeto, escolhe as skills " +
      "correspondentes (mais as de arquitetura e revisão, sempre), monta o prompt com o contexto " +
      "comprimido e executa um agente de IA de verdade, validando com `npm test` quando existir. " +
      "Sem nenhum agente no PATH, cai de volta para apenas imprimir o prompt.",
  )
  .option("--skill <nome>", "força uma skill específica (id ou arquivo) em vez de autodetectar")
  .option("--no-skill", "não carrega skill nenhuma")
  .option("--economy <nivel>", ECONOMY_OPT_DESC)
  .option("--agent <bin>", AGENT_OPT_DESC)
  .option("--yolo", "auto-aprova TUDO no agente, inclusive execução de shell arbitrário")
  .action(async (descricao, options) => {
    try {
      await task(ROOT, process.cwd(), descricao, options);
    } catch (err) {
      console.log(chalk.red(`Erro: ${err.message}`));
      process.exitCode = 1;
    }
  });

program
  .command("ask <pergunta>")
  .description(
    "Analisa o projeto e EXPLICA: detecta a stack, carrega as convenções da tecnologia, monta o " +
      "mapa do repositório e responde a pergunta com o agente em modo somente-leitura. Para " +
      "entender o código antes de mexer — 'como funciona X', 'me explica esse projeto'.",
  )
  .option("--deep", "dobra o mapa do repositório, para perguntas amplas sobre arquitetura")
  .option("--agent <bin>", AGENT_OPT_DESC)
  .option("--economy <nivel>", ECONOMY_OPT_DESC)
  .action(async (pergunta, options) => {
    try {
      await ask(ROOT, process.cwd(), pergunta, { ...options, depth: options.deep ? "deep" : "normal" });
    } catch (err) {
      console.log(chalk.red(`Erro: ${err.message}`));
      process.exitCode = 1;
    }
  });

program
  .command("run <tarefa>")
  .description(
    "Modo agente: conduz a tarefa pelas etapas do pipeline (entender → especificar → planejar → " +
      "tarefas → implementar → revisar → verificar), carregando em cada uma só as skills daquela " +
      "etapa e parando quando um portão reprova.",
  )
  .option("--mode <modo>", "assistido (padrão, para a cada etapa), supervisionado, autonomo", "assistido")
  .option(
    "--auto",
    "vai sozinho do início ao fim sem perguntar nada: liga o autônomo, dispensa a confirmação " +
      "e instrui o agente a decidir em vez de perguntar",
  )
  .option("--from <etapa>", "começa nesta etapa")
  .option("--to <etapa>", "para nesta etapa")
  .option("--only <etapas...>", "executa só estas etapas")
  .option("--resume-run <id>", "retoma uma execução anterior")
  .option("--max-cost <usd>", "teto de gasto da execução", Number)
  .option("--max-turns <n>", "teto de turnos por etapa", Number)
  .option("--stage-timeout <min>", "teto de tempo por etapa, em minutos", Number)
  .option("--no-worktree", "no modo autônomo, escreve direto em vez de isolar (arriscado)")
  .option("--deny <ferramentas...>", "ferramentas adicionais a bloquear")
  .option("--no-vault", "não grava o resultado no vault nem no diário ao terminar")
  .option("--no-mcp", "não libera os servidores MCP configurados (Jira, GitHub, ...)")
  .option("--mcp-only <servidores...>", "libera só estes servidores MCP")
  .option("--mcp-exclude <servidores...>", "libera todos os MCP menos estes")
  .option("--dry-run", "mostra o plano de execução sem executar nada")
  .option("--agent <bin>", AGENT_OPT_DESC)
  .option("--economy <nivel>", ECONOMY_OPT_DESC)
  .option("-y, --yes", "não pede confirmação no modo autônomo")
  .action(async (tarefa, options) => {
    try {
      await run(ROOT, process.cwd(), tarefa, options);
    } catch (err) {
      console.log(chalk.red(`Erro: ${err.message}`));
      process.exitCode = 1;
    }
  });

program
  .command("run-stages")
  .description("Lista as etapas do pipeline, o que cada uma faz e quais skills carrega.")
  .action(() => {
    try {
      runStages();
    } catch (err) {
      console.log(chalk.red(`Erro: ${err.message}`));
      process.exitCode = 1;
    }
  });

program
  .command("run-list")
  .description("Lista as execuções do modo agente.")
  .action(() => {
    try {
      runList();
    } catch (err) {
      console.log(chalk.red(`Erro: ${err.message}`));
      process.exitCode = 1;
    }
  });

program
  .command("run-show <id>")
  .description("Detalha uma execução: etapas, custo e onde estão o estado e o registro.")
  .action((id) => {
    try {
      runShow(id);
    } catch (err) {
      console.log(chalk.red(`Erro: ${err.message}`));
      process.exitCode = 1;
    }
  });

program
  .command("run-stop <id>")
  .description("Pede que uma execução pare ao terminar a etapa atual.")
  .action((id) => {
    try {
      runStop(id);
    } catch (err) {
      console.log(chalk.red(`Erro: ${err.message}`));
      process.exitCode = 1;
    }
  });

program
  .command("speckit <feature-name>")
  .description(
    "Chama a CLI real do spec-kit (`specify init --here`) para gerar a estrutura completa de " +
      "spec-driven development neste diretório e imprime a sequência de slash commands /speckit.* a rodar.",
  )
  .option("--integration <agente>", "integração de agente de IA (claude, copilot, cursor_agent, codex, gemini, ...)")
  .action(async (featureName, options) => {
    try {
      await speckit(process.cwd(), featureName, options);
    } catch (err) {
      console.log(chalk.red(`Erro: ${err.message}`));
      process.exitCode = 1;
    }
  });

program
  .command("review")
  .description(
    "Revisa as mudanças pendentes (staged + unstaged) do repositório atual. Carrega sempre as skills " +
      "de revisão e arquitetura, mais as da stack detectada. Executa um agente de IA em modo " +
      "somente-leitura; sem nenhum no PATH, imprime o prompt.",
  )
  .option("--agent <bin>", AGENT_OPT_DESC)
  .option("--economy <nivel>", ECONOMY_OPT_DESC)
  .action(async (options) => {
    try {
      await review(ROOT, process.cwd(), options);
    } catch (err) {
      console.log(chalk.red(`Erro: ${err.message}`));
      process.exitCode = 1;
    }
  });

program
  .command("install")
  .description(
    "Prepara o ambiente: instala dependências (em clone de dev) e clona caveman-code/spec-kit no " +
      "diretório de ferramentas (~/.melinna/tools numa instalação global).",
  )
  .option("--full", "clone completo dos repositórios de terceiros (o padrão é --depth 1)")
  .action(async (options) => {
    try {
      await install(ROOT, options);
    } catch (err) {
      console.log(chalk.red(`Erro: ${err.message}`));
      process.exitCode = 1;
    }
  });

const skills = program
  .command("skills")
  .description("Gerencia as skills: instala repositórios do registry, lista o que está disponível e atualiza.");

skills
  .command("install [nomes...]")
  .description(
    "Clona repositórios de skills em ~/.melinna/skills. Sem argumentos, instala as skills " +
      "sempre-ativas (arquitetura e revisão) mais as que casam com a stack detectada aqui.",
  )
  .option("--all", "instala todos os repositórios do registry")
  .option("--full", "clone completo (o padrão é --depth 1)")
  .action(async (nomes, options) => {
    try {
      await skillsInstall(process.cwd(), nomes ?? [], options);
    } catch (err) {
      console.log(chalk.red(`Erro: ${err.message}`));
      process.exitCode = 1;
    }
  });

skills
  .command("list")
  .description("Lista as skills visíveis (projeto, usuário, pacote e registry).")
  .option("--detect", "mostra também quais seriam escolhidas automaticamente aqui")
  .action((options) => {
    try {
      skillsList(ROOT, process.cwd(), options);
    } catch (err) {
      console.log(chalk.red(`Erro: ${err.message}`));
      process.exitCode = 1;
    }
  });

skills
  .command("add <nome> <url>")
  .description("Registra um repositório de skills seu, fora do catálogo embutido.")
  .option("--tag <tags...>", "tags de stack que ele cobre (padrão: custom)")
  .option("--description <texto>", "descrição curta")
  .option("--pin <commit>", "fixa num commit, para `skills update` não movê-lo")
  .action((nome, url, options) => {
    try {
      skillsAdd(nome, url, options);
    } catch (err) {
      console.log(chalk.red(`Erro: ${err.message}`));
      process.exitCode = 1;
    }
  });

skills
  .command("remove <nome>")
  .description("Remove um repositório que você adicionou. O catálogo embutido não é afetado.")
  .action((nome) => {
    try {
      skillsRemove(nome);
    } catch (err) {
      console.log(chalk.red(`Erro: ${err.message}`));
      process.exitCode = 1;
    }
  });

skills
  .command("pin <nome> [commit]")
  .description(
    "Fixa um repositório num commit, para que `skills update` não traga conteúdo não revisado. " +
      "Sem o commit, usa o que está instalado.",
  )
  .action(async (nome, commit) => {
    try {
      await skillsPin(nome, commit);
    } catch (err) {
      console.log(chalk.red(`Erro: ${err.message}`));
      process.exitCode = 1;
    }
  });

skills
  .command("registry")
  .description("Mostra o catálogo de repositórios de skills e o que já está instalado.")
  .action(() => {
    try {
      skillsRegistry();
    } catch (err) {
      console.log(chalk.red(`Erro: ${err.message}`));
      process.exitCode = 1;
    }
  });

skills
  .command("update")
  .description("Roda `git pull` em cada repositório de skills instalado.")
  .action(async () => {
    try {
      await skillsUpdate();
    } catch (err) {
      console.log(chalk.red(`Erro: ${err.message}`));
      process.exitCode = 1;
    }
  });

const vault = program
  .command("vault")
  .description(
    "Segundo cérebro por projeto, em formato Obsidian. Fica ligado até você desligar: ao fim de " +
      "cada sessão com trabalho de verdade, o agente grava arquitetura, decisões e regras numa " +
      "nota do projeto, e uma linha no diário do dia.",
  );

vault
  .command("enable [pasta]")
  .description(
    "Liga o vault numa pasta. A gravação é sob demanda (`/melinna-salvar`); o hook instalado só " +
      "carrega o contexto no início da conversa, sem interromper nada.",
  )
  .option("--no-hook", "não instala hook nenhum — nem a carga automática do contexto")
  .option("--auto-save", "também pede a gravação ao fim das sessões (interrompe a conversa)")
  .option("--cooldown <minutos>", "com --auto-save, intervalo mínimo entre pedidos (padrão: 15)", Number)
  .option("-y, --yes", "não pergunta antes de alterar as settings do Claude Code")
  .action(async (pasta, options) => {
    try {
      await vaultEnable(pasta, options);
    } catch (err) {
      console.log(chalk.red(`Erro: ${err.message}`));
      process.exitCode = 1;
    }
  });

vault
  .command("disable")
  .description("Desliga o vault e remove o hook. As notas já escritas permanecem.")
  .option("-y, --yes", "não pergunta antes de remover o hook")
  .action(async (options) => {
    try {
      await vaultDisable(options);
    } catch (err) {
      console.log(chalk.red(`Erro: ${err.message}`));
      process.exitCode = 1;
    }
  });

vault
  .command("status")
  .description("Mostra se o vault está ligado, onde fica, se o hook está instalado e o projeto atual.")
  .action(() => {
    try {
      vaultStatus(process.cwd());
    } catch (err) {
      console.log(chalk.red(`Erro: ${err.message}`));
      process.exitCode = 1;
    }
  });

vault
  .command("show")
  .description("Imprime o contexto que o vault guarda sobre o projeto atual.")
  .action(() => {
    try {
      vaultShow(process.cwd());
    } catch (err) {
      console.log(chalk.red(`Erro: ${err.message}`));
      process.exitCode = 1;
    }
  });

vault
  .command("save [resumo]")
  .description("Grava manualmente no vault, sem esperar o hook. O caminho normal é o agente gravar.")
  .option("--arquitetura <texto>", "substitui a seção de arquitetura")
  .option("--decisao <texto...>", "acrescenta decisões")
  .option("--regra <texto...>", "acrescenta regras")
  .option("--atencao <texto>", "substitui os pontos de atenção")
  .action((resumo, options) => {
    try {
      vaultSave(process.cwd(), resumo, options);
    } catch (err) {
      console.log(chalk.red(`Erro: ${err.message}`));
      process.exitCode = 1;
    }
  });

// Executores de hook: invocados pelo Claude Code, não pelo usuário.
//
// A stdout aqui é o canal do protocolo de hooks — só JSON pode sair por ela.
// Qualquer falha vira `{}` (deixa a sessão seguir) e sai com código 0: um hook
// quebrado não pode travar o trabalho de quem está usando o agente.
for (const { sub, run } of [
  { sub: "hook-run", run: async (m, input) => m.runStopHook(input) },
  { sub: "hook-start", run: async (m, input) => m.runSessionStartHook(input) },
]) {
  vault
    // `[marca...]` engole o `--melinna-vault` do comando instalado: ele existe
    // só para identificar a entrada no settings, e o executor o ignora.
    .command(`${sub} [marca...]`, { hidden: true })
    .description("Executor de hook do Claude Code — chamado pelo agente, não por você.")
    .allowUnknownOption()
    .action(async () => {
      let output = "{}";
      try {
        const runner = await import("../lib/hooks/runner.js");
        output = JSON.stringify((await run(runner, runner.readHookInput())) ?? {});
      } catch {
        output = "{}";
      }
      process.stdout.write(output);
      process.exit(0);
    });
}

vault
  .command("auto-save <estado>")
  .description(
    "Liga ou desliga a gravação automática ao fim das sessões (`on` ou `off`). " +
      "Desligada, o vault grava só com `/melinna-salvar`.",
  )
  .action((estado) => {
    try {
      vaultAutoSave(estado);
    } catch (err) {
      console.log(chalk.red(`Erro: ${err.message}`));
      process.exitCode = 1;
    }
  });

vault
  .command("hook <acao>")
  .description("Instala ou remove os hooks do Claude Code (`install` ou `remove`).")
  .option("--auto-save", "inclui o hook de gravação automática")
  .action((acao, options) => {
    try {
      vaultHook(acao, options);
    } catch (err) {
      console.log(chalk.red(`Erro: ${err.message}`));
      process.exitCode = 1;
    }
  });

const slash = program
  .command("slash")
  .description(
    "Slash commands da Melinna no Claude Code: /melinna-salvar, /melinna-diario e /melinna-contexto. " +
      "Você decide a hora de gravar, sem depender do hook.",
  );

slash
  .command("install")
  .description("Cria os slash commands em ~/.claude/commands (ou no projeto, com --project).")
  .option("--project", "instala em .claude/commands do repositório atual, em vez do HOME")
  .option("--force", "sobrescreve arquivos de mesmo nome que não foram criados pela Melinna")
  .action((options) => {
    try {
      slashInstall(process.cwd(), options);
    } catch (err) {
      console.log(chalk.red(`Erro: ${err.message}`));
      process.exitCode = 1;
    }
  });

slash
  .command("remove")
  .description("Remove os slash commands que a Melinna instalou.")
  .option("--project", "remove do repositório atual, em vez do HOME")
  .action((options) => {
    try {
      slashRemove(process.cwd(), options);
    } catch (err) {
      console.log(chalk.red(`Erro: ${err.message}`));
      process.exitCode = 1;
    }
  });

slash
  .command("list")
  .description("Mostra os slash commands e quais estão instalados.")
  .option("--project", "consulta o repositório atual, em vez do HOME")
  .action((options) => {
    try {
      slashList(process.cwd(), options);
    } catch (err) {
      console.log(chalk.red(`Erro: ${err.message}`));
      process.exitCode = 1;
    }
  });

const journal = program
  .command("journal")
  .description("Diário de bordo: uma linha por dia sobre o que foi feito, ligada ao projeto.");

journal
  .command("add <linha>")
  .description("Acrescenta uma linha ao diário de hoje.")
  .option("--dia <AAAA-MM-DD>", "registra em outro dia")
  .option("--no-project", "não liga a linha a nenhum projeto")
  .action((linha, options) => {
    try {
      journalAdd(process.cwd(), linha, { ...options, day: options.dia });
    } catch (err) {
      console.log(chalk.red(`Erro: ${err.message}`));
      process.exitCode = 1;
    }
  });

journal
  .command("show [dia]")
  .description("Mostra o diário de um dia (padrão: hoje).")
  .action((dia) => {
    try {
      journalShow(dia);
    } catch (err) {
      console.log(chalk.red(`Erro: ${err.message}`));
      process.exitCode = 1;
    }
  });

const config = program
  .command("config")
  .description("Preferências da Melinna, salvas em ~/.melinna/config.json e válidas também via MCP.");

config
  .command("economy [nivel]")
  .description(
    `Escolhe quanto token gastar por tarefa (${Object.keys(PROFILES).join(", ")}). ` +
      "Sem o nível, pergunta na lista.",
  )
  .action(async (nivel) => {
    try {
      await configEconomy(nivel);
    } catch (err) {
      console.log(chalk.red(`Erro: ${err.message}`));
      process.exitCode = 1;
    }
  });

config
  .command("show")
  .description("Mostra a configuração em vigor, de onde ela veio e os perfis disponíveis.")
  .action(() => {
    try {
      configShow();
    } catch (err) {
      console.log(chalk.red(`Erro: ${err.message}`));
      process.exitCode = 1;
    }
  });

program
  .command("mcp")
  .description(
    "Sobe o servidor MCP na stdio, expondo todos os comandos da Melinna como ferramentas para " +
      "Claude Code, Cursor, Antigravity, Codex — qualquer cliente MCP. Não use direto no terminal: " +
      "configure no agente (veja `melinna mcp --setup`).",
  )
  .option("--setup", "imprime o trecho de configuração para cada agente, sem subir o servidor")
  .action(async (options) => {
    try {
      if (options.setup) {
        printMcpSetup();
        return;
      }
      const { startMcpServer } = await import("../lib/mcp.js");
      await startMcpServer(ROOT);
    } catch (err) {
      // Em modo servidor a stdout é o canal do protocolo — erro vai para stderr.
      console.error(`Erro: ${err.message}`);
      process.exitCode = 1;
    }
  });

program
  .command("sync")
  .description(
    "Escreve as skills no formato nativo de cada agente (Claude Code, Cursor, AGENTS.md), para " +
      "usá-las de dentro do agente sem passar pela Melinna. Complementa o `melinna mcp`.",
  )
  .option(
    "--target <alvos...>",
    "quais agentes sincronizar: claude, cursor, agents (padrão: todos)",
  )
  .option("--all", "sincroniza todas as skills, não só as da stack detectada")
  .option("--global", "no Claude Code, escreve em ~/.claude/skills em vez de .claude/skills do projeto")
  .option("--clean", "apaga o diretório de destino antes de escrever")
  .action(async (options) => {
    try {
      await sync(ROOT, process.cwd(), { ...options, targets: options.target });
    } catch (err) {
      console.log(chalk.red(`Erro: ${err.message}`));
      process.exitCode = 1;
    }
  });

program
  .command("init-project")
  .description(
    "Cria `.melinna/` no repositório atual (memória do projeto + skills próprias) e mostra a stack detectada.",
  )
  .action(async () => {
    try {
      await initProject(process.cwd());
    } catch (err) {
      console.log(chalk.red(`Erro: ${err.message}`));
      process.exitCode = 1;
    }
  });

program
  .command("doctor")
  .description(
    "Checa o ambiente: git, npm, specify, clones de terceiros, skills instaladas e agentes de IA disponíveis.",
  )
  .action(async () => {
    try {
      const ok = await doctor(ROOT, process.cwd());
      if (!ok) process.exitCode = 1;
    } catch (err) {
      console.log(chalk.red(`Erro: ${err.message}`));
      process.exitCode = 1;
    }
  });

program
  .command("upgrade")
  .description(
    "Atualiza tudo de uma vez: a própria Melinna (do git), os clones de terceiros e os " +
      "repositórios de skills instalados. Dispensa lembrar do `npm install -g git+...`.",
  )
  .option("--no-self", "não atualiza a própria Melinna")
  .option("--no-tools", "não atualiza caveman-code/spec-kit")
  .option("--no-skills", "não atualiza os repositórios de skills")
  .action(async (options) => {
    try {
      await upgrade(ROOT, options);
    } catch (err) {
      console.log(chalk.red(`Erro: ${err.message}`));
      process.exitCode = 1;
    }
  });

program
  .command("init")
  .description("Linka o comando `melinna` globalmente (npm link, só em clone de dev) e roda o `doctor`.")
  .action(async () => {
    try {
      await init(ROOT);
    } catch (err) {
      console.log(chalk.red(`Erro: ${err.message}`));
      process.exitCode = 1;
    }
  });

program.parseAsync(process.argv).catch((err) => {
  console.log(chalk.red(`Erro inesperado: ${err.message}`));
  process.exitCode = 1;
});
