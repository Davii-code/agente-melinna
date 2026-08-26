import chalk from "chalk";
import { listSkills, readSkill, readSkillBundle, selectSkills } from "../skills.js";
import { detectStacks, summarizeStacks } from "../detect.js";
import { resolveProfile } from "../config.js";
import { compressProject } from "../caveman.js";

/**
 * `melinna quick-task <descricao>`: monta e imprime o prompt (skills + contexto
 * comprimido + descrição) sem executar nenhum agente — para colar num chat ou
 * inspecionar o que a `melinna task` mandaria.
 *
 * As skills são escolhidas por autodetecção de stack; `--skill` força uma
 * específica e `--no-skill` desliga.
 */
export async function quickTask(root, cwd, description, options) {
  let profile;
  try {
    profile = resolveProfile(options.economy);
  } catch (err) {
    console.log(chalk.red(err.message));
    process.exitCode = 1;
    return;
  }

  const available = listSkills(root, cwd);
  let skills = [];

  if (options.skill === false) {
    skills = [];
  } else if (options.skill) {
    try {
      readSkill(root, options.skill, cwd);
    } catch (err) {
      console.log(chalk.red(err.message));
      process.exitCode = 1;
      return;
    }
    const wanted = options.skill.replace(/\.md$/i, "").toLowerCase();
    skills = available.filter(
      (s) => s.id.toLowerCase() === wanted || s.file.toLowerCase() === options.skill.toLowerCase(),
    );
  } else {
    const { tags, evidence } = detectStacks(cwd);
    skills = selectSkills(available, tags, profile.skillLimit ? { limit: profile.skillLimit } : {});
    if (evidence.length > 0) {
      console.log(chalk.dim(`Stack detectada: ${summarizeStacks(evidence)}`));
    }
  }
  if (profile.name !== "full") {
    console.log(chalk.dim(`Economia: ${profile.name} (${profile.label}) — via ${profile.source}`));
  }

  if (skills.length > 0) {
    console.log(chalk.cyan(`Skills: ${skills.map((s) => s.id).join(", ")}`));
  } else if (options.skill !== false) {
    console.log(chalk.yellow("Nenhuma skill casou com este projeto — seguindo sem skill."));
  }

  console.log(chalk.cyan("Comprimindo diretório atual com caveman-code..."));
  let compressed;
  try {
    compressed = await compressProject(cwd, {
      tokenBudget: profile.tokenBudget,
      compressRatio: profile.compressMap ? 0.6 : 0,
    });
  } catch (err) {
    console.log(chalk.red(`Falha na compressão de contexto: ${err.message}`));
    process.exitCode = 1;
    return;
  }

  const prompt = [
    ...skills.map((s) => readSkillBundle(s, { includeReferences: profile.includeReferences }).trim()),
    compressed.trim(),
    description.trim(),
  ]
    .filter(Boolean)
    .join("\n\n---\n\n");

  console.log("");
  console.log(prompt);
}
