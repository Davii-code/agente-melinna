import chalk from "chalk";
import { confirm } from "@inquirer/prompts";
import { runPipeline, hasSpeckit } from "../agent/pipeline.js";
import { STAGES } from "../agent/stages.js";
import { summarizeStacks } from "../detect.js";
import {
  listRuns,
  loadState,
  logPath,
  requestCancel,
  runStatePath,
} from "../agent/envelope.js";

/** Modos aceitos, do mais contido ao mais solto. */
const MODES = ["assistido", "supervisionado", "autonomo"];

/** Uma linha por etapa concluída. */
function printStage(stage, result, spentUsd) {
  const mark = result.ok ? chalk.green("✔") : chalk.red("✘");
  console.log(
    `${mark} ${chalk.bold(stage.label)} ` +
      chalk.dim(`(${result.turns} turnos, US$ ${(result.costUsd ?? 0).toFixed(4)}, acumulado US$ ${spentUsd.toFixed(4)})`),
  );
  const text = (result.text ?? "").trim();
  if (text) {
    // Só o começo: a resposta inteira vai para o log, o terminal fica legível.
    const lines = text.split("\n").slice(0, 8);
    for (const line of lines) console.log(chalk.dim(`    ${line}`));
    if (text.split("\n").length > 8) console.log(chalk.dim("    ..."));
  }
  if (result.error) console.log(chalk.red(`    ${result.error}`));
}

/**
 * `melinna run <tarefa>`: conduz a tarefa pelas etapas do pipeline.
 *
 * É o modo agente: em vez de um disparo único, a Melinna encadeia etapas —
 * entender, especificar, planejar, implementar, revisar, verificar — carregando
 * em cada uma só as skills daquela etapa e parando quando um portão reprova.
 */
export async function run(root, cwd, task, options = {}) {
  const mode = options.auto ? "autonomo" : (options.mode ?? "assistido");
  if (!MODES.includes(mode)) {
    console.log(chalk.red(`Modo "${mode}" inválido. Use: ${MODES.join(", ")}`));
    process.exitCode = 1;
    return;
  }

  // `--auto` é o atalho para "vai sozinho e não me pergunta nada": liga o modo
  // autônomo e dispensa a confirmação de uma vez. Existe porque pedir duas
  // flags para dizer a mesma coisa é atrito sem ganho.
  if (options.auto) {
    options = { ...options, yes: true };
  }

  // O autônomo escreve sem ninguém olhando: confirmação explícita, salvo quando
  // o usuário já assumiu isso na linha de comando (uso em cron).
  if (mode === "autonomo" && !options.yes && !options.dryRun) {
    console.log(chalk.yellow("Modo autônomo: o agente vai executar todas as etapas sem parar para você aprovar."));
    console.log(chalk.dim(`  teto de gasto: US$ ${(options.maxCost ?? 5).toFixed(2)}`));
    console.log(chalk.dim(`  worktree isolado: ${options.worktree === false ? "NÃO" : "sim"}`));
    const ok = await confirm({ message: "Seguir?", default: false });
    if (!ok) {
      console.log(chalk.dim("Cancelado."));
      return;
    }
  }

  if (!hasSpeckit(cwd)) {
    console.log(chalk.dim("spec-kit não inicializado aqui — as etapas de artefato vão produzir os arquivos mesmo assim."));
    console.log(chalk.dim("Para a estrutura completa: `melinna speckit <feature>`."));
  }

  const state = await runPipeline({
    root,
    cwd,
    task,
    options: { ...options, mode },
    onEvent: (event) => {
      switch (event.type) {
        case "start":
          console.log(chalk.bold(`\nExecução ${event.runId}`));
          if (event.evidence?.length) {
            console.log(chalk.dim(`Stack: ${summarizeStacks(event.evidence)}`));
          }
          console.log(chalk.dim(`Modo: ${event.envelope.mode} | etapas: ${event.sequence.join(" → ")}`));
          console.log(chalk.dim(`Teto: US$ ${event.envelope.maxCostUsd.toFixed(2)}`));
          console.log(
            chalk.dim(
              event.mcpServers?.length
                ? `MCP disponível: ${event.mcpServers.join(", ")}`
                : "MCP: nenhum servidor liberado",
            ),
          );
          console.log("");
          break;
        case "worktree":
          console.log(`${chalk.cyan("⎇")} worktree ${event.worktree.path} ${chalk.dim(`(${event.worktree.branch})`)}`);
          break;
        case "plan":
          console.log(
            `  ${chalk.dim("·")} ${event.stage.label} ${chalk.dim(`— skills: ${event.loaded.join(", ") || "nenhuma"}`)}`,
          );
          if (event.missing?.length) {
            console.log(chalk.yellow(`      faltando: ${event.missing.join(", ")}`));
          }
          break;
        case "stage:start":
          console.log(chalk.cyan(`▶ ${event.stage.label}...`));
          if (event.missing?.length) {
            console.log(chalk.yellow(`  skills não instaladas: ${event.missing.join(", ")}`));
            console.log(chalk.dim("  `melinna skills install superpowers` traz as do método."));
          }
          break;
        case "stage:done":
          printStage(event.stage, event.result, event.spentUsd);
          break;
        case "decisions":
          for (const d of event.decisions) console.log(chalk.magenta(`    ⓘ decidiu: ${d}`));
          break;
        case "blocked":
          console.log(chalk.yellow(`\n⚠ Parou em "${event.stage.label}": ${event.reason}`));
          console.log(chalk.dim("  O agente não chutou numa ambiguidade irreversível — isso é o comportamento certo."));
          break;
        case "vault":
          console.log(chalk.dim(`\n📓 vault: ${event.saved.note}`));
          if (event.saved.journal) console.log(chalk.dim(`   diário: ${event.saved.journal}`));
          break;
        case "gate:failed":
          console.log(chalk.red(`\n✘ Portão "${event.stage.label}" reprovou — pipeline interrompido.`));
          break;
        case "budget":
          console.log(chalk.yellow(`\n⚠ ${event.reason}`));
          break;
        case "paused":
          console.log(chalk.dim(`\nPausado. Próxima etapa: ${event.next}`));
          console.log(chalk.dim(`Continue com: melinna run --resume-run ${event.runId} --from ${event.next}`));
          break;
        default:
          break;
      }
    },
  });

  console.log("");
  const cor = state.status === "concluído" ? chalk.green : state.status === "pausado" ? chalk.dim : chalk.yellow;
  console.log(cor(`${state.status} — US$ ${state.spentUsd.toFixed(4)} em ${state.stages.length} etapa(s)`));
  if (state.stopReason) console.log(chalk.dim(`  ${state.stopReason}`));

  // As decisões tomadas sozinho são o que você precisa revisar depois — mais
  // que o diff, porque explicam por que o diff ficou daquele jeito.
  if (state.decisions?.length) {
    console.log("");
    console.log(chalk.bold(`Decisões tomadas sozinho (${state.decisions.length})`));
    for (const d of state.decisions) console.log(chalk.magenta(`  · ${d}`));
  }
  if (state.worktree) {
    console.log(chalk.dim(`  trabalho em ${state.worktree.path} (branch ${state.worktree.branch})`));
    console.log(chalk.dim(`  revise e integre com: git -C "${state.cwd}" merge ${state.worktree.branch}`));
  }
  console.log(chalk.dim(`  registro: ${logPath(state.runId)}`));

  if (state.status === "erro" || state.status === "portão") process.exitCode = 1;
}

