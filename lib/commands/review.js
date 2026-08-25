import { execFile } from "node:child_process";
import { promisify } from "node:util";
import chalk from "chalk";
import { readSkill } from "../skills.js";
import { runWithStdin } from "../tools.js";
import { resolveAgent, installHint } from "../agents.js";

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
 * atual usando a skill skills/custom/code-review.md. Usa `caveman` se disponível,
 * senão `claude` (Claude Code); sem nenhum dos dois no PATH, imprime o prompt para
 * colar manualmente. Use `--agent <bin>` para forçar um agente específico.
 */
export async function review(root, cwd, options = {}) {
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

  const agent = await resolveAgent(options.agent);
  if (!agent) {
    console.log(chalk.yellow("Nenhum agente de IA encontrado no PATH — imprimindo o prompt para colar manualmente."));
    console.log(chalk.dim(`Agentes suportados:\n${installHint()}`));
    console.log("");
    console.log(prompt);
    return;
  }

  // Modo `read`: somente leitura, para a revisão não alterar arquivos
  // (as flags exatas variam por agente — ver lib/agents.js).
  console.log(chalk.cyan(`Executando \`${agent.name}\` para revisar o diff...`));
  const code = await runWithStdin(agent.name, agent.spec.read(STDIN_INSTRUCTION), prompt, { cwd });
  if (code !== 0) {
    console.log(chalk.red(`${agent.name} saiu com código ${code}.`));
    process.exitCode = code;
  }
}
