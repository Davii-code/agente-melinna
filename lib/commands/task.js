import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import chalk from "chalk";
import { listSkills, readSkill, readSkillBundle, selectSkills } from "../skills.js";
import { detectStacks } from "../detect.js";
import { compressProject } from "../caveman.js";
import { runInherit, runWithStdin } from "../tools.js";
import { resolveAgent, installHint } from "../agents.js";

const STDIN_INSTRUCTION =
  "Leia a entrada padrão (stdin): ela contém, nesta ordem, uma ou mais skills, " +
  "um snapshot comprimido deste repositório e a descrição da tarefa. Implemente a " +
  "tarefa diretamente neste repositório.";

/**
 * Resolve quais skills usar.
 *
 * Por padrão a escolha é automática: detecta a stack pelos arquivos-marca do
 * projeto e casa com as skills disponíveis, sempre incluindo as de arquitetura e
 * revisão. `--skill` força uma específica; `--no-skill` desliga tudo.
 *
 * @returns {{ skills: Array<object>, evidence: Array<object> }}
 */
function resolveSkills(root, cwd, options) {
  if (options.skill === false) return { skills: [], evidence: [] };

  const available = listSkills(root, cwd);

  if (options.skill) {
    // readSkill valida o nome e dá uma mensagem melhor que a busca crua.
    readSkill(root, options.skill, cwd);
    const wanted = options.skill.replace(/\.md$/i, "").toLowerCase();
    const match = available.find(
      (s) => s.id.toLowerCase() === wanted || s.file.toLowerCase() === options.skill.toLowerCase(),
    );
    return { skills: match ? [match] : [], evidence: [] };
  }

  const { tags, evidence } = detectStacks(cwd);
  return { skills: selectSkills(available, tags), evidence };
}

/**
 * `melinna task <descricao>`: monta o prompt (skills + contexto comprimido + descrição)
 * e executa de verdade (não interativo) para implementar a tarefa, validando em
 * seguida com `npm test` quando existir. Escolhe o agente por autodetecção
 * (ver lib/agents.js) ou via `--agent`; sem nenhum agente no PATH, cai de volta
 * para apenas imprimir o prompt (como `quick-task`).
 */
export async function task(root, cwd, description, options) {
  let selected;
  try {
    selected = resolveSkills(root, cwd, options);
  } catch (err) {
    console.log(chalk.red(err.message));
    process.exitCode = 1;
    return;
  }

  const { skills, evidence } = selected;
  if (evidence.length > 0) {
    console.log(chalk.dim(`Stack detectada: ${evidence.map((e) => e.tag).join(", ")}`));
  }
  if (skills.length > 0) {
    console.log(chalk.cyan(`Skills: ${skills.map((s) => s.id).join(", ")}`));
  } else if (options.skill !== false) {
    console.log(chalk.yellow("Nenhuma skill casou com este projeto — seguindo sem skill."));
    console.log(chalk.dim("Instale mais com `melinna skills install`."));
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

  const skillBlocks = skills.map((s) => readSkillBundle(s).trim()).filter(Boolean);
  const prompt = [...skillBlocks, compressed.trim(), `Tarefa: ${description.trim()}`]
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
