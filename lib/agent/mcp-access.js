import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

/**
 * Acesso do pipeline aos servidores MCP que o usuário já configurou.
 *
 * O envelope restringe as ferramentas por etapa (`--allowed-tools`), e essa
 * lista é exaustiva: o que não está nela é recusado. Sem tratar MCP, uma tarefa
 * como "pegue a atividade do Jira e implemente" morria na primeira chamada —
 * o agente não alcançaria o Jira, o GitHub, nem nenhum outro servidor.
 *
 * A liberação é **por servidor** (`mcp__jira`), não por curinga: `mcp__*` é
 * recusado pela CLI. Enumeramos o que está configurado e liberamos nominalmente.
 */

/** Config do Claude Code, de onde saem os servidores registrados. */
function claudeConfigPath() {
  return join(homedir(), ".claude.json");
}

function readJson(path) {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return null;
  }
}

/**
 * Servidores MCP visíveis para uma execução neste diretório.
 *
 * Junta o escopo de usuário (vale em todo projeto) com o escopo local do
 * projeto — é assim que o Claude Code resolve, e o subprocesso herda os dois.
 *
 * @param {string} [cwd]
 * @returns {string[]} nomes dos servidores
 */
export function discoverMcpServers(cwd = process.cwd()) {
  const config = readJson(claudeConfigPath());
  if (!config) return [];

  const names = new Set(Object.keys(config.mcpServers ?? {}));

  // O Claude Code guarda a config de projeto sob o caminho absoluto, com
  // barras normalizadas.
  const key = resolve(cwd).replace(/\\/g, "/");
  const project = config.projects?.[key];
  for (const name of Object.keys(project?.mcpServers ?? {})) names.add(name);

  return [...names].sort();
}

/**
 * Entradas de `--allowed-tools` que liberam os servidores MCP.
 *
 * @param {string[]} servers
 * @param {{ only?: string[], exclude?: string[] }} [options]
 * @returns {string[]}
 */
export function mcpAllowEntries(servers, options = {}) {
  let list = servers;
  if (options.only?.length) {
    const wanted = new Set(options.only.map((s) => s.toLowerCase()));
    list = list.filter((s) => wanted.has(s.toLowerCase()));
  }
  if (options.exclude?.length) {
    const skip = new Set(options.exclude.map((s) => s.toLowerCase()));
    list = list.filter((s) => !skip.has(s.toLowerCase()));
  }
  return list.map((name) => `mcp__${name}`);
}

/**
 * Ferramentas da etapa somadas ao acesso MCP.
 *
 * Chamar a própria Melinna de dentro de uma execução dela seria recursão sem
 * ganho — a etapa já roda com stack detectada e skills carregadas. Por isso o
 * servidor `melinna` fica de fora por padrão.
 *
 * @param {string[]} stageTools
 * @param {object} options
 * @returns {string[]}
 */
export function withMcpAccess(stageTools, options = {}) {
  if (options.mcp === false) return stageTools;

  const servers = discoverMcpServers(options.cwd);
  const entries = mcpAllowEntries(servers, {
    only: options.mcpOnly,
    exclude: options.mcpOnly?.length ? [] : ["melinna", ...(options.mcpExclude ?? [])],
  });
  return [...stageTools, ...entries];
}
