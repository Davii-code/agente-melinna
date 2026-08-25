import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Raiz dos dados do usuário (skills instaladas, skills próprias, clones de terceiros).
 *
 * Fica fora do diretório do pacote porque o npm apaga e recria esse diretório a
 * cada `npm install -g` — qualquer coisa gravada lá dentro some no próximo
 * upgrade. `$MELINNA_HOME` permite mover tudo (útil em CI e em testes).
 *
 * @returns {string}
 */
export function resolveHome() {
  return process.env.MELINNA_HOME || join(homedir(), ".melinna");
}

/**
 * Resolve onde vivem os clones de terceiros (caveman-code, spec-kit).
 *
 * Precedência:
 *   1. `$MELINNA_HOME/tools` — override explícito.
 *   2. `<repo>/tools` — clone de desenvolvimento, quando já foi populado ali.
 *   3. `~/.melinna/tools` — instalação global.
 *
 * @param {string} root diretório raiz do pacote Melinna
 * @returns {string} caminho absoluto do diretório de tools
 */
export function resolveToolsDir(root) {
  if (process.env.MELINNA_HOME) {
    return join(process.env.MELINNA_HOME, "tools");
  }
  const repoTools = join(root, "tools");
  if (existsSync(join(repoTools, "caveman-code"))) {
    return repoTools;
  }
  return join(resolveHome(), "tools");
}

/**
 * Caminho do módulo de compressão (repomap) do caveman-code dentro do diretório
 * de tools resolvido.
 * @param {string} root
 * @returns {string}
 */
export function resolveRepomapDir(root) {
  return join(resolveToolsDir(root), "caveman-code", "packages", "agent", "src", "repomap");
}

/**
 * Diretório onde `melinna skills install` clona os repositórios de skills de
 * terceiros. Mesma lógica do tools/: fora do pacote, para sobreviver a upgrades.
 * @returns {string}
 */
export function resolveRegistryDir() {
  return join(resolveHome(), "skills");
}

/**
 * Diretório de skills próprias do usuário — criadas por ele, nunca sobrescritas
 * por `melinna upgrade`.
 * @returns {string}
 */
export function resolveUserSkillsDir() {
  return join(resolveHome(), "custom");
}

/**
 * Raízes de skills, em ordem de precedência na busca por nome:
 *
 *   1. `<cwd>/.melinna/skills` — skills do projeto atual (versionáveis com ele).
 *   2. `~/.melinna/custom` — skills próprias do usuário, valem em todo projeto.
 *   3. `<pacote>/skills/custom` e `skills/external` — as que vêm no pacote.
 *   4. `~/.melinna/skills` — repositórios instalados via `melinna skills install`.
 *
 * O projeto vem primeiro para que um repositório possa sobrescrever uma skill
 * genérica pela sua própria versão sem renomear nada.
 *
 * @param {string} root diretório raiz do pacote Melinna
 * @param {string} [cwd] diretório do projeto em uso
 * @returns {Array<{ dir: string, label: string, kind: string }>}
 */
export function resolveSkillRoots(root, cwd) {
  const roots = [];
  if (cwd) {
    roots.push({ dir: join(cwd, ".melinna", "skills"), label: "projeto", kind: "project" });
  }
  roots.push({ dir: resolveUserSkillsDir(), label: "usuário", kind: "user" });
  roots.push({ dir: join(root, "skills", "custom"), label: "melinna", kind: "builtin" });
  roots.push({ dir: join(root, "skills", "external"), label: "melinna/external", kind: "builtin" });
  roots.push({ dir: resolveRegistryDir(), label: "registry", kind: "registry" });
  return roots.filter((r) => existsSync(r.dir));
}

/**
 * Diretório de memória do projeto em uso.
 *
 * Fica no `cwd`, não no pacote: a memória descreve *o projeto atual* (decisões,
 * convenções, histórico), então precisa viajar junto com o repositório dele e
 * ser diferente para cada projeto.
 *
 * @param {string} cwd
 * @returns {string}
 */
export function resolveMemoryDir(cwd) {
  return join(cwd, ".melinna", "memory");
}
