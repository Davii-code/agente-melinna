import { existsSync, readFileSync, writeFileSync, mkdirSync, copyFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/**
 * Instalação dos hooks de ciclo de vida no Claude Code.
 *
 * Dois eventos, com papéis opostos:
 *   - `SessionStart` injeta o contexto gravado no início da conversa. Passivo:
 *     o usuário não percebe, só ganha um agente que já sabe do projeto.
 *   - `Stop`         pede ao agente que grave o contexto. **Opt-in**, porque
 *     dispara ao fim de CADA resposta e interrompe a conversa pedindo gravação
 *     — atrito que não compensa. O caminho normal é `/melinna-salvar`.
 *
 * A instalação mexe em `~/.claude/settings.json`, que é config do usuário — por
 * isso cada entrada carrega uma marca `melinna`, e a desinstalação remove só o
 * que tem essa marca, nunca o resto.
 */

const MARKER = "melinna-vault";

/** Eventos que a Melinna sabe instalar, e o subcomando que cada um invoca. */
export const HOOK_EVENTS = [
  {
    event: "SessionStart",
    sub: "hook-start",
    purpose: "carrega o contexto salvo no início da conversa",
    optional: false,
  },
  {
    event: "Stop",
    sub: "hook-run",
    purpose: "pede a gravação do contexto ao fim da sessão",
    optional: true,
  },
];

/** Eventos instalados por padrão: só os que não interrompem a conversa. */
export function defaultHookEvents() {
  return HOOK_EVENTS.filter((e) => !e.optional);
}

/** Caminho do arquivo de settings do Claude Code. */
export function claudeSettingsPath() {
  return join(homedir(), ".claude", "settings.json");
}

/**
 * Comando que o Claude Code vai executar.
 *
 * Invoca a CLI pelo PATH, não o caminho absoluto do script. Gravar o caminho do
 * pacote quebrava em silêncio quando ele mudava de lugar — ao trocar um clone de
 * desenvolvimento por instalação global, por exemplo. `melinna` está no PATH em
 * qualquer uma das duas formas de instalar.
 *
 * O `--melinna-vault` no fim é a marca que identifica a entrada como nossa na
 * hora de desinstalar.
 */
export function hookCommand(sub) {
  return `melinna vault ${sub} --${MARKER}`;
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

/** A entrada de grupo é nossa? */
function isOurs(group) {
  return (group.hooks ?? []).some((h) => typeof h.command === "string" && h.command.includes(MARKER));
}

/**
 * Quais dos nossos hooks estão instalados.
 * @returns {string[]} nomes dos eventos
 */
export function installedHooks(path = claudeSettingsPath()) {
  try {
    const settings = readSettings(path);
    return HOOK_EVENTS.filter(({ event }) => (settings.hooks?.[event] ?? []).some(isOurs)).map((e) => e.event);
  } catch {
    return [];
  }
}

/** Algum hook da Melinna está instalado? */
export function isHookInstalled(path = claudeSettingsPath()) {
  return installedHooks(path).length > 0;
}

/**
 * Instala os hooks, preservando o que já existe no settings.
 *
 * Reinstalar atualiza o comando das entradas nossas: é assim que uma instalação
 * antiga, que gravou o caminho absoluto do script, migra para a invocação pelo
 * PATH sem o usuário precisar saber que isso mudou.
 *
 * @returns {{ path: string, backup: string | null, installed: string[] }}
 */
export function installHook(path = claudeSettingsPath(), options = {}) {
  const settings = readSettings(path);
  // Sem `autoSave`, o `Stop` não é instalado — e um instalado antes é removido,
  // para que desligar a gravação automática realmente a tire do settings.
  const wanted = options.autoSave ? HOOK_EVENTS : defaultHookEvents();

  // Antes de tocar na config do usuário, guarda uma cópia — é o arquivo que
  // controla o comportamento do Claude Code dele.
  let backup = null;
  if (existsSync(path)) {
    backup = `${path}.melinna-backup`;
    copyFileSync(path, backup);
  }

  settings.hooks ??= {};
  const installed = [];
  const removed = [];

  for (const { event, sub } of HOOK_EVENTS) {
    const keep = wanted.some((w) => w.event === event);
    settings.hooks[event] ??= [];
    const ours = settings.hooks[event].filter(isOurs);

    if (!keep) {
      if (ours.length > 0) {
        settings.hooks[event] = settings.hooks[event].filter((g) => !isOurs(g));
        removed.push(event);
      }
      if (settings.hooks[event].length === 0) delete settings.hooks[event];
      continue;
    }

    if (ours.length > 0) {
      for (const group of ours) {
        for (const hook of group.hooks ?? []) {
          if (hook.command?.includes(MARKER)) hook.command = hookCommand(sub);
        }
      }
    } else {
      settings.hooks[event].push({
        hooks: [{ type: "command", command: hookCommand(sub), timeout: 10 }],
      });
    }
    installed.push(event);
  }

  if (Object.keys(settings.hooks).length === 0) delete settings.hooks;
  writeSettings(path, settings);
  return { path, backup, installed, removed };
}

/**
 * Remove os hooks da Melinna, deixando os demais intactos.
 * @returns {{ path: string, removed: number }}
 */
export function uninstallHook(path = claudeSettingsPath()) {
  if (!existsSync(path)) return { path, removed: 0 };
  const settings = readSettings(path);
  if (!settings.hooks) return { path, removed: 0 };

  let removed = 0;
  for (const { event } of HOOK_EVENTS) {
    const list = settings.hooks[event];
    if (!Array.isArray(list)) continue;
    const kept = list.filter((group) => !isOurs(group));
    removed += list.length - kept.length;
    if (kept.length === 0) delete settings.hooks[event];
    else settings.hooks[event] = kept;
  }

  // Não deixa chaves vazias sobrando na config do usuário.
  if (Object.keys(settings.hooks).length === 0) delete settings.hooks;
  if (removed > 0) writeSettings(path, settings);
  return { path, removed };
}
