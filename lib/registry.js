/**
 * Catálogo de repositórios de skills de terceiros que a Melinna sabe instalar.
 *
 * Cada entrada é clonada por `melinna skills install` para `~/.melinna/skills/<dir>`
 * e indexada procurando arquivos `SKILL.md` — a convenção `skills/<nome>/SKILL.md`
 * usada pelo Claude Code, que todos os repositórios abaixo seguem.
 *
 * Os repositórios são clonados, não copiados arquivo a arquivo: as skills fazem
 * referência a `references/` e `assets/` vizinhos por caminho relativo, então
 * achatar tudo num diretório só quebraria esses links. Clonar também mantém
 * autoria e licença de cada projeto intactas e deixa `melinna skills update`
 * ser um `git pull`.
 *
 * Campos:
 *   - `tags`    — stacks que a entrada cobre; casadas com a detecção de
 *                 lib/detect.js para escolher skills sem perguntar ao usuário.
 *   - `always`  — entra em toda task, independente da stack detectada. Reservado
 *                 para skills de arquitetura e revisão, que valem em qualquer
 *                 linguagem.
 *   - `subdir`  — limita a indexação a uma subárvore, para repositórios grandes
 *                 onde só uma parte é relevante.
 *   - `skills`  — número de SKILL.md encontrados na verificação inicial; serve de
 *                 sanity check, não é usado em runtime.
 */
export const REGISTRY = [
  // --- Arquitetura e revisão: sempre carregadas (pedido do usuário) ---
  {
    name: "architecture",
    url: "https://github.com/keez97/claude-architecture-skills",
    dir: "claude-architecture-skills",
    description: "Revisão arquitetural: microserviços, cloud, web app moderna, design docs.",
    tags: ["architecture"],
    always: true,
    skills: 7,
  },
  {
    name: "code-review",
    url: "https://github.com/tt-a1i/code-review-skill",
    dir: "code-review-skill",
    description: "Code review multi-stack (React 19, Vue 3, TypeScript, Rust, Java, Python).",
    tags: ["review"],
    always: true,
    skills: 1,
  },

  // --- TOTVS ---
  {
    name: "fluig",
    url: "https://github.com/totvs/fluig-agent-skills",
    dir: "fluig-agent-skills",
    description: "Skills oficiais TOTVS para desenvolvimento Fluig (widgets, code review, i18n, a11y).",
    tags: ["fluig"],
    skills: 16,
  },
  {
    name: "advpl",
    url: "https://github.com/totvs/engpro-advpl-tlpp-skills",
    dir: "engpro-advpl-tlpp-skills",
    description: "Skills oficiais TOTVS para ADVPL/TLPP (ecossistema Protheus).",
    tags: ["advpl", "protheus"],
    skills: 33,
  },

  // --- Java / Spring Boot ---
  {
    name: "spring-optimization",
    url: "https://github.com/claudioed/claude-skills",
    dir: "claudioed-claude-skills",
    description: "Otimização Spring Boot, migração Java 17→21, auditoria de dependências.",
    tags: ["java", "spring"],
    skills: 4,
  },
  {
    name: "spring-template",
    url: "https://github.com/piomin/claude-ai-spring-boot",
    dir: "claude-ai-spring-boot",
    description: "Design patterns, clean code, java code review, JPA patterns.",
    tags: ["java", "spring"],
    skills: 5,
  },
  {
    name: "spring-marketplace",
    url: "https://github.com/a-pavithraa/springboot-skills-marketplace",
    dir: "springboot-skills-marketplace",
    description: "Escolha de arquitetura Spring conforme a complexidade (CRUD vs DDD/CQRS).",
    tags: ["java", "spring", "architecture"],
    skills: 1,
  },
  {
    name: "spring-mcp",
    url: "https://github.com/rrezartprebreza/spring-boot-skills",
    dir: "spring-boot-skills",
    description: "Skills Spring Boot, incluindo construção de MCP servers com Spring AI.",
    tags: ["java", "spring"],
    skills: 60,
  },

  // --- Multi-stack ---
  {
    name: "fullstack",
    url: "https://github.com/Jeffallan/claude-skills",
    dir: "Jeffallan-claude-skills",
    description: "67 skills full-stack: java-architect, angular-architect, nestjs, react e mais.",
    tags: ["java", "spring", "angular", "react", "node", "nestjs", "python", "go", "architecture"],
    skills: 67,
  },

  // --- Frontend ---
  {
    name: "frontend-design",
    url: "https://github.com/anthropics/claude-code",
    dir: "anthropic-claude-code",
    subdir: "plugins/frontend-design",
    description: "Skill oficial da Anthropic contra 'AI slop' visual — ótima com React/Tailwind.",
    tags: ["react", "angular", "vue", "frontend", "nextjs"],
    skills: 1,
  },
  {
    name: "cloudflare-react",
    url: "https://github.com/jezweb/claude-skills",
    dir: "jezweb-claude-skills",
    description: "Full stack Cloudflare + React + Tailwind v4.",
    tags: ["react", "nextjs", "frontend", "node"],
    skills: 63,
  },

  // --- Flutter ---
  {
    name: "flutter",
    url: "https://github.com/Arcturus91/claude-flutter-skill",
    dir: "claude-flutter-skill",
    description: "Router SKILL.md + 19 referências (BLoC/Cubit, Firebase, Material 3, testes).",
    tags: ["flutter", "dart"],
    skills: 1,
  },
  {
    name: "flutter-pipeline",
    url: "https://github.com/cleydson/flutter-claude-code",
    dir: "flutter-claude-code",
    description: "Skill de patterns Flutter, do design no Figma ao deploy na App Store.",
    tags: ["flutter", "dart"],
    skills: 1,
  },
];

/** Entradas marcadas como `always` — arquitetura e revisão, válidas em qualquer stack. */
export function alwaysOnEntries() {
  return REGISTRY.filter((e) => e.always);
}

/** Entradas cujas tags cruzam com as stacks detectadas. */
export function entriesForTags(tags) {
  const wanted = new Set(tags);
  return REGISTRY.filter((e) => !e.always && e.tags.some((t) => wanted.has(t)));
}

/** Busca uma entrada pelo nome curto usado na CLI. */
export function findEntry(name) {
  return REGISTRY.find((e) => e.name === name) ?? null;
}
