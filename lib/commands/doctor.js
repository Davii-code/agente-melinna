import { existsSync } from "node:fs";
import { join } from "node:path";
import chalk from "chalk";
import { isOnPath } from "../tools.js";
import { AGENTS, AGENT_PRIORITY } from "../agents.js";
import { resolveToolsDir } from "../paths.js";

/**
 * `melinna doctor`: checa tudo que os comandos da Melinna dependem — o git, os
 * clones de terceiros, a CLI do spec-kit e os agentes de IA suportados.
 * @returns {Promise<boolean>} true se o ambiente está utilizável
 */
export async function doctor(root) {
  let ok = true;

  console.log(chalk.bold("Ferramentas base"));
  const hasGit = await isOnPath("git");
  console.log(
    hasGit
      ? `  ${chalk.green("✔")} git`
      : `  ${chalk.red("✘")} git — necessário para \`melinna install\`/\`upgrade\``,
  );
  if (!hasGit) ok = false;

  const hasSpecify = await isOnPath("specify");
  console.log(
    hasSpecify
      ? `  ${chalk.green("✔")} specify`
      : `  ${chalk.yellow("○")} specify não encontrado — necessário para \`melinna speckit\` (uv tool install specify-cli)`,
  );

  console.log("");
  console.log(chalk.bold("Clones de terceiros"));
  const toolsDir = resolveToolsDir(root);
  console.log(chalk.dim(`  ${toolsDir}`));
  let missingClone = false;
  for (const dir of ["caveman-code", "spec-kit"]) {
    const found = existsSync(join(toolsDir, dir));
    console.log(found ? `  ${chalk.green("✔")} ${dir}` : `  ${chalk.red("✘")} ${dir} — rode \`melinna install\``);
    if (!found) missingClone = true;
  }
  if (missingClone) ok = false;

  console.log("");
  console.log(chalk.bold("Agentes de IA (para `task` e `review`)"));
  const available = [];
  for (const name of AGENT_PRIORITY) {
    const spec = AGENTS[name];
    if (await isOnPath(name)) {
      console.log(`  ${chalk.green("✔")} ${name} ${chalk.dim(`(${spec.label})`)}`);
      available.push(name);
    } else {
      console.log(`  ${chalk.yellow("○")} ${name} ${chalk.dim(`(${spec.label})`)} — ${spec.install}`);
    }
  }

  console.log("");
  if (available.length === 0) {
    console.log(
      chalk.yellow("Nenhum agente de IA encontrado — `melinna task`/`review` vão apenas imprimir o prompt."),
    );
  } else {
    console.log(chalk.dim(`Agente padrão (autodetecção): ${chalk.bold(available[0])}. Use --agent para escolher outro.`));
  }

  if (ok) {
    console.log(chalk.green("✔ Ambiente pronto."));
  } else {
    console.log(chalk.red("✘ Há pendências acima — resolva antes de usar a Melinna."));
  }
  return ok;
}
