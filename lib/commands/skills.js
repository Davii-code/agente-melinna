import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import chalk from "chalk";
import { runInherit } from "../tools.js";
import { resolveRegistryDir } from "../paths.js";
import {
  REGISTRY,
  allEntries,
  alwaysOnEntries,
  entriesForTags,
  findEntry,
  addCustomEntry,
  removeCustomEntry,
  customEntries,
} from "../registry.js";

import { listSkills, selectSkills, selectionConfidence } from "../skills.js";
import { detectStacks, describeEvidence, summarizeStacks } from "../detect.js";

const execFileAsync = promisify(execFile);

/** Commit em que um repositório instalado está. */
export async function currentCommit(dir) {
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: dir });
    return stdout.trim();
  } catch {
    return null;
  }
}

/** Clona uma entrada do registry, pulando o que já existe. */
async function cloneEntry(entry, registryDir, options) {
  const dest = join(registryDir, entry.dir);
  if (existsSync(dest)) {
    console.log(`  ${chalk.yellow("○")} ${entry.name} já instalada — pulando.`);
    return true;
  }

  console.log(`  ${chalk.cyan("↓")} ${entry.name} ${chalk.dim(entry.url)}`);
  const args = ["clone", "--quiet"];
  // Um pin exige o histórico até aquele commit, então clone raso não serve.
  if (!options.full && !entry.pin) args.push("--depth", "1");
  // Repositórios grandes (ex: anthropics/claude-code) só interessam por uma
  // subárvore; sem os blobs o clone cai de centenas de MB para poucos.
  if (entry.subdir && !options.full) args.push("--filter=blob:none");
  args.push(entry.url, dest);

  const code = await runInherit("git", args);
  if (code !== 0) {
    console.log(`  ${chalk.red("✘")} falha ao clonar ${entry.name} (código ${code}).`);
    return false;
  }

  if (entry.pin) {
    const checkout = await runInherit("git", ["checkout", "--quiet", entry.pin], { cwd: dest });
    if (checkout !== 0) {
      console.log(`  ${chalk.red("✘")} ${entry.name}: commit fixado ${entry.pin.slice(0, 8)} não encontrado.`);
      return false;
    }
    console.log(`     ${chalk.dim(`fixado em ${entry.pin.slice(0, 8)}`)}`);
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
    entries = allEntries();
    console.log(chalk.cyan("Instalando todos os repositórios do registry..."));
  } else if (names.length > 0) {
    entries = [];
    for (const name of names) {
      const entry = findEntry(name);
      if (!entry) {
        console.log(chalk.red(`Repositório "${name}" não existe no registry.`));
        console.log(chalk.dim(`Disponíveis: ${allEntries().map((e) => e.name).join(", ")}`));
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
  let pinned = 0;
  for (const entry of allEntries()) {
    const dest = join(registryDir, entry.dir);
    if (!existsSync(dest)) continue;

    // Um repositório fixado não se move: atualizá-lo traria conteúdo que o
    // usuário não revisou para dentro do prompt do agente.
    if (entry.pin) {
      console.log(`  ${chalk.dim("⊙")} ${entry.name} fixado em ${entry.pin.slice(0, 8)} — não atualizado`);
      pinned += 1;
      continue;
    }

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
  if (pinned > 0) console.log(chalk.dim(`${pinned} fixado(s) em commit, preservados.`));
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
    const confidence = selectionConfidence(chosen, tags);
    if (chosen.length === 0) {
      console.log(chalk.yellow("  nenhuma skill casou — `melinna task` vai rodar sem skill."));
    } else {
      for (const skill of chosen) console.log(`  ${chalk.green("✔")} ${skill.id} ${chalk.dim(`(${skill.source})`)}`);
    }
    if (confidence.level !== "forte") {
      console.log(chalk.yellow(`  ⚠ ${confidence.reason}`));
      console.log(chalk.dim("    Rode `melinna skills install` para baixar as da stack."));
    }
  }

  console.log("");
}

/**
 * `melinna skills add <nome> <url>`: registra um repositório de skills próprio.
 *
 * O catálogo embutido é fixo no código; sem isto, usar um repositório novo
 * exigiria editar a Melinna. O que o usuário adiciona fica na config dele.
 */
export function skillsAdd(name, url, options = {}) {
  let entry;
  try {
    entry = addCustomEntry({
      name,
      url,
      tags: options.tag,
      description: options.description,
      pin: options.pin,
    });
  } catch (err) {
    console.log(chalk.red(err.message));
    process.exitCode = 1;
    return;
  }

  console.log(`${chalk.green("✔")} ${chalk.bold(entry.name)} registrado`);
  console.log(chalk.dim(`  ${entry.url}`));
  console.log(chalk.dim(`  tags: ${entry.tags.join(", ")}`));
  console.log(chalk.dim(`  commit: ${entry.pin ? entry.pin : "segue o branch padrão (sem pin)"}`));
  console.log("");

  // Esse conteúdo vira prompt de agente, às vezes com permissão de escrita.
  // Quem instala precisa saber que está confiando no autor do repositório.
  console.log(chalk.yellow("Skills viram instrução para o agente — instale só o que você confia."));
  console.log(chalk.dim(`Fixe uma versão com: melinna skills pin ${entry.name} <commit>`));
  console.log(chalk.dim(`Instale com: melinna skills install ${entry.name}`));
}

/** `melinna skills remove <nome>`: tira um repositório adicionado pelo usuário. */
export function skillsRemove(name) {
  if (REGISTRY.some((e) => e.name === name)) {
    console.log(chalk.red(`"${name}" faz parte do catálogo embutido e não pode ser removido.`));
    console.log(chalk.dim("Para não usá-lo, basta não instalá-lo."));
    process.exitCode = 1;
    return;
  }
  if (!removeCustomEntry(name)) {
    console.log(chalk.yellow(`"${name}" não está registrado.`));
    return;
  }
  console.log(`${chalk.green("✔")} ${name} removido do catálogo.`);
  console.log(chalk.dim(`O clone em ${join(resolveRegistryDir(), `custom-${name}`)} continua no disco.`));
}

/**
 * `melinna skills pin <nome> [commit]`: fixa um repositório num commit.
 *
 * Um `git pull` traz o que o autor publicou desde ontem, e esse conteúdo entra
 * no prompt do agente sem ninguém revisar. Fixar o commit torna a atualização
 * uma decisão explícita.
 */
export async function skillsPin(name, commit) {
  const entry = findEntry(name);
  if (!entry) {
    console.log(chalk.red(`"${name}" não existe no catálogo.`));
    process.exitCode = 1;
    return;
  }

  const dest = join(resolveRegistryDir(), entry.dir);
  let target = commit;
  if (!target) {
    target = await currentCommit(dest);
    if (!target) {
      console.log(chalk.red(`${name} não está instalado — informe o commit explicitamente.`));
      process.exitCode = 1;
      return;
    }
    console.log(chalk.dim(`Usando o commit instalado: ${target.slice(0, 8)}`));
  }

  if (entry.custom) {
    addCustomEntry({ ...entry, pin: target });
    console.log(`${chalk.green("✔")} ${name} fixado em ${target.slice(0, 8)}`);
    console.log(chalk.dim("`melinna skills update` não vai mais mover este repositório."));
    return;
  }

  // Fixar um repositório do catálogo embutido exigiria alterar o código; para
  // esses o caminho é registrar uma cópia própria com o pin.
  console.log(chalk.yellow(`"${name}" é do catálogo embutido e não guarda pin.`));
  console.log(chalk.dim("Registre uma entrada sua apontando para a mesma URL:"));
  console.log(chalk.dim(`  melinna skills add meu-${name} ${entry.url} --pin ${target.slice(0, 12)}`));
}

/** `melinna skills registry`: lista o catálogo, marcando o que já está instalado. */
export function skillsRegistry() {
  const registryDir = resolveRegistryDir();
  console.log(chalk.dim(`Diretório de skills: ${registryDir}\n`));

  for (const entry of allEntries()) {
    const installed = existsSync(join(registryDir, entry.dir));
    const mark = installed ? chalk.green("✔") : chalk.yellow("○");
    const flag = entry.always ? chalk.magenta(" [sempre]") : "";
    console.log(`${mark} ${chalk.bold(entry.name)}${flag} ${chalk.dim(`~${entry.skills} skills`)}`);
    console.log(`   ${entry.description}`);
    console.log(chalk.dim(`   tags: ${entry.tags.join(", ")}  |  ${entry.url}`));
  }

  console.log(chalk.dim("\nInstale com `melinna skills install <nome>`, ou sem argumentos para autodetectar."));
}
