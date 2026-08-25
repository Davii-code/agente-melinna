import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolveRepomapDir } from "./paths.js";

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));

const ROOT = join(__dirname, "..");
const RUNNER_SCRIPT = join(__dirname, "compress-runner.mjs");

/**
 * Comprime um diretório de projeto usando o módulo `repomap` do caveman-code
 * (ver comentário em lib/compress-runner.mjs para o porquê dessa abordagem).
 *
 * @param {string} targetDir diretório a comprimir
 * @param {{ tokenBudget?: number }} [opts]
 * @returns {Promise<string>} contexto comprimido, pronto para embutir em um prompt
 */
export async function compressProject(targetDir, opts = {}) {
  const repomapDir = resolveRepomapDir(ROOT);
  if (!existsSync(repomapDir)) {
    throw new Error(
      `Módulo de compressão do caveman-code não encontrado em ${repomapDir}.\n` +
        "Rode `melinna install` para clonar as ferramentas de terceiros.",
    );
  }

  const tsxBin = require.resolve("tsx/cli");
  const tokenBudget = String(opts.tokenBudget ?? 4096);

  try {
    const { stdout } = await execFileAsync(
      process.execPath,
      [tsxBin, RUNNER_SCRIPT, targetDir, tokenBudget, repomapDir],
      { maxBuffer: 1024 * 1024 * 32 },
    );
    return stdout;
  } catch (err) {
    const detail = err.stderr || err.message;
    throw new Error(`Falha ao rodar a compressão do caveman-code:\n${detail}`);
  }
}
