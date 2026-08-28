#!/usr/bin/env node
/**
 * Executor do hook `SessionStart` do Claude Code.
 *
 * Injeta o contexto que o vault acumulou sobre o projeto, para a conversa já
 * começar sabendo. Sem ele, gravar o contexto só serve se alguém lembrar de
 * pedir para carregar.
 *
 * Sempre sai com código 0: um hook que falha não pode travar a sessão.
 */
import { readHookInput, runSessionStartHook } from "./runner.js";

try {
  process.stdout.write(JSON.stringify(await runSessionStartHook(readHookInput())));
} catch {
  process.stdout.write("{}");
}
process.exit(0);
