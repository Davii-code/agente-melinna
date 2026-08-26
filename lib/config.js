import { existsSync, readFileSync } from "node:fs";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { resolveHome } from "./paths.js";

/**
 * Preferências persistentes da Melinna, em `~/.melinna/config.json`.
 *
 * Existe para o usuário escolher uma vez e não repetir a flag a cada comando —
 * e para que a escolha valha também dentro do agente, via MCP, onde não há
 * linha de comando para passar flag nenhuma.
 */

/**
 * Perfis de economia de token.
 *
 * A escolha do que cortar veio de medir onde o custo está: num projeto Spring
 * real, o pacote de skills domina o prompt e o mapa do repositório é ruído
 * perto disso. Por isso os perfis mexem primeiro em quantas skills entram e se
 * os arquivos de referência vão junto — não na compressão do contexto.
 *
 * Prompt medido pelo `quick-task` no mesmo projeto Java/Spring:
 *
 *   full  ~36.700 tokens   (base)
 *   lean   ~8.600 tokens   (-77%)
 *   max    ~4.500 tokens   (-88%)
 *
 * A compressão do caveman-code NUNCA é aplicada ao texto das skills: o
 * algoritmo descarta uma palavra a cada N, o que corromperia uma instrução.
 * Ela só entra no mapa do repositório, que já é uma lista de símbolos.
 */
export const PROFILES = {
  full: {
    label: "completo",
    description:
      "Todas as skills escolhidas, com os arquivos de referência. Melhor qualidade, maior custo (~36k tokens).",
    skillLimit: null,
    includeReferences: true,
    tokenBudget: 2048,
    compressMap: false,
  },
  lean: {
    label: "enxuto",
    description:
      "Só o SKILL.md de cada skill, sem os arquivos de referência. Cerca de 77% mais barato (~8,6k tokens).",
    skillLimit: null,
    includeReferences: false,
    tokenBudget: 1536,
    compressMap: false,
  },
  max: {
    label: "máximo",
    description:
      "Duas skills, sem referências e mapa comprimido pelo caveman-code. Cerca de 88% mais barato " +
      "(~4,5k tokens), com risco de o agente perder contexto.",
    skillLimit: 2,
    includeReferences: false,
    tokenBudget: 1024,
    compressMap: true,
  },
};

export const DEFAULT_PROFILE = "full";

/** Caminho do arquivo de configuração. */
export function configPath() {
  return join(resolveHome(), "config.json");
}

/**
 * Lê a configuração salva, como ela está em disco.
 *
 * Devolve `{}` quando não há arquivo — e não um padrão fabricado — para que
 * `resolveProfile` consiga distinguir "o usuário escolheu isso" de "ninguém
 * escolheu nada", e relatar a origem corretamente.
 *
 * Nunca estoura: config corrompida ou perfil inexistente viram ausência, porque
 * derrubar um `melinna task` por causa de um JSON quebrado seria pior que
 * ignorá-lo.
 *
 * @returns {{ economy?: string }}
 */
export function readConfig() {
  const path = configPath();
  if (!existsSync(path)) return {};
  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8"));
    if (parsed.economy && !PROFILES[parsed.economy]) {
      const { economy, ...rest } = parsed;
      return rest;
    }
    return parsed;
  } catch {
    return {};
  }
}

/** Perfil de economia em vigor pela config salva, ou o padrão. */
export function savedEconomy() {
  return readConfig().economy ?? DEFAULT_PROFILE;
}

/**
 * Grava a configuração, preservando chaves que não conhecemos.
 * @param {object} patch
 */
export function writeConfig(patch) {
  const path = configPath();
  const merged = { ...readConfig(), ...patch };
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(merged, null, 2)}\n`, "utf-8");
  return merged;
}

/**
 * Resolve o perfil em vigor.
 *
 * Precedência: flag da linha de comando (ou argumento MCP) → variável de
 * ambiente → config salva → padrão. A variável existe para CI e para testar um
 * perfil sem alterar a preferência do usuário.
 *
 * @param {string} [override] valor vindo de `--economy`
 * @returns {{ name: string, source: string } & typeof PROFILES.full}
 */
export function resolveProfile(override) {
  const candidates = [
    { value: override, source: "flag" },
    { value: process.env.MELINNA_ECONOMY, source: "MELINNA_ECONOMY" },
    { value: readConfig().economy, source: "config" },
  ];


  for (const { value, source } of candidates) {
    if (!value) continue;
    if (!PROFILES[value]) {
      throw new Error(
        `Perfil de economia "${value}" não existe (vindo de ${source}). ` +
          `Use um de: ${Object.keys(PROFILES).join(", ")}.`,
      );
    }
    return { name: value, source, ...PROFILES[value] };
  }
  return { name: DEFAULT_PROFILE, source: "padrão", ...PROFILES[DEFAULT_PROFILE] };
}
