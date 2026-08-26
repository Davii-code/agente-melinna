import { execFile } from "node:child_process";
import { promisify } from "node:util";
import chalk from "chalk";
import { listSkills, readSkillBundle, selectSkills } from "../skills.js";
import { detectStacks, summarizeStacks } from "../detect.js";
import { resolveProfile } from "../config.js";
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

  // A revisão sempre carrega as skills de review e arquitetura (que valem em
  // qualquer linguagem) mais as que casam com a stack detectada — assim um
  // projeto Java é revisado com as regras de Java sem o usuário pedir.
  let profile;
  try {
    profile = resolveProfile(options.economy);
  } catch (err) {
    console.log(chalk.red(err.message));
    process.exitCode = 1;
    return;
  }

  const { tags, evidence } = detectStacks(cwd);
  const skills = selectSkills(
    listSkills(root, cwd),
    [...tags, "review", "architecture"],
    profile.skillLimit ? { limit: profile.skillLimit } : {},
  );
  if (evidence.length > 0) {
    console.log(chalk.dim(`Stack detectada: ${summarizeStacks(evidence)}`));
  }
  if (profile.name !== "full") {
    console.log(chalk.dim(`Economia: ${profile.name} (${profile.label}) — via ${profile.source}`));
  }
  if (skills.length > 0) {
    console.log(chalk.cyan(`Skills: ${skills.map((s) => s.id).join(", ")}`));
  } else {
    console.log(chalk.yellow("Nenhuma skill de review encontrada — revisando sem skill."));
    console.log(chalk.dim("Instale as padrão com `melinna skills install`."));
  }

  const prompt = [
    ...skills.map((s) => readSkillBundle(s, { includeReferences: profile.includeReferences }).trim()),
    "Diff a revisar:\n\n```diff\n" + diff + "\n```",
  ]
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

  // Modo `read`: somente leitura, para a revisão não alterar arquivos
  // (as flags exatas variam por agente — ver lib/agents.js).
  console.log(chalk.cyan(`Executando \`${agent.name}\` para revisar o diff...`));
  const code = await runWithStdin(agent.name, agent.spec.read(STDIN_INSTRUCTION), prompt, { cwd });
  if (code !== 0) {
    console.log(chalk.red(`${agent.name} saiu com código ${code}.`));
    process.exitCode = code;
  }
}
