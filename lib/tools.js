import { spawn } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { delimiter, extname, isAbsolute, join } from "node:path";

/**
 * Resolve o caminho real de um binário no PATH, respeitando PATHEXT no Windows.
 *
 * Por que não basta `spawn("npm", ...)`: no Windows o npm (e a maioria das CLIs
 * instaladas via npm) é um shim `.cmd`. Desde a correção do CVE-2024-27980 o Node
 * recusa spawnar `.cmd`/`.bat` sem `shell: true` — o erro é `spawn npm ENOENT`,
 * que parece "não instalado" mesmo com o npm no PATH. Resolver o caminho aqui
 * conserta tanto a detecção quanto a execução, sem recorrer a `shell: true`
 * (que concatena argumentos sem escapar — ver DEP0190).
 *
 * @param {string} bin nome do binário, ou um caminho já explícito
 * @returns {string | null} caminho absoluto do executável, ou null se não achado
 */
export function resolveBin(bin) {
  if (isAbsolute(bin) || bin.includes("/") || bin.includes("\\")) {
    return existsSync(bin) ? bin : null;
  }

  const dirs = (process.env.PATH || "").split(delimiter).filter(Boolean);
  const exts =
    process.platform === "win32"
      ? (process.env.PATHEXT || ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean)
      : [""];

  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = join(dir, bin + ext);
      try {
        if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
      } catch {
        // entrada de PATH inacessível, tenta a próxima
      }
    }
  }
  return null;
}

/**
 * Verifica se um binário está disponível no PATH.
 *
 * Checa a existência do arquivo em vez de rodar `<bin> --version`: além de ser
 * mais rápido (sem processo filho), evita o falso negativo dos shims `.cmd` no
 * Windows e o falso positivo de um binário que existe mas sai com erro no
 * `--version`.
 *
 * @param {string} bin
 * @returns {Promise<boolean>}
 */
export async function isOnPath(bin) {
  return resolveBin(bin) !== null;
}

/**
 * Monta os argumentos de spawn para um executável já resolvido.
 *
 * Scripts em lote (`.cmd`/`.bat`) não podem ser spawnados direto — o Node
 * devolve `EINVAL`. Eles vão via `cmd.exe /d /s /c`, com a linha inteira entre
 * aspas (o formato `cmd /c ""prog" "arg""`), porque senão o `cmd.exe` remove as
 * aspas internas e quebra em caminhos com espaço (ex: `C:\Program Files\...`).
 * Isso exige `windowsVerbatimArguments`, já que a citação é feita aqui.
 */
function spawnArgs(resolved, args) {
  const isBatch = process.platform === "win32" && /^\.(cmd|bat)$/i.test(extname(resolved));
  if (!isBatch) {
    return { file: resolved, argv: args, opts: {} };
  }
  const line = `"${[resolved, ...args].map((a) => `"${a}"`).join(" ")}"`;
  return {
    file: process.env.ComSpec || "cmd.exe",
    argv: ["/d", "/s", "/c", line],
    opts: { windowsVerbatimArguments: true },
  };
}

function notFound(bin) {
  return new Error(
    `Binário \`${bin}\` não encontrado no PATH. Rode \`melinna doctor\` para ver o que está faltando.`,
  );
}

/**
 * Roda um comando com stdio herdado do processo pai (output em tempo real no terminal).
 * @returns {Promise<number>} código de saída
 */
export function runInherit(bin, args, opts = {}) {
  const resolved = resolveBin(bin);
  if (!resolved) return Promise.reject(notFound(bin));
  const { file, argv, opts: extra } = spawnArgs(resolved, args);

  return new Promise((resolve, reject) => {
    const child = spawn(file, argv, { stdio: "inherit", ...extra, ...opts });
    child.on("error", reject);
    child.on("exit", (code, signal) => resolve(code ?? (signal ? 1 : 0)));
  });
}

/**
 * Roda um comando escrevendo `input` na stdin do processo filho, com stdout/stderr
 * herdados (streaming em tempo real). Usado para passar prompts grandes sem
 * esbarrar em limites de tamanho de argumento de linha de comando.
 * @returns {Promise<number>} código de saída
 */
export function runWithStdin(bin, args, input, opts = {}) {
  const resolved = resolveBin(bin);
  if (!resolved) return Promise.reject(notFound(bin));
  const { file, argv, opts: extra } = spawnArgs(resolved, args);

  return new Promise((resolve, reject) => {
    const child = spawn(file, argv, { stdio: ["pipe", "inherit", "inherit"], ...extra, ...opts });
    child.on("error", reject);
    child.stdin.on("error", () => {});
    child.stdin.write(input);
    child.stdin.end();
    child.on("exit", (code, signal) => resolve(code ?? (signal ? 1 : 0)));
  });
}