/** `melinna run-list`: execuções registradas. */
export function runList() {
  const runs = listRuns();
  if (runs.length === 0) {
    console.log(chalk.dim("Nenhuma execução registrada."));
    return;
  }
  console.log(chalk.bold("Execuções"));
  for (const id of runs.slice(0, 20)) {
    const state = loadState(id);
    if (!state) continue;
    const cor = state.status === "concluído" ? chalk.green : chalk.yellow;
    console.log(
      `  ${cor(state.status.padEnd(12))} ${id} ${chalk.dim(`US$ ${(state.spentUsd ?? 0).toFixed(4)} — ${state.task?.slice(0, 50) ?? ""}`)}`,
    );
  }
  console.log(chalk.dim(`\nDetalhe: melinna run-show <id>`));
}

/** `melinna run-show <id>`: detalhe de uma execução. */
export function runShow(runId) {
  const state = loadState(runId);
  if (!state) {
    console.log(chalk.red(`Execução "${runId}" não encontrada.`));
    process.exitCode = 1;
    return;
  }
  console.log(chalk.bold(`Execução ${runId}`));
  console.log(chalk.dim(`  ${state.task}`));
  console.log(chalk.dim(`  modo ${state.mode} | ${state.status} | US$ ${(state.spentUsd ?? 0).toFixed(4)}`));
  console.log("");
  for (const stage of state.stages ?? []) {
    const mark = stage.ok ? chalk.green("✔") : chalk.red("✘");
    const flag = stage.gateFailed ? chalk.red(" [portão reprovou]") : "";
    console.log(`${mark} ${stage.id}${flag} ${chalk.dim(`US$ ${(stage.costUsd ?? 0).toFixed(4)}`)}`);
  }
  console.log("");
  console.log(chalk.dim(`estado: ${runStatePath(runId)}`));
  console.log(chalk.dim(`registro: ${logPath(runId)}`));
}

/** `melinna run-stop <id>`: pede parada na próxima fronteira de etapa. */
export function runStop(runId) {
  requestCancel(runId);
  console.log(`${chalk.green("✔")} Parada solicitada para ${runId}.`);
  console.log(chalk.dim("  A execução para ao terminar a etapa atual — não interrompe no meio."));
}

/** `melinna run-stages`: as etapas do pipeline. */
export function runStages() {
  console.log(chalk.bold("Etapas do pipeline"));
  for (const stage of STAGES) {
    const flags = [stage.readOnly ? "leitura" : "escrita", stage.gate ? chalk.magenta("portão") : null]
      .filter(Boolean)
      .join(", ");
    console.log(`  ${chalk.bold(stage.id.padEnd(14))} ${chalk.dim(`[${flags}]`)}`);
    console.log(chalk.dim(`    ${stage.goal.split(".")[0]}.`));
    if (stage.skills.length) console.log(chalk.dim(`    skills: ${stage.skills.join(", ")}`));
    if (stage.speckit) console.log(chalk.dim(`    spec-kit: ${stage.speckit}`));
  }
}
