import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import chalk from "chalk";
import { runInherit } from "../tools.js";
import { resolveToolsDir, resolveRegistryDir } from "../paths.js";
import { REGISTRY } from "../registry.js";

const REPO_DIRS = ["caveman-code", "spec-kit"];

/** De onde a Melinna se reinstala numa instalação global. */
const SELF_REPO = "git+https://github.com/Davii-code/agente-melinna.git";

/**
 * Argumentos de atualização de um clone de terceiro.
 *
 * `origin HEAD` é explícito de propósito: um clone raso (`--depth 1`) nem sempre
 * grava o upstream do branch, e aí `git pull` sozinho falha com "there is no
 * tracking information for the current branch". Nomear o remoto e deixar o
 * próprio git resolver o branch padrão via HEAD funciona nos dois casos.
 */
const PULL_ARGS = ["pull", "--ff-only", "--quiet", "origin", "HEAD"];

/**
 * Atualiza a própria Melinna.
 *
 * Num clone de desenvolvimento é `git pull` + `npm install`. Numa instalação
 * global é `npm install -g` do repositório: o npm resolve o commit mais recente
 * do branch padrão, então o efeito é o mesmo de reinstalar — sem o usuário
 * precisar lembrar da URL.
 *
 * @returns {Promise<boolean>} true se deu certo
 */
async function upgradeSelf(root) {
  const isDevClone = existsSync(join(root, ".git"));

  if (isDevClone) {
    console.log(chalk.cyan("Melinna (clone de desenvolvimento): git pull..."));
    const pullCode = await runInherit("git", PULL_ARGS, { cwd: root });
    if (pullCode !== 0) {
      console.log(chalk.red(`git pull da Melinna saiu com código ${pullCode}.`));
      console.log(chalk.dim("Resolva o estado do repositório e rode de novo."));
      return false;
    }

    console.log(chalk.cyan("Melinna: npm install..."));
    const npmCode = await runInherit("npm", ["install"], { cwd: root });
    if (npmCode !== 0) {
      console.log(chalk.red(`npm install saiu com código ${npmCode}.`));
      return false;
    }
    return true;
  }

  console.log(chalk.cyan("Melinna (instalação global): buscando a versão mais recente do git..."));
  const code = await runInherit("npm", ["install", "-g", SELF_REPO]);
  if (code !== 0) {
    console.log(chalk.red(`npm install -g saiu com código ${code}.`));
    console.log(chalk.dim(`Tente manualmente: npm install -g ${SELF_REPO}`));
    return false;
  }
  return true;
}

/**
 * Avisa quando os hooks instalados ficaram para trás.
 *
 * Duas formas de ficar desatualizado, ambas silenciosas: uma instalação antiga
 * gravou o caminho absoluto do script (que quebra se o pacote mudar de lugar),
 * ou não tem o `SessionStart` — sem ele o vault grava contexto que ninguém lê.
 */
async function warnStaleHooks() {
  let installed;
  let expected;
  try {
    const mod = await import("../hook-install.js");
    installed = mod.installedHooks();
    expected = mod.HOOK_EVENTS.map((e) => e.event);
  } catch {
    return;
  }
  if (installed.length === 0) return;

  const missing = expected.filter((e) => !installed.includes(e));
  if (missing.length === 0) return;

  console.log(chalk.yellow(`Hooks desatualizados — faltando: ${missing.join(", ")}`));
  console.log(chalk.dim("  Atualize com: melinna vault hook install"));
  console.log("");
}

/** Versão declarada no package.json, para relatar o antes/depois. */
async function readVersion(root) {
  try {
    return JSON.parse(await readFile(join(root, "package.json"), "utf-8")).version;
  } catch {
    return null;
  }
}

/**
 * `melinna upgrade`: atualiza tudo — a própria Melinna (do git), os clones de
 * terceiros e os repositórios de skills instalados.
 *
 * É o comando único que substitui ter que lembrar do `npm install -g git+...`:
 * quem usa só precisa rodar `melinna upgrade` para pegar o que foi publicado.
 *
 * @param {string} root raiz do pacote Melinna
 * @param {{ self?: boolean, tools?: boolean, skills?: boolean }} [options]
 *   flags negativas do commander (`--no-self` etc.) chegam como false
 */
export async function upgrade(root, options = {}) {
  const doSelf = options.self !== false;
  const doTools = options.tools !== false;
  const doSkills = options.skills !== false;
  let failed = false;

  if (doSelf) {
    const before = await readVersion(root);
    const ok = await upgradeSelf(root);
    failed = failed || !ok;
    if (ok) {
      const after = await readVersion(root);
      console.log(
        after && before && after !== before
          ? `  ${chalk.green("✔")} Melinna ${before} → ${after}`
          : `  ${chalk.green("✔")} Melinna atualizada (${after ?? "versão desconhecida"})`,
      );
    }
    console.log("");
  }

  if (doTools) {
    const toolsDir = resolveToolsDir(root);
    console.log(chalk.cyan("Ferramentas de terceiros:"));
    console.log(chalk.dim(`  ${toolsDir}`));
    for (const dir of REPO_DIRS) {
      const dest = join(toolsDir, dir);
      if (!existsSync(dest)) {
        console.log(`  ${chalk.yellow("○")} ${dir} não instalado — rode \`melinna install\``);
        continue;
      }
      const code = await runInherit("git", PULL_ARGS, { cwd: dest });
      if (code === 0) {
        console.log(`  ${chalk.green("✔")} ${dir}`);
      } else {
        console.log(`  ${chalk.red("✘")} ${dir} (git saiu com ${code})`);
        failed = true;
      }
    }
    console.log("");
  }

  if (doSkills) {
    const registryDir = resolveRegistryDir();
    const installed = REGISTRY.filter((e) => existsSync(join(registryDir, e.dir)));
    if (installed.length === 0) {
      console.log(chalk.dim("Skills: nenhuma instalada — rode `melinna skills install`."));
    } else {
      console.log(chalk.cyan(`Skills (${installed.length} repositório(s)):`));
      for (const entry of installed) {
        const code = await runInherit("git", PULL_ARGS, {
          cwd: join(registryDir, entry.dir),
        });
        if (code === 0) {
          console.log(`  ${chalk.green("✔")} ${entry.name}`);
        } else {
          console.log(`  ${chalk.red("✘")} ${entry.name} (git saiu com ${code})`);
          failed = true;
        }
      }
    }
    console.log("");
  }

  // Hooks instalados por versões anteriores gravaram o caminho absoluto do
  // script e não conhecem o evento SessionStart. Avisar em vez de reinstalar
  // sozinho: mexer no settings do Claude Code é decisão do usuário.
  await warnStaleHooks();

  if (failed) {
    console.log(chalk.red("✘ Upgrade concluído com pendências — veja os erros acima."));
    process.exitCode = 1;
    return;
  }

  console.log(chalk.green("✔ Tudo atualizado."));
  if (doSelf) {
    console.log(chalk.dim("Se você usa a Melinna via MCP, reinicie o agente para recarregar o servidor."));
  }
}
