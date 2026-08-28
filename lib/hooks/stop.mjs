#!/usr/bin/env node
/**
 * Executor do hook `Stop` do Claude Code.
 *
 * A lógica mora em runner.js; este arquivo é só o invólucro de linha de comando.
 * Continua existindo para instalações antigas, que gravaram o caminho absoluto
 * deste script no settings — as novas chamam `melinna vault hook-run`, que não
 * quebra quando o pacote muda de lugar.
 *
 * Sempre sai com código 0 e escreve JSON na stdout: um hook que falha não pode
 * travar a sessão do usuário.
 */
import { readHookInput, runStopHook } from "./runner.js";

try {
  process.stdout.write(JSON.stringify(runStopHook(readHookInput())));
} catch {
  process.stdout.write("{}");
}
process.exit(0);
