import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Resolve onde vivem os clones de terceiros (caveman-code, spec-kit).
 *
 * Precedência:
 *   1. $MELINNA_HOME/tools — override explícito.
 *   2. <repo>/tools — clone de desenvolvimento, quando já foi populado ali.
 *   3. ~/.melinna/tools — instalação global.
 *
 * O passo 3 existe porque `tools/` é gitignored e portanto não entra no tarball
 * do npm: numa instalação global (`npm i -g git+...`) o diretório do pacote fica
 * sem os clones — e escrever dentro do node_modules global seria frágil (o npm
 * apaga o diretório a cada upgrade) e às vezes sem permissão. Por isso os clones
 * moram no HOME do usuário, fora do pacote.
 *
 * @param {string} root diretório raiz do pacote Melinna
 * @returns {string} caminho absoluto do diretório de tools
 */
export function resolveToolsDir(root) {
  if (process.env.MELINNA_HOME) {
    return join(process.env.MELINNA_HOME, "tools");
  }
  const repoTools = join(root, "tools");
  if (existsSync(join(repoTools, "caveman-code"))) {
    return repoTools;
  }
  return join(homedir(), ".melinna", "tools");
}

/**
 * Caminho do módulo de compressão (repomap) do caveman-code dentro do diretório
 * de tools resolvido.
 * @param {string} root
 * @returns {string}
 */
export function resolveRepomapDir(root) {
  return join(resolveToolsDir(root), "caveman-code", "packages", "agent", "src", "repomap");
}
