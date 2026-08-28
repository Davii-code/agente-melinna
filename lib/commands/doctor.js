import { existsSync } from "node:fs";
import { join } from "node:path";
import chalk from "chalk";
import { isOnPath, resolveBin } from "../tools.js";
import { AGENTS, AGENT_PRIORITY } from "../agents.js";
import { resolveToolsDir, resolveRegistryDir } from "../paths.js";
import { REGISTRY } from "../registry.js";
import { listSkills } from "../skills.js";
import { detectStacks, summarizeStacks } from "../detect.js";
import { installedHooks } from "../hook-install.js";
import { listInstalled } from "../slash.js";

/**
 * `melinna doctor`: checa tudo que os comandos da Melinna dependem — o git, os
 * clones de terceiros, a CLI do spec-kit e os agentes de IA suportados.
 * @returns {Promise<boolean>} true se o ambiente está utilizável
 */
export async function doctor(root, cwd = process.cwd()) {
  let ok = true;

  console.log(chalk.bold("Ferramentas base"));
  const hasGit = await isOnPath("git");
  console.log(
    hasGit
      ? `  ${chalk.green("✔")} git ${chalk.dim(resolveBin("git") ?? "")}`
      : `  ${chalk.red("✘")} git — necessário para \`melinna install\`/\`upgrade\``,
  );
  if (!hasGit) ok = false;

  // O npm é checado explicitamente porque `install`, `upgrade`, `init` e a
  // validação da `task` dependem dele — e no Windows ele é um shim `.cmd`,
  // exatamente o caso que a detecção ingênua deixava passar.
  const hasNpm = await isOnPath("npm");
  console.log(
    hasNpm
      ? `  ${chalk.green("✔")} npm ${chalk.dim(resolveBin("npm") ?? "")}`
      : `  ${chalk.red("✘")} npm — necessário para \`melinna install\`/\`upgrade\`/\`init\``,
  );
  if (!hasNpm) ok = false;

  const hasSpecify = await isOnPath("specify");
  console.log(
    hasSpecify
      ? `  ${chalk.green("✔")} specify`
      : `  ${chalk.yellow("○")} specify não encontrado — necessário para \`melinna speckit\` (uv tool install specify-cli)`,
  );

  console.log("");
  console.log(chalk.bold("Clones de terceiros"));
  const toolsDir = resolveToolsDir(root);
  console.log(chalk.dim(`  ${toolsDir}`));
  let missingClone = false;
  for (const dir of ["caveman-code", "spec-kit"]) {
    const found = existsSync(join(toolsDir, dir));
    console.log(found ? `  ${chalk.green("✔")} ${dir}` : `  ${chalk.red("✘")} ${dir} — rode \`melinna install\``);
    if (!found) missingClone = true;
  }
  if (missingClone) ok = false;

  console.log("");
  console.log(chalk.bold("Agentes de IA (para `task` e `review`)"));
  const available = [];
  for (const name of AGENT_PRIORITY) {
    const spec = AGENTS[name];
    if (await isOnPath(name)) {
      console.log(`  ${chalk.green("✔")} ${name} ${chalk.dim(`(${spec.label})`)}`);
      available.push(name);
    } else {
      console.log(`  ${chalk.yellow("○")} ${name} ${chalk.dim(`(${spec.label})`)} — ${spec.install}`);
    }
  }

  console.log("");
  console.log(chalk.bold("Skills"));
  const registryDir = resolveRegistryDir();
  const installedRepos = REGISTRY.filter((e) => existsSync(join(registryDir, e.dir)));
  const skills = listSkills(root, cwd);
  console.log(chalk.dim(`  ${registryDir}`));
  console.log(
    skills.length > 0
      ? `  ${chalk.green("✔")} ${skills.length} skills visíveis, de ${installedRepos.length} repositório(s) do registry`
      : `  ${chalk.yellow("○")} nenhuma skill instalada — rode \`melinna skills install\``,
  );

  const alwaysMissing = REGISTRY.filter((e) => e.always && !existsSync(join(registryDir, e.dir)));
  if (alwaysMissing.length > 0) {
    console.log(
      `  ${chalk.yellow("○")} skills sempre-ativas faltando: ${alwaysMissing.map((e) => e.name).join(", ")}`,
    );
    console.log(chalk.dim(`     instale com: melinna skills install ${alwaysMissing.map((e) => e.name).join(" ")}`));
  }

  const { evidence } = detectStacks(cwd);
  console.log(
    evidence.length > 0
      ? chalk.dim(`  stack aqui: ${summarizeStacks(evidence)}`)
      : chalk.dim("  stack aqui: nenhuma reconhecida"),
  );

  console.log("");
  console.log(chalk.bold("Integração com o agente"));

  const hooks = installedHooks();
  console.log(
    hooks.length > 0
      ? `  ${chalk.green("✔")} hooks: ${hooks.join(", ")}`
      : `  ${chalk.yellow("○")} nenhum hook instalado — \`melinna vault enable <pasta>\``,
  );

  const slash = listInstalled();
  console.log(
    slash.length > 0
      ? `  ${chalk.green("✔")} slash commands: ${slash.map((s) => `/${s}`).join(", ")}`
      : `  ${chalk.yellow("○")} sem slash commands — \`melinna slash install\``,
  );

  // O hook instalado invoca `melinna` pelo PATH. Se a CLI não estiver lá, ele
  // falha em silêncio — o Claude Code não reporta hook que não executa.
  if (hooks.length > 0 && !(await isOnPath("melinna"))) {
    console.log(`  ${chalk.red("✘")} \`melinna\` não está no PATH — os hooks instalados não vão rodar`);
    ok = false;
  }

  // Acima de ~10k tokens de descrição, o Claude Code passa a carregar as
  // ferramentas sob demanda em vez de todas de uma vez. Não é erro, mas muda o
  // comportamento — melhor saber antes de acrescentar a próxima.
  try {
    const { buildTools } = await import("../mcp.js");
    const tools = buildTools(root);
    const bytes = tools.reduce(
      (sum, t) => sum + JSON.stringify({ name: t.name, description: t.description, inputSchema: t.inputSchema }).length,
      0,
    );
    const estimated = Math.round(bytes / 4);
    const near = estimated > 8000;
    console.log(
      `  ${near ? chalk.yellow("○") : chalk.green("✔")} ${tools.length} ferramentas MCP, ~${estimated} tokens de descrição` +
        (near ? chalk.dim(" (perto do limiar de carregamento sob demanda)") : ""),
    );
  } catch {
    // mcp.js indisponível não impede o diagnóstico do resto.
  }

  console.log("");
  if (available.length === 0) {
    console.log(
      chalk.yellow("Nenhum agente de IA encontrado — `melinna task`/`review` vão apenas imprimir o prompt."),
    );
  } else {
    console.log(chalk.dim(`Agente padrão (autodetecção): ${chalk.bold(available[0])}. Use --agent para escolher outro.`));
  }

  if (ok) {
    console.log(chalk.green("✔ Ambiente pronto."));
  } else {
    console.log(chalk.red("✘ Há pendências acima — resolva antes de usar a Melinna."));
  }
  return ok;
}
