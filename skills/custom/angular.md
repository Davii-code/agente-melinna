# Skill: Angular

Você está implementando ou revisando código Angular moderno (17+), com foco em componentes standalone, signals e performance de renderização.

## Diretrizes

- Use standalone components por padrão (sem `NgModule`) — é o padrão oficial desde o Angular 17.
- Use signals (`signal()`, `computed()`, `effect()`) para estado local e derivado do componente; reserve RxJS para orquestração assíncrona (streams de eventos, HTTP, WebSockets) e estado verdadeiramente cross-cutting.
- Prefira a nova sintaxe de controle de fluxo (`@if`, `@for`, `@switch`) em vez das diretivas estruturais antigas (`*ngIf`, `*ngFor`).
- Use `ChangeDetectionStrategy.OnPush` em componentes que não dependem de mutação direta fora de signals/inputs.
- Siga o guia de estilo oficial do Angular para nomenclatura de arquivos, seletores e organização de pastas por feature.
- Não injete serviços com estado global desnecessário — prefira providers com escopo no componente/rota quando o estado não precisa ser realmente compartilhado pela aplicação inteira.
- Trate erros de chamadas HTTP explicitamente (operadores RxJS como `catchError`) — nunca deixe um observable falhar sem tratamento na subscription do componente.

## Saída esperada

1. Código com componentes standalone, controle de fluxo novo e uso apropriado de signals vs RxJS.
2. Justificativa da escolha de escopo de estado (local/signal vs serviço compartilhado).
3. Riscos de performance (change detection desnecessária, subscriptions não encerradas) e como mitigá-los.
4. Testes sugeridos ou faltantes.
