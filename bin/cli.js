#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Command } from "commander";
import chalk from "chalk";
import { startFeature } from "../lib/commands/start-feature.js";
import { quickTask } from "../lib/commands/quick-task.js";
import { explainProject } from "../lib/commands/explain-project.js";

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

program.parseAsync(process.argv).catch((err) => {
  console.log(chalk.red(`Erro inesperado: ${err.message}`));
  process.exitCode = 1;
});
