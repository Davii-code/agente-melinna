import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import chalk from "chalk";
import { runInherit } from "../tools.js";
import { resolveRegistryDir } from "../paths.js";
import { REGISTRY, alwaysOnEntries, entriesForTags, findEntry } from "../registry.js";
import { listSkills, selectSkills } from "../skills.js";
import { detectStacks, describeEvidence, summarizeStacks } from "../detect.js";

/** Clona uma entrada do registry, pulando o que já existe. */
async function cloneEntry(entry, registryDir, options) {
  const dest = join(registryDir, entry.dir);
  if (existsSync(dest)) {
    console.log(`  ${chalk.yellow("○")} ${entry.name} já instalada — pulando.`);
    return true;
  }

  console.log(`  ${chalk.cyan("↓")} ${entry.name} ${chalk.dim(entry.url)}`);
  const args = ["clone", "--quiet"];
  if (!options.full) args.push("--depth", "1");
  // Repositórios grandes (ex: anthropics/claude-code) só interessam por uma
  // subárvore; sem os blobs o clone cai de centenas de MB para poucos.
  if (entry.subdir && !options.full) args.push("--filter=blob:none");
  args.push(entry.url, dest);

  const code = await runInherit("git", args);
  if (code !== 0) {
    console.log(`  ${chalk.red("✘")} falha ao clonar ${entry.name} (código ${code}).`);
    return false;
  }
  return true;
}

/**
 * `melinna skills install [nomes...]`: clona repositórios de skills de terceiros
 * em ~/.melinna/skills. Sem argumentos, instala as skills sempre-ativas
 * (arquitetura e revisão) mais as que casam com a stack detectada no diretório
 * atual — é o caminho que dispensa o usuário de escolher.
 */
export async function skillsInstall(cwd, names, options = {}) {
  const registryDir = resolveRegistryDir();
  await mkdir(registryDir, { recursive: true });
  console.log(chalk.dim(`Diretório de skills: ${registryDir}`));

  let entries;
  if (options.all) {
    entries = REGISTRY;
    console.log(chalk.cyan("Instalando todos os repositórios do registry..."));
  } else if (names.length > 0) {
    entries = [];
    for (const name of names) {
      const entry = findEntry(name);
      if (!entry) {
        console.log(chalk.red(`Repositório "${name}" não existe no registry.`));
        console.log(chalk.dim(`Disponíveis: ${REGISTRY.map((e) => e.name).join(", ")}`));
        process.exitCode = 1;
        return;
      }
      entries.push(entry);
    }
  } else {
    const { tags, evidence } = detectStacks(cwd);
    if (evidence.length > 0) {
      console.log(chalk.cyan(`Stack detectada: ${describeEvidence(evidence)}`));
    } else {
      console.log(chalk.yellow("Nenhuma stack detectada aqui — instalando só arquitetura e revisão."));
    }
    entries = [...alwaysOnEntries(), ...entriesForTags(tags)];
  }

  let failed = 0;
  for (const entry of entries) {
    if (!(await cloneEntry(entry, registryDir, options))) failed += 1;
  }

  console.log("");
  if (failed > 0) {
    console.log(chalk.red(`✘ ${failed} repositório(s) falharam.`));
    process.exitCode = 1;
    return;
  }
  console.log(chalk.green(`✔ ${entries.length} repositório(s) prontos.`));
  console.log(chalk.dim("Veja o que ficou disponível com `melinna skills list`."));
}

/** `melinna skills update`: git pull em cada repositório de skills instalado. */
export async function skillsUpdate() {
  const registryDir = resolveRegistryDir();
  if (!existsSync(registryDir)) {
    console.log(chalk.yellow("Nenhuma skill instalada ainda — rode `melinna skills install`."));
    return;
  }

  let updated = 0;
  for (const entry of REGISTRY) {
    const dest = join(registryDir, entry.dir);
    if (!existsSync(dest)) continue;
    console.log(chalk.cyan(`Atualizando ${entry.name}...`));
    const code = await runInherit("git", ["pull", "--ff-only", "--quiet", "origin", "HEAD"], { cwd: dest });
    if (code !== 0) {
      console.log(chalk.red(`  git pull em ${entry.name} saiu com código ${code}.`));
      process.exitCode = code;
    } else {
      updated += 1;
    }
  }

  console.log("");
  console.log(chalk.green(`✔ ${updated} repositório(s) atualizados.`));
}

/**
 * `melinna skills list`: mostra as skills visíveis. Com --detect, mostra também
 * quais seriam escolhidas automaticamente para o diretório atual.
 */
export function skillsList(root, cwd, options = {}) {
  const skills = listSkills(root, cwd);

  if (skills.length === 0) {
    console.log(chalk.yellow("Nenhuma skill encontrada."));
    console.log(chalk.dim("Rode `melinna skills install` para baixar as do registry."));
    return;
  }

  const bySource = new Map();
  for (const skill of skills) {
    if (!bySource.has(skill.source)) bySource.set(skill.source, []);
    bySource.get(skill.source).push(skill);
  }

  for (const [source, group] of bySource) {
    console.log(chalk.bold(`\n${source} ${chalk.dim(`(${group.length})`)}`));
    for (const skill of group) {
      const summary = skill.description.split(/(?<=\.)\s/)[0] ?? "";
      const trimmed = summary.length > 96 ? `${summary.slice(0, 93)}...` : summary;
      console.log(`  ${skill.id}${trimmed ? chalk.dim(` — ${trimmed}`) : ""}`);
    }
  }

  if (options.detect) {
    const { tags, evidence, modules } = detectStacks(cwd);
    console.log(chalk.bold("\nAutodetecção neste diretório"));
    console.log(
      evidence.length > 0
        ? chalk.dim(`  stack: ${summarizeStacks(evidence)}`)
        : chalk.dim("  nenhuma stack reconhecida"),
    );
    if (modules.length > 0) {
      console.log(chalk.dim(`  módulos: ${modules.map((m) => `${m.path}/`).join(", ")}`));
    }
    const chosen = selectSkills(skills, tags);
    if (chosen.length === 0) {
      console.log(chalk.yellow("  nenhuma skill casou — `melinna task` vai rodar sem skill."));
    } else {
      for (const skill of chosen) console.log(`  ${chalk.green("✔")} ${skill.id} ${chalk.dim(`(${skill.source})`)}`);
    }
  }

  console.log("");
}

/** `melinna skills registry`: lista o catálogo, marcando o que já está instalado. */
export function skillsRegistry() {
  const registryDir = resolveRegistryDir();
  console.log(chalk.dim(`Diretório de skills: ${registryDir}\n`));

  for (const entry of REGISTRY) {
    const installed = existsSync(join(registryDir, entry.dir));
    const mark = installed ? chalk.green("✔") : chalk.yellow("○");
    const flag = entry.always ? chalk.magenta(" [sempre]") : "";
    console.log(`${mark} ${chalk.bold(entry.name)}${flag} ${chalk.dim(`~${entry.skills} skills`)}`);
    console.log(`   ${entry.description}`);
    console.log(chalk.dim(`   tags: ${entry.tags.join(", ")}  |  ${entry.url}`));
  }

  console.log(chalk.dim("\nInstale com `melinna skills install <nome>`, ou sem argumentos para autodetectar."));
}
