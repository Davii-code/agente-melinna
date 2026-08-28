import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import chalk from "chalk";
import { input, confirm } from "@inquirer/prompts";
import {
  JOURNAL_DIR,
  PROJECTS_DIR,
  appendJournal,
  disableVault,
  enableVault,
  journalNotePath,
  listProjects,
  projectIdentity,
  projectNotePath,
  readProjectContext,
  stacksFor,
  today,
  vaultConfig,
  writeProjectNote,
} from "../vault.js";
import { installHook, uninstallHook, isHookInstalled, claudeSettingsPath } from "../hook-install.js";

/**
 * `melinna vault enable [pasta]`: liga o segundo cérebro.
 *
 * Além de salvar o caminho, instala o hook `Stop` no Claude Code — é ele que
 * torna a captura automática. Sem o hook, o vault continua funcionando, só que
 * gravando quando o usuário (ou o agente) pede.
 */
export async function vaultEnable(folder, options = {}) {
  let target = folder;
  if (!target) {
    target = await input({
      message: "Pasta do vault (a raiz do seu cofre do Obsidian, por exemplo):",
      validate: (v) => (v.trim() ? true : "Informe um caminho."),
    });
  }

  const path = resolve(target.trim());
  const existed = existsSync(path);
  enableVault(path, { cooldownMinutes: options.cooldown });

  console.log(`${chalk.green("✔")} Vault ligado em ${chalk.bold(path)}`);
  console.log(chalk.dim(`  ${PROJECTS_DIR}/  — uma nota viva por projeto`));
  console.log(chalk.dim(`  ${JOURNAL_DIR}/  — uma linha por sessão, por dia`));
  if (!existed) console.log(chalk.dim("  (pasta criada agora)"));

  if (options.hook === false) {
    console.log("");
    console.log(chalk.yellow("Hook não instalado (--no-hook)."));
    console.log(chalk.dim("A gravação só acontece quando você pedir: \"salva o contexto no vault\"."));
    return;
  }

  console.log("");
  console.log(chalk.cyan("Instalando o hook de captura automática no Claude Code..."));
  console.log(chalk.dim(`  Isso altera ${claudeSettingsPath()}`));

  const ok =
    options.yes ||
    (await confirm({
      message: "Posso alterar as settings do Claude Code para instalar o hook?",
      default: true,
    }));
  if (!ok) {
    console.log(chalk.yellow("Hook não instalado. O vault segue ligado, só sem captura automática."));
    console.log(chalk.dim("Instale depois com `melinna vault hook install`."));
    return;
  }

  const { path: settings, backup } = installHook();
  console.log(`${chalk.green("✔")} Hook instalado em ${settings}`);
  if (backup) console.log(chalk.dim(`  Backup do arquivo anterior: ${backup}`));
  console.log("");
  console.log(chalk.dim("Reinicie o Claude Code — hooks são lidos na inicialização."));
  console.log(chalk.dim("A partir daí, ao fim de uma sessão com trabalho de verdade, o agente"));
  console.log(chalk.dim("grava o contexto do projeto no vault sozinho."));
}

/** `melinna vault disable`: desliga e remove o hook, preservando as notas. */
export async function vaultDisable(options = {}) {
  disableVault();
  console.log(`${chalk.green("✔")} Vault desligado. As notas já escritas continuam onde estão.`);

  if (isHookInstalled()) {
    const ok =
      options.yes ||
      (await confirm({ message: "Remover também o hook do Claude Code?", default: true }));
    if (ok) {
      const { path, removed } = uninstallHook();
      console.log(
        removed > 0
          ? `${chalk.green("✔")} Hook removido de ${path}`
          : chalk.dim("Nenhum hook da Melinna encontrado nas settings."),
      );
      console.log(chalk.dim("Reinicie o Claude Code para a mudança valer."));
    } else {
      console.log(chalk.dim("Hook mantido — ele não faz nada com o vault desligado."));
    }
  }
}

/** `melinna vault status`: estado do vault e do hook. */
export function vaultStatus(cwd) {
  const config = vaultConfig();

  console.log(chalk.bold("Vault de contexto"));
  if (!config.enabled) {
    console.log(`  ${chalk.yellow("○")} desligado`);
    console.log(chalk.dim("  Ligue com `melinna vault enable <pasta>`."));
    return;
  }

  console.log(`  ${chalk.green("✔")} ligado`);
  console.log(chalk.dim(`  pasta: ${config.path}`));
  console.log(chalk.dim(`  intervalo mínimo entre gravações: ${config.cooldownMinutes} min`));

  const hook = isHookInstalled();
  console.log(
    hook
      ? `  ${chalk.green("✔")} hook de captura automática instalado`
      : `  ${chalk.yellow("○")} sem hook — grava só quando você pedir (\`melinna vault hook install\`)`,
  );

  const projects = listProjects(config.path);
  console.log(chalk.dim(`  projetos com nota: ${projects.length ? projects.join(", ") : "nenhum ainda"}`));

  if (cwd) {
    const identity = projectIdentity(cwd);
    const note = projectNotePath(config.path, identity.id);
    console.log("");
    console.log(chalk.bold("Projeto atual"));
    console.log(chalk.dim(`  ${identity.label} (id: ${identity.id}, via ${identity.source})`));
    console.log(
      existsSync(note)
        ? `  ${chalk.green("✔")} nota: ${note}`
        : `  ${chalk.yellow("○")} sem nota ainda`,
    );
  }
}

