import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Detecção de stack a partir de arquivos-marca do projeto.
 *
 * Só olha a raiz do projeto (e, no caso do Fluig, um nível abaixo): marcadores de
 * build ficam no topo do repositório, e varrer a árvore inteira faria um monorepo
 * casar com todas as stacks de uma vez.
 *
 * Cada regra devolve uma ou mais tags do vocabulário usado em lib/registry.js.
 */

/** Lê e parseia um JSON, devolvendo null em qualquer falha (arquivo ausente ou inválido). */
function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return null;
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

/** Detecta customização Fluig: os projetos trazem um descritor próprio. */
function detectFluig(cwd) {
  const markers = [".fluig", "fluig.json", "wcm", "vcs.properties"];
  if (markers.some((m) => existsSync(join(cwd, m)))) return true;

  // Um projeto Fluig típico é uma pasta de widget com view/ + *.js + application.info.
  if (existsSync(join(cwd, "application.info"))) return true;

  try {
    const entries = readdirSync(cwd, { withFileTypes: true });
    return entries.some((e) => e.isDirectory() && existsSync(join(cwd, e.name, "application.info")));
  } catch {
    return false;
  }
}

/**
 * Detecta as stacks presentes em `cwd`.
 *
 * @param {string} cwd
 * @returns {{ tags: string[], evidence: Array<{ tag: string, reason: string }> }}
 */
export function detectStacks(cwd) {
  const evidence = [];
  const add = (tag, reason) => {
    if (!evidence.some((e) => e.tag === tag)) evidence.push({ tag, reason });
  };
  const has = (f) => existsSync(join(cwd, f));

  // --- JVM ---
  if (has("pom.xml")) add("java", "pom.xml");
  if (has("build.gradle") || has("build.gradle.kts")) add("java", "build.gradle");
  if (has("pom.xml")) {
    const pom = (() => {
      try {
        return readFileSync(join(cwd, "pom.xml"), "utf-8");
      } catch {
        return "";
      }
    })();
    if (/spring-boot|springframework/i.test(pom)) add("spring", "spring no pom.xml");
  }
  for (const f of ["build.gradle", "build.gradle.kts"]) {
    if (!has(f)) continue;
    try {
      if (/org\.springframework\.boot|spring-boot/i.test(readFileSync(join(cwd, f), "utf-8"))) {
        add("spring", `spring no ${f}`);
      }
    } catch {
      // ilegível, ignora
    }
  }

  // --- TOTVS ---
  if (detectFluig(cwd)) add("fluig", "descritor de projeto Fluig");
  try {
    const entries = readdirSync(cwd).slice(0, 500);
    if (entries.some((n) => /\.(prw|tlpp|ch|prx)$/i.test(n))) {
      add("advpl", "fontes .prw/.tlpp");
      add("protheus", "fontes .prw/.tlpp");
    }
  } catch {
    // diretório ilegível, ignora
  }

  // --- Dart / Flutter ---
  if (has("pubspec.yaml")) {
    add("dart", "pubspec.yaml");
    try {
      if (/^\s*flutter\s*:/m.test(readFileSync(join(cwd, "pubspec.yaml"), "utf-8"))) {
        add("flutter", "flutter no pubspec.yaml");
      }
    } catch {
      // ilegível, ignora
    }
  }

  // --- Node e frameworks JS ---
  if (has("angular.json")) add("angular", "angular.json");
  const pkg = has("package.json") ? readJson(join(cwd, "package.json")) : null;
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
  if (has("requirements.txt") || has("pyproject.toml") || has("setup.py")) {
    add("python", "manifesto Python");
  }

  return { tags: evidence.map((e) => e.tag), evidence };
}
