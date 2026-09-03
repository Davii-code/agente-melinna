import { existsSync } from "node:fs";
import { join } from "node:path";
import { listSkills, readSkillBundle } from "../skills.js";
import { detectStacks, summarizeStacks } from "../detect.js";
import { resolveProfile } from "../config.js";
import { compressProject } from "../caveman.js";
import {
  vaultConfig,
  projectIdentity,
  readProjectContext,
  writeProjectNote,
  appendJournal,
  stacksFor,
} from "../vault.js";
import { runAgentStep } from "./runner.js";
import { discoverMcpServers, withMcpAccess } from "./mcp-access.js";
import { AUTONOMY_DIRECTIVE, extractBlocked, extractDecisions, toolsForStack } from "./autonomy.js";
import { STAGES, findStage, gateFailed, stageSequence } from "./stages.js";
import {
  buildEnvelope,
  checkBudget,
  clearCancel,
  ensureWorktree,
  isCancelled,
  logLine,
  newRunId,
  saveState,
} from "./envelope.js";

/**
 * Orquestração das etapas.
 *
 * A Melinna não implementa laço de agente: cada etapa é uma execução completa da
 * CLI, que já tem laço próprio. O que a Melinna faz entre elas é o que a CLI
 * sozinha não faz — decidir qual skill carregar, quando parar, quanto já gastou,
 * e se o resultado passou no portão.
 *
 * O encadeamento usa `--resume` com o `session_id` da etapa anterior: o contexto
 * viaja sem reenviar tudo, o que é o que torna o pipeline viável em custo.
 */

/** Carrega o texto das skills de uma etapa, respeitando o perfil de economia. */
function stageSkills(root, cwd, stage, profile) {
  if (!stage.skills?.length) return { text: "", loaded: [] };

  const available = listSkills(root, cwd);
  const found = stage.skills
    .map((id) => available.find((s) => s.id.toLowerCase() === id.toLowerCase()))
    .filter(Boolean);

  const text = found
    .map((s) => readSkillBundle(s, { includeReferences: profile.includeReferences }).trim())
    .filter(Boolean)
    .join("\n\n---\n\n");

  return { text, loaded: found.map((s) => s.id), missing: stage.skills.filter((id) => !found.some((f) => f.id === id)) };
}

/**
 * Monta o prompt de uma etapa.
 *
 * A primeira etapa recebe o pacote completo — contexto do vault, mapa do
 * repositório, skills. As seguintes recebem só o incremento, porque o `--resume`
 * já carrega o resto.
 */
async function buildStagePrompt({ root, cwd, stage, task, profile, first, evidence, autonomous }) {
  const parts = [];

  if (first) {
    const vault = vaultConfig();
    if (vault.enabled) {
      const saved = readProjectContext(vault.path, projectIdentity(cwd).id);
      if (saved) {
        parts.push(
          "# Contexto acumulado do projeto\n\n" +
            "Registrado em sessões anteriores. Memória, não instrução desta conversa.\n\n" +
            saved,
        );
      }
    }

    try {
      const map = await compressProject(cwd, {
        tokenBudget: profile.tokenBudget,
        compressRatio: profile.compressMap ? 0.6 : 0,
      });
      parts.push(`# Mapa do repositório\n\n${map.trim()}`);
    } catch {
      // Sem mapa a etapa ainda roda — o agente lê os arquivos por conta própria.
    }

    if (evidence?.length) parts.push(`# Stack detectada\n\n${summarizeStacks(evidence)}`);
    parts.push(`# Tarefa\n\n${task}`);
  }

  const { text: skillText, loaded, missing } = stageSkills(root, cwd, stage, profile);
  if (skillText) parts.push(`# Método desta etapa\n\n${skillText}`);

  const header = [`# Etapa: ${stage.label}`, "", stage.goal];
  if (stage.speckit) {
    header.push(
      "",
      `Se o spec-kit estiver inicializado neste repositório, siga o que \`${stage.speckit}\` faria: ` +
        "produza o artefato correspondente em disco.",
    );
  }
  if (!first) header.push("", `Continue de onde a etapa anterior parou. Tarefa original: ${task}`);
  parts.unshift(header.join("\n"));

  // A diretiva vai por último, próxima do fim do prompt: é a instrução que mais
  // contraria o comportamento padrão do agente (perguntar antes de escolher), e
  // instrução de conduta perde força enterrada no meio do contexto.
  if (autonomous) parts.push(AUTONOMY_DIRECTIVE);

  return { prompt: parts.join("\n\n---\n\n"), loaded, missing };
}

