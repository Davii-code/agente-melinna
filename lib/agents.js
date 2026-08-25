import { isOnPath } from "./tools.js";

/**
 * Registro dos agentes de IA que a Melinna sabe executar em modo não interativo.
 *
 * Cada agente expõe dois modos de invocação, porque os comandos da Melinna têm
 * necessidades opostas:
 *   - `write(instrucao, { yolo })`: pode editar arquivos (usado por `task`).
 *   - `read(instrucao)`: somente leitura, não deve alterar nada (usado por `review`).
 *
 * As flags NÃO são uniformes entre agentes — `codex` usa o subcomando `exec` em
 * vez de `-p`, e controla escrita via `--sandbox` — por isso cada um monta seus
 * próprios argumentos aqui em vez de um formato único.
 *
 * `yolo` liga a auto-aprovação total do agente (equivalente a "pule todas as
 * permissões"). É sempre opt-in explícito via `melinna task --yolo`, porque
 * autoriza também execução de shell arbitrário. Para agentes cujo modo de
 * escrita padrão já não pergunta nada, `yolo` não muda nada.
 *
 * `install` é um comando quando ele é conhecido com certeza, ou uma URL de
 * documentação quando o método de instalação varia por plataforma.
 */
export const AGENTS = {
  caveman: {
    label: "caveman-code",
    install: "npm install -g @juliusbrussee/caveman-code",
    // Roda em autopilot: o sistema de permissões foi removido do caveman-code,
    // então não há flag de aprovação a passar em nenhum dos modos.
    write: (instruction) => ["-p", instruction],
    read: (instruction) => ["-p", instruction],
  },
  claude: {
    label: "Claude Code",
    install: "npm install -g @anthropic-ai/claude-code",
    // acceptEdits: edita arquivos sem perguntar, mas ainda pede aprovação para
    // shell arbitrário. plan: modo somente-leitura.
    write: (instruction, { yolo } = {}) =>
      yolo
        ? ["-p", instruction, "--dangerously-skip-permissions"]
        : ["-p", instruction, "--permission-mode", "acceptEdits"],
    read: (instruction) => ["-p", instruction, "--permission-mode", "plan"],
  },
  "cursor-agent": {
    label: "Cursor CLI",
    install: "https://cursor.com/docs/cli/overview",
    // Sem --force o agente apenas propõe as mudanças em vez de aplicá-las.
    write: (instruction) => ["-p", "--force", instruction],
    read: (instruction) => ["-p", instruction],
  },
  codex: {
    label: "OpenAI Codex CLI",
    install: "npm install -g @openai/codex",
    // `codex exec` é o modo headless (não existe `-p`). `--full-auto` foi
    // deprecado e hoje dá erro; o substituto é declarar o sandbox.
    write: (instruction, { yolo } = {}) =>
      yolo
        ? ["exec", instruction, "--dangerously-bypass-approvals-and-sandbox"]
        : ["exec", instruction, "--sandbox", "workspace-write"],
    read: (instruction) => ["exec", instruction, "--sandbox", "read-only"],
  },
  agy: {
    label: "Google Antigravity CLI",
    install: "https://antigravity.google/product/antigravity-cli",
    // Sucessor do Gemini CLI (descontinuado em 18/06/2026). Não tem um meio-termo
    // como o acceptEdits do Claude: ou pergunta, ou pula tudo. Sem --yolo, uma
    // task que precise editar pode parar pedindo confirmação.
    write: (instruction, { yolo } = {}) =>
      yolo ? ["-p", instruction, "--dangerously-skip-permissions"] : ["-p", instruction],
    read: (instruction) => ["-p", instruction],
  },
};

/** Ordem de autodetecção quando nenhum agente é passado via `--agent`. */
export const AGENT_PRIORITY = ["caveman", "claude", "cursor-agent", "codex", "agy"];

/**
 * Resolve qual agente usar: `preferred` se informado (e presente no PATH),
 * senão o primeiro de AGENT_PRIORITY encontrado.
 * @param {string} [preferred]
 * @returns {Promise<{ name: string, spec: object } | null>}
 */
export async function resolveAgent(preferred) {
  if (preferred) {
    if (!AGENTS[preferred]) {
      throw new Error(
        `Agente "${preferred}" desconhecido. Suportados: ${Object.keys(AGENTS).join(", ")}.`,
      );
    }
    if (!(await isOnPath(preferred))) return null;
    return { name: preferred, spec: AGENTS[preferred] };
  }
  for (const name of AGENT_PRIORITY) {
    if (await isOnPath(name)) return { name, spec: AGENTS[name] };
  }
  return null;
}

/** Mensagem de ajuda listando como instalar cada agente suportado. */
export function installHint() {
  return Object.entries(AGENTS)
    .map(([name, spec]) => `  ${name} (${spec.label}) — ${spec.install}`)
    .join("\n");
}
