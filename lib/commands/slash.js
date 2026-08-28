import chalk from "chalk";
import { SLASH_COMMANDS, installSlashCommands, removeSlashCommands, listInstalled } from "../slash.js";

/**
 * `melinna slash install`: instala os slash commands no Claude Code.
 *
 * Por padrão vão para o HOME, valendo em todo projeto — que é o caso de uso:
 * você quer `/melinna-salvar` disponível em qualquer repositório, não só num.
 */
export function slashInstall(cwd, options = {}) {
  const target = options.project ? { project: cwd } : {};
  const { dir, written, skipped } = installSlashCommands({ ...target, force: options.force });

  console.log(chalk.dim(`Diretório: ${dir}`));
  for (const name of written) {
    const meta = SLASH_COMMANDS.find((c) => c.name === name);
    console.log(`  ${chalk.green("✔")} /${name} ${chalk.dim(`— ${meta.summary}`)}`);
  }
  for (const name of skipped) {
    console.log(`  ${chalk.yellow("○")} /${name} ${chalk.dim("— já existe e não foi criado pela Melinna")}`);
  }

  if (skipped.length > 0) {
    console.log("");
    console.log(chalk.yellow("Arquivos seus com esses nomes foram preservados."));
    console.log(chalk.dim("Use --force para sobrescrever."));
  }

  console.log("");
  console.log(chalk.dim("Reinicie o Claude Code e digite `/` para ver os comandos."));
}

/** `melinna slash remove`: remove só o que a Melinna instalou. */
export function slashRemove(cwd, options = {}) {
  const target = options.project ? { project: cwd } : {};
  const { dir, removed } = removeSlashCommands(target);

  if (removed.length === 0) {
    console.log(chalk.dim(`Nenhum slash command da Melinna em ${dir}.`));
    return;
  }
  console.log(chalk.dim(`Diretório: ${dir}`));
  for (const name of removed) console.log(`  ${chalk.green("✔")} /${name} removido`);
}

/** `melinna slash list`: o que está instalado e o que cada um faz. */
export function slashList(cwd, options = {}) {
  const target = options.project ? { project: cwd } : {};
  const installed = new Set(listInstalled(target));

  console.log(chalk.bold("Slash commands da Melinna"));
  for (const command of SLASH_COMMANDS) {
    const mark = installed.has(command.name) ? chalk.green("✔") : chalk.yellow("○");
    console.log(`  ${mark} /${command.name} ${chalk.dim(`— ${command.summary}`)}`);
  }

  if (installed.size < SLASH_COMMANDS.length) {
    console.log("");
    console.log(chalk.dim("Instale com `melinna slash install`."));
  }
}
