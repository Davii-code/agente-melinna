import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import chalk from "chalk";
import { runInherit } from "../tools.js";
import { resolveToolsDir } from "../paths.js";

const REPOS = [
  { dir: "caveman-code", url: "https://github.com/JuliusBrussee/caveman-code" },
  { dir: "spec-kit", url: "https://github.com/github/spec-kit" },
];

/**
 * `melinna install`: prepara o ambiente — instala as dependências npm da própria
 * Melinna (só quando rodando de um clone de desenvolvimento, que tem package.json
 * e node_modules próprios) e clona caveman-code/spec-kit no diretório de tools
 * resolvido (ver lib/paths.js), pulando o que já existir.
 */
export async function install(root, options = {}) {
  const toolsDir = resolveToolsDir(root);

  // Numa instalação global o npm já instalou as dependências junto com o pacote;
  // rodar `npm install` dentro do node_modules global não faz sentido.
  const isDevClone = existsSync(join(root, ".git"));
  if (isDevClone) {
    console.log(chalk.cyan("Instalando dependências da Melinna (npm install)..."));
    const npmCode = await runInherit("npm", ["install"], { cwd: root });
    if (npmCode !== 0) {
      console.log(chalk.red(`npm install saiu com código ${npmCode}.`));
      process.exitCode = npmCode;
      return;
    }
  }

  console.log(chalk.dim(`Diretório de ferramentas: ${toolsDir}`));
  await mkdir(toolsDir, { recursive: true });

  for (const repo of REPOS) {
    const dest = join(toolsDir, repo.dir);
    if (existsSync(dest)) {
      console.log(chalk.yellow(`${repo.dir} já existe — pulando clone.`));
      continue;
    }
    console.log(chalk.cyan(`Clonando ${repo.url}...`));
    const args = ["clone"];
    if (!options.full) args.push("--depth", "1");
    args.push(repo.url, dest);
    const code = await runInherit("git", args);
    if (code !== 0) {
      console.log(chalk.red(`git clone de ${repo.dir} saiu com código ${code}.`));
      process.exitCode = code;
      return;
    }
  }

  console.log("");
  console.log(chalk.green("✔ Instalação concluída."));
  console.log(`Rode ${chalk.bold("melinna doctor")} para conferir quais agentes de IA estão disponíveis.`);
}
