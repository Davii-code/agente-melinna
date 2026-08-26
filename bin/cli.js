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
import { install } from "../lib/commands/install.js";
import { upgrade } from "../lib/commands/upgrade.js";
import { init } from "../lib/commands/init.js";
import { initProject } from "../lib/commands/init-project.js";
import { doctor } from "../lib/commands/doctor.js";
import { skillsInstall, skillsUpdate, skillsList, skillsRegistry } from "../lib/commands/skills.js";
import { sync } from "../lib/commands/sync.js";
import { AGENT_PRIORITY } from "../lib/agents.js";

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
  console.log("    claude mcp add melinna -- melinna mcp");

  console.log(chalk.bold("\nCursor"));
  console.log(chalk.dim("  .cursor/mcp.json (no projeto) ou ~/.cursor/mcp.json (global):"));
  console.log(json);

  console.log(chalk.bold("\nCodex"));
  console.log(chalk.dim("  ~/.codex/config.toml:"));
  console.log('    [mcp_servers.melinna]\n    command = "melinna"\n    args = ["mcp"]');

  console.log(chalk.bold("\nOutros clientes MCP (Antigravity, Windsurf, Zed)"));
  console.log(chalk.dim("  Aponte para o mesmo comando:"));
  console.log("    melinna mcp");

  console.log(chalk.dim("\nDepois de configurar, reinicie o agente e peça algo como:"));
  console.log(chalk.dim('  "usa a melinna para preparar: adicionar validação de e-mail no cadastro"'));
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
  .description("Atualiza os clones em tools/ (git pull) e as dependências npm da Melinna.")
  .action(async () => {
    try {
      await upgrade(ROOT);
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
