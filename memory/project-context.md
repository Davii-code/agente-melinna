# A memória do projeto mudou de lugar

Este arquivo não é mais lido pela Melinna. Ele ficou aqui só para explicar a mudança
a quem está atualizando de uma versão anterior.

## O que mudou

Antes, `melinna explain-project` lia a memória de `memory/` **dentro do pacote da
Melinna**. Isso tinha dois problemas:

1. A memória era a mesma para todos os projetos, embora o próprio arquivo se
   descrevesse como "contexto do projeto atual".
2. Numa instalação global (`npm install -g git+...`), o npm recria o diretório do
   pacote a cada upgrade — qualquer memória escrita aqui era perdida.

Agora a memória mora em **`.melinna/memory/` dentro de cada repositório**, junto do
código que ela descreve, e pode ser versionada com ele.

## Como migrar

No repositório do seu projeto:

```bash
melinna init-project
```

Isso cria `.melinna/memory/project-context.md` (e `.melinna/skills/` para skills
próprias do projeto). Copie para lá o conteúdo que você mantinha aqui.
