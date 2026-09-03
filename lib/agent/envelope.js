import { existsSync, mkdirSync, appendFileSync, readFileSync, writeFileSync, readdirSync, unlinkSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { resolveHome } from "../paths.js";
import { ALWAYS_DENIED } from "./stages.js";

/**
 * Envelope de segurança das execuções autônomas.
 *
 * A combinação perigosa não é o agente escrever arquivo — é escrever **sem
 * ninguém olhando**. No modo assistido o usuário vê cada etapa; no autônomo,
 * não. Estes limites são o que torna o segundo aceitável:
 *
 *   - worktree isolado, para o agente nunca tocar a árvore de trabalho;
 *   - teto de gasto, medido no `total_cost_usd` que a própria CLI reporta;
 *   - cancelamento por arquivo, que funciona mesmo de outro terminal;
 *   - registro do que foi feito, para auditar depois.
 *
 * Nenhum deles depende de o agente cooperar.
 */

/** Diretório de estado das execuções. */
export function runsDir() {
  return join(resolveHome(), "runs");
}

/** Arquivo de estado de uma execução. */
export function runStatePath(runId) {
  return join(runsDir(), `${runId}.json`);
}

/** Arquivo cuja existência cancela a execução. */
export function cancelPath(runId) {
  return join(runsDir(), `${runId}.cancel`);
}

/** Registro append-only do que aconteceu. */
export function logPath(runId) {
  return join(runsDir(), `${runId}.log`);
}

/** Identificador de execução legível, com o instante embutido. */
export function newRunId(prefix = "run") {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const stamp =
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `${prefix}-${stamp}`;
}

/**
 * Limites em vigor para uma execução.
 *
 * Os padrões são deliberadamente apertados no modo autônomo: é mais fácil
 * afrouxar depois de ver o comportamento do que explicar um gasto inesperado.
 */
export function buildEnvelope(options = {}) {
  const autonomous = options.mode === "autonomo";
  return {
    mode: options.mode ?? "assistido",
    maxCostUsd: options.maxCost ?? (autonomous ? 5 : 20),
    maxTurnsPerStage: options.maxTurns ?? (autonomous ? 30 : 60),
    stageTimeoutMs: (options.stageTimeout ?? (autonomous ? 15 : 30)) * 60 * 1000,
    // Worktree é obrigatório no autônomo, opcional nos demais.
    requireWorktree: autonomous && options.worktree !== false,
    disallowedTools: [...ALWAYS_DENIED, ...(options.deny ?? [])],
    dryRun: options.dryRun === true,
  };
}

/** Grava uma linha no registro da execução. */
export function logLine(runId, message) {
  const dir = runsDir();
  mkdirSync(dir, { recursive: true });
  appendFileSync(logPath(runId), `${new Date().toISOString()}  ${message}\n`, "utf-8");
}

/** Persiste o estado, para retomar depois. */
export function saveState(runId, state) {
  const path = runStatePath(runId);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`, "utf-8");
}

/** Lê o estado de uma execução anterior. */
export function loadState(runId) {
  const path = runStatePath(runId);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return null;
  }
}

/** Execuções registradas, mais recentes primeiro. */
export function listRuns() {
  const dir = runsDir();
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir)
      .filter((n) => n.endsWith(".json"))
      .map((n) => n.replace(/\.json$/, ""))
      .sort()
      .reverse();
  } catch {
    return [];
  }
}

/**
 * O usuário pediu para parar?
 *
 * Cancelamento por arquivo, e não por sinal, porque precisa funcionar de outro
 * terminal — quem vê a execução saindo do controle não está no processo dela.
 */
export function isCancelled(runId) {
  return existsSync(cancelPath(runId));
}

/** Marca uma execução para parar na próxima fronteira de etapa. */
export function requestCancel(runId) {
  mkdirSync(runsDir(), { recursive: true });
  writeFileSync(cancelPath(runId), `${new Date().toISOString()}\n`, "utf-8");
}

/** Limpa o pedido de cancelamento. */
export function clearCancel(runId) {
  const path = cancelPath(runId);
  if (existsSync(path)) unlinkSync(path);
}

/**
 * Cria (ou reaproveita) um worktree isolado para a execução.
 *
 * O agente autônomo trabalha aqui, nunca na árvore do usuário: se a execução
 * sair errada, descartar é apagar um diretório — não desfazer commits numa
 * branch que ele estava usando.
 *
 * @returns {{ path: string, branch: string, created: boolean }}
 */
export function ensureWorktree(cwd, runId) {
  const branch = `melinna/${runId}`;
  const path = resolve(cwd, "..", `${basename(cwd)}-${runId}`);

  if (existsSync(path)) return { path, branch, created: false };

  try {
    execFileSync("git", ["worktree", "add", "-b", branch, path], {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { path, branch, created: true };
  } catch (err) {
    const detail = err.stderr?.toString().trim().split("\n")[0] ?? err.message;
    throw new Error(
      `Não consegui criar o worktree isolado: ${detail}\n` +
        "O modo autônomo exige isolamento. Use --no-worktree para assumir o risco de escrever direto.",
    );
  }
}

/**
 * A execução ainda cabe no orçamento?
 * @returns {{ ok: boolean, reason?: string }}
 */
export function checkBudget(envelope, spentUsd) {
  if (spentUsd >= envelope.maxCostUsd) {
    return {
      ok: false,
      reason: `Orçamento estourado: US$ ${spentUsd.toFixed(4)} de US$ ${envelope.maxCostUsd.toFixed(2)}.`,
    };
  }
  return { ok: true };
}
