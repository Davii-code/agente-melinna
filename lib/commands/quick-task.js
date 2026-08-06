import chalk from "chalk";
import { select } from "@inquirer/prompts";
import { listSkills, readSkill } from "../skills.js";
import { compressProject } from "../caveman.js";

export async function quickTask(root, cwd, description, options) {
  let skillName = options.skill;

  if (!skillName) {
    const available = listSkills(root);
    if (available.length === 0) {
      console.log(chalk.red("Nenhuma skill disponível em skills/custom/ ou skills/external/."));
      process.exitCode = 1;
      return;
    }
    skillName = await select({
      message: "Selecione a skill a usar:",
      choices: available.map((s) => ({ name: `${s.name}  ${chalk.dim(`(${s.dir})`)}`, value: s.name })),
    });
  }

  let skillContent;
  try {
    skillContent = readSkill(root, skillName);
  } catch (err) {
    console.log(chalk.red(err.message));
    process.exitCode = 1;
    return;
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

  const prompt = [
    skillContent.trim(),
    "---",
    compressed.trim(),
    "---",
    description.trim(),
  ].join("\n\n");

  console.log("");
  console.log(prompt);
}
