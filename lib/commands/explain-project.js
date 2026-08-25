import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import chalk from "chalk";
import { compressProject } from "../caveman.js";

function readMemory(root) {
  const memoryDir = join(root, "memory");
  if (!existsSync(memoryDir)) return [];
  const files = readdirSync(memoryDir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(".md"))
    .sort((a, b) => a.name.localeCompare(b.name));

  return files.map((f) => ({
    name: f.name,
    content: readFileSync(join(memoryDir, f.name), "utf-8"),
  }));
}

export async function explainProject(root, cwd) {
  console.log(chalk.cyan("Comprimindo o repositório inteiro com caveman-code..."));
  let snapshot;
  try {
    snapshot = await compressProject(cwd, { tokenBudget: 8192 });
  } catch (err) {
    console.log(chalk.red(`Falha na compressão de contexto: ${err.message}`));
    process.exitCode = 1;
    return;
  }

  const memoryFiles = readMemory(root);

  const sections = ["# System Prompt — Contexto do Projeto"];

  if (memoryFiles.length > 0) {
    sections.push("## Memória do projeto");
    for (const f of memoryFiles) {
      sections.push(`### ${f.name}\n\n${f.content.trim()}`);
    }
  } else {
    sections.push("## Memória do projeto\n\n(memory/ está vazio — nenhum arquivo de memória encontrado)");
  }

  sections.push(`## Snapshot comprimido do repositório\n\n${snapshot.trim()}`);

  const systemPrompt = sections.join("\n\n---\n\n");

  console.log("");
  console.log(systemPrompt);
}
