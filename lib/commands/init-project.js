import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import chalk from "chalk";
import { detectStacks } from "../detect.js";

const MEMORY_TEMPLATE = `# Contexto do Projeto

<!--
Carregado por \`melinna explain-project\` como memória persistente sobre ESTE
repositório. Versione este arquivo junto com o código: ele é do projeto, não da
Melinna. Registre aqui só o que não dá para derivar lendo o código.
-->

## Visão geral

(Propósito do projeto, domínio e principais stakeholders.)

## Decisões arquiteturais

(Decisões importantes e o porquê — não o que já é óbvio no código.)

## Convenções

(Padrões de código, nomenclatura e estrutura de pastas específicos deste projeto.)

## Restrições

(Limites técnicos, de negócio ou de prazo que orientam as escolhas.)
`;

const SKILLS_README = `# Skills deste projeto

Arquivos \`.md\` aqui, ou diretórios no formato \`<nome>/SKILL.md\`, viram skills
visíveis só neste repositório — e têm precedência sobre as skills do usuário e as
do registry, então dá para sobrescrever uma skill genérica pela versão do projeto
sem renomear nada.

Liste o que está valendo com:

    melinna skills list --detect
`;

/**
 * `melinna init-project`: cria a estrutura `.melinna/` no repositório atual —
 * memória do projeto e diretório de skills próprias — e mostra a stack detectada.
 */
export async function initProject(cwd) {
  const base = join(cwd, ".melinna");
  const memoryDir = join(base, "memory");
  const skillsDir = join(base, "skills");

  await mkdir(memoryDir, { recursive: true });
  await mkdir(skillsDir, { recursive: true });

  const memoryFile = join(memoryDir, "project-context.md");
  if (existsSync(memoryFile)) {
    console.log(chalk.yellow(".melinna/memory/project-context.md já existe — mantido."));
  } else {
    await writeFile(memoryFile, MEMORY_TEMPLATE, "utf-8");
    console.log(`${chalk.green("✔")} .melinna/memory/project-context.md`);
  }

  const skillsReadme = join(skillsDir, "README.md");
  if (!existsSync(skillsReadme)) {
    await writeFile(skillsReadme, SKILLS_README, "utf-8");
    console.log(`${chalk.green("✔")} .melinna/skills/README.md`);
  }

  console.log("");
  const { evidence, modules } = detectStacks(cwd);
  if (evidence.length > 0) {
    console.log(chalk.bold("Stack detectada"));
    for (const e of evidence) {
      const onde = e.where === "." ? e.reason : `${e.reason} em ${e.where}/`;
      console.log(`  ${chalk.green("✔")} ${e.tag} ${chalk.dim(`(${onde})`)}`);
    }
    if (modules.length > 0) {
      console.log("");
      console.log(chalk.dim(`Monorepo: ${modules.length} módulo(s) — ${modules.map((m) => `${m.path}/`).join(", ")}`));
    }
    console.log("");
    console.log(chalk.dim("Baixe as skills correspondentes com `melinna skills install`."));
  } else {
    console.log(chalk.yellow("Nenhuma stack reconhecida neste diretório."));
    console.log(chalk.dim("`melinna task` ainda funciona, só sem skill específica de linguagem."));
  }
}
