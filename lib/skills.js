import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { basename, dirname, join, relative, sep } from "node:path";
import { resolveSkillRoots } from "./paths.js";

/** Profundidade máxima ao varrer um clone de registry atrás de SKILL.md. */
const MAX_DEPTH = 6;

/** Diretórios que nunca contêm skills e cujo conteúdo só atrasa a varredura. */
const SKIP_DIRS = new Set([".git", "node_modules", "assets", "references", "scripts", "dist", "build"]);

/** Bloco de frontmatter no topo do arquivo, tolerante a BOM e a CRLF. */
const FRONTMATTER_RE = /^﻿?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

/**
 * Extrai o frontmatter YAML de um SKILL.md.
 *
 * É um parser deliberadamente mínimo (chave: valor de primeiro nível, mais o
 * bloco `metadata:`) em vez de uma dependência de YAML: o frontmatter de skill
 * é padronizado e raso, e só precisamos de `name`, `description` e
 * `metadata.triggers` para casar com a stack detectada.
 *
 * @param {string} content
 * @returns {{ name?: string, description?: string, triggers?: string }}
 */
export function parseFrontmatter(content) {
  const match = FRONTMATTER_RE.exec(content);
  if (!match) return {};

  const out = {};
  const lines = match[1].split(/\r?\n/);
  let inMetadata = false;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (!raw.trim() || raw.trim().startsWith("#")) continue;

    const indented = /^\s/.test(raw);
    if (!indented) inMetadata = false;

    const kv = /^(\s*)([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(raw);
    if (!kv) continue;
    const [, indent, key, rawValue] = kv;
    let value = rawValue.trim().replace(/^["']|["']$/g, "");

    // Escalares de bloco YAML (`description: >` ou `|`, com ou sem os
    // modificadores `-`/`+`): o valor real são as linhas indentadas que seguem.
    // Sem isso a descrição vira literalmente ">" — e várias skills do registry
    // usam essa forma.
    if (/^[|>][-+]?\d*$/.test(value)) {
      const collected = [];
      const baseIndent = indent.length;
      while (i + 1 < lines.length) {
        const next = lines[i + 1];
        if (next.trim() && next.search(/\S/) <= baseIndent) break;
        collected.push(next.trim());
        i += 1;
      }
      value = collected.join(" ").trim();
    }

    if (!indent && key === "metadata" && !value) {
      inMetadata = true;
      continue;
    }
    if (!indent) {
      if (key === "name" || key === "description") out[key] = value;
      continue;
    }
    if (inMetadata && key === "triggers") out.triggers = value;
  }
  return out;
}

/**
 * Remove o bloco de frontmatter do início de um documento.
 *
 * Aceita CRLF porque os clones vêm de repositórios que o git pode ter convertido
 * no Windows — e um regex só de `\n` deixaria o frontmatter original no corpo,
 * duplicando-o quando `melinna sync` escreve o seu por cima.
 *
 * @param {string} content
 * @returns {string}
 */
export function stripFrontmatter(content) {
  return content.replace(FRONTMATTER_RE, "").replace(/^\s*\r?\n/, "");
}

/** Lê os metadados de uma skill sem estourar em arquivo ilegível. */
function describe(path) {
  try {
    // O frontmatter fica no topo; ler o arquivo inteiro só para isso é
    // desperdício num registry com dezenas de skills, mas os arquivos são
    // pequenos (KBs) e a simplicidade compensa.
    return parseFrontmatter(readFileSync(path, "utf-8"));
  } catch {
    return {};
  }
}

/**
 * Nome público de uma skill num diretório `skills/<nome>/SKILL.md`: o nome do
 * diretório, que é o identificador que o autor escolheu.
 */
function skillIdFrom(path) {
  return basename(path) === "SKILL.md" ? basename(dirname(path)) : basename(path, ".md");
}

/** Varre um diretório atrás de `SKILL.md` e `.md` soltos, com profundidade limitada. */
function walkSkills(dir, root, kind, label, depth = 0, out = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }

  for (const entry of entries) {
    const full = join(dir, entry.name);

    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name) || depth >= MAX_DEPTH) continue;
      walkSkills(full, root, kind, label, depth + 1, out);
      continue;
    }
    if (!entry.isFile()) continue;

    // No topo de uma raiz aceitamos .md solto (formato original da Melinna);
    // mais fundo, só SKILL.md — para não indexar README/CHANGELOG dos clones.
    const isSkillFile = entry.name === "SKILL.md" || (depth === 0 && entry.name.endsWith(".md"));
    if (!isSkillFile) continue;

    const meta = describe(full);
    out.push({
      id: meta.name || skillIdFrom(full),
      file: entry.name,
      path: full,
      kind,
      source: label,
      rel: relative(root, full).split(sep).join("/"),
      description: meta.description ?? "",
      triggers: meta.triggers ?? "",
    });
  }
  return out;
}

