import { execFile } from "node:child_process";
import { promisify } from "node:util";
import chalk from "chalk";
import { readSkill } from "../skills.js";
import { isOnPath, runWithStdin } from "../tools.js";

const execFileAsync = promisify(execFile);

const STDIN_INSTRUCTION =
  "Leia a entrada padrão (stdin): ela contém a skill de code review e o diff a revisar. " +
  "Aplique a skill e responda com os achados, sem alterar arquivos.";

async function getDiff(cwd) {
  let staged;
  let unstaged;
  try {
    staged = (await execFileAsync("git", ["diff", "--cached"], { cwd, maxBuffer: 1024 * 1024 * 16 })).stdout;
    unstaged = (await execFileAsync("git", ["diff"], { cwd, maxBuffer: 1024 * 1024 * 16 })).stdout;
  } catch {
    throw new Error("Não foi possível obter o diff do git — este diretório é um repositório git?");
  }
  return [staged, unstaged].filter(Boolean).join("\n").trim();
}

/**
 * `melinna review`: revisa as mudanças pendentes (staged + unstaged) do repositório
 * atual usando a skill skills/custom/code-review.md. Se `caveman` estiver no PATH,
 * executa a revisão de verdade; senão, imprime o prompt para colar manualmente.
 */
export async function review(root, cwd) {
  let diff;
  try {
    diff = await getDiff(cwd);
  } catch (err) {
    console.log(chalk.red(err.message));
    process.exitCode = 1;
    return;
  }

  if (!diff) {
    console.log(chalk.yellow("Nenhuma mudança pendente (staged ou unstaged) encontrada para revisar."));
    return;
  }

  let skillContent;
  try {
    skillContent = readSkill(root, "code-review.md");
  } catch (err) {
    console.log(chalk.red(err.message));
    process.exitCode = 1;
    return;
  }

  const prompt = [skillContent.trim(), "Diff a revisar:\n\n```diff\n" + diff + "\n```"].join("\n\n---\n\n");

  const hasCaveman = await isOnPath("caveman");
  if (!hasCaveman) {
    console.log(chalk.yellow("Binário `caveman` não encontrado no PATH — imprimindo o prompt para colar manualmente."));
    console.log(chalk.dim("Instale com: npm install -g @juliusbrussee/caveman-code"));
    console.log("");
    console.log(prompt);
    return;
  }

  console.log(chalk.cyan("Executando `caveman` para revisar o diff..."));
  const code = await runWithStdin("caveman", ["-p", STDIN_INSTRUCTION], prompt, { cwd });
  if (code !== 0) {
    console.log(chalk.red(`caveman saiu com código ${code}.`));
    process.exitCode = code;
  }
}
