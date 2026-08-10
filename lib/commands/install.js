import { existsSync } from "node:fs";
import { join } from "node:path";
import chalk from "chalk";
import { runInherit } from "../tools.js";

const REPOS = [
  { dir: "caveman-code", url: "https://github.com/JuliusBrussee/caveman-code" },
  { dir: "spec-kit", url: "https://github.com/github/spec-kit" },
];

/**
 * `melinna install`: automatiza a seção "Instalação" do README — instala as
 * dependências npm da própria Melinna e clona caveman-code/spec-kit em tools/
 * (pulando o que já existir).
 */
export async function install(root) {
  console.log(chalk.cyan("Instalando dependências da Melinna (npm install)..."));
  const npmCode = await runInherit("npm", ["install"], { cwd: root });
  if (npmCode !== 0) {
    console.log(chalk.red(`npm install saiu com código ${npmCode}.`));
    process.exitCode = npmCode;
    return;
  }

  for (const repo of REPOS) {
    const dest = join(root, "tools", repo.dir);
    if (existsSync(dest)) {
      console.log(chalk.yellow(`tools/${repo.dir} já existe — pulando clone.`));
      continue;
    }
    console.log(chalk.cyan(`Clonando ${repo.url} em tools/${repo.dir}...`));
    const code = await runInherit("git", ["clone", repo.url, dest], { cwd: root });
    if (code !== 0) {
      console.log(chalk.red(`git clone de ${repo.dir} saiu com código ${code}.`));
      process.exitCode = code;
      return;
    }
  }

  console.log("");
  console.log(chalk.green("✔ Instalação concluída."));
  console.log(
    `Rode ${chalk.bold("melinna init")} em seguida para linkar o comando globalmente e checar dependências opcionais (caveman, specify).`,
  );
}