/**
 * Lista todas as skills visíveis, de todas as raízes (ver resolveSkillRoots).
 * Skills de raízes de maior precedência sombreiam as de mesmo id nas seguintes.
 *
 * @param {string} root diretório raiz do pacote Melinna
 * @param {string} [cwd] projeto em uso, para incluir `<cwd>/.melinna/skills`
 * @returns {Array<object>}
 */
export function listSkills(root, cwd) {
  const seen = new Set();
  const skills = [];

  for (const { dir, label, kind } of resolveSkillRoots(root, cwd)) {
    for (const skill of walkSkills(dir, dir, kind, label)) {
      const key = skill.id.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      skills.push(skill);
    }
  }
  return skills.sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Encontra e lê o conteúdo de uma skill pelo id ou nome de arquivo.
 *
 * O nome é validado antes de virar caminho: sem separadores nem `..`, para que
 * `--skill ../../../etc/passwd` não escape das raízes de skills.
 *
 * @param {string} root
 * @param {string} name id da skill (ex: "java-architect") ou arquivo (ex: "code-review.md")
 * @param {string} [cwd]
 * @returns {string} conteúdo da skill
 */
export function readSkill(root, name, cwd) {
  if (!name || /[\\/]/.test(name) || name.split(/[\\/]/).includes("..") || name.includes("\0")) {
    throw new Error(`Nome de skill inválido: "${name}". Use só o id ou o nome do arquivo.`);
  }

  const wanted = name.toLowerCase();
  const stripped = wanted.endsWith(".md") ? wanted.slice(0, -3) : wanted;

  const match = listSkills(root, cwd).find(
    (s) => s.id.toLowerCase() === stripped || s.file.toLowerCase() === wanted,
  );
  if (match) return readFileSync(match.path, "utf-8");

  throw new Error(
    `Skill "${name}" não encontrada.\n` +
      "Rode `melinna skills list` para ver as disponíveis, ou `melinna skills install` para baixar mais.",
  );
}

/**
 * Lê uma skill e a acompanha dos arquivos `references/` e `assets/` vizinhos.
 *
 * Skills de registry costumam ser um roteador curto que aponta para arquivos
 * irmãos; sem eles o agente recebe só o índice. Anexamos os vizinhos até um teto
 * de tamanho, porque alguns pacotes (Flutter, ADVPL) têm dezenas de referências
 * e estourariam o prompt.
 *
 * @param {object} skill entrada devolvida por listSkills
 * @param {{ maxBytes?: number }} [opts]
 * @returns {string}
 */
export function readSkillBundle(skill, opts = {}) {
  const maxBytes = opts.maxBytes ?? 48 * 1024;
  let content = readFileSync(skill.path, "utf-8");
  let budget = maxBytes - content.length;
  if (budget <= 0) return content;

  const parts = [];
  for (const sub of ["references", "assets"]) {
    const dir = join(dirname(skill.path), sub);
    if (!existsSync(dir)) continue;
    let names;
    try {
      names = readdirSync(dir).filter((n) => n.endsWith(".md")).sort();
    } catch {
      continue;
    }
    for (const name of names) {
      const full = join(dir, name);
      try {
        if (statSync(full).size > budget) continue;
        const body = readFileSync(full, "utf-8");
        budget -= body.length;
        if (budget <= 0) break;
        parts.push(`### ${sub}/${name}\n\n${body}`);
      } catch {
        // ilegível, pula
      }
    }
  }

  if (parts.length > 0) content += `\n\n## Referências da skill\n\n${parts.join("\n\n")}`;
  return content;
}

/**
 * Vocabulário de stacks conhecidas, usado para detectar conflito de linguagem.
 *
 * Sem isso o bônus de "arquitetura" faz uma skill como `python-architecture-review`
 * subir num projeto Node: ela casa por ser de arquitetura, e nada a penaliza por
 * ser de outra linguagem.
 */
const STACK_VOCAB = [
  "java", "spring", "kotlin", "python", "go", "rust", "php", "ruby", "dotnet", "csharp",
  "react", "vue", "angular", "svelte", "nextjs", "node", "nestjs", "typescript", "javascript",
  "flutter", "dart", "swift", "android", "ios",
  "fluig", "advpl", "protheus",
];

/**
 * Casa uma tag como palavra inteira.
 *
 * `includes` cru daria falso positivo em pares que se contêm — "java" casaria
 * com `javascript-pro`, e um projeto Java receberia uma skill de JavaScript.
 */
function mentions(haystack, tag) {
  return new RegExp(`(^|[^a-z0-9])${tag}([^a-z0-9]|$)`, "i").test(haystack);
}

/** Tags de stack citadas no id ou nos triggers de uma skill. */
function stacksMentioned(skill) {
  const haystack = `${skill.id} ${skill.triggers}`.toLowerCase();
  return STACK_VOCAB.filter((tag) => mentions(haystack, tag));
}

/**
 * Skills genéricas preferidas quando várias empatam no mesmo papel.
 *
 * Um registry grande traz muitos ids que casam com "review" ou "architect" sem
 * serem a revisão/arquitetura genérica — `codex-review` é sobre uma ferramenta,
 * `rag-architect` sobre um padrão de IA. Sem essa lista o desempate cai no
 * alfabético e escolhe qualquer um deles.
 */
const CANONICAL = {
  architecture: [
    "software-architecture",
    "architecture-designer",
    "architecture-workflow",
    "architecture-review",
    "software-architecture-design",
  ],
  review: ["code-review", "code-reviewer", "code-review-skill"],
};

/**
 * Famílias de stack, para dar cobertura a monorepos.
 *
 * Num monolito com backend Java e frontend React, as tags das duas stacks são
 * detectadas — mas as skills de Java pontuam mais e tomariam todas as vagas.
 * Agrupando por família dá para reservar espaço para cada uma.
 */
const FAMILIES = {
  jvm: ["java", "spring", "kotlin"],
  js: ["node", "react", "vue", "angular", "nextjs", "nestjs", "frontend", "typescript", "javascript"],
  dart: ["dart", "flutter"],
  fluig: ["fluig"],
  erp: ["advpl", "protheus"],
  python: ["python"],
  go: ["go"],
  rust: ["rust"],
};

/** Famílias representadas num conjunto de tags detectadas. */
function familiesOf(tags) {
  const wanted = new Set(tags.map((t) => t.toLowerCase()));
  return Object.entries(FAMILIES)
    .filter(([, members]) => members.some((m) => wanted.has(m)))
    .map(([name]) => name);
}

/** Família a que uma skill pertence, pelas stacks que ela cita. */
function familyOfSkill(skill) {
  const mentioned = stacksMentioned(skill);
  for (const [name, members] of Object.entries(FAMILIES)) {
    if (mentioned.some((t) => members.includes(t))) return name;
  }
  return null;
}

/**
 * Escolhe automaticamente as skills para um conjunto de tags de stack.
 *
 * Casa por três sinais, do mais forte ao mais fraco: o id da skill, os
 * `metadata.triggers` do frontmatter e a descrição. Skills de arquitetura e
 * revisão ganham um bônus por valerem em qualquer linguagem — mas só quando não
 * são amarradas a uma stack diferente da detectada.
 *
 * Num monorepo, várias famílias de stack são detectadas ao mesmo tempo. O limite
 * cresce com o número de famílias e cada uma ganha uma vaga reservada — senão as
 * skills da stack que pontua mais tomam tudo, e um monolito Java + React sairia
 * só com skills de Java.
 *
 * @param {Array<object>} skills saída de listSkills
 * @param {string[]} tags saída de detectStacks
 * @param {{ limit?: number }} [opts]
 * @returns {Array<object>} skills escolhidas, mais relevantes primeiro
 */
export function selectSkills(skills, tags, opts = {}) {
  const families = familiesOf(tags);
  // Base de 4 (arquitetura + revisão + 2 da stack), mais 2 vagas por família extra.
  const limit = opts.limit ?? 4 + Math.max(0, families.length - 1) * 2;
  const wanted = new Set(tags.map((t) => t.toLowerCase()));

  const scored = skills.map((skill) => {
    const id = skill.id.toLowerCase();
    const triggers = skill.triggers.toLowerCase();
    const description = skill.description.toLowerCase();
    let score = 0;

    for (const tag of wanted) {
      if (mentions(id, tag)) score += 10;
      if (mentions(triggers, tag)) score += 5;
      if (mentions(description, tag)) score += 1;
    }

    // Uma skill que só se declara de outras stacks é descartada, por mais
    // genérica que pareça: `python-architecture-review` não serve a um Java.
    const mentioned = stacksMentioned(skill);
    if (mentioned.length > 0 && mentioned.every((t) => !wanted.has(t))) {
      return { skill, score: -1, role: null };
    }

    // Arquitetura e revisão valem em qualquer linguagem, então entram mesmo sem
    // casar com a stack — com peso menor que um casamento direto, para não
    // sombrearem a skill específica.
    const isNeutral = mentioned.length === 0;
    const isArchitecture = /architect|architecture/.test(id);
    const isReview = /(^|[^a-z])review/.test(id);
    if (isNeutral && isArchitecture) score += 6;
    if (isNeutral && isReview) score += 5;

    const role = isArchitecture ? "architecture" : isReview ? "review" : null;
    const family = familyOfSkill(skill);
    // Desempata a favor da skill genérica do papel, em vez de qualquer id que
    // por acaso contenha "review"/"architect".
    if (role && CANONICAL[role].includes(id)) score += 3;

    return { skill, score, role, family };
  });

  const eligible = scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || a.skill.id.localeCompare(b.skill.id));

  // Vagas reservadas, preenchidas antes do resto por pontuação:
  //   - arquitetura e revisão, que valem em qualquer linguagem — sem isso um
  //     projeto com muitas skills próprias (Fluig, ADVPL) enche o limite e a
  //     checagem arquitetural nunca chega ao prompt;
  //   - uma por família de stack detectada, para que um monolito Java + React
  //     não saia só com skills de Java.
  const chosen = [];
  const take = (predicate) => {
    const best = eligible.find((s) => predicate(s) && !chosen.includes(s));
    if (best) chosen.push(best);
  };

  for (const role of ["architecture", "review"]) take((s) => s.role === role);
  for (const family of families) take((s) => s.family === family);

  for (const entry of eligible) {
    if (chosen.length >= limit) break;
    if (!chosen.includes(entry)) chosen.push(entry);
  }

  return chosen
    .slice(0, limit)
    .sort((a, b) => b.score - a.score || a.skill.id.localeCompare(b.skill.id))
    .map((s) => s.skill);
}
