import { existsSync } from "node:fs";
import { join } from "node:path";
import chalk from "chalk";
import { runInherit } from "../tools.js";
import { doctor } from "./doctor.js";

/**
 * `melinna init`: prepara o comando `melinna` para uso e roda o `doctor`.
 *
 * O `npm link` só faz sentido num clone de desenvolvimento; numa instalação
 * global (`npm i -g git+...`) o binário já está no PATH e linkar de novo seria
 * redundante — nesse caso o comando vira só o checklist.
 */
export async function init(root) {
  const isDevClone = existsSync(join(root, ".git"));

  if (isDevClone) {
    console.log(chalk.cyan("Clone de desenvolvimento detectado — linkando `melinna` globalmente (npm link)..."));
    const linkCode = await runInherit("npm", ["link"], { cwd: root });
    if (linkCode !== 0) {
      console.log(chalk.red(`npm link saiu com código ${linkCode}.`));
      process.exitCode = linkCode;
      return;
    }
  } else {
    console.log(chalk.dim("Instalação global detectada — `npm link` não é necessário."));
  }

  console.log("");
  const ok = await doctor(root, process.cwd());
  if (!ok) process.exitCode = 1;
}
