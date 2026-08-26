import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PROFILES, DEFAULT_PROFILE } from "../lib/config.js";

/**
 * A config mora em `$MELINNA_HOME/config.json`. Cada teste aponta MELINNA_HOME
 * para um diretório temporário e reimporta o módulo, para nunca tocar no
 * `~/.melinna` real de quem roda os testes.
 */
async function withHome(t, fn) {
  const home = mkdtempSync(join(tmpdir(), "melinna-config-"));
  const previous = process.env.MELINNA_HOME;
  const previousEconomy = process.env.MELINNA_ECONOMY;
  process.env.MELINNA_HOME = home;
  delete process.env.MELINNA_ECONOMY;

  t.after(() => {
    if (previous === undefined) delete process.env.MELINNA_HOME;
    else process.env.MELINNA_HOME = previous;
    if (previousEconomy === undefined) delete process.env.MELINNA_ECONOMY;
    else process.env.MELINNA_ECONOMY = previousEconomy;
    rmSync(home, { recursive: true, force: true });
  });

  // Cache-busting: o módulo lê MELINNA_HOME a cada chamada, mas reimportar
  // garante isolamento se isso mudar.
  const mod = await import(`../lib/config.js?t=${Date.now()}${Math.random()}`);
  return fn(mod, home);
}

test("perfis declaram todos os campos que os comandos consomem", () => {
  for (const [name, profile] of Object.entries(PROFILES)) {
    assert.ok(profile.label, `${name} sem label`);
    assert.ok(profile.description, `${name} sem description`);
    assert.ok("skillLimit" in profile, `${name} sem skillLimit`);
    assert.equal(typeof profile.includeReferences, "boolean", `${name}: includeReferences`);
    assert.equal(typeof profile.tokenBudget, "number", `${name}: tokenBudget`);
    assert.equal(typeof profile.compressMap, "boolean", `${name}: compressMap`);
  }
});

test("os perfis ficam progressivamente mais baratos", () => {
  assert.equal(PROFILES.full.includeReferences, true, "full deveria trazer as referências");
  assert.equal(PROFILES.lean.includeReferences, false, "lean deveria omitir as referências");
  assert.equal(PROFILES.max.includeReferences, false);
  assert.ok(PROFILES.full.tokenBudget > PROFILES.lean.tokenBudget);
  assert.ok(PROFILES.lean.tokenBudget > PROFILES.max.tokenBudget);
  assert.equal(PROFILES.full.skillLimit, null, "full não deveria limitar skills");
  assert.ok(PROFILES.max.skillLimit > 0, "max deveria limitar skills");
});

test("só o perfil `max` comprime o mapa — nunca as skills", () => {
  // A compressão do caveman-code descarta palavras; aplicá-la ao texto de uma
  // skill corromperia a instrução. Ela só pode tocar o mapa de símbolos.
  assert.equal(PROFILES.full.compressMap, false);
  assert.equal(PROFILES.lean.compressMap, false);
  assert.equal(PROFILES.max.compressMap, true);

  const skillsSource = readFileSync(new URL("../lib/skills.js", import.meta.url), "utf-8");
  assert.ok(
    !/deterministicCompress|compressRatio/.test(skillsSource),
    "skills.js não deveria conhecer a compressão do caveman-code",
  );
});

test("sem config, vale o perfil padrão", (t) =>
  withHome(t, ({ resolveProfile }) => {
    const profile = resolveProfile();
    assert.equal(profile.name, DEFAULT_PROFILE);
    assert.equal(profile.source, "padrão");
  }));

test("config salva é lida de volta", (t) =>
  withHome(t, ({ writeConfig, readConfig, resolveProfile }) => {
    writeConfig({ economy: "lean" });
    assert.equal(readConfig().economy, "lean");
    const profile = resolveProfile();
    assert.equal(profile.name, "lean");
    assert.equal(profile.source, "config");
  }));

test("writeConfig preserva chaves desconhecidas", (t) =>
  withHome(t, ({ writeConfig, readConfig }) => {
    writeConfig({ economy: "lean", futuro: { algo: 1 } });
    writeConfig({ economy: "max" });
    const saved = readConfig();
    assert.equal(saved.economy, "max");
    assert.deepEqual(saved.futuro, { algo: 1 }, "chave desconhecida foi perdida");
  }));

test("precedência: flag > variável de ambiente > config", (t) =>
  withHome(t, ({ writeConfig, resolveProfile }) => {
    writeConfig({ economy: "lean" });
    assert.equal(resolveProfile().name, "lean");

    process.env.MELINNA_ECONOMY = "max";
    assert.equal(resolveProfile().name, "max");
    assert.equal(resolveProfile().source, "MELINNA_ECONOMY");

    assert.equal(resolveProfile("full").name, "full");
    assert.equal(resolveProfile("full").source, "flag");
    delete process.env.MELINNA_ECONOMY;
  }));

test("config corrompida cai no padrão em vez de estourar", (t) =>
  withHome(t, ({ resolveProfile }, home) => {
    mkdirSync(home, { recursive: true });
    writeFileSync(join(home, "config.json"), "{ isso não é json", "utf-8");
    assert.doesNotThrow(() => resolveProfile());
    assert.equal(resolveProfile().name, DEFAULT_PROFILE);
  }));

test("perfil desconhecido na config vira o padrão, não erro", (t) =>
  withHome(t, ({ readConfig, savedEconomy, resolveProfile }, home) => {
    mkdirSync(home, { recursive: true });
    writeFileSync(join(home, "config.json"), JSON.stringify({ economy: "inventado" }), "utf-8");

    // readConfig devolve o disco cru, sem o valor inválido; quem aplica o
    // padrão é savedEconomy/resolveProfile.
    assert.equal(readConfig().economy, undefined);
    assert.equal(savedEconomy(), DEFAULT_PROFILE);
    assert.doesNotThrow(() => resolveProfile());
    assert.equal(resolveProfile().name, DEFAULT_PROFILE);
  }));

test("readConfig devolve vazio quando não há arquivo", (t) =>
  withHome(t, ({ readConfig, savedEconomy }) => {
    // Distinguir "ninguém escolheu" de "escolheu o padrão" é o que permite
    // resolveProfile relatar a origem certa.
    assert.deepEqual(readConfig(), {});
    assert.equal(savedEconomy(), DEFAULT_PROFILE);
  }));

test("perfil inválido vindo de flag é recusado com mensagem útil", (t) =>
  withHome(t, ({ resolveProfile }) => {
    assert.throws(() => resolveProfile("nao-existe"), /não existe/);
    assert.throws(() => resolveProfile("nao-existe"), /full, lean, max/);
  }));

test("readSkillBundle omite as referências quando pedido", async () => {
  const { readSkillBundle } = await import("../lib/skills.js");
  const dir = mkdtempSync(join(tmpdir(), "melinna-bundle-"));
  mkdirSync(join(dir, "references"), { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), "# Skill\n\nCorpo.\n", "utf-8");
  writeFileSync(join(dir, "references", "extra.md"), "REFERENCIA-MARCADORA\n", "utf-8");

  const skill = { id: "x", path: join(dir, "SKILL.md") };
  try {
    assert.match(readSkillBundle(skill), /REFERENCIA-MARCADORA/, "padrão deveria incluir referências");
    const lean = readSkillBundle(skill, { includeReferences: false });
    assert.ok(!lean.includes("REFERENCIA-MARCADORA"), "lean não deveria trazer referências");
    assert.match(lean, /Corpo\./, "lean deveria manter o SKILL.md");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
