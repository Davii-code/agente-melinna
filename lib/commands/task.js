import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import chalk from "chalk";
import { select } from "@inquirer/prompts";
import { listSkills, readSkill } from "../skills.js";
import { compressProject } from "../caveman.js";
import { isOnPath, runInherit, runWithStdin } from "../tools.js";

const STDIN_INSTRUCTION =
  "Leia a entrada padrão (stdin): ela contém, nesta ordem, uma skill (opcional), " +
  "um snapshot comprimido deste repositório e a descrição da tarefa. Implemente a " +
  "tarefa diretamente neste repositório.";

/**
 * `melinna task <descricao>`: monta o prompt (skill + contexto comprimido + descrição)
 * e, se o binário `caveman` estiver disponível, executa-o de verdade (não interativo)
 * para implementar a tarefa, validando em seguida com `npm test` quando existir.
 * Sem `caveman` no PATH, cai de volta para apenas imprimir o prompt (como `quick-task`).
 */
export async function task(root, cwd, description, options) {
  let skillName = options.skill;
  if (!skillName) {
    const available = listSkills(root);
    if (available.length > 0) {
      skillName = await select({
        message: "Selecione a skill a usar (opcional):",
        choices: [
          { name: chalk.dim("(nenhuma)"), value: null },
          ...available.map((s) => ({ name: `${s.name}  ${chalk.dim(`(${s.dir})`)}`, value: s.name })),
        ],
      });
    }
  }

  let skillContent = "";
  if (skillName) {
    try {
      skillContent = readSkill(root, skillName);
    } catch (err) {
      console.log(chalk.red(err.message));
      process.exitCode = 1;
      return;
    }
  }

  console.log(chalk.cyan("Comprimindo diretório atual com caveman-code..."));
  let compressed;
  try {
    compressed = await compressProject(cwd, { tokenBudget: 2048 });
  } catch (err) {
    console.log(chalk.red(`Falha na compressão de contexto: ${err.message}`));
    process.exitCode = 1;
    return;
  }

  const prompt = [skillContent.trim(), compressed.trim(), `Tarefa: ${description.trim()}`]
    .filter(Boolean)
    .join("\n\n---\n\n");

  const hasCaveman = await isOnPath("caveman");
  if (!hasCaveman) {
    console.log(chalk.yellow("Binário `caveman` não encontrado no PATH — imprimindo o prompt para colar manualmente."));
    console.log(chalk.dim("Instale com: npm install -g @juliusbrussee/caveman-code"));
    console.log("");
    console.log(prompt);
    return;
  }

  console.log(chalk.cyan("Executando `caveman` para implementar a tarefa..."));
  const implementCode = await runWithStdin("caveman", ["-p", STDIN_INSTRUCTION], prompt, { cwd });
  if (implementCode !== 0) {
    console.log(chalk.red(`caveman saiu com código ${implementCode}.`));
    process.exitCode = implementCode;
    return;
  }

  console.log("");
  console.log(chalk.cyan("Validando: procurando script de teste em package.json..."));
  const pkgPath = join(cwd, "package.json");
  if (!existsSync(pkgPath)) {
    console.log(chalk.yellow("Nenhum package.json encontrado — pulando validação automática."));
    console.log(chalk.green("✔ Task implementada."));
    return;
  }

  const pkg = JSON.parse(await readFile(pkgPath, "utf-8"));
  const hasRealTestScript =
    pkg.scripts?.test && !/^echo .*no test specified.* && exit 1$/.test(pkg.scripts.test.trim());
  if (!hasRealTestScript) {
    console.log(chalk.yellow("Nenhum script de teste configurado — pulando validação automática."));
    console.log(chalk.green("✔ Task implementada."));
    return;
  }

  console.log(chalk.cyan("Rodando `npm test`..."));
  const testCode = await runInherit("npm", ["test"], { cwd });
  if (testCode !== 0) {
    console.log(chalk.red("Testes falharam após a implementação — revise as mudanças."));
    process.exitCode = testCode;
    return;
  }
  console.log(chalk.green("✔ Task implementada e validada (testes passaram)."));
}
