import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  appendJournal,
  journalNotePath,
  listProjects,
  projectIdentity,
  projectNotePath,
  readProjectContext,
  readProjectNote,
  slugify,
  today,
  writeProjectNote,
} from "../lib/vault.js";
import { installHook, uninstallHook, isHookInstalled, hookCommand } from "../lib/hook-install.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const HOOK = join(ROOT, "lib", "hooks", "stop.mjs");

function tempDir(t, prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const IDENTITY = { id: "meu-projeto", label: "meu-projeto", path: "C:/dev/meu-projeto", source: "teste" };

// ── Identidade do projeto ──────────────────────────────────────────────────

test("slugify produz nome seguro para arquivo e wikilink", () => {
  assert.equal(slugify("Meu Projeto Legal"), "meu-projeto-legal");
  assert.equal(slugify("@escopo/pacote"), "escopo-pacote");
  assert.equal(slugify("---"), "projeto", "nome vazio deveria cair num padrão");
});

test("projectIdentity usa o package.json quando não há remoto git", (t) => {
  const dir = tempDir(t, "melinna-ident-");
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "@acme/minha-lib" }), "utf-8");
  const identity = projectIdentity(dir);
  assert.equal(identity.id, "minha-lib", "o escopo do npm não deveria entrar no id");
  assert.equal(identity.source, "package.json");
});

test("projectIdentity cai no nome do diretório em último caso", (t) => {
  const dir = tempDir(t, "melinna-ident-");
  const identity = projectIdentity(dir);
  assert.equal(identity.source, "diretório");
  assert.ok(identity.id.length > 0);
});

test("projectIdentity prefere o remoto git ao nome da pasta", (t) => {
  const dir = tempDir(t, "melinna-ident-");
  try {
    execFileSync("git", ["init", "-q"], { cwd: dir, stdio: "ignore" });
    execFileSync("git", ["remote", "add", "origin", "https://github.com/acme/repo-canonico.git"], {
      cwd: dir,
      stdio: "ignore",
    });
  } catch {
    return; // sem git no ambiente: nada a verificar
  }
  const identity = projectIdentity(dir);
  assert.equal(identity.id, "repo-canonico");
  assert.equal(identity.source, "git remote");
});

// ── Nota do projeto ────────────────────────────────────────────────────────

