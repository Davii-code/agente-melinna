import { existsSync, readFileSync, readdirSync } from "node:fs";
import { mkdirSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { readConfig, writeConfig } from "./config.js";
import { detectStacks } from "./detect.js";

/**
 * Vault de contexto — o "segundo cérebro" por projeto, em formato Obsidian.
 *
 * O que a Melinna guarda aqui é o que NÃO dá para deduzir lendo o código na
 * próxima sessão: por que a arquitetura é assim, que regra foi combinada, o que
 * já foi tentado e não deu certo. O código o agente relê sozinho; a intenção,
 * não.
 *
 * Estrutura, sob a raiz escolhida pelo usuário:
 *
 *   <vault>/
 *   ├── projetos/<projeto>.md    nota viva do projeto, reescrita a cada sessão
 *   └── diario/<AAAA-MM-DD>.md   uma linha por sessão, ligada ao projeto
 *
 * As notas se referenciam por `[[wikilink]]` nos dois sentidos, que é o que faz
 * o grafo do Obsidian funcionar: do diário dá para chegar ao projeto, e do
 * histórico do projeto dá para voltar ao dia.
 */

/** Subpastas sob a raiz do vault. */
export const PROJECTS_DIR = "projetos";
export const JOURNAL_DIR = "diario";

/** Marcadores das seções gerenciadas na nota do projeto. */
const SECTIONS = [
  { key: "arquitetura", title: "Arquitetura", mode: "replace" },
  { key: "decisoes", title: "Decisões", mode: "append" },
  { key: "regras", title: "Convenções e regras", mode: "append" },
  { key: "atencao", title: "Pontos de atenção", mode: "replace" },
];

const HISTORY_TITLE = "Histórico";

/** Data de hoje em AAAA-MM-DD, no fuso local. */
export function today(date = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * Transforma um nome em algo seguro para nome de arquivo e para wikilink.
 * Mantém acentos fora e troca o resto por hífen — o Obsidian aceita espaço, mas
 * hífen evita ambiguidade no link e no shell.
 */
export function slugify(name) {
  return (
    String(name)
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .replace(/-{2,}/g, "-")
      .toLowerCase() || "projeto"
  );
}

/**
 * Identidade do projeto em `cwd`.
 *
 * Precedência: nome do repositório git → `name` do package.json → nome do
 * diretório. O remoto vem primeiro porque é estável mesmo quando a pasta local
 * tem outro nome (clones com sufixo, worktrees).
 *
 * @param {string} cwd
 * @returns {{ id: string, label: string, source: string, path: string }}
 */
export function projectIdentity(cwd) {
  const path = resolve(cwd);

  try {
    const remote = execFileSync("git", ["remote", "get-url", "origin"], {
      cwd: path,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    const match = /([^/:]+?)(?:\.git)?$/.exec(remote);
    if (match?.[1]) {
      return { id: slugify(match[1]), label: match[1], source: "git remote", path };
    }
  } catch {
    // sem git ou sem remoto — segue para o próximo sinal
  }

  const pkgPath = join(path, "package.json");
  if (existsSync(pkgPath)) {
    try {
      const name = JSON.parse(readFileSync(pkgPath, "utf-8")).name;
      if (name) {
        const clean = String(name).replace(/^@[^/]+\//, "");
        return { id: slugify(clean), label: clean, source: "package.json", path };
      }
    } catch {
      // package.json inválido — segue
    }
  }

  const dir = basename(path);
  return { id: slugify(dir), label: dir, source: "diretório", path };
}

// ---------------------------------------------------------------------------
// Configuração
// ---------------------------------------------------------------------------

/**
 * Estado do vault: se está ligado e onde fica.
 * @returns {{ enabled: boolean, path: string | null, cooldownMinutes: number }}
 */
export function vaultConfig() {
  const vault = readConfig().vault ?? {};
  return {
    enabled: Boolean(vault.enabled && vault.path),
    path: vault.path ?? null,
    // Evita gravar a cada resposta do agente: o hook Stop dispara a cada turno,
    // não só no fim do chat.
    cooldownMinutes: Number.isFinite(vault.cooldownMinutes) ? vault.cooldownMinutes : 15,
  };
}

/** Liga o vault numa raiz, criando a estrutura. */
export function enableVault(root, { cooldownMinutes } = {}) {
  const path = resolve(root);
  mkdirSync(join(path, PROJECTS_DIR), { recursive: true });
  mkdirSync(join(path, JOURNAL_DIR), { recursive: true });

  const current = readConfig().vault ?? {};
  writeConfig({
    vault: {
      ...current,
      enabled: true,
      path,
      cooldownMinutes: cooldownMinutes ?? current.cooldownMinutes ?? 15,
    },
  });
  return path;
}

/** Desliga o vault, preservando o que já foi escrito. */
export function disableVault() {
  const current = readConfig().vault ?? {};
  writeConfig({ vault: { ...current, enabled: false } });
}

// ---------------------------------------------------------------------------
// Leitura e escrita das notas
// ---------------------------------------------------------------------------

/** Caminho da nota de um projeto. */
export function projectNotePath(vaultPath, projectId) {
  return join(vaultPath, PROJECTS_DIR, `${projectId}.md`);
}

/** Caminho da nota de um dia. */
export function journalNotePath(vaultPath, day = today()) {
  return join(vaultPath, JOURNAL_DIR, `${day}.md`);
}

/**
 * Extrai o corpo de uma seção `## Título` de um markdown.
 * @returns {string} conteúdo sem o cabeçalho, ou "" se a seção não existe
 */
function sectionBody(markdown, title) {
  const re = new RegExp(`^## ${title}\\s*$([\\s\\S]*?)(?=^## |\\s*$(?![\\s\\S]))`, "m");
  const match = re.exec(markdown);
  return match ? match[1].trim() : "";
}

/** Itens de uma lista markdown, sem o marcador. */
function listItems(body) {
  return body
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*[-*]\s+/, "").trim())
    .filter(Boolean);
}

/** Une listas sem duplicar, preservando a ordem de chegada. */
function mergeList(existing, incoming) {
  const seen = new Set(existing.map((i) => i.toLowerCase()));
  const out = [...existing];
  for (const item of incoming) {
    const clean = String(item).trim();
    if (!clean || seen.has(clean.toLowerCase())) continue;
    seen.add(clean.toLowerCase());
    out.push(clean);
  }
  return out;
}

/**
 * Lê a nota de um projeto e devolve suas seções já separadas.
 * @returns {{ exists: boolean, raw: string, sections: object, history: string[] }}
 */
export function readProjectNote(vaultPath, projectId) {
  const path = projectNotePath(vaultPath, projectId);
  if (!existsSync(path)) {
    return { exists: false, raw: "", sections: {}, history: [] };
  }
  const raw = readFileSync(path, "utf-8");
  const sections = {};
  for (const { key, title } of SECTIONS) sections[key] = sectionBody(raw, title);
  return { exists: true, raw, sections, history: listItems(sectionBody(raw, HISTORY_TITLE)) };
}

/**
 * Grava (ou atualiza) a nota do projeto.
 *
 * Seções de prosa (`arquitetura`, `atencao`) são substituídas: elas descrevem o
 * estado atual, e manter versões antigas empilhadas só polui. Listas (`decisoes`,
 * `regras`) acumulam sem duplicar: uma decisão tomada em março continua valendo
 * em agosto.
 *
 * @param {string} vaultPath
 * @param {object} identity saída de projectIdentity
 * @param {object} update { arquitetura, decisoes, regras, atencao, resumo }
 * @param {{ day?: string, stacks?: string[] }} [meta]
 * @returns {{ path: string, created: boolean }}
 */
export function writeProjectNote(vaultPath, identity, update, meta = {}) {
  const day = meta.day ?? today();
  const previous = readProjectNote(vaultPath, identity.id);

  const merged = {};
  for (const { key, mode } of SECTIONS) {
    const incoming = update[key];
    if (mode === "replace") {
      const text = typeof incoming === "string" ? incoming.trim() : "";
      merged[key] = text || previous.sections[key] || "";
    } else {
      const existing = listItems(previous.sections[key] ?? "");
      merged[key] = mergeList(existing, Array.isArray(incoming) ? incoming : []);
    }
  }

  const history = [...previous.history];
  if (update.resumo?.trim()) {
    const entry = `[[${day}]] — ${update.resumo.trim()}`;
    if (!history.includes(entry)) history.push(entry);
  }

  const stacks = meta.stacks?.length ? meta.stacks : null;
  const lines = [
    "---",
    `projeto: ${identity.label}`,
    `caminho: ${identity.path.replace(/\\/g, "/")}`,
    ...(stacks ? [`stack: [${stacks.join(", ")}]`] : []),
    `atualizado: ${day}`,
    "tags: [melinna/projeto]",
    "---",
    "",
    `# ${identity.label}`,
    "",
  ];

  for (const { key, title, mode } of SECTIONS) {
    lines.push(`## ${title}`, "");
    if (mode === "replace") {
      lines.push(merged[key] || "_(ainda não registrado)_", "");
    } else {
      lines.push(...(merged[key].length ? merged[key].map((i) => `- ${i}`) : ["_(ainda não registrado)_"]), "");
    }
  }

  lines.push(`## ${HISTORY_TITLE}`, "");
  lines.push(...(history.length ? history.map((h) => `- ${h}`) : ["_(sem registros)_"]), "");

  const path = projectNotePath(vaultPath, identity.id);
  mkdirSync(join(vaultPath, PROJECTS_DIR), { recursive: true });
  writeFileSync(path, lines.join("\n"), "utf-8");
  return { path, created: !previous.exists };
}

/**
 * Acrescenta uma linha ao diário do dia, ligada ao projeto.
 *
 * Uma linha por sessão, por desenho: o diário serve para responder "o que eu fiz
 * na terça?" de relance, não para guardar o detalhe — esse mora na nota do
 * projeto.
 *
 * @param {string} vaultPath
 * @param {string} line
 * @param {{ projectId?: string, day?: string }} [opts]
 * @returns {{ path: string, added: boolean }}
 */
export function appendJournal(vaultPath, line, opts = {}) {
  const day = opts.day ?? today();
  const clean = String(line).replace(/\s+/g, " ").trim();
  if (!clean) return { path: journalNotePath(vaultPath, day), added: false };

  const entry = opts.projectId ? `- [[${opts.projectId}]] — ${clean}` : `- ${clean}`;
  const path = journalNotePath(vaultPath, day);
  mkdirSync(join(vaultPath, JOURNAL_DIR), { recursive: true });

  if (!existsSync(path)) {
    const header = ["---", `data: ${day}`, "tags: [melinna/diario]", "---", "", `# ${day}`, "", entry, ""];
    writeFileSync(path, header.join("\n"), "utf-8");
    return { path, added: true };
  }

  const existing = readFileSync(path, "utf-8");
  // Não repete a mesma linha se o hook disparar duas vezes no mesmo dia.
  if (existing.includes(entry)) return { path, added: false };
  writeFileSync(path, `${existing.trimEnd()}\n${entry}\n`, "utf-8");
  return { path, added: true };
}

/**
 * Contexto salvo de um projeto, pronto para injetar num prompt.
 * @returns {string} vazio se não há nota
 */
export function readProjectContext(vaultPath, projectId) {
  const note = readProjectNote(vaultPath, projectId);
  if (!note.exists) return "";
  // Tira o frontmatter: ele é metadado do Obsidian, não contexto para o agente.
  return note.raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "").trim();
}

/** Lista os projetos com nota no vault. */
export function listProjects(vaultPath) {
  const dir = join(vaultPath, PROJECTS_DIR);
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir)
      .filter((n) => n.endsWith(".md"))
      .map((n) => n.replace(/\.md$/, ""))
      .sort();
  } catch {
    return [];
  }
}

/** Stacks detectadas, para o frontmatter da nota. */
export function stacksFor(cwd) {
  try {
    return detectStacks(cwd).tags;
  } catch {
    return [];
  }
}
