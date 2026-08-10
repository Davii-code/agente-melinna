import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * Verifica se um binário está disponível no PATH tentando rodar `<bin> --version`.
 * @param {string} bin
 * @returns {Promise<boolean>}
 */
export async function isOnPath(bin) {
  try {
    await execFileAsync(bin, ["--version"]);
    return true;
  } catch (err) {
    return err.code !== "ENOENT";
  }
}

/**
 * Roda um comando com stdio herdado do processo pai (output em tempo real no terminal).
 * @returns {Promise<number>} código de saída
 */
export function runInherit(bin, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: "inherit", ...opts });
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
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ["pipe", "inherit", "inherit"], ...opts });
    child.on("error", reject);
    child.stdin.on("error", () => {});
    child.stdin.write(input);
    child.stdin.end();
    child.on("exit", (code, signal) => resolve(code ?? (signal ? 1 : 0)));
  });
}
