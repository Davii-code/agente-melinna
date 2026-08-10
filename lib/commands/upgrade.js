import { existsSync } from "node:fs";
import { join } from "node:path";
import chalk from "chalk";
import { runInherit } from "../tools.js";

const REPO_DIRS = ["caveman-code", "spec-kit"];

/**
 * `melinna upgrade`: atualiza os clones em tools/ (git pull --ff-only) e
 * as dependências npm da própria Melinna.
 */
export async function upgrade(root) {
  for (const dir of REPO_DIRS) {
    const dest = join(root, "tools", dir);
    if (!existsSync(dest)) {
      console.log(chalk.yellow(`tools/${dir} não encontrado — pulando (rode \`melinna install\` primeiro).`));
      continue;
    }
    console.log(chalk.cyan(`Atualizando tools/${dir} (git pull)...`));
    const code = await runInherit("git", ["pull", "--ff-only"], { cwd: dest });
    if (code !== 0) {
      console.log(chalk.red(`git pull em tools/${dir} saiu com código ${code}.`));
      process.exitCode = code;
    }
  }

  console.log(chalk.cyan("Atualizando dependências da Melinna (npm install)..."));
  const npmCode = await runInherit("npm", ["install"], { cwd: root });
  if (npmCode !== 0) {
    console.log(chalk.red(`npm install saiu com código ${npmCode}.`));
    process.exitCode = npmCode;
    return;
  }

  console.log("");
  console.log(chalk.green("✔ Upgrade concluído."));
}
