import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const SKILL_DIRS = ["skills/custom", "skills/external"];

/**
 * Lista todos os arquivos .md dentro de skills/custom e skills/external.
 * @param {string} root diretório raiz do projeto Melinna
 * @returns {Array<{ name: string, dir: string, path: string }>}
 */
export function listSkills(root) {
  const skills = [];
  for (const dir of SKILL_DIRS) {
    const full = join(root, dir);
    if (!existsSync(full)) continue;
    for (const entry of readdirSync(full, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
      skills.push({ name: entry.name, dir, path: join(full, entry.name) });
    }
  }
  return skills;
}

/**
 * Encontra e lê o conteúdo de uma skill pelo nome de arquivo, procurando em
 * skills/custom e depois skills/external.
 * @param {string} root
 * @param {string} name nome do arquivo (ex: "code-review.md")
 * @returns {string} conteúdo da skill
 */
export function readSkill(root, name) {
  for (const dir of SKILL_DIRS) {
    const full = join(root, dir, name);
    if (existsSync(full)) return readFileSync(full, "utf-8");
  }
  throw new Error(
    `Skill "${name}" não encontrada em skills/custom/ ou skills/external/.`,
  );
}