test("writeProjectNote cria nota Obsidian com frontmatter e seções", (t) => {
  const vault = tempDir(t, "melinna-vault-");
  const { path, created } = writeProjectNote(
    vault,
    IDENTITY,
    { resumo: "fez a primeira coisa", arquitetura: "Monolito.", decisoes: ["usar Postgres"], regras: ["sem ORM"] },
    { stacks: ["java"], day: "2026-08-28" },
  );

  assert.equal(created, true);
  const body = readFileSync(path, "utf-8");
  assert.match(body, /^---\nprojeto: meu-projeto/, "faltou o frontmatter");
  assert.match(body, /tags: \[melinna\/projeto\]/);
  assert.match(body, /stack: \[java\]/);
  assert.match(body, /## Arquitetura\n\nMonolito\./);
  assert.match(body, /- usar Postgres/);
  assert.match(body, /- \[\[2026-08-28\]\] — fez a primeira coisa/, "o histórico deveria linkar o dia");
});

test("listas acumulam entre sessões, prosa é substituída", (t) => {
  const vault = tempDir(t, "melinna-vault-");
  writeProjectNote(
    vault,
    IDENTITY,
    { arquitetura: "Versão antiga.", decisoes: ["decisão A"], regras: ["regra 1"] },
    { day: "2026-08-27" },
  );
  writeProjectNote(
    vault,
    IDENTITY,
    { arquitetura: "Versão nova.", decisoes: ["decisão B"], regras: [] },
    { day: "2026-08-28" },
  );

  const note = readProjectNote(vault, IDENTITY.id);
  assert.match(note.sections.arquitetura, /Versão nova\./);
  assert.ok(!note.sections.arquitetura.includes("Versão antiga"), "prosa deveria ser substituída");
  assert.match(note.sections.decisoes, /decisão A/, "decisão antiga deveria sobreviver");
  assert.match(note.sections.decisoes, /decisão B/);
  assert.match(note.sections.regras, /regra 1/, "regra antiga deveria sobreviver a uma lista vazia");
});

test("a mesma decisão não é duplicada", (t) => {
  const vault = tempDir(t, "melinna-vault-");
  writeProjectNote(vault, IDENTITY, { decisoes: ["usar Postgres"] }, { day: "2026-08-27" });
  writeProjectNote(vault, IDENTITY, { decisoes: ["usar Postgres", "Usar Postgres"] }, { day: "2026-08-28" });

  const body = readFileSync(projectNotePath(vault, IDENTITY.id), "utf-8");
  assert.equal((body.match(/usar Postgres/gi) ?? []).length, 1, "a decisão foi duplicada");
});

test("readProjectContext devolve o corpo sem o frontmatter", (t) => {
  const vault = tempDir(t, "melinna-vault-");
  writeProjectNote(vault, IDENTITY, { arquitetura: "Camadas." }, { day: "2026-08-28" });
  const context = readProjectContext(vault, IDENTITY.id);
  assert.ok(!context.startsWith("---"), "o frontmatter é metadado do Obsidian, não contexto");
  assert.match(context, /## Arquitetura/);
});

test("readProjectContext devolve vazio para projeto sem nota", (t) => {
  const vault = tempDir(t, "melinna-vault-");
  assert.equal(readProjectContext(vault, "nunca-visto"), "");
});

test("listProjects enumera as notas gravadas", (t) => {
  const vault = tempDir(t, "melinna-vault-");
  writeProjectNote(vault, IDENTITY, {}, { day: "2026-08-28" });
  writeProjectNote(vault, { ...IDENTITY, id: "outro", label: "outro" }, {}, { day: "2026-08-28" });
  assert.deepEqual(listProjects(vault), ["meu-projeto", "outro"]);
});

// ── Diário ─────────────────────────────────────────────────────────────────

test("appendJournal cria a nota do dia com wikilink para o projeto", (t) => {
  const vault = tempDir(t, "melinna-vault-");
  const { path, added } = appendJournal(vault, "corrigiu o spawn no Windows", {
    projectId: "meu-projeto",
    day: "2026-08-28",
  });

  assert.equal(added, true);
  const body = readFileSync(path, "utf-8");
  assert.match(body, /data: 2026-08-28/);
  assert.match(body, /- \[\[meu-projeto\]\] — corrigiu o spawn no Windows/);
});

test("o diário acumula linhas no mesmo dia sem repetir", (t) => {
  const vault = tempDir(t, "melinna-vault-");
  const opts = { projectId: "meu-projeto", day: "2026-08-28" };
  appendJournal(vault, "primeira coisa", opts);
  appendJournal(vault, "segunda coisa", opts);
  const repetida = appendJournal(vault, "primeira coisa", opts);

  assert.equal(repetida.added, false, "linha repetida não deveria ser gravada de novo");
  const body = readFileSync(journalNotePath(vault, "2026-08-28"), "utf-8");
  assert.equal((body.match(/primeira coisa/g) ?? []).length, 1);
  assert.match(body, /segunda coisa/);
});

test("o diário mantém a linha em uma linha só", (t) => {
  const vault = tempDir(t, "melinna-vault-");
  const { path } = appendJournal(vault, "fez\numa\ncoisa   com   espaços", { day: "2026-08-28" });
  const body = readFileSync(path, "utf-8");
  assert.match(body, /- fez uma coisa com espaços/, "quebras de linha deveriam virar espaço");
});

test("today devolve AAAA-MM-DD", () => {
  assert.match(today(new Date(2026, 7, 5)), /^2026-08-05$/);
});

// ── Hook ───────────────────────────────────────────────────────────────────

test("hookCommand carrega a marca que permite desinstalar", () => {
  assert.match(hookCommand(), /--melinna-vault/, "sem a marca não dá para remover só o nosso hook");
});

test("installHook preserva as settings e os hooks do usuário", (t) => {
  const dir = tempDir(t, "melinna-hook-");
  const path = join(dir, "settings.json");
  writeFileSync(
    path,
    JSON.stringify({
      model: "opus",
      hooks: { Stop: [{ hooks: [{ type: "command", command: "echo hook-do-usuario" }] }] },
    }),
    "utf-8",
  );

  assert.equal(isHookInstalled(path), false);
  installHook(path);
  assert.equal(isHookInstalled(path), true);

  const settings = JSON.parse(readFileSync(path, "utf-8"));
  assert.equal(settings.model, "opus", "config do usuário foi perdida");
  assert.ok(JSON.stringify(settings.hooks.Stop).includes("hook-do-usuario"), "hook do usuário foi perdido");
  assert.ok(existsSync(`${path}.melinna-backup`), "deveria ter feito backup antes de alterar");
});

test("uninstallHook remove só o hook da Melinna", (t) => {
  const dir = tempDir(t, "melinna-hook-");
  const path = join(dir, "settings.json");
  writeFileSync(
    path,
    JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: "command", command: "echo hook-do-usuario" }] }] } }),
    "utf-8",
  );

  installHook(path);
  const { removed } = uninstallHook(path);
  assert.equal(removed, 1);
  assert.equal(isHookInstalled(path), false);
  assert.ok(
    JSON.stringify(JSON.parse(readFileSync(path, "utf-8"))).includes("hook-do-usuario"),
    "o hook do usuário não deveria ter sido tocado",
  );
});

