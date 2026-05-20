# `src/modules/`

Implementaciones (adapters) intercambiables que el core consume a través de [ports](../core/ports/).

## Regla de oro

> **`src/core/` nunca debe importar de `src/modules/`.** Si lo hace, hay un bug arquitectónico.

Los módulos se registran condicionalmente en [`src/config/module-registry.ts`](../config/module-registry.ts) según las feature flags. Para agregar un módulo nuevo:

1. Crea la carpeta `src/modules/<categoría>/<provider>/`.
2. Implementa el port correspondiente de `src/core/ports/`.
3. Crea un `<provider>.module.ts` que registre el adapter con el token de DI.
4. Agrega el módulo a `resolveModules()` en `module-registry.ts` con el flag que lo activa.
5. Crea un adapter mock equivalente para tests.

Ver [docs/01_ARCHITECTURE.md §11](../../docs/01_ARCHITECTURE.md#11-patrones-arquitectónicos-adapter--coremódulos) para el patrón completo.

## Estructura actual

```
modules/
├── llm/            # LLMProviderPort: Claude (primario), mock para tests
├── channels/       # ChannelProviderPort: WhatsApp (v1)
├── tools/          # ToolModulePort: catalog, orders, info, escalation
├── embeddings/     # EmbeddingProviderPort: OpenAI
├── persistence/    # repos sobre Prisma
├── cache/          # ResponseCachePort: exact (Redis), semantic (pgvector)
└── queue/          # BullMQ + workers
```

Los .gitkeep en cada carpeta marcan estructura pendiente de implementar — se reemplazan por código real a medida que avanzamos en el roadmap.
