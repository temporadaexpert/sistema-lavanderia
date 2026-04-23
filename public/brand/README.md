# Logo Temporada Expert

Este diretório abriga os arquivos de marca usados pelo sistema.

## Estado atual (placeholder)

Hoje o sistema renderiza a identidade via componente `<LogoTE />`
(`src/app/_components/LogoTE.tsx`) — um monograma dourado "TE" + texto
"Temporada Expert / Lavanderia Control". Suficiente como placeholder até
que a imagem oficial da marca seja disponibilizada.

## Quando a logo oficial chegar

Coloque o arquivo aqui:

```
public/brand/logo.svg         (preferível — vetorial, sem perda)
public/brand/logo.png         (fallback — 256x256 recomendado)
public/brand/logo-light.svg   (opcional — versão para fundos escuros)
```

Depois, edite `src/app/_components/LogoTE.tsx` para renderizar
`<Image src="/brand/logo.svg" ... />` em vez do monograma textual. Os
chamadores do componente (`src/app/login/page.tsx`,
`src/app/_components/AdminSidebar.tsx`, `src/app/page.tsx`) não precisam
mudar — a troca é interna ao componente.

## Convenção

- Arquivos dentro de `public/brand/` ficam acessíveis em
  `https://seu-dominio/brand/logo.svg` em runtime.
- Prefira SVG quando possível (melhor em qualquer DPI, tamanho menor).
- Para evitar cache agressivo ao trocar a logo, renomeie com sufixo de
  versão (ex.: `logo-v2.svg`) ou inclua query string no import do Image.
