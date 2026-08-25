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
