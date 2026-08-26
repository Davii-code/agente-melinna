import chalk from "chalk";
import { select } from "@inquirer/prompts";
import { PROFILES, configPath, savedEconomy, writeConfig, resolveProfile } from "../config.js";

/**
 * `melinna config economy [nivel]`: escolhe o perfil de economia de token.
 *
 * Sem `nivel`, pergunta interativamente. A escolha fica em `~/.melinna/config.json`
 * e vale para todos os comandos e também dentro do agente, via MCP — onde não há
 * linha de comando para passar flag.
 */
export async function configEconomy(level) {
  let chosen = level;

  if (!chosen) {
    const current = savedEconomy();
    chosen = await select({
      message: "Quanto token você quer gastar por tarefa?",
      default: current,
      choices: Object.entries(PROFILES).map(([name, profile]) => ({
        name: `${name} (${profile.label})${name === current ? chalk.dim(" — atual") : ""}`,
        value: name,
        description: profile.description,
      })),
    });
  }

  if (!PROFILES[chosen]) {
    console.log(chalk.red(`Perfil "${chosen}" não existe.`));
    console.log(chalk.dim(`Use um de: ${Object.keys(PROFILES).join(", ")}`));
    process.exitCode = 1;
    return;
  }

  writeConfig({ economy: chosen });
  const profile = PROFILES[chosen];

  console.log("");
  console.log(`${chalk.green("✔")} Economia: ${chalk.bold(chosen)} (${profile.label})`);
  console.log(chalk.dim(`  ${profile.description}`));
  console.log("");
  console.log(chalk.dim(`  skills            ${profile.skillLimit ?? "sem limite extra"}`));
  console.log(chalk.dim(`  referências       ${profile.includeReferences ? "incluídas" : "omitidas"}`));
  console.log(chalk.dim(`  mapa do projeto   ${profile.tokenBudget} tokens`));
  console.log(chalk.dim(`  compressão extra  ${profile.compressMap ? "sim (caveman-code)" : "não"}`));
  console.log("");
  console.log(chalk.dim(`Salvo em ${configPath()}`));
  console.log(chalk.dim("Sobrescreva pontualmente com `--economy <nivel>`."));
  console.log(chalk.dim("Se você usa a Melinna via MCP, reinicie o agente para recarregar a preferência."));
}

/** `melinna config show`: mostra a configuração em vigor e de onde ela veio. */
export function configShow() {
  const profile = resolveProfile();

  console.log(chalk.bold("Configuração da Melinna"));
  console.log(chalk.dim(`  ${configPath()}`));
  console.log("");
  console.log(`  economia: ${chalk.bold(profile.name)} (${profile.label}) ${chalk.dim(`— via ${profile.source}`)}`);
  console.log(chalk.dim(`  ${profile.description}`));
  console.log("");

  console.log(chalk.bold("Perfis disponíveis"));
  for (const [name, item] of Object.entries(PROFILES)) {
    const mark = name === profile.name ? chalk.green("✔") : " ";
    console.log(`  ${mark} ${chalk.bold(name.padEnd(6))} ${item.description}`);
  }
  console.log("");
  console.log(chalk.dim("Mude com `melinna config economy <nivel>` (ou sem o nível, para escolher na lista)."));
}
