import { spawn } from "node:child_process";
import { resolveBin } from "../tools.js";
import { AGENTS, resolveAgent } from "../agents.js";

/**
 * Execução de uma etapa de agente.
 *
 * A Melinna dirige o agente por **subprocesso**, não por SDK. A documentação do
 * Agent SDK é explícita: ele exige chave de API própria e não pode usar o login
 * do Claude Code — cobrança separada, por token. Já a CLI com `-p
 * --output-format json` expõe o mesmo laço de agente pela assinatura que o
 * usuário já tem, sem credencial nova e sem dependência nova. E vale para
 * qualquer CLI que a Melinna suporta, preservando a agnosticidade do projeto.
 *
 * O JSON devolvido traz o que um orquestrador precisa: `session_id` para
 * retomar a etapa seguinte no mesmo contexto, `total_cost_usd` para o
 * orçamento, `stop_reason` para decidir o próximo passo.
 */

/**
 * Extrai o objeto JSON da saída do agente.
 *
 * A CLI escreve avisos operacionais antes do JSON (workspace não confiado,
 * permissões ignoradas), então tratar a stdout inteira como JSON quebra. Procura
 * a primeira chave e parseia dali.
 *
 * @param {string} stdout
 * @returns {object | null}
 */
export function parseAgentOutput(stdout) {
  const start = stdout.indexOf("{");
  if (start < 0) return null;
  try {
    return JSON.parse(stdout.slice(start));
  } catch {
    // Saída em stream ou truncada: tenta a última linha que seja um objeto.
    for (const line of stdout.split(/\r?\n/).reverse()) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("{")) continue;
      try {
        return JSON.parse(trimmed);
      } catch {
        // linha não é JSON completo, continua
      }
    }
    return null;
  }
}

/**
 * Normaliza o resultado, para o resto da Melinna não depender do formato de um
 * agente específico.
 *
 * @param {object | null} raw
 * @param {number} exitCode
 * @returns {object}
 */
export function normalizeResult(raw, exitCode) {
  if (!raw) {
    return {
      ok: false,
      text: "",
      sessionId: null,
      costUsd: 0,
      turns: 0,
      stopReason: exitCode === 0 ? "sem-saida" : "erro",
      denials: [],
      error: "O agente não devolveu JSON reconhecível.",
      raw: null,
    };
  }

  return {
    ok: raw.is_error !== true && exitCode === 0,
    text: raw.result ?? "",
    sessionId: raw.session_id ?? null,
    costUsd: raw.total_cost_usd ?? 0,
    turns: raw.num_turns ?? 0,
    stopReason: raw.stop_reason ?? raw.subtype ?? "desconhecido",
    denials: raw.permission_denials ?? [],
    error: raw.is_error ? (raw.api_error_status ?? raw.subtype ?? "erro do agente") : null,
    usage: raw.usage ?? null,
    raw,
  };
}

/**
 * Monta os argumentos da CLI a partir das opções da etapa.
 *
 * Só o Claude Code expõe o conjunto completo (`--resume`, `--allowed-tools`,
 * `--max-turns`). Para os demais agentes usamos o modo básico já definido em
 * lib/agents.js — eles executam a etapa, mas sem retomada nem envelope fino.
 */
export function buildArgs(agentName, options = {}) {
  if (agentName !== "claude") {
    const spec = AGENTS[agentName];
    const instruction = options.instruction ?? "Leia a entrada padrão (stdin) e execute a tarefa descrita.";
    return options.readOnly ? spec.read(instruction) : spec.write(instruction, { yolo: options.yolo });
  }

  const args = ["-p", "--output-format", "json"];

  // Retomar a sessão mantém o contexto entre etapas do pipeline sem reenviar
  // tudo — é o que torna o encadeamento viável em custo.
  if (options.resume) args.push("--resume", options.resume);

  // Somente-leitura vem da lista de ferramentas, não do `--permission-mode
  // plan`: o modo plan espera que alguém aprove o plano interativamente, e num
  // pipeline não há ninguém — o agente trava esperando `ExitPlanMode`. Restringir
  // as ferramentas alcança o mesmo efeito e deixa a etapa concluir.
  if (options.yolo) {
    args.push("--dangerously-skip-permissions");
  } else {
    args.push("--permission-mode", options.permissionMode ?? "acceptEdits");
  }

  if (options.allowedTools?.length) args.push("--allowed-tools", ...options.allowedTools);
  // Bloqueio nativo da própria CLI: mais confiável que uma lista de proibidos
  // implementada aqui, que o agente poderia contornar por outro caminho.
  if (options.disallowedTools?.length) args.push("--disallowed-tools", ...options.disallowedTools);
  if (options.maxTurns) args.push("--max-turns", String(options.maxTurns));
  if (options.appendSystemPrompt) args.push("--append-system-prompt", options.appendSystemPrompt);

  return args;
}

/**
 * Executa uma etapa e devolve o resultado normalizado.
 *
 * O prompt vai por stdin (não cabe em argumento), e a stdout é capturada em vez
 * de herdada — é dela que sai o JSON que o orquestrador lê.
 *
 * @param {string} prompt
 * @param {object} options
 * @returns {Promise<object>}
 */
export async function runAgentStep(prompt, options = {}) {
  const agent = await resolveAgent(options.agent);
  if (!agent) {
    return {
      ok: false,
      text: "",
      sessionId: null,
      costUsd: 0,
      turns: 0,
      stopReason: "sem-agente",
      denials: [],
      error: "Nenhum agente de IA encontrado no PATH.",
      raw: null,
    };
  }

  const resolved = resolveBin(agent.name);
  const args = buildArgs(agent.name, options);

  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;

    const child = spawn(resolved, args, {
      cwd: options.cwd,
      stdio: ["pipe", "pipe", "pipe"],
      // Um shim .cmd no Windows precisa de shell; resolveBin já devolveu o
      // caminho real, então isto só cobre o caso de batch.
      shell: /\.(cmd|bat)$/i.test(resolved),
    });

    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    // Teto de tempo: uma etapa travada não pode segurar o pipeline para sempre.
    const timer = options.timeoutMs
      ? setTimeout(() => {
          child.kill();
          finish({
            ok: false,
            text: stdout,
            sessionId: null,
            costUsd: 0,
            turns: 0,
            stopReason: "timeout",
            denials: [],
            error: `A etapa passou de ${Math.round(options.timeoutMs / 1000)}s e foi interrompida.`,
            raw: null,
          });
        }, options.timeoutMs)
      : null;

    child.stdout.on("data", (d) => {
      stdout += d.toString();
      options.onOutput?.(d.toString());
    });
    child.stderr.on("data", (d) => (stderr += d.toString()));

    child.on("error", (err) => {
      if (timer) clearTimeout(timer);
      finish({
        ok: false,
        text: "",
        sessionId: null,
        costUsd: 0,
        turns: 0,
        stopReason: "erro",
        denials: [],
        error: `Falha ao executar ${agent.name}: ${err.message}`,
        raw: null,
      });
    });

    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      const result = normalizeResult(parseAgentOutput(stdout), code ?? 0);
      if (!result.ok && !result.error && stderr.trim()) result.error = stderr.trim().split("\n")[0];
      result.agent = agent.name;
      finish(result);
    });

    child.stdin.on("error", () => {});
    child.stdin.write(prompt);
    child.stdin.end();
  });
}
