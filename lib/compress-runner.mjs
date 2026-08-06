// Executado via `tsx` (ver lib/caveman.js) num processo filho.
//
// Por que este bridge existe: o CLI completo do caveman-code (`cave`) é um
// monorepo que precisa ser compilado (tsgo) e puxa dependências nativas
// (better-sqlite3, photon-node) para funcionalidades que não usamos aqui
// (sessões, TUI, processamento de imagem). O módulo de compressão real —
// `packages/agent/src/repomap` — é TypeScript puro, sem dependências
// nativas, com fallback gracioso quando sua única dependência opcional
// (web-tree-sitter) não está instalada. Por isso importamos esse módulo
// diretamente do código-fonte clonado, via `tsx` (que resolve os imports
// `./arquivo.js` do pacote para os `.ts` reais sem precisar de build).
import { readdirSync, statSync, readFileSync } from "node:fs";
import { join, extname } from "node:path";
import { buildRepomap } from "../tools/caveman-code/packages/agent/src/repomap/index.js";

const SOURCE_EXTS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".py", ".go", ".rs", ".java", ".c", ".h", ".cc", ".cpp", ".rb", ".php",
]);
const IGNORE_DIRS = new Set([
  "node_modules", "dist", "build", ".git", ".cave", ".speckit",
  "tools", ".next", ".cache", "venv", ".venv", "__pycache__", "target", "out",
]);

function collectFiles(root, { maxFiles = 800, maxBytes = 256 * 1024 } = {}) {
  const out = [];
  function walk(dir) {
    if (out.length >= maxFiles) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (out.length >= maxFiles) return;
      if (IGNORE_DIRS.has(entry.name)) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.isFile()) continue;
      const ext = extname(entry.name).toLowerCase();
      if (!SOURCE_EXTS.has(ext)) continue;
      try {
        const stat = statSync(full);
        if (stat.size > maxBytes) continue;
        out.push({ file: full, source: readFileSync(full, "utf-8") });
      } catch {
        // arquivo ilegível, pula
      }
    }
  }
  walk(root);
  return out;
}

const targetDir = process.argv[2];
const tokenBudget = Number.parseInt(process.argv[3] ?? "4096", 10);

if (!targetDir) {
  console.error("Uso: compress-runner.mjs <targetDir> [tokenBudget]");
  process.exit(1);
}

const files = collectFiles(targetDir);
if (files.length === 0) {
  process.stdout.write(`(nenhum arquivo de código-fonte reconhecido encontrado em ${targetDir})`);
  process.exit(0);
}

const result = await buildRepomap({ files, tokenBudget, workdir: targetDir });
process.stdout.write(result.rendered || "(repomap vazio)");