test("instalar duas vezes não duplica a entrada", (t) => {
  const dir = tempDir(t, "melinna-hook-");
  const path = join(dir, "settings.json");
  installHook(path);
  installHook(path);
  const settings = JSON.parse(readFileSync(path, "utf-8"));
  assert.equal(settings.hooks.Stop.length, 1);
});

test("installHook recusa settings com JSON quebrado em vez de sobrescrever", (t) => {
  const dir = tempDir(t, "melinna-hook-");
  const path = join(dir, "settings.json");
  writeFileSync(path, "{ isso não é json", "utf-8");
  assert.throws(() => installHook(path), /Corrija o JSON/);
  assert.equal(readFileSync(path, "utf-8"), "{ isso não é json", "o arquivo foi alterado mesmo assim");
});

// ── Decisão do hook Stop ───────────────────────────────────────────────────

/** Roda o executor do hook com um payload, num MELINNA_HOME isolado. */
function runHook(payload, home) {
  const out = execFileSync(process.execPath, [HOOK], {
    input: JSON.stringify(payload),
    encoding: "utf-8",
    env: { ...process.env, MELINNA_HOME: home },
  });
  return JSON.parse(out || "{}");
}

/** MELINNA_HOME com o vault ligado e um transcript de trabalho. */
function hookFixture(t, { write = true } = {}) {
  const dir = tempDir(t, "melinna-hookrun-");
  const home = join(dir, "home");
  mkdirSync(home, { recursive: true });
  writeFileSync(
    join(home, "config.json"),
    JSON.stringify({ vault: { enabled: true, path: join(dir, "vault"), cooldownMinutes: 15 } }),
    "utf-8",
  );
  const transcript = join(dir, "transcript.jsonl");
  writeFileSync(
    transcript,
    JSON.stringify({ message: { content: [{ type: "tool_use", name: write ? "Edit" : "Read" }] } }),
    "utf-8",
  );
  return { home, transcript };
}

test("hook pede a gravação quando a sessão editou arquivos", (t) => {
  const { home, transcript } = hookFixture(t);
  const out = runHook({ hook_event_name: "Stop", session_id: "s1", transcript_path: transcript }, home);
  assert.equal(out.decision, "block");
  assert.match(out.reason, /melinna_vault_save/);
  assert.match(out.reason, /uma linha/i, "a instrução deveria exigir resumo de uma linha");
});

test("hook respeita o cooldown da sessão", (t) => {
  const { home, transcript } = hookFixture(t);
  const payload = { hook_event_name: "Stop", session_id: "s1", transcript_path: transcript };
  assert.equal(runHook(payload, home).decision, "block");
  // O evento Stop dispara a cada turno; sem cooldown, pediria gravação sempre.
  assert.deepEqual(runHook(payload, home), {});
});

test("hook não age quando a sessão só leu arquivos", (t) => {
  const { home, transcript } = hookFixture(t, { write: false });
  const out = runHook({ hook_event_name: "Stop", session_id: "s2", transcript_path: transcript }, home);
  assert.deepEqual(out, {});
});

test("hook respeita stop_hook_active, para não entrar em laço", (t) => {
  const { home, transcript } = hookFixture(t);
  const out = runHook(
    { hook_event_name: "Stop", session_id: "s3", transcript_path: transcript, stop_hook_active: true },
    home,
  );
  assert.deepEqual(out, {});
});

test("hook não age com o vault desligado", (t) => {
  const dir = tempDir(t, "melinna-hookoff-");
  const home = join(dir, "home");
  mkdirSync(home, { recursive: true });
  writeFileSync(join(home, "config.json"), JSON.stringify({ vault: { enabled: false } }), "utf-8");
  assert.deepEqual(runHook({ hook_event_name: "Stop", session_id: "s4" }, home), {});
});

test("hook sobrevive a entrada inválida sem travar a sessão", (t) => {
  const dir = tempDir(t, "melinna-hookbad-");
  const out = execFileSync(process.execPath, [HOOK], {
    input: "isso não é json",
    encoding: "utf-8",
    env: { ...process.env, MELINNA_HOME: join(dir, "home") },
  });
  assert.deepEqual(JSON.parse(out || "{}"), {});
});
