import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import chalk from "chalk";
import { select } from "@inquirer/prompts";
import { listSkills, readSkill } from "../skills.js";
import { compressProject } from "../caveman.js";
import { runInherit, runWithStdin } from "../tools.js";
import { resolveAgent, installHint } from "../agents.js";

const STDIN_INSTRUCTION =
  "Leia a entrada padrão (stdin): ela contém, nesta ordem, uma skill (opcional), " +
  "um snapshot comprimido deste repositório e a descrição da tarefa. Implemente a " +
  "tarefa diretamente neste repositório.";

/**
 * `melinna task <descricao>`: monta o prompt (skill + contexto comprimido + descrição)
 * e executa de verdade (não interativo) para implementar a tarefa, validando em
 * seguida com `npm test` quando existir. Usa `caveman` se disponível, senão `claude`
 * (Claude Code) — em ambos com stdio herdado, sem `caveman`/`claude` no PATH, cai de
 * volta para apenas imprimir o prompt (como `quick-task`). Use `--agent <bin>` para
 * forçar um agente específico.
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

  const agent = await resolveAgent(options.agent);
  if (!agent) {
    console.log(chalk.yellow("Nenhum agente de IA encontrado no PATH — imprimindo o prompt para colar manualmente."));
    console.log(chalk.dim(`Agentes suportados:\n${installHint()}`));
    console.log("");
    console.log(prompt);
    return;
  }

  // Modo `write`: o agente pode editar arquivos sem confirmação interativa
  // (as flags exatas variam por agente — ver lib/agents.js).
  if (options.yolo) {
    console.log(chalk.yellow("--yolo: o agente vai auto-aprovar tudo, inclusive execução de shell arbitrário."));
  }
  console.log(chalk.cyan(`Executando \`${agent.name}\` para implementar a tarefa...`));
  const agentArgs = agent.spec.write(STDIN_INSTRUCTION, { yolo: options.yolo });
  const implementCode = await runWithStdin(agent.name, agentArgs, prompt, { cwd });
  if (implementCode !== 0) {
    console.log(chalk.red(`${agent.name} saiu com código ${implementCode}.`));
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
