import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildAnalysis } from "../lib/commands/ask.js";
import { buildTools } from "../lib/mcp.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Projeto Java/Spring mínimo, suficiente para a detecção e o repomap. */
function javaFixture() {
  const dir = mkdtempSync(join(tmpdir(), "melinna-ask-"));
  writeFileSync(
    join(dir, "pom.xml"),
    "<project><dependency><groupId>org.springframework.boot</groupId></dependency></project>",
    "utf-8",
  );
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(
    join(dir, "src", "App.java"),
    "package com.ex;\npublic class App { public void login() {} }\n",
    "utf-8",
  );
  return dir;
}

test("buildAnalysis inclui pergunta, mapa e convenções da stack", async (t) => {
  const dir = javaFixture();
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const { prompt, evidence } = await buildAnalysis(ROOT, dir, "como funciona o login?");

  assert.match(prompt, /como funciona o login\?/, "a pergunta deveria estar no prompt");
  assert.match(prompt, /# Mapa do repositório/, "faltou o mapa do repositório");
  assert.ok(
    evidence.some((e) => e.tag === "java"),
    `esperava java na detecção: ${JSON.stringify(evidence)}`,
  );
});

test("buildAnalysis pede uma resposta estruturada, não um muro de texto", async (t) => {
  const dir = javaFixture();
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const { prompt } = await buildAnalysis(ROOT, dir, "o que é isso?");
  for (const secao of ["Resposta direta", "Como funciona", "Pontos de atenção"]) {
    assert.ok(prompt.includes(secao), `faltou a seção "${secao}" no formato pedido`);
  }
});

test("--deep amplia o mapa sem trocar o perfil de economia", async (t) => {
  const dir = javaFixture();
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const normal = await buildAnalysis(ROOT, dir, "x", { economy: "lean" });
  const deep = await buildAnalysis(ROOT, dir, "x", { economy: "lean", depth: "deep" });

  assert.equal(normal.profile.name, "lean");
  assert.equal(deep.profile.name, "lean", "deep não deveria mudar o perfil escolhido");
  assert.ok(deep.prompt.length >= normal.prompt.length, "deep deveria trazer ao menos tanto contexto");
});

test("o perfil de economia vale para a análise", async (t) => {
  const dir = javaFixture();
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const full = await buildAnalysis(ROOT, dir, "x", { economy: "full" });
  const max = await buildAnalysis(ROOT, dir, "x", { economy: "max" });

  assert.ok(max.prompt.length < full.prompt.length, "max deveria produzir um prompt menor que full");
  assert.ok(max.skills.length <= 2, "max deveria limitar as skills");
});

test("melinna_ask está exposta no MCP com o schema esperado", () => {
  const ask = buildTools(ROOT).find((t) => t.name === "melinna_ask");
  assert.ok(ask, "melinna_ask não foi registrada");
  assert.deepEqual(Object.keys(ask.inputSchema.properties).sort(), ["cwd", "depth", "economy", "question"]);
  assert.deepEqual(ask.inputSchema.required, ["question"]);
  // A descrição precisa dizer QUANDO usar, senão o agente não escolhe a ferramenta.
  assert.match(ask.description, /entender|explica/i);
});

test("melinna_ask recusa pergunta vazia", async () => {
  const ask = buildTools(ROOT).find((t) => t.name === "melinna_ask");
  const result = await ask.run({ question: "   " });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /question/);
});

test("melinna_ask responde com a pergunta e a stack detectada", async (t) => {
  const dir = javaFixture();
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const ask = buildTools(ROOT).find((t) => t.name === "melinna_ask");
  const body = (await ask.run({ question: "onde fica o login?", cwd: dir })).content[0].text;

  assert.match(body, /onde fica o login\?/);
  assert.match(body, /java/, `esperava a stack no cabeçalho: ${body.slice(0, 200)}`);
});
