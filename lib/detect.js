import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";

/**
 * Detecção de stack a partir de arquivos-marca do projeto.
 *
 * Um repositório pode ter mais de uma stack: num monolito com `backend/` (Java) e
 * `frontend/` (React), nenhum marcador fica na raiz. Por isso a varredura olha a
 * raiz e também os módulos — subdiretórios de primeiro nível, mais os filhos das
 * pastas-contêiner convencionais (`apps/`, `packages/`, ...).
 *
 * A profundidade é limitada de propósito: marcadores de build ficam no topo de
 * cada módulo, e descer a árvore inteira faria qualquer repositório grande casar
 * com todas as stacks de uma vez.
 */

/** Pastas que agrupam módulos em monorepos — seus filhos também são inspecionados. */
const CONTAINER_DIRS = new Set([
  "apps", "packages", "services", "modules", "libs", "projects", "src", "backend", "frontend",
]);

/** Pastas que nunca contêm um módulo de código-fonte do projeto. */
const SKIP_DIRS = new Set([
  "node_modules", ".git", "dist", "build", "target", "out", "vendor",
  ".next", ".cache", "venv", ".venv", "__pycache__", ".idea", ".vscode",
  "coverage", "tmp", "temp", ".melinna", ".speckit", ".specify",
]);

/** Lê e parseia um JSON, devolvendo null em qualquer falha (arquivo ausente ou inválido). */
function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return null;
  }
}

/** Lê um arquivo de texto, devolvendo string vazia se não der. */
function readText(path) {
  try {
    return readFileSync(path, "utf-8");
  } catch {
    return "";
  }
}

/** Todas as dependências declaradas num package.json, de qualquer seção. */
function allDeps(pkg) {
  return {
    ...(pkg.dependencies ?? {}),
    ...(pkg.devDependencies ?? {}),
    ...(pkg.peerDependencies ?? {}),
  };
}

/** Nomes de arquivo do diretório, sem estourar em diretório ilegível. */
function entryNames(dir) {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

/**
 * Aplica as regras de detecção a UM diretório, sem descer.
 *
 * @param {string} dir
 * @returns {Array<{ tag: string, reason: string }>}
 */
function detectInDir(dir) {
  const found = [];
  const add = (tag, reason) => {
    if (!found.some((e) => e.tag === tag)) found.push({ tag, reason });
  };
  const has = (f) => existsSync(join(dir, f));

  // --- JVM ---
  if (has("pom.xml")) {
    add("java", "pom.xml");
    if (/spring-boot|springframework/i.test(readText(join(dir, "pom.xml")))) {
      add("spring", "spring no pom.xml");
    }
  }
  for (const f of ["build.gradle", "build.gradle.kts"]) {
    if (!has(f)) continue;
    add("java", f);
    if (/org\.springframework\.boot|spring-boot/i.test(readText(join(dir, f)))) {
      add("spring", `spring no ${f}`);
    }
  }

  // --- TOTVS ---
  if (["fluig.json", ".fluig", "wcm", "vcs.properties", "application.info"].some(has)) {
    add("fluig", "descritor de projeto Fluig");
  }
  if (entryNames(dir).some((n) => /\.(prw|tlpp|ch|prx)$/i.test(n))) {
    add("advpl", "fontes .prw/.tlpp");
    add("protheus", "fontes .prw/.tlpp");
  }

  // --- Dart / Flutter ---
  if (has("pubspec.yaml")) {
    add("dart", "pubspec.yaml");
    if (/^\s*flutter\s*:/m.test(readText(join(dir, "pubspec.yaml")))) {
      add("flutter", "flutter no pubspec.yaml");
    }
  }

  // --- Node e frameworks JS ---
  if (has("angular.json")) add("angular", "angular.json");
  const pkg = has("package.json") ? readJson(join(dir, "package.json")) : null;
  if (pkg) {
    add("node", "package.json");
    const deps = allDeps(pkg);
    const dep = (n) => Object.hasOwn(deps, n);

    if (dep("next")) add("nextjs", "dependência next");
    if (dep("react") || dep("react-dom")) add("react", "dependência react");
    if (dep("vue")) add("vue", "dependência vue");
    if (dep("@angular/core")) add("angular", "dependência @angular/core");
    if (dep("@nestjs/core")) add("nestjs", "dependência @nestjs/core");
    if (dep("tailwindcss")) add("frontend", "dependência tailwindcss");
    if (dep("react") || dep("vue") || dep("@angular/core") || dep("next")) {
      add("frontend", "framework de UI nas dependências");
    }
  }

  // --- Outras ---
  if (has("go.mod")) add("go", "go.mod");
  if (has("Cargo.toml")) add("rust", "Cargo.toml");
  if (["requirements.txt", "pyproject.toml", "setup.py"].some(has)) {
    add("python", "manifesto Python");
  }

  return found;
}

/** Subdiretórios candidatos a módulo: nível 1, mais os filhos das pastas-contêiner. */
function moduleDirs(root) {
  const dirs = [];
  let entries;
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return dirs;
  }

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".") || SKIP_DIRS.has(entry.name)) continue;
    const full = join(root, entry.name);
    dirs.push(full);

    if (!CONTAINER_DIRS.has(entry.name.toLowerCase())) continue;
    let children;
    try {
      children = readdirSync(full, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const child of children) {
      if (!child.isDirectory() || child.name.startsWith(".") || SKIP_DIRS.has(child.name)) continue;
      dirs.push(join(full, child.name));
    }
  }
  return dirs;
}

