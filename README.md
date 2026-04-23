# Sistema de Lavanderia — MVP 1

Sistema interno para controle de enxoval com rastreabilidade completa:
entrada no depósito, saída para imóveis, retorno, envio/retorno de lavanderia,
ajustes e identificação de perdas.

## Arquitetura

Clean Architecture / Ports & Adapters em 4 camadas:

```
src/
├── domain/          # Entidades, tipos, regras e erros (puro, sem deps)
│   ├── entities/        Item, Local, Movimentacao
│   ├── types/           IDs branded, enums (LocalTipo, MovimentacaoTipo)
│   ├── rules/           Tabela de regras por tipo de movimentação
│   └── errors/          DomainError, ValidationError, SaldoInsuficienteError
├── application/     # Casos de uso (orquestração)
│   ├── ports/           Interfaces dos repositórios
│   ├── dto/             Inputs dos casos de uso
│   └── services/        MovimentacaoService, SaldoService
├── infrastructure/  # Adapters concretos
│   ├── repositories/    InMemory* (MVP) — substituíveis por Prisma/SQL
│   ├── ids/             Gerador UUID
│   ├── clock/           Relógio do sistema
│   └── container.ts     Composition root
├── mock/            # Seed para testes
└── app/             # Next.js App Router (UI mínima no MVP 1)

scripts/
└── demo.ts          # Demonstração end-to-end do fluxo operacional
```

**Regra de ouro:** dependências sempre apontam para dentro. `domain/` não
importa nada de Next.js, repositório ou framework. Testar a regra de saldo
não exige subir nada.

## Regra crítica: saldo como projeção

O saldo **não é armazenado**. A fonte única da verdade é o log append-only
de movimentações. Qualquer consulta de saldo é recalculada a partir dele:

```
saldo(item, local) = Σ qtd (destino=local) − Σ qtd (origem=local)
```

Essa fórmula vale para todos os 6 tipos de movimentação, porque a semântica
de cada tipo foi codificada em "quem é origem" e "quem é destino".

Quando o volume exigir, introduziremos snapshots periódicos como otimização
de leitura — nunca como fonte de verdade.

## Tipos de movimentação e regras

| tipo                | origem      | destino     |
|---------------------|-------------|-------------|
| `entrada_deposito`  | —           | depósito    |
| `saida_imovel`      | depósito    | imóvel      |
| `retorno_imovel`    | imóvel      | depósito    |
| `envio_lavanderia`  | depósito    | lavanderia  |
| `retorno_lavanderia`| lavanderia  | depósito    |
| `ajuste`            | qualquer ou — | qualquer ou — (pelo menos 1) |

Validações aplicadas em `MovimentacaoService.registrar`:
- Quantidade inteira positiva, responsável obrigatório.
- Item e locais existem e estão ativos.
- Tipos de origem/destino batem com a regra (`REGRAS_MOVIMENTACAO`).
- Origem ≠ destino.
- Saldo disponível na origem é suficiente (exceto em `ajuste`).

## Como rodar

```bash
npm install
npm run demo        # roda o fluxo completo em console
npm run dev         # sobe o Next.js em http://localhost:3000
npm run typecheck   # verifica tipos
```

## Pontos de atenção (limitações deliberadas do MVP 1)

- **Persistência in-memory:** dados somem ao reiniciar. Trocar adapter em
  `infrastructure/repositories/` quando for para Postgres/SQLite.
- **Concorrência:** `registrar` lê saldo e grava sem lock. Suficiente para
  uso single-process; com DB real, envolver em transação com `SELECT ... FOR
  UPDATE` ou `serializable isolation`.
- **Sem autenticação:** `responsavel` é texto livre. Virá como `UsuarioId`
  quando houver login.
- **Sem fechamento de ciclo:** envio/retorno não são correlacionados
  individualmente — só agregados. Quando precisar rastrear "este lote foi
  enviado no dia X e voltou no dia Y com perda Z", modelaremos `CicloLavanderia`.
- **Sem unidade de medida:** quantidade é inteira. Se o cliente pedir controle
  por peso, entra `unidade` em `Item`.
- **Sem soft-delete cascading:** desativar um item ou local não valida
  retroativamente movimentações — é por design (imutabilidade do log).
