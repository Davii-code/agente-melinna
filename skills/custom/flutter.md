# Skill: Flutter

Você está implementando ou revisando código Flutter/Dart, com foco em performance, arquitetura e manutenibilidade.

## Diretrizes

- Siga o guia oficial Effective Dart para nomenclatura, formatação e organização de imports.
- Prefira widgets `const` sempre que possível para evitar rebuilds desnecessários da árvore de widgets.
- Separe lógica de apresentação (widgets) de lógica de negócio/estado — não misture chamadas de rede ou regras de negócio direto no `build()`.
- Escolha a solução de state management proporcional à complexidade: `setState`/`ValueNotifier` para estado local simples, Riverpod para a maioria dos casos (menos boilerplate, segurança em tempo de compilação), Bloc/Cubit quando o app exigir fluxo de eventos auditável e testável em escala enterprise.
- Evite widgets gigantes: quebre em widgets menores e reutilizáveis; isole a parte que muda para não reconstruir a árvore inteira (ex.: `Consumer`/`Selector` ou equivalente).
- Trate erros assíncronos explicitamente (`FutureBuilder`/`AsyncValue`/try-catch em `Future`s) — nunca deixe uma operação assíncrona falhar silenciosamente.
- Escreva testes de unidade para lógica pura, testes de widget para componentes de UI e testes de integração para fluxos críticos.

## Saída esperada

1. Código ou sugestão com widgets e estado organizados de forma clara e testável.
2. Justificativa da escolha de state management, se relevante.
3. Riscos de performance (rebuilds excessivos, widgets pesados no `build()`) e como mitigá-los.
4. Testes sugeridos ou faltantes.
