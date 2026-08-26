import { existsSync, readdirSync, readFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

import { detectStacks, describeEvidence, summarizeStacks } from "./detect.js";
import { listSkills, readSkillBundle, selectSkills } from "./skills.js";
import { compressProject } from "./caveman.js";
import { REGISTRY, alwaysOnEntries, entriesForTags, findEntry } from "./registry.js";
import { isOnPath, resolveBin, runInherit } from "./tools.js";
import { AGENTS, AGENT_PRIORITY } from "./agents.js";
import {
  resolveMemoryDir,
  resolveRegistryDir,
  resolveToolsDir,
  resolveSkillRoots,
} from "./paths.js";

const execFileAsync = promisify(execFile);

/**
 * Servidor MCP da Melinna.
 *
 * Expõe os mesmos comandos do CLI como ferramentas, para que a Melinna seja
 * usável de dentro do Claude Code, Cursor, Antigravity, Codex — qualquer cliente
 * MCP — sem sair do agente para o terminal.
 *
 * Diferença deliberada em relação ao CLI: aqui `task` e `review` **preparam** o
 * material (stack detectada, skills escolhidas, contexto comprimido, diff) e
 * devolvem ao agente que já está rodando, em vez de disparar um segundo agente
 * por baixo. Dentro de um agente, ele próprio é o executor — subprocessar outro
 * seria recursão sem ganho, e o dobro do custo.
 */

/** Diretório do projeto em que as ferramentas operam. */
function workdir(args) {
  return args?.cwd || process.env.MELINNA_CWD || process.cwd();
}

/** Resposta de texto no formato que o MCP espera. */
function text(body) {
  return { content: [{ type: "text", text: body }] };
}

/** Resposta de erro, sinalizada para o cliente. */
function fail(message) {
  return { content: [{ type: "text", text: message }], isError: true };
}

/** Monta o bloco de skills escolhidas, já com os arquivos de referência. */
function skillsBlock(skills) {
  return skills.map((s) => `# Skill: ${s.id}\n\n${readSkillBundle(s).trim()}`).join("\n\n---\n\n");
}

/** Cabeçalho comum descrevendo o que foi detectado e escolhido. */
function header(evidence, skills) {
  const lines = [];
  lines.push(evidence.length > 0 ? `Stack detectada: ${summarizeStacks(evidence)}` : "Stack: nenhuma reconhecida");
  lines.push(
    skills.length > 0
      ? `Skills carregadas: ${skills.map((s) => s.id).join(", ")}`
      : "Nenhuma skill casou — rode melinna_skills_install.",
  );
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Implementação de cada ferramenta
// ---------------------------------------------------------------------------

async function toolTask(root, args) {
  const cwd = workdir(args);
  const description = (args.description ?? "").trim();
  if (!description) return fail("Informe `description`: o que deve ser implementado.");

  const { tags, evidence } = detectStacks(cwd);
  const available = listSkills(root, cwd);
  const skills = args.skill
    ? available.filter((s) => s.id.toLowerCase() === String(args.skill).toLowerCase())
    : selectSkills(available, tags);

  const parts = [header(evidence, skills), ""];
  if (skills.length > 0) parts.push(skillsBlock(skills), "---");

  if (args.include_context !== false) {
    try {
      parts.push(`# Contexto comprimido do projeto\n\n${(await compressProject(cwd, { tokenBudget: 2048 })).trim()}`);
      parts.push("---");
    } catch (err) {
      parts.push(`(contexto comprimido indisponível: ${err.message})`, "---");
    }
  }

  parts.push(
    `# Tarefa\n\n${description}\n\n` +
      "Implemente no diretório do projeto seguindo as skills acima. " +
      "Ao terminar, rode os testes do projeto se existirem.",
  );
  return text(parts.join("\n\n"));
}

async function toolReview(root, args) {
  const cwd = workdir(args);

  let diff;
  try {
    const staged = (await execFileAsync("git", ["diff", "--cached"], { cwd, maxBuffer: 1024 * 1024 * 16 })).stdout;
    const unstaged = (await execFileAsync("git", ["diff"], { cwd, maxBuffer: 1024 * 1024 * 16 })).stdout;
    diff = [staged, unstaged].filter(Boolean).join("\n").trim();
  } catch {
    return fail(`Não foi possível obter o diff do git em ${cwd} — é um repositório git?`);
  }
  if (!diff) return text("Nenhuma mudança pendente (staged ou unstaged) para revisar.");

  const { tags, evidence } = detectStacks(cwd);
  const skills = selectSkills(listSkills(root, cwd), [...tags, "review", "architecture"]);

  return text(
    [
      header(evidence, skills),
      "",
      skills.length > 0 ? skillsBlock(skills) : "",
      "---",
      `# Diff a revisar\n\n\`\`\`diff\n${diff}\n\`\`\``,
      "",
      "Aplique as skills acima e responda com os achados por severidade. Não altere arquivos.",
    ]
      .filter(Boolean)
      .join("\n\n"),
  );
}

async function toolExplainProject(root, args) {
  const cwd = workdir(args);
  const sections = ["# Contexto do Projeto"];

  const memoryDir = resolveMemoryDir(cwd);
  if (existsSync(memoryDir)) {
    const files = readdirSync(memoryDir, { withFileTypes: true })
      .filter((e) => e.isFile() && e.name.endsWith(".md"))
      .sort((a, b) => a.name.localeCompare(b.name));
    if (files.length > 0) {
      sections.push("## Memória do projeto");
      for (const f of files) {
        sections.push(`### ${f.name}\n\n${readFileSync(join(memoryDir, f.name), "utf-8").trim()}`);
      }
    }
  } else {
    sections.push("## Memória do projeto\n\n(nenhuma — rode melinna_init_project para criar `.melinna/memory/`)");
  }

  try {
    sections.push(`## Snapshot comprimido\n\n${(await compressProject(cwd, { tokenBudget: 8192 })).trim()}`);
  } catch (err) {
    sections.push(`## Snapshot comprimido\n\n(indisponível: ${err.message})`);
  }
  return text(sections.join("\n\n---\n\n"));
}

function toolDetectStack(_root, args) {
  const cwd = workdir(args);
  const { tags, evidence, modules } = detectStacks(cwd);
  if (evidence.length === 0) return text(`Nenhuma stack reconhecida em ${cwd}.`);

  const lines = [`Stacks: ${tags.join(", ")}`, "", "Evidência:"];
  for (const e of evidence) {
    lines.push(`  - ${e.tag}: ${e.reason}${e.where === "." ? "" : ` (em ${e.where}/)`}`);
  }
  if (modules.length > 0) {
    lines.push("", `Monorepo — ${modules.length} módulo(s):`);
    for (const m of modules) lines.push(`  - ${m.path}/: ${m.tags.join(", ")}`);
  }
  return text(lines.join("\n"));
}

function toolSkillsList(root, args) {
  const cwd = workdir(args);
  const skills = listSkills(root, cwd);
  if (skills.length === 0) {
    return text("Nenhuma skill instalada. Rode melinna_skills_install para baixar as do registry.");
  }

  const lines = [`${skills.length} skills visíveis.`];
  if (args.detect !== false) {
    const { tags, evidence } = detectStacks(cwd);
    const chosen = selectSkills(skills, tags);
    lines.push("", header(evidence, chosen));
  }
  if (args.all) {
    lines.push("", "Todas:");
    for (const s of skills) lines.push(`  ${s.id} (${s.source})${s.description ? ` — ${s.description}` : ""}`);
  }
  return text(lines.join("\n"));
}

function toolGetSkill(root, args) {
  const cwd = workdir(args);
  const wanted = String(args.name ?? "").toLowerCase();
  const match = listSkills(root, cwd).find((s) => s.id.toLowerCase() === wanted);
  if (!match) return fail(`Skill "${args.name}" não encontrada. Use melinna_skills_list para ver as disponíveis.`);
  return text(readSkillBundle(match));
}

async function toolSkillsInstall(_root, args) {
  const cwd = workdir(args);
  const registryDir = resolveRegistryDir();
  await mkdir(registryDir, { recursive: true });

  let entries;
  const names = Array.isArray(args.names) ? args.names : [];
  if (args.all) {
    entries = REGISTRY;
  } else if (names.length > 0) {
    entries = [];
    for (const name of names) {
      const entry = findEntry(name);
      if (!entry) {
        return fail(`Repositório "${name}" não existe. Disponíveis: ${REGISTRY.map((e) => e.name).join(", ")}`);
      }
      entries.push(entry);
    }
  } else {
    const { tags } = detectStacks(cwd);
    entries = [...alwaysOnEntries(), ...entriesForTags(tags)];
  }

  const lines = [];
  let failed = 0;
  for (const entry of entries) {
    const dest = join(registryDir, entry.dir);
    if (existsSync(dest)) {
      lines.push(`  ○ ${entry.name} já instalada`);
      continue;
    }
    const gitArgs = ["clone", "--quiet"];
    if (!args.full) gitArgs.push("--depth", "1");
    if (entry.subdir && !args.full) gitArgs.push("--filter=blob:none");
    gitArgs.push(entry.url, dest);

    const code = await runInherit("git", gitArgs, { stdio: "ignore" });
    if (code === 0) {
      lines.push(`  ✔ ${entry.name}`);
    } else {
      lines.push(`  ✘ ${entry.name} (git saiu com ${code})`);
      failed += 1;
    }
  }

  lines.push("", failed > 0 ? `${failed} falharam.` : `${entries.length} repositório(s) prontos.`);
  return failed > 0 ? fail(lines.join("\n")) : text(lines.join("\n"));
}

async function toolSkillsUpdate() {
  const registryDir = resolveRegistryDir();
  if (!existsSync(registryDir)) return text("Nenhuma skill instalada ainda.");

  const lines = [];
  for (const entry of REGISTRY) {
    const dest = join(registryDir, entry.dir);
    if (!existsSync(dest)) continue;
    const code = await runInherit("git", ["pull", "--ff-only", "--quiet"], { cwd: dest, stdio: "ignore" });
    lines.push(code === 0 ? `  ✔ ${entry.name}` : `  ✘ ${entry.name} (código ${code})`);
  }
  return text(lines.length > 0 ? lines.join("\n") : "Nenhum repositório instalado.");
}

function toolSkillsRegistry() {
  const registryDir = resolveRegistryDir();
  const lines = [];
  for (const entry of REGISTRY) {
    const mark = existsSync(join(registryDir, entry.dir)) ? "✔" : "○";
    const flag = entry.always ? " [sempre]" : "";
    lines.push(`${mark} ${entry.name}${flag} — ${entry.description}`);
    lines.push(`   tags: ${entry.tags.join(", ")}`);
  }
  return text(lines.join("\n"));
}

async function toolDoctor(root, args) {
  const cwd = workdir(args);
  const lines = ["# Ambiente Melinna", ""];

  lines.push("Ferramentas base:");
  for (const bin of ["git", "npm", "specify"]) {
    const found = await isOnPath(bin);
    lines.push(`  ${found ? "✔" : "○"} ${bin}${found ? ` (${resolveBin(bin)})` : ""}`);
  }

  const toolsDir = resolveToolsDir(root);
  lines.push("", `Clones de terceiros (${toolsDir}):`);
  for (const dir of ["caveman-code", "spec-kit"]) {
    lines.push(`  ${existsSync(join(toolsDir, dir)) ? "✔" : "✘"} ${dir}`);
  }

  lines.push("", "Agentes de IA no PATH:");
  for (const name of AGENT_PRIORITY) {
    lines.push(`  ${(await isOnPath(name)) ? "✔" : "○"} ${name} (${AGENTS[name].label})`);
  }

  const registryDir = resolveRegistryDir();
  const installed = REGISTRY.filter((e) => existsSync(join(registryDir, e.dir)));
  const skills = listSkills(root, cwd);
  lines.push("", `Skills: ${skills.length} visíveis, de ${installed.length} repositório(s).`);
  const missing = REGISTRY.filter((e) => e.always && !existsSync(join(registryDir, e.dir)));
  if (missing.length > 0) lines.push(`  ○ sempre-ativas faltando: ${missing.map((e) => e.name).join(", ")}`);

  lines.push("", `Raízes de skills:`);
  for (const r of resolveSkillRoots(root, cwd)) lines.push(`  ${r.label}: ${r.dir}`);

  const { evidence } = detectStacks(cwd);
  lines.push("", evidence.length > 0 ? `Stack aqui: ${describeEvidence(evidence)}` : "Stack aqui: nenhuma reconhecida");
  return text(lines.join("\n"));
}

async function toolInitProject(_root, args) {
  const cwd = workdir(args);
  const { initProject } = await import("./commands/init-project.js");

  // O comando imprime seu progresso; capturamos para devolver como resultado.
  const captured = [];
  const original = console.log;
  console.log = (...parts) => captured.push(parts.join(" "));
  try {
    await initProject(cwd);
  } finally {
    console.log = original;
  }
  // eslint-disable-next-line no-control-regex
  return text(captured.join("\n").replace(/\[[0-9;]*m/g, ""));
}

async function toolSpeckit(_root, args) {
  const cwd = workdir(args);
  const feature = String(args.feature ?? "").trim();
  if (!feature) return fail("Informe `feature`: o nome da feature.");

  const choices = ["claude", "copilot", "cursor_agent", "codex", "agy"];
  const integration = args.integration ?? "claude";
  if (!choices.includes(integration)) {
    return fail(`Integração "${integration}" não suportada. Use uma de: ${choices.join(", ")}`);
  }
  if (!(await isOnPath("specify"))) {
    return fail("Binário `specify` não encontrado no PATH. Instale com: uv tool install specify-cli");
  }
  if (existsSync(join(cwd, ".specify"))) {
    return text(".specify/ já existe neste diretório — nada a fazer.");
  }

  const code = await runInherit("specify", ["init", "--here", "--integration", integration], {
    cwd,
    stdio: "ignore",
  });
  if (code !== 0) return fail(`\`specify init\` saiu com código ${code}.`);
  return text(`✔ Spec-kit inicializado para "${feature}".\nPróximo passo: /speckit.specify ${feature}`);
}

// ---------------------------------------------------------------------------
// Registro das ferramentas
// ---------------------------------------------------------------------------

const CWD_PROP = {
  cwd: { type: "string", description: "Diretório do projeto (padrão: o diretório de trabalho do servidor)." },
};

/**
 * Catálogo de ferramentas MCP, espelhando os comandos do CLI.
 * @param {string} root diretório raiz do pacote Melinna
 */
export function buildTools(root) {
  return [
    {
      name: "melinna_task",
      description:
        "Prepara uma tarefa de implementação: detecta a stack do projeto, escolhe as skills " +
        "correspondentes (com arquitetura e revisão sempre incluídas) e devolve as instruções " +
        "com o contexto comprimido. Use ANTES de implementar qualquer mudança, para carregar as " +
        "convenções certas da tecnologia do projeto.",
      inputSchema: {
        type: "object",
        properties: {
          description: { type: "string", description: "O que deve ser implementado." },
          skill: { type: "string", description: "Força uma skill específica pelo id, em vez de autodetectar." },
          include_context: {
            type: "boolean",
            description: "Incluir o snapshot comprimido do projeto (padrão: true).",
          },
          ...CWD_PROP,
        },
        required: ["description"],
      },
      run: (args) => toolTask(root, args),
    },
    {
      name: "melinna_review",
      description:
        "Prepara a revisão das mudanças pendentes (git diff staged + unstaged) com as skills de " +
        "revisão e arquitetura, mais as da stack detectada. Devolve o diff e as regras a aplicar.",
      inputSchema: { type: "object", properties: { ...CWD_PROP } },
      run: (args) => toolReview(root, args),
    },
    {
      name: "melinna_detect_stack",
      description:
        "Detecta as stacks do projeto pelos arquivos-marca (pom.xml, package.json, pubspec.yaml, " +
        "application.info, fontes .prw/.tlpp, ...), incluindo os módulos de um monorepo.",
      inputSchema: { type: "object", properties: { ...CWD_PROP } },
      run: (args) => toolDetectStack(root, args),
    },
    {
      name: "melinna_explain_project",
      description:
        "Devolve a memória do projeto (.melinna/memory/) mais um snapshot comprimido do " +
        "repositório — o contexto persistente que não dá para deduzir lendo o código.",
      inputSchema: { type: "object", properties: { ...CWD_PROP } },
      run: (args) => toolExplainProject(root, args),
    },
    {
      name: "melinna_skills_list",
      description:
        "Lista as skills disponíveis e mostra quais seriam escolhidas automaticamente para este projeto.",
      inputSchema: {
        type: "object",
        properties: {
          all: { type: "boolean", description: "Listar todas as skills, não só as escolhidas." },
          detect: { type: "boolean", description: "Mostrar a autodetecção (padrão: true)." },
          ...CWD_PROP,
        },
      },
      run: (args) => toolSkillsList(root, args),
    },
    {
      name: "melinna_get_skill",
      description: "Devolve o conteúdo completo de uma skill pelo id, com seus arquivos de referência.",
      inputSchema: {
        type: "object",
        properties: { name: { type: "string", description: "Id da skill." }, ...CWD_PROP },
        required: ["name"],
      },
      run: (args) => toolGetSkill(root, args),
    },
    {
      name: "melinna_skills_install",
      description:
        "Baixa repositórios de skills para ~/.melinna/skills. Sem `names`, instala as sempre-ativas " +
        "(arquitetura e revisão) mais as que casam com a stack detectada.",
      inputSchema: {
        type: "object",
        properties: {
          names: { type: "array", items: { type: "string" }, description: "Nomes do registry a instalar." },
          all: { type: "boolean", description: "Instalar todos os repositórios." },
          full: { type: "boolean", description: "Clone completo (padrão: --depth 1)." },
          ...CWD_PROP,
        },
      },
      run: (args) => toolSkillsInstall(root, args),
    },
    {
      name: "melinna_skills_registry",
      description: "Mostra o catálogo de repositórios de skills e o que já está instalado.",
      inputSchema: { type: "object", properties: {} },
      run: () => toolSkillsRegistry(),
    },
    {
      name: "melinna_skills_update",
      description: "Atualiza (git pull) cada repositório de skills instalado.",
      inputSchema: { type: "object", properties: {} },
      run: () => toolSkillsUpdate(),
    },
    {
      name: "melinna_init_project",
      description:
        "Cria `.melinna/` no projeto (memory/ para a memória e skills/ para skills próprias) e " +
        "relata a stack detectada.",
      inputSchema: { type: "object", properties: { ...CWD_PROP } },
      run: (args) => toolInitProject(root, args),
    },
    {
      name: "melinna_speckit",
      description:
        "Inicializa a estrutura de spec-driven development no projeto chamando a CLI real do spec-kit.",
      inputSchema: {
        type: "object",
        properties: {
          feature: { type: "string", description: "Nome da feature." },
          integration: { type: "string", description: "claude, copilot, cursor_agent, codex ou agy." },
          ...CWD_PROP,
        },
        required: ["feature"],
      },
      run: (args) => toolSpeckit(root, args),
    },
    {
      name: "melinna_doctor",
      description:
        "Diagnóstico do ambiente: git, npm, specify, clones de terceiros, agentes no PATH, " +
        "skills instaladas e stack detectada aqui.",
      inputSchema: { type: "object", properties: { ...CWD_PROP } },
      run: (args) => toolDoctor(root, args),
    },
  ];
}

/**
 * Sobe o servidor MCP na stdio.
 * @param {string} root diretório raiz do pacote Melinna
 */
export async function startMcpServer(root) {
  const tools = buildTools(root);
  const byName = new Map(tools.map((t) => [t.name, t]));

  const server = new Server(
    { name: "melinna", version: "1.0.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const tool = byName.get(request.params.name);
    if (!tool) return fail(`Ferramenta desconhecida: ${request.params.name}`);
    try {
      return await tool.run(request.params.arguments ?? {});
    } catch (err) {
      return fail(`Erro em ${request.params.name}: ${err.message}`);
    }
  });

  await server.connect(new StdioServerTransport());
}
