import chalk from "chalk";
import { listSkills, readSkillBundle, selectSkills } from "../skills.js";
import { detectStacks, summarizeStacks } from "../detect.js";
import { resolveProfile } from "../config.js";
import { compressProject } from "../caveman.js";
import { runWithStdin } from "../tools.js";
import { resolveAgent, installHint } from "../agents.js";

/**
 * Instrução de análise enviada ao agente.
 *
 * Deliberadamente explicativa em vez de imperativa: o objetivo aqui é entender
 * o código, não mudá-lo. O agente roda em modo somente-leitura (ver `read` em
 * lib/agents.js), então mesmo que a pergunta sugira uma mudança, ele responde
 * com a explicação e o caminho — não com o patch.
 */
const STDIN_INSTRUCTION =
  "Leia a entrada padrão (stdin): ela contém as convenções da stack deste projeto, " +
  "um mapa comprimido do repositório e uma pergunta. Analise o código e RESPONDA a " +
  "pergunta de forma didática, citando arquivos e símbolos concretos. Não altere " +
  "nenhum arquivo. Se a resposta depender de algo que não está no mapa, diga o que " +
  "falta em vez de supor.";

/** Orientação de formato, para a resposta sair navegável em vez de um muro de texto. */
const ANSWER_SHAPE = [
  "Estruture a resposta assim:",
  "",
  "1. **Resposta direta** — duas ou três frases respondendo o que foi perguntado.",
  "2. **Como funciona** — o caminho pelo código, citando `arquivo:linha` quando souber.",
  "3. **Pontos de atenção** — o que surpreende, o que está frágil, o que checar antes de mexer.",
  "",
  "Se a pergunta for aberta (\"me explica o projeto\"), comece pelo propósito e pela",
  "arquitetura antes de descer ao detalhe. Prefira o concreto deste repositório a",
  "generalidades sobre a tecnologia.",
].join("\n");

/**
 * Monta o material de análise: convenções da stack + mapa do repositório + pergunta.
 *
 * Compartilhado entre o CLI e a ferramenta MCP, para os dois caminhos produzirem
 * exatamente o mesmo prompt.
 *
 * @param {string} root raiz do pacote Melinna
 * @param {string} cwd projeto a analisar
 * @param {string} question
 * @param {{ economy?: string, depth?: string }} [options]
 * @returns {Promise<{ prompt: string, skills: Array<object>, evidence: Array<object>, profile: object }>}
 */
export async function buildAnalysis(root, cwd, question, options = {}) {
  const profile = resolveProfile(options.economy);
  const { tags, evidence } = detectStacks(cwd);

  // Uma pergunta ampla ("me explica o projeto") precisa de mais mapa que uma
  // pontual ("o que o AuthFilter faz"), então o orçamento do repomap dobra no
  // modo `--deep`, sem mexer no perfil de economia escolhido.
  const tokenBudget = options.depth === "deep" ? profile.tokenBudget * 2 : profile.tokenBudget;

  const skills = selectSkills(
    listSkills(root, cwd),
    tags,
    profile.skillLimit ? { limit: profile.skillLimit } : {},
  );

  const map = await compressProject(cwd, {
    tokenBudget,
    compressRatio: profile.compressMap ? 0.6 : 0,
  });

  const blocks = [];
  if (skills.length > 0) {
    blocks.push(
      skills
        .map((s) => readSkillBundle(s, { includeReferences: profile.includeReferences }).trim())
        .filter(Boolean)
        .join("\n\n---\n\n"),
    );
  }
  blocks.push(`# Mapa do repositório\n\n${map.trim()}`);
  blocks.push(`# Pergunta\n\n${question.trim()}\n\n${ANSWER_SHAPE}`);

  return { prompt: blocks.join("\n\n---\n\n"), skills, evidence, profile };
}

/**
 * `melinna ask <pergunta>`: analisa o projeto e explica.
 *
 * É o contraponto de leitura da `task`: mesma detecção de stack e mesmo contexto
 * comprimido, mas o agente roda em modo somente-leitura e responde em vez de
 * editar. Serve para entender um repositório antes de mexer nele — o caso em que
 * `task` seria destrutivo e `review` não se aplica (não há diff ainda).
 */
export async function ask(root, cwd, question, options = {}) {
  const trimmed = (question ?? "").trim();
  if (!trimmed) {
    console.log(chalk.red("Informe a pergunta. Ex: melinna ask \"como funciona a autenticação?\""));
    process.exitCode = 1;
    return;
  }

  let analysis;
  try {
    console.log(chalk.cyan("Analisando o projeto..."));
    analysis = await buildAnalysis(root, cwd, trimmed, options);
  } catch (err) {
    console.log(chalk.red(`Falha ao montar a análise: ${err.message}`));
    process.exitCode = 1;
    return;
  }

  const { prompt, skills, evidence, profile } = analysis;
  if (evidence.length > 0) {
    console.log(chalk.dim(`Stack detectada: ${summarizeStacks(evidence)}`));
  }
  if (skills.length > 0) {
    console.log(chalk.dim(`Skills: ${skills.map((s) => s.id).join(", ")}`));
  }
  if (profile.name !== "full") {
    console.log(chalk.dim(`Economia: ${profile.name} (${profile.label}) — via ${profile.source}`));
  }

  const agent = await resolveAgent(options.agent);
  if (!agent) {
    console.log(chalk.yellow("Nenhum agente de IA encontrado no PATH — imprimindo o prompt para colar manualmente."));
    console.log(chalk.dim(`Agentes suportados:\n${installHint()}`));
    console.log("");
    console.log(prompt);
    return;
  }

  // Modo `read`: a análise nunca altera arquivos, por mais que a pergunta
  // sugira uma mudança.
  console.log(chalk.cyan(`Executando \`${agent.name}\` para responder...`));
  console.log("");
  const code = await runWithStdin(agent.name, agent.spec.read(STDIN_INSTRUCTION), prompt, { cwd });
  if (code !== 0) {
    console.log(chalk.red(`${agent.name} saiu com código ${code}.`));
    process.exitCode = code;
  }
}
