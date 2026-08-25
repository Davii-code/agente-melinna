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
import { doctor } from "../lib/commands/doctor.js";
import { AGENT_PRIORITY } from "../lib/agents.js";

const AGENT_OPT_DESC = `força o agente a usar (${AGENT_PRIORITY.join(", ")}) em vez de autodetectar`;

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

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
  .description("Monta um prompt rápido: skill + contexto comprimido do diretório atual + descrição da tarefa.")
  .option("--skill <nome_do_arquivo>", "arquivo .md da skill a usar (em skills/custom/ ou skills/external/)")
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
    "Implementa uma task simples de ponta a ponta: monta o prompt (skill + contexto comprimido) e " +
      "executa um agente de IA de verdade (`caveman` ou `claude`, o que estiver no PATH), validando " +
      "com `npm test` quando existir. Sem nenhum dos dois, cai de volta para apenas imprimir o prompt.",
  )
  .option("--skill <nome_do_arquivo>", "arquivo .md da skill a usar (em skills/custom/ ou skills/external/)")
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
    "Revisa as mudanças pendentes (staged + unstaged) do repositório atual com a skill code-review.md. " +
      "Executa `caveman` ou `claude` de verdade (o que estiver no PATH); senão, imprime o prompt.",
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

program
  .command("doctor")
  .description("Checa o ambiente: git, specify, clones de terceiros e quais agentes de IA estão disponíveis.")
  .action(async () => {
    try {
      const ok = await doctor(ROOT);
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