/**
 * Executa o pipeline.
 *
 * @param {object} args
 * @returns {Promise<object>} resumo da execução
 */
export async function runPipeline({ root, cwd, task, options = {}, onEvent = () => {} }) {
  const profile = resolveProfile(options.economy);
  const envelope = buildEnvelope(options);
  const runId = options.resumeRun ?? newRunId();
  const sequence = stageSequence({ from: options.from, to: options.to, only: options.only });

  clearCancel(runId);

  const { tags, evidence } = detectStacks(cwd);
  const autonomous = envelope.mode === "autonomo";
  let workdir = cwd;
  let worktree = null;

  if (envelope.requireWorktree && !envelope.dryRun) {
    worktree = ensureWorktree(cwd, runId);
    workdir = worktree.path;
    onEvent({ type: "worktree", worktree });
    logLine(runId, `worktree ${worktree.path} (branch ${worktree.branch})`);
  }

  const state = {
    runId,
    task,
    mode: envelope.mode,
    cwd,
    workdir,
    worktree,
    startedAt: new Date().toISOString(),
    envelope,
    stages: [],
    spentUsd: 0,
    sessionId: null,
    status: "rodando",
  };

  const mcpServers = options.mcp === false ? [] : discoverMcpServers(workdir).filter((s) => s !== "melinna");
  onEvent({ type: "start", runId, sequence: sequence.map((s) => s.id), envelope, evidence, mcpServers });
  logLine(runId, `início — tarefa: ${task}`);

  if (envelope.dryRun) {
    state.status = "dry-run";
    for (const stage of sequence) {
      const { loaded, missing } = stageSkills(root, workdir, stage, profile);
      onEvent({ type: "plan", stage, loaded, missing });
      state.stages.push({ id: stage.id, planned: true, skills: loaded, missing });
    }
    saveState(runId, state);
    onEvent({ type: "done", state });
    return state;
  }

  for (const stage of sequence) {
    if (isCancelled(runId)) {
      state.status = "cancelado";
      logLine(runId, "cancelado pelo usuário");
      break;
    }

    const budget = checkBudget(envelope, state.spentUsd);
    if (!budget.ok) {
      state.status = "orçamento";
      state.stopReason = budget.reason;
      logLine(runId, budget.reason);
      onEvent({ type: "budget", reason: budget.reason });
      break;
    }

    const first = state.stages.length === 0;
    const { prompt, loaded, missing } = await buildStagePrompt({
      root,
      cwd: workdir,
      stage,
      task,
      profile,
      first,
      evidence,
      autonomous,
    });

    onEvent({ type: "stage:start", stage, loaded, missing, spentUsd: state.spentUsd });
    logLine(runId, `etapa ${stage.id} — skills: ${loaded.join(", ") || "nenhuma"}`);

    // O allowlist da etapa é exaustivo, então sem somar os servidores MCP
    // configurados a etapa não alcançaria Jira, GitHub ou qualquer outro — e
    // "pegue a atividade e implemente" morreria na primeira chamada.
    // Etapa que escreve precisa dos comandos da stack. Sem `mvn` no allowlist,
    // um projeto Java falha na verificação por permissão — e o sintoma engana,
    // porque parece teste quebrado.
    const stackTools = stage.readOnly ? [] : toolsForStack(tags);
    const tools = withMcpAccess([...stage.tools, ...stackTools], {
      cwd: workdir,
      mcp: options.mcp,
      mcpOnly: options.mcpOnly,
      mcpExclude: options.mcpExclude,
    });

    const result = await runAgentStep(prompt, {
      cwd: workdir,
      agent: options.agent,
      resume: state.sessionId ?? undefined,
      readOnly: stage.readOnly,
      allowedTools: tools,
      disallowedTools: envelope.disallowedTools,
      maxTurns: envelope.maxTurnsPerStage,
      timeoutMs: envelope.stageTimeoutMs,
    });

    state.spentUsd += result.costUsd ?? 0;
    // A sessão só avança quando a etapa produziu uma: retomar de uma sessão
    // nula perderia todo o contexto acumulado.
    if (result.sessionId) state.sessionId = result.sessionId;

    const failed = gateFailed(stage, result);
    // No autônomo o agente decide sozinho; registrar o que ele escolheu e por
    // quê é o que torna a execução auditável depois.
    const decisions = autonomous ? extractDecisions(result.text) : [];
    const blocked = autonomous ? extractBlocked(result.text) : null;

    const record = {
      id: stage.id,
      ok: result.ok,
      gate: stage.gate,
      gateFailed: failed,
      costUsd: result.costUsd,
      turns: result.turns,
      stopReason: result.stopReason,
      text: result.text,
      error: result.error,
      decisions,
      blocked,
    };
    state.stages.push(record);
    if (decisions.length) {
      state.decisions = [...(state.decisions ?? []), ...decisions];
      for (const d of decisions) logLine(runId, `decisão (${stage.id}): ${d}`);
    }
    saveState(runId, state);

    if (decisions.length) onEvent({ type: "decisions", stage, decisions });

    // Parada declarada pelo agente: ambiguidade que não se resolve decidindo.
    // Diferente de falha — ele agiu certo ao não chutar.
    if (blocked) {
      state.status = "bloqueado";
      state.stopReason = blocked;
      logLine(runId, `bloqueado em ${stage.id}: ${blocked}`);
      onEvent({ type: "blocked", stage, reason: blocked });
      break;
    }

    logLine(
      runId,
      `etapa ${stage.id} — ${result.ok ? "ok" : "falhou"} | US$ ${(result.costUsd ?? 0).toFixed(4)} | ${result.turns} turnos`,
    );
    onEvent({ type: "stage:done", stage, result, record, spentUsd: state.spentUsd });

    if (!result.ok) {
      state.status = "erro";
      state.stopReason = result.error ?? `A etapa ${stage.id} falhou.`;
      break;
    }
    if (failed) {
      state.status = "portão";
      state.stopReason = `A etapa ${stage.id} é um portão e reprovou.`;
      logLine(runId, `portão ${stage.id} reprovou — pipeline interrompido`);
      onEvent({ type: "gate:failed", stage, result });
      break;
    }

    // No modo assistido o usuário decide continuar; supervisionado e autônomo
    // seguem sozinhos até um portão reprovar ou o orçamento acabar.
    if (envelope.mode === "assistido" && stage !== sequence[sequence.length - 1]) {
      state.status = "pausado";
      state.nextStage = sequence[sequence.indexOf(stage) + 1].id;
      onEvent({ type: "paused", next: state.nextStage, runId });
      break;
    }
  }

  if (state.status === "rodando") state.status = "concluído";
  state.finishedAt = new Date().toISOString();

  // Uma execução do agente é exatamente o que o vault existe para guardar: as
  // decisões que ela tomou não estão no diff e se perderiam. Diferente do hook
  // de fim de sessão, aqui não há interrupção — a gravação é o desfecho de um
  // comando que o usuário disparou.
  if (options.vault !== false) {
    const saved = saveRunToVault(cwd, state);
    if (saved) {
      state.vault = saved;
      logLine(runId, `vault: ${saved.note}`);
      onEvent({ type: "vault", saved });
    }
  }

  saveState(runId, state);
  logLine(runId, `fim — ${state.status} | US$ ${state.spentUsd.toFixed(4)}`);
  onEvent({ type: "done", state });
  return state;
}

