/**
 * Comportamento autônomo.
 *
 * O modo autônomo falha por um motivo que não é técnico: o agente **pergunta e
 * espera**. Num pipeline sem ninguém do outro lado, cada pergunta vira uma
 * etapa parada — e o resultado é uma execução que gastou tokens para devolver
 * "me diga qual das duas opções você prefere".
 *
 * A correção tem três partes, e nenhuma sozinha resolve:
 *
 *   1. **instruir a decidir** — dizer explicitamente que não há usuário,
 *      que a decisão é dele, e que ela deve ser registrada com o porquê;
 *   2. **dar as ferramentas** — um allowlist que não cobre `mvn` faz a etapa
 *      de teste falhar por permissão, não por bug (o agente é recusado em
 *      silêncio, porque prompt de permissão sem usuário é negação);
 *   3. **manter uma parada** — decidir sozinho não é chutar em coisa
 *      irreversível; aí ele deve parar e dizer por quê.
 */

/** Marcador que o agente usa ao registrar uma decisão tomada sozinho. */
export const DECISION_MARK = "DECISÃO:";

/** Marcador de parada legítima: ambiguidade que não se resolve decidindo. */
export const BLOCKED_MARK = "BLOQUEADO:";

/**
 * Instrução de autonomia, anexada a cada etapa no modo autônomo.
 *
 * Deliberadamente afirma que não há usuário: sem isso o agente assume que há, e
 * o comportamento aprendido é perguntar antes de escolher.
 */
export const AUTONOMY_DIRECTIVE = [
  "## Autonomia",
  "",
  "**Não há ninguém para responder você nesta execução.** Toda pergunta que você fizer",
  "fica sem resposta e a etapa termina sem ter feito o trabalho.",
  "",
  "Portanto:",
  "",
  "- **Decida.** Diante de duas opções razoáveis, escolha a mais consistente com o que já",
  "  existe no código. Não pergunte qual preferir.",
  "- **Registre.** Toda escolha não óbvia entra na resposta numa linha começando com",
  `  \`${DECISION_MARK}\` seguida do que você escolheu e por quê. É o que permite auditar depois.`,
  "- **Assuma o padrão.** Faltando detalhe de estilo, nome ou formato, siga a convenção",
  "  do repositório. Se não houver convenção, escolha a mais comum na stack e registre.",
  "- **Não invente requisito.** Decidir como implementar é seu; decidir o que o produto faz,",
  "  não. Se a tarefa não diz, implemente o caminho mínimo e registre o que deixou de fora.",
  "",
  "**Quando parar:** se a ambiguidade for de algo irreversível ou fora do seu alcance —",
  "apagar dados, mudar contrato de API pública, credencial que falta, requisito de negócio",
  `que muda o resultado — responda com \`${BLOCKED_MARK}\` e o motivo. Parar é certo aqui;`,
  "chutar, não.",
].join("\n");

/**
 * Comandos de build e teste por stack.
 *
 * Sem isto o agente é recusado ao rodar `mvn test` num projeto Java — e como
 * prompt de permissão sem usuário equivale a negação, a etapa falha por
 * permissão, não por bug. O sintoma engana: parece que o teste quebrou.
 */
const STACK_COMMANDS = {
  java: ["Bash(mvn:*)", "Bash(./mvnw:*)", "Bash(gradle:*)", "Bash(./gradlew:*)"],
  spring: ["Bash(mvn:*)", "Bash(./mvnw:*)"],
  node: ["Bash(npm:*)", "Bash(npx:*)", "Bash(pnpm:*)", "Bash(yarn:*)"],
  react: ["Bash(npm:*)", "Bash(npx:*)"],
  nextjs: ["Bash(npm:*)", "Bash(npx:*)"],
  angular: ["Bash(npm:*)", "Bash(npx:*)", "Bash(ng:*)"],
  nestjs: ["Bash(npm:*)", "Bash(npx:*)"],
  flutter: ["Bash(flutter:*)", "Bash(dart:*)"],
  dart: ["Bash(dart:*)"],
  python: ["Bash(python:*)", "Bash(python3:*)", "Bash(pytest:*)", "Bash(pip:*)", "Bash(uv:*)"],
  go: ["Bash(go:*)"],
  rust: ["Bash(cargo:*)"],
};

/**
 * Ferramentas que a stack detectada exige, sem duplicar.
 *
 * @param {string[]} tags saída de detectStacks
 * @returns {string[]}
 */
export function toolsForStack(tags = []) {
  const out = new Set();
  for (const tag of tags) {
    for (const cmd of STACK_COMMANDS[tag] ?? []) out.add(cmd);
  }
  return [...out];
}

/**
 * Extrai as decisões que o agente registrou numa etapa.
 *
 * @param {string} text
 * @returns {string[]}
 */
export function extractDecisions(text = "") {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.toUpperCase().startsWith(DECISION_MARK.toUpperCase()))
    .map((line) => line.slice(DECISION_MARK.length).trim())
    .filter(Boolean);
}

/**
 * A etapa parou por ambiguidade que não se resolve decidindo?
 *
 * @param {string} text
 * @returns {string | null} o motivo, ou null
 */
export function extractBlocked(text = "") {
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.toUpperCase().startsWith(BLOCKED_MARK.toUpperCase())) {
      return line.slice(BLOCKED_MARK.length).trim() || "sem motivo declarado";
    }
  }
  return null;
}
