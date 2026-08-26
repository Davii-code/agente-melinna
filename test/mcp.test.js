import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildTools } from "../lib/mcp.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CLI = join(ROOT, "bin", "cli.js");

/** Cria um projeto falso e devolve seu caminho. */
function fixture(files) {
  const dir = mkdtempSync(join(tmpdir(), "melinna-mcp-"));
  for (const [path, content] of Object.entries(files)) {
    const full = join(dir, path);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, content, "utf-8");
  }
  return dir;
}

/**
 * Fala JSON-RPC com `melinna mcp` por stdio e devolve as respostas.
 *
 * Exercita o servidor de verdade, como um cliente MCP faria — é a única forma de
 * pegar erro de handshake ou de serialização, que um teste de unidade das
 * funções internas não veria.
 */
function rpc(requests, { cwd } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI, "mcp"], {
      cwd: cwd ?? ROOT,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let out = "";
    let err = "";
    child.stdout.on("data", (d) => {
      out += d.toString();
      // Encerra assim que todas as respostas chegarem.
      if (out.split("\n").filter((l) => l.trim().startsWith("{")).length >= requests.length) {
        child.kill();
      }
    });
    child.stderr.on("data", (d) => (err += d.toString()));
    child.on("error", reject);
    child.on("close", () => {
      const messages = out
        .split("\n")
        .filter((l) => l.trim().startsWith("{"))
        .map((l) => JSON.parse(l));
      resolve({ messages, stderr: err });
    });

    for (const request of requests) child.stdin.write(`${JSON.stringify(request)}\n`);
  });
}

const INIT = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "test", version: "1.0.0" },
  },
};

test("buildTools registra uma ferramenta por comando, com schema válido", () => {
  const tools = buildTools(ROOT);
  assert.ok(tools.length >= 10, `esperava ao menos 10 ferramentas, veio ${tools.length}`);

  const names = new Set();
  for (const tool of tools) {
    assert.match(tool.name, /^melinna_[a-z_]+$/, `nome fora do padrão: ${tool.name}`);
    assert.ok(tool.description?.length > 20, `${tool.name} sem descrição útil`);
    assert.equal(tool.inputSchema.type, "object", `${tool.name} sem schema de objeto`);
    assert.equal(typeof tool.run, "function", `${tool.name} sem implementação`);
    assert.ok(!names.has(tool.name), `ferramenta duplicada: ${tool.name}`);
    names.add(tool.name);
  }

  // Os comandos centrais precisam estar expostos.
  for (const expected of [
    "melinna_task",
    "melinna_review",
    "melinna_detect_stack",
    "melinna_skills_list",
    "melinna_doctor",
  ]) {
    assert.ok(names.has(expected), `faltou ${expected}`);
  }
});

test("servidor MCP responde ao handshake e lista as ferramentas", async () => {
  const { messages, stderr } = await rpc([
    INIT,
    { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
  ]);

  const init = messages.find((m) => m.id === 1);
  assert.ok(init?.result, `handshake falhou. stderr: ${stderr}`);
  assert.equal(init.result.serverInfo.name, "melinna");

  const list = messages.find((m) => m.id === 2);
  assert.ok(Array.isArray(list?.result?.tools), "tools/list não devolveu lista");
  assert.ok(list.result.tools.some((t) => t.name === "melinna_task"));
});

test("melinna_detect_stack devolve a stack do projeto pelo MCP", async (t) => {
  const dir = fixture({
    "backend/pom.xml": "<project><groupId>org.springframework.boot</groupId></project>",
    "frontend/package.json": JSON.stringify({ dependencies: { react: "^19" } }),
  });
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const { messages } = await rpc(
    [
      INIT,
      {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "melinna_detect_stack", arguments: { cwd: dir } },
      },
    ],
    { cwd: dir },
  );

  const body = messages.find((m) => m.id === 2)?.result?.content?.[0]?.text ?? "";
  assert.match(body, /java/, `esperava java na saída: ${body}`);
  assert.match(body, /react/, `esperava react na saída: ${body}`);
  assert.match(body, /backend/, "esperava o módulo backend citado");
});

test("ferramenta desconhecida devolve erro, não derruba o servidor", async () => {
  const { messages } = await rpc([
    INIT,
    { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "melinna_nao_existe", arguments: {} } },
  ]);

  const response = messages.find((m) => m.id === 2);
  assert.ok(response, "servidor não respondeu");
  const payload = response.result ?? response.error;
  assert.ok(payload, "sem result nem error");
});

test("melinna_task exige description", async () => {
  const tools = buildTools(ROOT);
  const task = tools.find((t) => t.name === "melinna_task");
  const result = await task.run({ description: "  " });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /description/);
});

test("melinna_get_skill reporta erro para skill inexistente", async () => {
  const tools = buildTools(ROOT);
  const get = tools.find((t) => t.name === "melinna_get_skill");
  const result = await get.run({ name: "nao-existe-xyz" });
  assert.equal(result.isError, true);
});
