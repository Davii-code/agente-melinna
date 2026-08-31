import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import chalk from "chalk";
import { input, confirm } from "@inquirer/prompts";
import { readConfig, writeConfig } from "../config.js";
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
import {
  installHook,
  uninstallHook,
  isHookInstalled,
  installedHooks,
  claudeSettingsPath,
} from "../hook-install.js";

/**
 * `melinna vault enable [pasta]`: liga o segundo cérebro.
 *
 * Instala o hook `SessionStart`, que carrega o contexto salvo no início de cada
 * conversa — passivo, o usuário não percebe. A gravação fica sob demanda
 * (`/melinna-salvar`): pedir a gravação sozinho ao fim de cada resposta
 * interrompe a conversa logo no primeiro comando, e o atrito não compensa.
 * `--auto-save` liga esse comportamento para quem preferir.
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
  enableVault(path, { cooldownMinutes: options.cooldown, autoSave: options.autoSave });

  console.log(`${chalk.green("✔")} Vault ligado em ${chalk.bold(path)}`);
  console.log(chalk.dim(`  ${PROJECTS_DIR}/  — uma nota viva por projeto`));
  console.log(chalk.dim(`  ${JOURNAL_DIR}/  — uma linha por sessão, por dia`));
  if (!existed) console.log(chalk.dim("  (pasta criada agora)"));

  console.log("");
  console.log(chalk.bold("Gravação: sob demanda"));
  console.log(chalk.dim("  Você grava quando quiser, com `/melinna-salvar` dentro do Claude"));
  console.log(chalk.dim("  ou `melinna vault save \"...\"` no terminal."));
  if (options.autoSave) {
    console.log(chalk.yellow("  --auto-save: o agente também vai pedir a gravação ao fim das sessões."));
  }

  if (options.hook === false) {
    console.log("");
    console.log(chalk.yellow("Nenhum hook instalado (--no-hook)."));
    console.log(chalk.dim("O contexto salvo não será carregado sozinho no início da conversa."));
    return;
  }

  console.log("");
  console.log(chalk.cyan("Instalando o hook de carga automática no Claude Code..."));
  console.log(chalk.dim("  Ele injeta o contexto salvo no início de cada conversa. Não interrompe nada."));
  console.log(chalk.dim(`  Isso altera ${claudeSettingsPath()}`));

  const ok =
    options.yes ||
    (await confirm({
      message: "Posso alterar as settings do Claude Code para instalar o hook?",
      default: true,
    }));
  if (!ok) {
    console.log(chalk.yellow("Hook não instalado. O vault segue ligado, só sem carga automática."));
    console.log(chalk.dim("Instale depois com `melinna vault hook install`."));
    return;
  }

  const { path: settings, backup, installed } = installHook(claudeSettingsPath(), {
    autoSave: options.autoSave,
  });
  console.log(`${chalk.green("✔")} Hooks instalados em ${settings}: ${installed.join(", ")}`);
  if (backup) console.log(chalk.dim(`  Backup do arquivo anterior: ${backup}`));
  console.log("");
  console.log(chalk.dim("Reinicie o Claude Code — hooks são lidos na inicialização."));
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

  console.log(
    config.autoSave
      ? `  ${chalk.yellow("⚠")} gravação automática LIGADA (pede ao fim das sessões, a cada ${config.cooldownMinutes} min)`
      : `  ${chalk.green("✔")} gravação sob demanda — só com \`/melinna-salvar\` ou \`melinna vault save\``,
  );
  console.log(
    config.autoLoad
      ? `  ${chalk.green("✔")} carga automática do contexto no início da conversa`
      : `  ${chalk.yellow("○")} carga automática desligada (autoLoad: false)`,
  );

  const hooks = installedHooks();
  console.log(
    hooks.length > 0
      ? `  ${chalk.green("✔")} hooks instalados: ${hooks.join(", ")}`
      : `  ${chalk.yellow("○")} sem hook — \`melinna vault hook install\``,
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

/** `melinna vault hook install|remove`: controla só os hooks. */
export function vaultHook(action, options = {}) {
  if (action === "install") {
    // Sem `--auto-save`, respeita o que já está na config: quem tinha a
    // gravação automática ligada não a perde ao migrar o formato do hook.
    const autoSave = options.autoSave ?? vaultConfig().autoSave;
    const { path, backup, installed, removed } = installHook(claudeSettingsPath(), { autoSave });
    console.log(`${chalk.green("✔")} Hooks em ${path}: ${installed.join(", ")}`);
    if (removed?.length) console.log(chalk.dim(`  removidos: ${removed.join(", ")}`));
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

/**
 * `melinna vault auto-save on|off`: liga ou desliga a gravação automática.
 *
 * Mexe na config e nos hooks juntos, porque desligar só um dos dois deixaria o
 * estado inconsistente — hook instalado que não faz nada, ou config ligada sem
 * hook para agir.
 */
export function vaultAutoSave(state) {
  const on = state === "on";
  if (!on && state !== "off") {
    console.log(chalk.red(`Estado "${state}" inválido. Use: on ou off.`));
    process.exitCode = 1;
    return;
  }

  const current = readConfig().vault ?? {};
  if (!current.enabled) {
    console.log(chalk.yellow("Vault desligado. Ligue com `melinna vault enable <pasta>` primeiro."));
    process.exitCode = 1;
    return;
  }
  writeConfig({ vault: { ...current, autoSave: on } });

  if (isHookInstalled()) {
    const { installed, removed } = installHook(claudeSettingsPath(), { autoSave: on });
    console.log(chalk.dim(`  hooks: ${installed.join(", ") || "nenhum"}`));
    if (removed?.length) console.log(chalk.dim(`  removidos: ${removed.join(", ")}`));
  }

  if (on) {
    console.log(`${chalk.yellow("⚠")} Gravação automática ligada.`);
    console.log(chalk.dim("  O agente vai pedir a gravação ao fim das sessões com trabalho."));
  } else {
    console.log(`${chalk.green("✔")} Gravação automática desligada.`);
    console.log(chalk.dim("  O vault grava só com `/melinna-salvar` ou `melinna vault save`."));
  }
  console.log(chalk.dim("Reinicie o Claude Code para a mudança valer."));
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