/**
 * Detecta as stacks presentes em `cwd`, incluindo as dos módulos de um monorepo.
 *
 * @param {string} cwd
 * @returns {{
 *   tags: string[],
 *   evidence: Array<{ tag: string, reason: string, where: string }>,
 *   modules: Array<{ path: string, tags: string[] }>,
 * }}
 */
export function detectStacks(cwd) {
  const evidence = [];
  const seen = new Set();
  const modules = [];

  const collect = (dir, where) => {
    const found = detectInDir(dir);
    if (found.length === 0) return;
    if (where !== ".") modules.push({ path: where, tags: found.map((e) => e.tag) });
    for (const item of found) {
      if (seen.has(item.tag)) continue;
      seen.add(item.tag);
      evidence.push({ ...item, where });
    }
  };

  collect(cwd, ".");
  for (const dir of moduleDirs(cwd)) {
    collect(dir, relative(cwd, dir).split(sep).join("/"));
  }

  return { tags: evidence.map((e) => e.tag), evidence, modules };
}

/**
 * Texto detalhado do que foi detectado, com o arquivo-marca de cada tag.
 * Usado onde cabe explicar (`doctor`, `init-project`, `skills install`).
 *
 * @param {Array<{ tag: string, reason: string, where: string }>} evidence
 * @returns {string}
 */
export function describeEvidence(evidence) {
  return evidence
    .map((e) => (e.where === "." ? `${e.tag} (${e.reason})` : `${e.tag} (${e.reason} em ${e.where}/)`))
    .join(", ");
}

/**
 * Resumo de uma linha, agrupado por módulo — a forma usada antes de rodar um
 * agente, onde o que importa é qual stack veio de onde, não o arquivo-marca.
 *
 * Ex.: `java, spring (backend/) · react, nextjs (frontend/)`
 *
 * @param {Array<{ tag: string, where: string }>} evidence
 * @returns {string}
 */
export function summarizeStacks(evidence) {
  const byModule = new Map();
  for (const e of evidence) {
    if (!byModule.has(e.where)) byModule.set(e.where, []);
    byModule.get(e.where).push(e.tag);
  }
  return [...byModule]
    .map(([where, tags]) => (where === "." ? tags.join(", ") : `${tags.join(", ")} (${where}/)`))
    .join(" · ");
}
