import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Estes testes leem o código-fonte em vez de rodar `git pull`: exercitar o
 * comando de verdade exigiria rede e mexeria nos clones do usuário. O que
 * precisa ficar travado é a forma do comando de pull — foi ela que quebrou.
 */
const sources = {
  upgrade: readFileSync(join(ROOT, "lib", "commands", "upgrade.js"), "utf-8"),
  skills: readFileSync(join(ROOT, "lib", "commands", "skills.js"), "utf-8"),
  mcp: readFileSync(join(ROOT, "lib", "mcp.js"), "utf-8"),
};

test("todo `git pull` nomeia remoto e branch", () => {
  // Regressão: um clone raso (`--depth 1`) nem sempre grava o upstream do
  // branch, e `git pull` sozinho falha com "there is no tracking information
  // for the current branch" — o que derrubava `melinna upgrade` inteiro.
  for (const [name, source] of Object.entries(sources)) {
    const pulls = source.match(/\["pull"[^\]]*\]/g) ?? [];
    for (const pull of pulls) {
      assert.match(pull, /"origin"/, `${name}: pull sem remoto explícito — ${pull}`);
      assert.match(pull, /"HEAD"/, `${name}: pull sem branch explícito — ${pull}`);
    }
  }
});

test("upgrade define PULL_ARGS com remoto e branch e o reutiliza", () => {
  assert.match(sources.upgrade, /const PULL_ARGS = \["pull", "--ff-only", "--quiet", "origin", "HEAD"\]/);
  const uses = sources.upgrade.match(/runInherit\("git", PULL_ARGS/g) ?? [];
  assert.ok(uses.length >= 3, `esperava PULL_ARGS reutilizado, veio ${uses.length}x`);
});

test("upgrade atualiza a própria Melinna, não só os clones", () => {
  // O ponto do comando: quem usa roda `melinna upgrade` e pega o que foi
  // publicado, sem precisar lembrar do `npm install -g git+...`.
  assert.match(sources.upgrade, /npm install -g|"install", "-g"/, "falta o caminho de instalação global");
  assert.match(sources.upgrade, /github\.com\/Davii-code\/agente-melinna/, "falta a URL do próprio repositório");
  assert.match(sources.upgrade, /async function upgradeSelf/, "falta a rotina de auto-atualização");
});

test("upgrade aceita as flags de escopo", async () => {
  const { upgrade } = await import("../lib/commands/upgrade.js");
  assert.equal(typeof upgrade, "function");
  // Commander entrega `--no-x` como `{ x: false }`; o padrão (sem flag) é fazer tudo.
  assert.match(sources.upgrade, /options\.self !== false/);
  assert.match(sources.upgrade, /options\.tools !== false/);
  assert.match(sources.upgrade, /options\.skills !== false/);
});