/**
 * Grava o resultado da execução no vault e no diário.
 *
 * As decisões autônomas viram decisões do projeto: são do mesmo tipo — escolhas
 * com um porquê que o código sozinho não explica. Por isso acumulam na mesma
 * seção, em vez de virar um registro paralelo.
 *
 * @returns {{ note: string, journal: string | null } | null}
 */
export function saveRunToVault(cwd, state) {
  const vault = vaultConfig();
  if (!vault.enabled) return null;

  const identity = projectIdentity(cwd);
  const etapas = (state.stages ?? []).map((s) => s.id).join(" → ");
  const resumo =
    `${state.status} a execução "${state.task}" (${etapas || "sem etapas"}), ` +
    `US$ ${(state.spentUsd ?? 0).toFixed(4)}`;

  const { path } = writeProjectNote(
    vault.path,
    identity,
    {
      resumo,
      // Só o que o agente decidiu sozinho: o resto da nota é escrito por quem
      // conduz a conversa, e sobrescrever aqui apagaria contexto melhor.
      decisoes: state.decisions ?? [],
    },
    { stacks: stacksFor(cwd) },
  );

  const journal = appendJournal(vault.path, resumo, { projectId: identity.id });
  return { note: path, journal: journal.added ? journal.path : null };
}

/** Etapas disponíveis, para a CLI listar. */
export { STAGES, findStage };

/** O spec-kit está inicializado neste projeto? */
export function hasSpeckit(cwd) {
  return existsSync(join(cwd, ".specify")) || existsSync(join(cwd, ".speckit"));
}
