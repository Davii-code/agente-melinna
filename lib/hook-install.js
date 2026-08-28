import { existsSync, readFileSync, writeFileSync, mkdirSync, copyFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Instalação do hook `Stop` no Claude Code.
 *
 * O hook é o que torna a captura automática: sem ele, o vault só grava quando o
 * usuário pede. A instalação mexe em `~/.claude/settings.json`, que é config do
 * usuário — por isso cada entrada carrega uma marca `melinna`, e a desinstalação
 * remove só o que tem essa marca, nunca o resto.
 */

const MARKER = "melinna-vault";

/** Caminho do arquivo de settings do Claude Code. */
export function claudeSettingsPath() {
  return join(homedir(), ".claude", "settings.json");
}

/** Caminho absoluto do executor do hook, dentro do pacote instalado. */
export function hookScriptPath() {
  return join(dirname(fileURLToPath(import.meta.url)), "hooks", "stop.mjs");
}

/**
 * Comando que o Claude Code vai executar.
 *
 * Usa `process.execPath` (o Node que está rodando a Melinna) em vez de contar
 * com `node` no PATH: o Claude Code pode iniciar com um ambiente diferente do
 * terminal, e um hook que não encontra o interpretador falha silenciosamente.
 *
 * O `--melinna-vault` no fim é a marca que identifica a entrada como nossa na
 * hora de desinstalar. Fica como argumento explícito (o hook o ignora) porque
 * depender do caminho conter a palavra seria frágil: o pacote pode ser instalado
 * em qualquer lugar.
 */
export function hookCommand() {
  return `"${process.execPath}" "${hookScriptPath()}" --${MARKER}`;
}

function readSettings(path) {
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch (err) {
    throw new Error(
      `Não consegui ler ${path} (${err.message}).\n` +
        "Corrija o JSON antes de instalar o hook — não vou sobrescrever um arquivo que não entendo.",
    );
  }
}

function writeSettings(path, settings) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(settings, null, 2)}\n`, "utf-8");
}

/** Todas as entradas de hook Stop que a Melinna instalou. */
function melinnaEntries(settings) {
  return (settings.hooks?.Stop ?? []).filter((group) =>
    (group.hooks ?? []).some((h) => typeof h.command === "string" && h.command.includes(MARKER)),
  );
}

/** O hook da Melinna está instalado? */
export function isHookInstalled(path = claudeSettingsPath()) {
  try {
    return melinnaEntries(readSettings(path)).length > 0;
  } catch {
    return false;
  }
}

/**
 * Instala o hook `Stop`, preservando o que já existe no settings.
 *
 * @param {string} [path]
 * @returns {{ path: string, backup: string | null, changed: boolean }}
 */
export function installHook(path = claudeSettingsPath()) {
  const settings = readSettings(path);

  // Antes de tocar na config do usuário, guarda uma cópia — é o arquivo que
  // controla o comportamento do Claude Code dele.
  let backup = null;
  if (existsSync(path)) {
    backup = `${path}.melinna-backup`;
    copyFileSync(path, backup);
  }

  settings.hooks ??= {};
  settings.hooks.Stop ??= [];

  const already = melinnaEntries(settings);
  if (already.length > 0) {
    // Reinstalar atualiza o caminho: o pacote pode ter mudado de lugar num
    // upgrade global.
    for (const group of already) {
      for (const hook of group.hooks ?? []) {
        if (hook.command?.includes(MARKER)) hook.command = hookCommand();
      }
    }
    writeSettings(path, settings);
    return { path, backup, changed: true };
  }

  settings.hooks.Stop.push({
    hooks: [{ type: "command", command: hookCommand(), timeout: 10 }],
  });
  writeSettings(path, settings);
  return { path, backup, changed: true };
}

/**
 * Remove o hook da Melinna, deixando os demais intactos.
 * @returns {{ path: string, removed: number }}
 */
export function uninstallHook(path = claudeSettingsPath()) {
  if (!existsSync(path)) return { path, removed: 0 };
  const settings = readSettings(path);
  const stop = settings.hooks?.Stop;
  if (!Array.isArray(stop)) return { path, removed: 0 };

  const before = stop.length;
  settings.hooks.Stop = stop.filter(
    (group) => !(group.hooks ?? []).some((h) => typeof h.command === "string" && h.command.includes(MARKER)),
  );
  const removed = before - settings.hooks.Stop.length;

  // Não deixa chaves vazias sobrando na config do usuário.
  if (settings.hooks.Stop.length === 0) delete settings.hooks.Stop;
  if (settings.hooks && Object.keys(settings.hooks).length === 0) delete settings.hooks;

  if (removed > 0) writeSettings(path, settings);
  return { path, removed };
}
