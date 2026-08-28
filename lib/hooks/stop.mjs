#!/usr/bin/env node
/**
 * Hook `Stop` do Claude Code.
 *
 * Roda quando o agente termina de responder e decide se pede a ele que grave o
 * contexto da sessão no vault antes de encerrar.
 *
 * Por que pedir ao modelo em vez de extrair do transcript: o que interessa
 * guardar é o "por quê" — a decisão arquitetural, a regra combinada, o que foi
 * tentado e descartado. Isso não sai de uma varredura mecânica do transcript;
 * quem entende o que aconteceu é o próprio agente.
 *
 * Contrato com o Claude Code:
 *   - entrada: JSON na stdin com hook_event_name, cwd, transcript_path,
 *     session_id e stop_hook_active.
 *   - saída: JSON na stdout. `{"decision":"block","reason":"..."}` devolve o
 *     controle ao modelo com uma instrução; `{}` deixa encerrar.
 *   - sempre sai com código 0: um hook que falha não pode travar a sessão.
 */
import { readFileSync, existsSync, mkdirSync, writeFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

/** Encerra deixando a sessão seguir. */
function allow() {
  process.stdout.write("{}");
  process.exit(0);
}

/** Devolve o controle ao modelo com uma instrução. */
function askModel(message) {
  process.stdout.write(JSON.stringify({ decision: "block", reason: message }));
  process.exit(0);
}

function readStdin() {
  try {
    return JSON.parse(readFileSync(0, "utf-8") || "{}");
  } catch {
    return {};
  }
}

/** Raiz de dados da Melinna — o mesmo caminho que lib/paths.js resolve. */
function melinnaHome() {
  return process.env.MELINNA_HOME || join(homedir(), ".melinna");
}

function readJson(path, fallback) {
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return fallback;
  }
}

/**
 * Estado por sessão, para o hook não pedir gravação a cada resposta.
 *
 * O evento `Stop` dispara ao fim de CADA turno do agente, não só quando o chat
 * fecha — sem essa trava, uma conversa de vinte turnos pediria vinte gravações.
 */
function stateFile() {
  return join(melinnaHome(), "vault-sessions.json");
}

function loadState() {
  return readJson(stateFile(), {});
}

function saveState(state) {
  const path = stateFile();
  mkdirSync(join(path, ".."), { recursive: true });
  // Guarda só as 200 sessões mais recentes: o arquivo é escrito a cada turno.
  const entries = Object.entries(state)
    .sort((a, b) => (b[1]?.at ?? 0) - (a[1]?.at ?? 0))
    .slice(0, 200);
  writeFileSync(path, JSON.stringify(Object.fromEntries(entries)), "utf-8");
}

/**
 * A sessão fez trabalho que valha registrar?
 *
 * Uma conversa que só leu arquivos não muda o entendimento do projeto. Procura
 * uso de ferramenta de escrita no transcript — se não achar, não vale acordar o
 * modelo para gravar nada.
 */
function didRealWork(transcriptPath, sinceBytes) {
  if (!transcriptPath || !existsSync(transcriptPath)) return false;
  try {
    const size = statSync(transcriptPath).size;
    if (size <= sinceBytes) return false;
    const text = readFileSync(transcriptPath, "utf-8");
    return /"(Edit|Write|NotebookEdit|MultiEdit)"|melinna_task|git commit/.test(text);
  } catch {
    return false;
  }
}

const INSTRUCTION = [
  "Antes de encerrar, grave o contexto desta sessão no vault da Melinna.",
  "",
  "Chame `melinna_vault_save` com o que ficou aprendido sobre ESTE projeto:",
  "",
  "- `resumo`: **uma linha só**, no passado, dizendo o que foi feito nesta sessão.",
  "- `arquitetura`: como o projeto está organizado hoje (substitui o texto anterior).",
  "- `decisoes`: decisões tomadas e o porquê (acumulam entre sessões).",
  "- `regras`: convenções combinadas, o que evitar (acumulam).",
  "- `atencao`: o que está frágil ou merece cuidado (substitui).",
  "",
  "Registre só o que NÃO dá para deduzir lendo o código na próxima sessão — a",
  "intenção por trás das escolhas, não o que os arquivos já mostram. Se nada",
  "relevante mudou, chame mesmo assim com apenas `resumo`.",
  "",
  "Depois disso, encerre normalmente. Não repita esta gravação nesta sessão.",
].join("\n");

function main() {
  const input = readStdin();

  // Trava de loop do próprio Claude Code: quando já bloqueamos uma vez, esta
  // flag vem ligada. Insistir criaria laço infinito.
  if (input.stop_hook_active) allow();

  const config = readJson(join(melinnaHome(), "config.json"), {});
  const vault = config.vault ?? {};
  if (!vault.enabled || !vault.path) allow();

  const sessionId = input.session_id || "sem-sessao";
  const state = loadState();
  const entry = state[sessionId] ?? { at: 0, bytes: 0 };

  const cooldownMs = (Number.isFinite(vault.cooldownMinutes) ? vault.cooldownMinutes : 15) * 60 * 1000;
  const now = Date.now();
  if (now - entry.at < cooldownMs) allow();

  if (!didRealWork(input.transcript_path, entry.bytes)) allow();

  let bytes = entry.bytes;
  try {
    bytes = statSync(input.transcript_path).size;
  } catch {
    // transcript sumiu entre a checagem e agora — grava assim mesmo
  }

  state[sessionId] = { at: now, bytes, cwd: input.cwd ?? null };
  try {
    saveState(state);
  } catch {
    // Sem poder gravar o estado, pedir a gravação repetiria a cada turno.
    allow();
  }

  askModel(INSTRUCTION);
}

try {
  main();
} catch {
  // Qualquer falha inesperada: deixa a sessão seguir.
  allow();
}
