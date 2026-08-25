import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import chalk from "chalk";
import { input, checkbox, confirm } from "@inquirer/prompts";
import { listSkills, readSkill } from "../skills.js";
import { compressProject } from "../caveman.js";

export async function startFeature(root, cwd) {
  const featureName = await input({
    message: "Nome da feature:",
    validate: (v) => (v.trim().length > 0 ? true : "O nome não pode ser vazio."),
  });
  const featureDescription = await input({
    message: "Descrição da feature:",
    validate: (v) => (v.trim().length > 0 ? true : "A descrição não pode ser vazia."),
  });

  const available = listSkills(root);
  let selectedSkills = [];
  if (available.length > 0) {
    selectedSkills = await checkbox({
      message: "Selecione as skills a carregar (espaço para marcar):",
      choices: available.map((s) => ({ name: `${s.name}  ${chalk.dim(`(${s.dir})`)}`, value: s })),
    });
  } else {
    console.log(chalk.yellow("Nenhuma skill encontrada em skills/custom/ ou skills/external/ — seguindo sem skills."));
  }

  const speckitDir = join(cwd, ".speckit");
  if (existsSync(speckitDir)) {
    const overwrite = await confirm({
      message: `${speckitDir} já existe. Sobrescrever?`,
      default: false,
    });
    if (!overwrite) {
      console.log(chalk.yellow("Operação cancelada."));
      return;
    }
  }
  await mkdir(speckitDir, { recursive: true });

  console.log(chalk.cyan("Comprimindo contexto do projeto com caveman-code..."));
  let compressed;
  try {
    compressed = await compressProject(cwd, { tokenBudget: 4096 });
  } catch (err) {
    console.log(chalk.red(`Falha na compressão de contexto: ${err.message}`));
    console.log(chalk.yellow("Continuando sem caveman-context.md..."));
    compressed = null;
  }

  let constitution = await readFile(
    join(root, ".speckit-templates", "constitution-template.md"),
    "utf-8",
  );

  if (selectedSkills.length > 0) {
    constitution += "\n\n## Skills carregadas\n";
    for (const skill of selectedSkills) {
      const content = readSkill(root, skill.name);
      constitution += `\n---\n\n### ${skill.name}\n\n${content}\n`;
    }
  }

  const contextPath = join(speckitDir, "caveman-context.md");
  if (compressed !== null) {
    await writeFile(contextPath, compressed, "utf-8");
    constitution +=
      "\n\n---\n\n## Contexto do projeto (caveman-code)\n\n" +
      "O arquivo `.speckit/caveman-context.md` contém um snapshot comprimido do código-fonte deste projeto. " +
      "Use-o como contexto de arquitetura ao planejar e implementar esta feature.\n";
  }

  const constitutionPath = join(speckitDir, "constitution.md");
  await writeFile(constitutionPath, constitution, "utf-8");

  const specifyTemplate = await readFile(
    join(root, ".speckit-templates", "specify-template.md"),
    "utf-8",
  );
  const today = new Date().toISOString().slice(0, 10);
  const specify = specifyTemplate
    .replace("[FEATURE NAME]", featureName)
    .replace("[DATE]", today)
    .replace('"$ARGUMENTS"', `"${featureDescription}"`);
  const specifyPath = join(speckitDir, "specify.md");
  await writeFile(specifyPath, specify, "utf-8");

  console.log("");
  console.log(chalk.green("✔ Feature iniciada com sucesso:"));
  console.log(`  ${chalk.bold(featureName)}`);
  console.log("");
  console.log("Arquivos gerados:");
  console.log(`  ${chalk.dim("-")} ${constitutionPath}`);
  console.log(`  ${chalk.dim("-")} ${specifyPath}`);
  if (compressed !== null) {
    console.log(`  ${chalk.dim("-")} ${contextPath}`);
  }
}
