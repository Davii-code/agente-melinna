import { existsSync } from "node:fs";
import { join } from "node:path";
import chalk from "chalk";
import { runInherit } from "../tools.js";
import { resolveToolsDir } from "../paths.js";

const REPO_DIRS = ["caveman-code", "spec-kit"];

/**
 * `melinna upgrade`: atualiza os clones de terceiros (git pull --ff-only) e,
 * num clone de desenvolvimento, as dependências npm da própria Melinna.
 */
export async function upgrade(root) {
  const toolsDir = resolveToolsDir(root);
  console.log(chalk.dim(`Diretório de ferramentas: ${toolsDir}`));

  for (const dir of REPO_DIRS) {
    const dest = join(toolsDir, dir);
    if (!existsSync(dest)) {
      console.log(chalk.yellow(`${dir} não encontrado — pulando (rode \`melinna install\` primeiro).`));
      continue;
    }
    console.log(chalk.cyan(`Atualizando ${dir} (git pull)...`));
    const code = await runInherit("git", ["pull", "--ff-only"], { cwd: dest });
    if (code !== 0) {
      console.log(chalk.red(`git pull em ${dir} saiu com código ${code}.`));
      process.exitCode = code;
    }
  }

  if (existsSync(join(root, ".git"))) {
    console.log(chalk.cyan("Atualizando dependências da Melinna (npm install)..."));
    const npmCode = await runInherit("npm", ["install"], { cwd: root });
    if (npmCode !== 0) {
      console.log(chalk.red(`npm install saiu com código ${npmCode}.`));
      process.exitCode = npmCode;
      return;
    }
  } else {
    console.log(
      chalk.dim("Instalação global — atualize a Melinna com: npm install -g git+https://github.com/Davii-code/agente-melinna.git"),
    );
  }

  console.log("");
  console.log(chalk.green("✔ Upgrade concluído."));
}
