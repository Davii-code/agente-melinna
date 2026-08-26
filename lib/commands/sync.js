import { existsSync } from "node:fs";
import { mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import chalk from "chalk";
import { listSkills, readSkillBundle, selectSkills, stripFrontmatter } from "../skills.js";
import { detectStacks, summarizeStacks } from "../detect.js";

/**
 * `melinna sync`: escreve as skills no formato nativo de cada agente de IA.
 *
 * Complementa o servidor MCP: o MCP dá acesso dinâmico (a autodetecção roda na
 * hora), mas exige um cliente MCP configurado. O sync é estático e funciona em
 * qualquer agente que leia arquivos de skill/regras do disco — inclusive os que
 * não falam MCP.
 *
 * As skills são **copiadas**, não linkadas: symlink no Windows exige modo
 * desenvolvedor ou privilégio de administrador, e falhar silenciosamente na
 * metade seria pior que copiar. `melinna sync` de novo re-escreve tudo.
 */

/** Marca de bloco gerenciado, para reescrever sem apagar o que é do usuário. */
const BEGIN = "<!-- BEGIN MELINNA -->";
const END = "<!-- END MELINNA -->";

/** Alvos de sincronização suportados. */
const TARGETS = {
  claude: {
    label: "Claude Code",
    /** Skills pessoais do Claude Code: ~/.claude/skills/<id>/SKILL.md */
    dir: (cwd, { global }) => (global ? join(homedir(), ".claude", "skills") : join(cwd, ".claude", "skills")),
    write: async (dir, skill) => {
      const target = join(dir, skill.id);
      await mkdir(target, { recursive: true });
      await writeFile(join(target, "SKILL.md"), skillDocument(skill), "utf-8");
    },
  },
  cursor: {
    label: "Cursor",
    /** Regras do Cursor: .cursor/rules/<id>.mdc — sempre no projeto. */
    dir: (cwd) => join(cwd, ".cursor", "rules"),
    write: async (dir, skill) => {
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, `${skill.id}.mdc`), cursorRule(skill), "utf-8");
    },
  },
  agents: {
    label: "AGENTS.md (Codex, Antigravity, Cursor)",
    dir: (cwd) => cwd,
    write: null, // tratado à parte: um arquivo só, com bloco gerenciado
  },
};

/** Frontmatter + corpo, no formato de skill do Claude Code. */
function skillDocument(skill) {
  const description = (skill.description || `Skill ${skill.id}, sincronizada pela Melinna.`)
    .replace(/\n+/g, " ")
    .trim();
  return [
    "---",
    `name: ${skill.id}`,
    `description: ${description}`,
    "---",
    "",
    stripFrontmatter(readSkillBundle(skill)).trim(),
    "",
  ].join("\n");
}

/** Regra do Cursor: frontmatter `.mdc` com `description` e `alwaysApply`. */
function cursorRule(skill) {
  const description = (skill.description || `Skill ${skill.id}`).replace(/\n+/g, " ").trim();
  return [
    "---",
    `description: ${description}`,
    "alwaysApply: false",
    "---",
    "",
    stripFrontmatter(readSkillBundle(skill)).trim(),
    "",
  ].join("\n");
}

/** Bloco para AGENTS.md: índice das skills, não o conteúdo inteiro. */
function agentsBlock(skills, evidence) {
  const lines = [
    BEGIN,
    "## Skills da Melinna",
    "",
    evidence.length > 0
      ? `Stack detectada neste repositório: **${summarizeStacks(evidence)}**.`
      : "Nenhuma stack reconhecida automaticamente.",
    "",
    "Consulte estas skills antes de implementar ou revisar. O conteúdo completo de cada uma está",
    "em `.claude/skills/<id>/SKILL.md`, ou via a ferramenta MCP `melinna_get_skill`.",
    "",
  ];
  for (const skill of skills) {
    const summary = (skill.description || "").split(/(?<=\.)\s/)[0] ?? "";
    lines.push(`- **${skill.id}** — ${summary || "(sem descrição)"}`);
  }
  lines.push("", "Regenerado por `melinna sync`. Não edite dentro deste bloco.", END);
  return lines.join("\n");
}

/** Reescreve só o bloco gerenciado, preservando o resto do arquivo. */
async function upsertBlock(path, block) {
  let existing = "";
  if (existsSync(path)) existing = await readFile(path, "utf-8");

  if (existing.includes(BEGIN) && existing.includes(END)) {
    const before = existing.slice(0, existing.indexOf(BEGIN));
    const after = existing.slice(existing.indexOf(END) + END.length);
    await writeFile(path, `${before}${block}${after}`, "utf-8");
    return "atualizado";
  }
  const prefix = existing.trim() ? `${existing.trimEnd()}\n\n` : "";
  await writeFile(path, `${prefix}${block}\n`, "utf-8");
  return existing.trim() ? "anexado" : "criado";
}

/**
 * Sincroniza as skills para os agentes escolhidos.
 *
 * @param {string} root raiz do pacote Melinna
 * @param {string} cwd projeto em uso
 * @param {{ targets?: string[], all?: boolean, global?: boolean, clean?: boolean }} options
 */
export async function sync(root, cwd, options = {}) {
  const requested = options.targets?.length ? options.targets : ["claude", "cursor", "agents"];
  for (const name of requested) {
    if (!TARGETS[name]) {
      console.log(chalk.red(`Alvo "${name}" desconhecido. Use: ${Object.keys(TARGETS).join(", ")}`));
      process.exitCode = 1;
      return;
    }
  }

  const available = listSkills(root, cwd);
  if (available.length === 0) {
    console.log(chalk.yellow("Nenhuma skill instalada — rode `melinna skills install` primeiro."));
    process.exitCode = 1;
    return;
  }

  const { tags, evidence } = detectStacks(cwd);
  // Por padrão sincroniza só as skills que casam com o projeto: despejar as 200+
  // do registry deixaria o menu do agente inutilizável.
  const skills = options.all ? available : selectSkills(available, tags, { limit: 12 });

  if (evidence.length > 0) {
    console.log(chalk.dim(`Stack detectada: ${summarizeStacks(evidence)}`));
  }
  if (skills.length === 0) {
    console.log(chalk.yellow("Nenhuma skill casou com este projeto — use --all para sincronizar todas."));
    process.exitCode = 1;
    return;
  }
  console.log(chalk.cyan(`Sincronizando ${skills.length} skill(s): ${skills.map((s) => s.id).join(", ")}`));
  console.log("");

  for (const name of requested) {
    const target = TARGETS[name];
    const dir = target.dir(cwd, options);

    if (name === "agents") {
      const path = join(dir, "AGENTS.md");
      const action = await upsertBlock(path, agentsBlock(skills, evidence));
      console.log(`${chalk.green("✔")} ${target.label} ${chalk.dim(`(${path} — bloco ${action})`)}`);
      continue;
    }

    if (options.clean && existsSync(dir)) {
      await rm(dir, { recursive: true, force: true });
    }
    await mkdir(dir, { recursive: true });
    for (const skill of skills) await target.write(dir, skill);
    console.log(`${chalk.green("✔")} ${target.label} ${chalk.dim(`(${dir})`)}`);
  }

  console.log("");
  console.log(chalk.green("✔ Sincronizado."));
  console.log(chalk.dim("As skills agora valem dentro do agente, sem passar pela Melinna."));
  console.log(chalk.dim("Rode de novo após `melinna skills update` ou ao trocar de stack."));
}