/** `melinna vault hook install|remove`: controla só o hook. */
export function vaultHook(action) {
  if (action === "install") {
    const { path, backup } = installHook();
    console.log(`${chalk.green("✔")} Hook instalado em ${path}`);
    if (backup) console.log(chalk.dim(`  Backup: ${backup}`));
    console.log(chalk.dim("Reinicie o Claude Code."));
    return;
  }
  if (action === "remove") {
    const { path, removed } = uninstallHook();
    console.log(
      removed > 0
        ? `${chalk.green("✔")} Hook removido de ${path}`
        : chalk.dim("Nenhum hook da Melinna encontrado nas settings."),
    );
    return;
  }
  console.log(chalk.red(`Ação "${action}" inválida. Use: install ou remove.`));
  process.exitCode = 1;
}

/** `melinna vault show`: imprime o contexto salvo do projeto atual. */
export function vaultShow(cwd) {
  const config = vaultConfig();
  if (!config.enabled) {
    console.log(chalk.yellow("Vault desligado. Ligue com `melinna vault enable <pasta>`."));
    process.exitCode = 1;
    return;
  }
  const identity = projectIdentity(cwd);
  const context = readProjectContext(config.path, identity.id);
  if (!context) {
    console.log(chalk.yellow(`Nenhuma nota para "${identity.label}" ainda.`));
    console.log(chalk.dim("Ela é criada na primeira gravação — automática, ou via `melinna vault save`."));
    return;
  }
  console.log(context);
}

/**
 * `melinna vault save`: grava manualmente, sem passar pelo agente.
 *
 * Existe para o caso em que você quer registrar algo pontual, e para testar o
 * vault sem esperar o hook disparar. O caminho normal é o agente chamar
 * `melinna_vault_save` com o resumo que ele mesmo escreve.
 */
export function vaultSave(cwd, resumo, options = {}) {
  const config = vaultConfig();
  if (!config.enabled) {
    console.log(chalk.yellow("Vault desligado. Ligue com `melinna vault enable <pasta>`."));
    process.exitCode = 1;
    return;
  }

  const identity = projectIdentity(cwd);
  const { path, created } = writeProjectNote(
    config.path,
    identity,
    {
      resumo,
      arquitetura: options.arquitetura,
      decisoes: options.decisao ?? [],
      regras: options.regra ?? [],
      atencao: options.atencao,
    },
    { stacks: stacksFor(cwd) },
  );

  console.log(`${chalk.green("✔")} ${created ? "Nota criada" : "Nota atualizada"}: ${path}`);

  if (resumo?.trim()) {
    const journal = appendJournal(config.path, resumo, { projectId: identity.id });
    if (journal.added) console.log(`${chalk.green("✔")} Diário: ${journal.path}`);
  }
}

/**
 * `melinna journal add <linha>`: uma linha no diário do dia.
 *
 * Separado do vault save porque nem toda anotação de diário nasce de uma sessão
 * de trabalho — às vezes você só quer registrar o que fez.
 */
export function journalAdd(cwd, line, options = {}) {
  const config = vaultConfig();
  if (!config.enabled) {
    console.log(chalk.yellow("Vault desligado. Ligue com `melinna vault enable <pasta>`."));
    process.exitCode = 1;
    return;
  }

  const clean = String(line ?? "").replace(/\s+/g, " ").trim();
  if (!clean) {
    console.log(chalk.red("Informe a linha. Ex: melinna journal add \"corrigiu o spawn no Windows\""));
    process.exitCode = 1;
    return;
  }

  const identity = options.noProject ? {} : projectIdentity(cwd);
  const { path, added } = appendJournal(config.path, clean, {
    projectId: identity.id,
    day: options.day,
  });
  console.log(
    added
      ? `${chalk.green("✔")} ${path}\n  - ${identity.id ? `[[${identity.id}]] — ` : ""}${clean}`
      : chalk.yellow("Essa linha já está registrada hoje."),
  );
}

/** `melinna journal show [dia]`: mostra o diário de um dia. */
export function journalShow(day) {
  const config = vaultConfig();
  if (!config.enabled) {
    console.log(chalk.yellow("Vault desligado. Ligue com `melinna vault enable <pasta>`."));
    process.exitCode = 1;
    return;
  }
  const target = day ?? today();
  const path = journalNotePath(config.path, target);
  if (!existsSync(path)) {
    console.log(chalk.yellow(`Nada registrado em ${target}.`));
    return;
  }
  console.log(readFileSync(path, "utf-8"));
}
