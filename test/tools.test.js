import { test } from "node:test";
import assert from "node:assert/strict";
import { isOnPath, resolveBin, runInherit } from "../lib/tools.js";

test("resolveBin acha binários reais do PATH", () => {
  assert.ok(resolveBin("node"), "node deveria estar no PATH");
  assert.ok(resolveBin("git"), "git deveria estar no PATH");
});

test("resolveBin acha o npm mesmo quando ele é um shim .cmd (Windows)", () => {
  // Regressão: `spawn("npm")` devolve ENOENT no Windows porque o npm é um
  // `npm.cmd` e o Node recusa spawnar batch sem shell. A detecção antiga
  // reportava "npm não instalado" numa máquina com npm.
  const resolved = resolveBin("npm");
  assert.ok(resolved, "npm deveria ser encontrado no PATH");
  if (process.platform === "win32") {
    assert.match(resolved, /\.(cmd|exe|bat)$/i);
  }
});

test("resolveBin devolve null para binário inexistente", () => {
  assert.equal(resolveBin("nao-existe-esse-binario-xyz-123"), null);
});

test("isOnPath acompanha resolveBin", async () => {
  assert.equal(await isOnPath("node"), true);
  assert.equal(await isOnPath("nao-existe-esse-binario-xyz-123"), false);
});

test("runInherit executa um shim .cmd sem estourar EINVAL", async () => {
  // Regressão: spawnar o caminho absoluto de um .cmd sem shell dá EINVAL;
  // o wrapper de cmd.exe precisa dar conta, inclusive com espaço no caminho
  // (o npm mora em "C:\\Program Files\\nodejs").
  const code = await runInherit("npm", ["--version"], { stdio: "ignore" });
  assert.equal(code, 0);
});

test("runInherit rejeita com mensagem útil quando o binário não existe", async () => {
  await assert.rejects(() => runInherit("nao-existe-esse-binario-xyz-123", []), /não encontrado no PATH/);
});
