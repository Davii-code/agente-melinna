import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildArgs, normalizeResult, parseAgentOutput } from "../lib/agent/runner.js";
import { mcpAllowEntries, withMcpAccess } from "../lib/agent/mcp-access.js";
import {
  AUTONOMY_DIRECTIVE,
  BLOCKED_MARK,
  DECISION_MARK,
  extractBlocked,
  extractDecisions,
  toolsForStack,
} from "../lib/agent/autonomy.js";
import { ALWAYS_DENIED, STAGES, findStage, gateFailed, stageSequence } from "../lib/agent/stages.js";
import {
  buildEnvelope,
  checkBudget,
  clearCancel,
  isCancelled,
  loadState,
  newRunId,
  requestCancel,
  saveState,
} from "../lib/agent/envelope.js";

function withHome(t) {
  const dir = mkdtempSync(join(tmpdir(), "melinna-agent-"));
  const previous = process.env.MELINNA_HOME;
  process.env.MELINNA_HOME = dir;
  t.after(() => {
    if (previous === undefined) delete process.env.MELINNA_HOME;
    else process.env.MELINNA_HOME = previous;
    rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}

// ── Leitura da saída do agente ─────────────────────────────────────────────

test("parseAgentOutput ignora os avisos que a CLI escreve antes do JSON", () => {
  // Regressão real: a CLI imprime "Ignoring N permissions.allow entries..." antes
  // do JSON, então tratar a stdout inteira como JSON quebra.
  const stdout = 'Ignoring 15 permissions.allow entries from settings.\n{"is_error":false,"result":"ok"}';
  assert.deepEqual(parseAgentOutput(stdout), { is_error: false, result: "ok" });
});

test("parseAgentOutput devolve null quando não há JSON", () => {
  assert.equal(parseAgentOutput("erro fatal, nada de JSON"), null);
});

test("normalizeResult extrai o que o orquestrador precisa", () => {
  const r = normalizeResult(
    {
      is_error: false,
      result: "pronto",
      session_id: "abc-123",
      total_cost_usd: 0.42,
      num_turns: 3,
      stop_reason: "end_turn",
      permission_denials: [],
    },
    0,
  );
  assert.equal(r.ok, true);
  assert.equal(r.text, "pronto");
  assert.equal(r.sessionId, "abc-123");
  assert.equal(r.costUsd, 0.42);
  assert.equal(r.turns, 3);
});

test("normalizeResult reprova quando o agente sinaliza erro ou sai != 0", () => {
  assert.equal(normalizeResult({ is_error: true, subtype: "falhou" }, 0).ok, false);
  assert.equal(normalizeResult({ is_error: false }, 1).ok, false);
  assert.equal(normalizeResult(null, 0).ok, false);
});

// ── Argumentos da CLI ──────────────────────────────────────────────────────

test("buildArgs pede JSON, que é o que torna o encadeamento possível", () => {
  const args = buildArgs("claude", {});
  assert.ok(args.includes("--output-format"));
  assert.ok(args.includes("json"));
});

test("etapa somente-leitura NÃO usa --permission-mode plan", () => {
  // Regressão: o modo plan espera aprovação interativa. Num pipeline não há
  // ninguém para aprovar, e o agente travava pedindo `ExitPlanMode`.
  const args = buildArgs("claude", { readOnly: true });
  const modeIndex = args.indexOf("--permission-mode");
  assert.ok(modeIndex >= 0, "deveria definir um modo de permissão");
  assert.notEqual(args[modeIndex + 1], "plan", "modo plan trava a etapa sem usuário");
});

test("buildArgs repassa retomada, limites e bloqueios", () => {
  const args = buildArgs("claude", {
    resume: "sess-1",
    maxTurns: 10,
    allowedTools: ["Read"],
    disallowedTools: ["Bash(git push:*)"],
  });
  assert.ok(args.includes("--resume") && args.includes("sess-1"));
  assert.ok(args.includes("--max-turns") && args.includes("10"));
  assert.ok(args.includes("--allowed-tools") && args.includes("Read"));
  assert.ok(args.includes("--disallowed-tools") && args.includes("Bash(git push:*)"));
});

test("buildArgs cai no formato básico para agentes que não são o claude", () => {
  // codex e cursor-agent não têm --resume nem --output-format json; usar as
  // flags do claude com eles quebraria a execução.
  const args = buildArgs("codex", { instruction: "faça algo" });
  assert.ok(!args.includes("--output-format"));
  assert.ok(args.includes("exec"));
});

// ── Etapas ─────────────────────────────────────────────────────────────────

test("o pipeline termina em portões, não em implementação", () => {
  // Implementar e parar seria afirmar pronto sem verificar — o modo de falha
  // que as skills de verificação existem para impedir.
  const ultimo = STAGES[STAGES.length - 1];
  assert.equal(ultimo.gate, true, "a última etapa precisa ser um portão");
  assert.ok(STAGES.filter((s) => s.gate).length >= 2, "esperava revisão e verificação como portões");
});

test("toda etapa declara objetivo e ferramentas", () => {
  for (const stage of STAGES) {
    assert.ok(stage.id && stage.label, `etapa sem identidade: ${JSON.stringify(stage)}`);
    assert.ok(stage.goal?.length > 20, `${stage.id}: objetivo vago`);
    assert.ok(stage.tools?.length > 0, `${stage.id}: sem ferramentas`);
  }
});

test("etapas de leitura não recebem ferramenta de escrita", () => {
  for (const stage of STAGES.filter((s) => s.readOnly)) {
    assert.ok(!stage.tools.includes("Write"), `${stage.id} é leitura mas pode escrever`);
    assert.ok(!stage.tools.includes("Edit"), `${stage.id} é leitura mas pode editar`);
  }
});

test("operações destrutivas são negadas em toda etapa", () => {
  for (const padrao of ["git push", "reset --hard", "rm -rf"]) {
    assert.ok(
      ALWAYS_DENIED.some((d) => d.includes(padrao)),
      `faltou negar ${padrao}`,
    );
  }
});

test("stageSequence recorta o pipeline", () => {
  assert.equal(stageSequence({}).length, STAGES.length);
  assert.deepEqual(
    stageSequence({ from: "implementar" }).map((s) => s.id),
    ["implementar", "revisar", "verificar"],
  );
  assert.deepEqual(stageSequence({ only: ["entender"] }).map((s) => s.id), ["entender"]);
  assert.deepEqual(stageSequence({ to: "planejar" }).map((s) => s.id), ["entender", "especificar", "planejar"]);
});

test("stageSequence recusa etapa inexistente e intervalo vazio", () => {
  assert.throws(() => stageSequence({ from: "nao-existe" }), /não existe/);
  assert.throws(() => stageSequence({ from: "verificar", to: "entender" }), /vazio/);
});

test("findStage acha por id", () => {
  assert.equal(findStage("revisar").label, "Revisar");
  assert.equal(findStage("inventada"), null);
});

// ── Portões ────────────────────────────────────────────────────────────────

test("portão reprova quando a resposta sinaliza problema", () => {
  const revisar = findStage("revisar");
  const base = { ok: true, text: "" };
  assert.equal(gateFailed(revisar, { ...base, text: "Tudo certo, nenhum achado." }), false);
  assert.equal(gateFailed(revisar, { ...base, text: "Achado crítico no parser." }), true);
  assert.equal(gateFailed(revisar, { ...base, text: "O trabalho não está pronto." }), true);
  assert.equal(gateFailed(revisar, { ...base, text: "2 tests failed" }), true);
});

test("etapa que não é portão nunca interrompe o pipeline", () => {
  const entender = findStage("entender");
  assert.equal(gateFailed(entender, { ok: true, text: "achado crítico em tudo" }), false);
});

test("portão reprova quando a etapa em si falhou", () => {
  assert.equal(gateFailed(findStage("verificar"), { ok: false, text: "" }), true);
});

// ── Envelope ───────────────────────────────────────────────────────────────

test("modo autônomo tem limites mais apertados que o assistido", () => {
  const auto = buildEnvelope({ mode: "autonomo" });
  const assistido = buildEnvelope({ mode: "assistido" });
  assert.ok(auto.maxCostUsd < assistido.maxCostUsd, "autônomo deveria gastar menos por padrão");
  assert.ok(auto.maxTurnsPerStage < assistido.maxTurnsPerStage);
  assert.equal(auto.requireWorktree, true, "autônomo tem de isolar por padrão");
  assert.equal(assistido.requireWorktree, false);
});

test("--no-worktree desliga o isolamento, mas só se pedido", () => {
  assert.equal(buildEnvelope({ mode: "autonomo", worktree: false }).requireWorktree, false);
});

test("o envelope sempre carrega os bloqueios destrutivos", () => {
  const env = buildEnvelope({ mode: "autonomo", deny: ["Bash(curl:*)"] });
  for (const d of ALWAYS_DENIED) assert.ok(env.disallowedTools.includes(d), `perdeu o bloqueio ${d}`);
  assert.ok(env.disallowedTools.includes("Bash(curl:*)"), "não somou o bloqueio extra");
});

test("checkBudget corta quando o gasto alcança o teto", () => {
  const env = buildEnvelope({ mode: "autonomo", maxCost: 1 });
  assert.equal(checkBudget(env, 0.5).ok, true);
  const estourou = checkBudget(env, 1.0);
  assert.equal(estourou.ok, false);
  assert.match(estourou.reason, /Orçamento/);
});

// ── Autonomia ──────────────────────────────────────────────────────────────

test("a diretiva diz que não há ninguém para responder", () => {
  // É a instrução que contraria o padrão do agente. Sem afirmar a ausência de
  // usuário, ele pergunta e a etapa termina sem ter feito o trabalho.
  assert.match(AUTONOMY_DIRECTIVE, /não há ninguém para responder/i);
  assert.match(AUTONOMY_DIRECTIVE, /decida/i);
  assert.ok(AUTONOMY_DIRECTIVE.includes(DECISION_MARK), "precisa ensinar como registrar a decisão");
  assert.ok(AUTONOMY_DIRECTIVE.includes(BLOCKED_MARK), "precisa manter uma forma de parar");
});

test("extractDecisions recolhe o que o agente decidiu sozinho", () => {
  const texto = [
    "Implementei o frete.",
    `${DECISION_MARK} parâmetro em vez de módulo novo — o arquivo tem uma função só.`,
    "Depois rodei os testes.",
    `${DECISION_MARK} testes em test/, não havia convenção no repo.`,
  ].join("\n");
  const decisoes = extractDecisions(texto);
  assert.equal(decisoes.length, 2);
  assert.match(decisoes[0], /parâmetro em vez de módulo/);
});

test("extractDecisions devolve vazio quando não houve decisão", () => {
  assert.deepEqual(extractDecisions("Só implementei o que foi pedido."), []);
});

test("extractBlocked reconhece a parada legítima", () => {
  // Parar diante de algo irreversível é o comportamento certo — não é falha.
  const motivo = extractBlocked(`${BLOCKED_MARK} apagar a tabela de pedidos é irreversível e não foi pedido.`);
  assert.match(motivo, /irreversível/);
  assert.equal(extractBlocked("tudo certo, implementado"), null);
});

test("toolsForStack dá os comandos que a stack exige", () => {
  // Regressão: sem `mvn` no allowlist, a verificação num projeto Java falha por
  // permissão — e o sintoma engana, porque parece teste quebrado.
  const java = toolsForStack(["java", "spring"]);
  assert.ok(java.some((t) => t.includes("mvn")), `esperava mvn: ${java}`);

  const flutter = toolsForStack(["flutter", "dart"]);
  assert.ok(flutter.some((t) => t.includes("flutter")));

  assert.deepEqual(toolsForStack([]), [], "sem stack, sem comando extra");
});

test("toolsForStack não repete comando compartilhado entre stacks", () => {
  const tools = toolsForStack(["node", "react", "nextjs"]);
  assert.equal(new Set(tools).size, tools.length, "houve duplicata");
});

// ── Acesso a MCP ───────────────────────────────────────────────────────────

test("libera MCP por servidor, não por curinga", () => {
  // Regressão: `mcp__*` é recusado pela CLI; a liberação tem de nomear cada
  // servidor. Sem isso o allowlist bloqueava Jira, GitHub e todo o resto.
  const entries = mcpAllowEntries(["jira", "github"]);
  assert.deepEqual(entries, ["mcp__jira", "mcp__github"]);
  assert.ok(!entries.some((e) => e.includes("*")), "curinga não funciona no --allowed-tools");
});

test("withMcpAccess soma os servidores às ferramentas da etapa", () => {
  const tools = withMcpAccess(["Read", "Grep"], { servers: ["jira"] });
  assert.ok(tools.includes("Read"), "não pode perder as ferramentas da etapa");
});

test("--no-mcp devolve a etapa intacta", () => {
  const tools = withMcpAccess(["Read"], { mcp: false });
  assert.deepEqual(tools, ["Read"]);
});

test("mcpAllowEntries respeita only e exclude", () => {
  const servers = ["jira", "github", "melinna"];
  assert.deepEqual(mcpAllowEntries(servers, { only: ["jira"] }), ["mcp__jira"]);
  assert.deepEqual(mcpAllowEntries(servers, { exclude: ["melinna"] }), ["mcp__jira", "mcp__github"]);
});

test("a própria Melinna fica fora por padrão", () => {
  // Chamar a Melinna de dentro de uma execução dela seria recursão sem ganho:
  // a etapa já roda com stack detectada e skills carregadas.
  const entries = mcpAllowEntries(["jira", "melinna"], { exclude: ["melinna"] });
  assert.ok(!entries.includes("mcp__melinna"));
  assert.ok(entries.includes("mcp__jira"));
});

// ── Estado e cancelamento ──────────────────────────────────────────────────

test("estado da execução vai e volta do disco", (t) => {
  withHome(t);
  const id = newRunId();
  saveState(id, { runId: id, task: "x", spentUsd: 1.5, stages: [] });
  const lido = loadState(id);
  assert.equal(lido.task, "x");
  assert.equal(lido.spentUsd, 1.5);
});

test("loadState devolve null para execução desconhecida", (t) => {
  withHome(t);
  assert.equal(loadState("nunca-existiu"), null);
});

test("cancelamento é por arquivo, para funcionar de outro terminal", (t) => {
  withHome(t);
  const id = newRunId();
  assert.equal(isCancelled(id), false);
  requestCancel(id);
  assert.equal(isCancelled(id), true, "o pedido de parada deveria ser visível de fora do processo");
  clearCancel(id);
  assert.equal(isCancelled(id), false);
});

test("newRunId é ordenável e único o bastante", () => {
  const a = newRunId();
  assert.match(a, /^run-\d{8}-\d{6}$/);
});
