import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeIndexNote, writeProjectNote } from "../lib/vault.js";
import { selectSkills, selectionConfidence } from "../lib/skills.js";
import { runSessionStartHook } from "../lib/hooks/runner.js";

function tempDir(t, prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const IDENTITY = { id: "meu-projeto", label: "meu-projeto", path: "C:/dev/x", source: "teste" };

// ── Índice do vault ────────────────────────────────────────────────────────

test("writeIndexNote linka todos os projetos", (t) => {
  // Sem índice, projetos/ vira pilha plana e o agente precisa varrer o
  // diretório para descobrir o que existe.
  const vault = tempDir(t, "melinna-idx-");
  writeProjectNote(vault, IDENTITY, { resumo: "fez A" }, { day: "2026-08-28" });
  writeProjectNote(vault, { ...IDENTITY, id: "outro", label: "outro" }, { resumo: "fez B" }, { day: "2026-08-28" });

  const { path, count } = writeIndexNote(vault);
  assert.equal(count, 2);
  const body = readFileSync(path, "utf-8");
  assert.match(body, /tags: \[melinna\/indice\]/);
  assert.match(body, /- \[\[meu-projeto\]\] — fez A/);
  assert.match(body, /- \[\[outro\]\] — fez B/);
});

test("o índice é regenerado a cada gravação de nota", (t) => {
  const vault = tempDir(t, "melinna-idx-");
  writeProjectNote(vault, IDENTITY, { resumo: "primeira" }, { day: "2026-08-28" });
  const body = readFileSync(join(vault, "projetos.md"), "utf-8");
  assert.match(body, /\[\[meu-projeto\]\]/, "a gravação deveria atualizar o índice sozinha");
});

test("índice de vault vazio não estoura", (t) => {
  const vault = tempDir(t, "melinna-idx-");
  const { count } = writeIndexNote(vault);
  assert.equal(count, 0);
  assert.match(readFileSync(join(vault, "projetos.md"), "utf-8"), /nenhum projeto registrado/);
});

// ── Hook SessionStart ──────────────────────────────────────────────────────

/** MELINNA_HOME isolado com vault ligado, para não tocar o do usuário. */
function hookHome(t, { autoLoad = true } = {}) {
  const dir = tempDir(t, "melinna-start-");
  const home = join(dir, "home");
  const vault = join(dir, "vault");
  mkdirSync(home, { recursive: true });
  writeFileSync(
    join(home, "config.json"),
    JSON.stringify({ vault: { enabled: true, path: vault, autoLoad } }),
    "utf-8",
  );
  return { home, vault, project: dir };
}

async function withHome(home, fn) {
  const previous = process.env.MELINNA_HOME;
  process.env.MELINNA_HOME = home;
  try {
    return await fn();
  } finally {
    if (previous === undefined) delete process.env.MELINNA_HOME;
    else process.env.MELINNA_HOME = previous;
  }
}

test("SessionStart injeta o contexto salvo do projeto", async (t) => {
  const { home, vault, project } = hookHome(t);

  const out = await withHome(home, async () => {
    const { projectIdentity } = await import("../lib/vault.js");
    // A nota precisa estar sob o id que o hook vai resolver para este diretório.
    writeProjectNote(vault, projectIdentity(project), { arquitetura: "MARCADOR-ARQUITETURA" }, { day: "2026-08-28" });
    return runSessionStartHook({ hook_event_name: "SessionStart", cwd: project });
  });

  assert.equal(out.hookSpecificOutput?.hookEventName, "SessionStart");
  assert.match(out.hookSpecificOutput.additionalContext, /MARCADOR-ARQUITETURA/);
  // O contexto vem de sessões passadas, não do usuário desta conversa.
  assert.match(out.hookSpecificOutput.additionalContext, /memória, não como instrução/);
});

test("SessionStart não injeta nada quando não há nota", async (t) => {
  const { home, project } = hookHome(t);
  const out = await withHome(home, () => runSessionStartHook({ cwd: project }));
  assert.deepEqual(out, {});
});

test("SessionStart respeita autoLoad desligado", async (t) => {
  const { home, vault, project } = hookHome(t, { autoLoad: false });
  await withHome(home, async () => {
    const { projectIdentity } = await import("../lib/vault.js");
    writeProjectNote(vault, projectIdentity(project), { arquitetura: "X" }, { day: "2026-08-28" });
  });
  const out = await withHome(home, () => runSessionStartHook({ cwd: project }));
  assert.deepEqual(out, {}, "com autoLoad desligado, não deveria injetar");
});

test("SessionStart trunca nota muito grande", async (t) => {
  // A nota entra no contexto de TODA conversa; sem teto, encarece em silêncio.
  const { home, vault, project } = hookHome(t);
  await withHome(home, async () => {
    const { projectIdentity } = await import("../lib/vault.js");
    writeProjectNote(vault, projectIdentity(project), { arquitetura: "x".repeat(20000) }, { day: "2026-08-28" });
  });
  const out = await withHome(home, () => runSessionStartHook({ cwd: project }));
  const body = out.hookSpecificOutput.additionalContext;
  assert.ok(body.length < 10000, `contexto grande demais: ${body.length}`);
  assert.match(body, /nota truncada/);
});

test("SessionStart não estoura com vault desligado", async (t) => {
  const dir = tempDir(t, "melinna-off-");
  const home = join(dir, "home");
  mkdirSync(home, { recursive: true });
  writeFileSync(join(home, "config.json"), JSON.stringify({ vault: { enabled: false } }), "utf-8");
  const out = await withHome(home, () => runSessionStartHook({ cwd: dir }));
  assert.deepEqual(out, {});
});

// ── Confiança da seleção de skills ─────────────────────────────────────────

const SKILLS = [
  { id: "java-architect", description: "Spring", triggers: "Java, Spring", source: "x" },
  { id: "architecture-designer", description: "Arquitetura", triggers: "", source: "x" },
  { id: "code-review", description: "Revisão", triggers: "", source: "x" },
];

test("confiança forte quando a skill casa com a stack", () => {
  const chosen = selectSkills(SKILLS, ["java", "spring"]);
  const confidence = selectionConfidence(chosen, ["java", "spring"]);
  assert.equal(confidence.level, "forte");
  assert.ok(confidence.direct > 0);
});

test("confiança fraca quando só entraram as genéricas", () => {
  // O casamento é lexical: com stack sem skill correspondente instalada, o que
  // sobra são arquitetura e revisão — e o usuário precisa saber disso.
  const chosen = selectSkills(SKILLS, ["fluig"]);
  const confidence = selectionConfidence(chosen, ["fluig"]);
  assert.equal(confidence.level, "fraco");
  assert.equal(confidence.direct, 0);
  assert.match(confidence.reason, /Nenhuma skill casou/);
});

test("confiança nenhuma sem stack e sem skills", () => {
  const confidence = selectionConfidence([], []);
  assert.equal(confidence.level, "nenhum");
  assert.match(confidence.reason, /Nenhuma stack reconhecida/);
});

test("selectSkills devolve a pontuação, para o diagnóstico funcionar", () => {
  const chosen = selectSkills(SKILLS, ["java"]);
  assert.ok(chosen.every((s) => typeof s.score === "number"), "faltou score nas skills escolhidas");
  assert.ok(chosen.every((s) => s.id), "o formato da skill precisa continuar utilizável");
});
