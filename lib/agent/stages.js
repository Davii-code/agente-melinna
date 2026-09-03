/**
 * As etapas do pipeline da Melinna.
 *
 * Combina dois eixos que não competem:
 *
 *   - **spec-kit** entrega artefatos — `spec.md`, `plan.md`, `tasks.md`. São
 *     documentos versionáveis e revisáveis, que sobrevivem à sessão.
 *   - **superpowers** entrega método — TDD, depuração sistemática, verificação
 *     antes de concluir. É o que impede o agente de afirmar que terminou sem ter
 *     testado.
 *
 * Cada etapa carrega **só as skills dela**, não as catorze de uma vez: skill em
 * excesso dilui a instrução e custa token à toa.
 *
 * `gate: true` significa que a falha **interrompe** o pipeline. Achado crítico
 * numa revisão não é aviso — é parada.
 */

/**
 * Ferramentas negadas em qualquer etapa.
 *
 * Bloqueio pela própria CLI (`--disallowed-tools`), não por lista minha: o
 * agente não tem como contornar o que o executor recusa. Todas são operações
 * que destroem trabalho ou publicam sem revisão.
 */
export const ALWAYS_DENIED = [
  "Bash(git push:*)",
  "Bash(git reset --hard:*)",
  "Bash(git clean:*)",
  "Bash(rm -rf:*)",
  "Bash(npm publish:*)",
];

/** Ferramentas de leitura — o suficiente para etapas que só analisam. */
const READ_TOOLS = ["Read", "Glob", "Grep", "Bash(git log:*)", "Bash(git diff:*)", "Bash(git status:*)"];

/** Leitura mais escrita, para as etapas que produzem artefato ou código. */
const WRITE_TOOLS = [...READ_TOOLS, "Write", "Edit", "Bash(npm test:*)", "Bash(npm run:*)", "Bash(git add:*)"];

export const STAGES = [
  {
    id: "entender",
    label: "Entender",
    skills: ["brainstorming"],
    readOnly: true,
    gate: false,
    tools: READ_TOOLS,
    goal:
      "Refine a ideia antes de qualquer código. Levante o que está mal especificado, " +
      "explore alternativas e apresente a proposta para validação. Não escreva código.",
  },
  {
    id: "especificar",
    label: "Especificar",
    speckit: "/speckit.specify",
    skills: [],
    readOnly: false,
    gate: false,
    tools: WRITE_TOOLS,
    goal: "Produza a especificação da feature: o que ela faz, para quem, e como se sabe que está pronta.",
  },
  {
    id: "planejar",
    label: "Planejar",
    speckit: "/speckit.plan",
    skills: ["writing-plans"],
    readOnly: false,
    gate: false,
    tools: WRITE_TOOLS,
    goal:
      "Quebre em tarefas pequenas, de poucos minutos cada. Toda tarefa precisa de caminho de " +
      "arquivo exato e passo de verificação — plano sem verificação não é plano.",
  },
  {
    id: "tarefas",
    label: "Tarefas",
    speckit: "/speckit.tasks",
    skills: [],
    readOnly: false,
    gate: false,
    tools: WRITE_TOOLS,
    goal: "Derive a lista de tarefas executáveis a partir do plano, em ordem de dependência.",
  },
  {
    id: "implementar",
    label: "Implementar",
    speckit: "/speckit.implement",
    skills: ["test-driven-development", "systematic-debugging"],
    readOnly: false,
    gate: false,
    tools: WRITE_TOOLS,
    goal:
      "Implemente seguindo TDD: teste que falha, código mínimo que passa, refatora. " +
      "Ao encontrar bug, investigue a causa antes de propor correção.",
  },
  {
    id: "revisar",
    label: "Revisar",
    speckit: "/speckit.analyze",
    skills: ["requesting-code-review"],
    readOnly: true,
    gate: true,
    tools: READ_TOOLS,
    goal:
      "Revise o que foi implementado contra o plano. Reporte achados por severidade. " +
      "Se houver achado crítico, diga explicitamente que o trabalho NÃO está pronto.",
  },
  {
    id: "verificar",
    label: "Verificar",
    skills: ["verification-before-completion"],
    readOnly: false,
    gate: true,
    tools: [...READ_TOOLS, "Bash(npm test:*)", "Bash(npm run:*)"],
    goal:
      "Rode os testes e confirme que passam de verdade. Não afirme que está pronto sem ter " +
      "executado a verificação. Se algo falhar, diga o que falhou.",
  },
];

/** Etapa pelo id. */
export function findStage(id) {
  return STAGES.find((s) => s.id === id) ?? null;
}

/**
 * Sequência de etapas a executar.
 *
 * `from`/`to` recortam o pipeline — útil para retomar de onde parou ou rodar só
 * a parte que interessa.
 */
export function stageSequence({ from, to, only } = {}) {
  if (only?.length) return STAGES.filter((s) => only.includes(s.id));

  let start = 0;
  let end = STAGES.length;
  if (from) {
    const i = STAGES.findIndex((s) => s.id === from);
    if (i < 0) throw new Error(`Etapa "${from}" não existe. Use: ${STAGES.map((s) => s.id).join(", ")}`);
    start = i;
  }
  if (to) {
    const i = STAGES.findIndex((s) => s.id === to);
    if (i < 0) throw new Error(`Etapa "${to}" não existe. Use: ${STAGES.map((s) => s.id).join(", ")}`);
    end = i + 1;
  }
  if (start >= end) throw new Error(`Intervalo vazio: "${from}" vem depois de "${to}".`);
  return STAGES.slice(start, end);
}

/**
 * Detecta se um resultado de etapa-portão reprovou.
 *
 * Só o texto da resposta diz — o agente sai com código 0 mesmo quando encontra
 * problema. Procura os sinais que as skills de revisão e verificação usam.
 */
export function gateFailed(stage, result) {
  if (!stage.gate) return false;
  if (!result.ok) return true;

  const text = (result.text ?? "").toLowerCase();
  const reprova = [
    /\bnão está pronto\b/,
    /\bnao esta pronto\b/,
    /\bcrític[oa]\b/,
    /\bcritical\b/,
    /\bbloqueia\b/,
    /\bfalh(ou|aram|a)\b/,
    /\bnot ready\b/,
    /\btests? fail/,
  ];
  return reprova.some((re) => re.test(text));
}
