import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import chalk from "chalk";
import { input, checkbox, confirm } from "@inquirer/prompts";
import { listSkills, readSkillBundle, selectSkills } from "../skills.js";
import { detectStacks } from "../detect.js";
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

  const available = listSkills(root, cwd);
  let selectedSkills = [];
  if (available.length > 0) {
    // A detecção de stack pré-marca as skills relevantes; o checkbox continua
    // aqui porque `start-feature` é o fluxo deliberado, onde revisar a escolha
    // faz sentido (ao contrário da `task`, que é one-shot).
    const { tags, evidence } = detectStacks(cwd);
    const suggested = new Set(selectSkills(available, tags).map((s) => s.id));
    if (evidence.length > 0) {
      console.log(chalk.dim(`Stack detectada: ${evidence.map((e) => e.tag).join(", ")}`));
    }
    selectedSkills = await checkbox({
      message: "Skills a carregar (as sugeridas já vêm marcadas):",
      choices: available.map((s) => ({
        name: `${s.id}  ${chalk.dim(`(${s.source})`)}`,
        value: s,
        checked: suggested.has(s.id),
      })),
    });
  } else {
    console.log(chalk.yellow("Nenhuma skill encontrada — rode `melinna skills install`. Seguindo sem skills."));
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
      constitution += `\n---\n\n### ${skill.id}\n\n${readSkillBundle(skill)}\n`;
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
