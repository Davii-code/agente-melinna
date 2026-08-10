import chalk from "chalk";
import { isOnPath, runInherit } from "../tools.js";

const CHECKS = [
  { bin: "git", required: true, hint: "necessário para `melinna install`/`upgrade` (clonar/atualizar tools/*)" },
  {
    bin: "caveman",
    required: false,
    hint: "necessário para `melinna task`/`review` executarem de verdade — npm install -g @juliusbrussee/caveman-code",
  },
  {
    bin: "specify",
    required: false,
    hint: "necessário para `melinna speckit` — uv tool install specify-cli",
  },
];

/**
 * `melinna init`: linka o comando `melinna` globalmente (npm link) e roda um
 * checklist ("doctor") das dependências opcionais que os outros comandos usam.
 */
export async function init(root) {
  console.log(chalk.cyan("Linkando o comando `melinna` globalmente (npm link)..."));
  const linkCode = await runInherit("npm", ["link"], { cwd: root });
  if (linkCode !== 0) {
    console.log(chalk.red(`npm link saiu com código ${linkCode}.`));
    process.exitCode = linkCode;
    return;
  }

  console.log("");
  console.log(chalk.cyan("Checando dependências..."));
  let missingRequired = false;
  for (const check of CHECKS) {
    const found = await isOnPath(check.bin);
    if (found) {
      console.log(`  ${chalk.green("✔")} ${check.bin}`);
    } else if (check.required) {
      console.log(`  ${chalk.red("✘")} ${check.bin} — ${check.hint}`);
      missingRequired = true;
    } else {
      console.log(`  ${chalk.yellow("○")} ${check.bin} não encontrado — ${check.hint}`);
    }
  }

  console.log("");
  if (missingRequired) {
    console.log(chalk.red("Há dependências obrigatórias faltando — instale-as antes de usar a Melinna."));
    process.exitCode = 1;
    return;
  }
  console.log(chalk.green("✔ Melinna inicializada. O comando `melinna` está disponível globalmente."));
}
