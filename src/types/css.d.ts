// Declarações de tipos para imports de CSS.
//
// Por quê: o Next.js gera `next-env.d.ts` ao rodar `next dev`/`next build`,
// que inclui as declarações necessárias via /// <reference types="next" />.
// Esse arquivo fica no .gitignore (convenção do Next), então o CI — que só
// roda `tsc --noEmit` + `vitest` sem `next build` — não enxerga essas
// declarações e o typecheck falha em todo `import styles from '...module.css'`.
//
// Declarar aqui remove a dependência do arquivo gerado pelo Next e torna o
// typecheck idempotente em qualquer ambiente (local, CI, fresh clone).

// CSS Modules: cada import devolve um objeto { className: string } onde a
// chave é a classe declarada no .module.css e o valor é o nome "hashado"
// injetado em runtime pelo Next.
declare module '*.module.css' {
  const classes: { readonly [key: string]: string };
  export default classes;
}

// Variante SCSS: declarada para futuro-proof, embora o projeto não use hoje.
declare module '*.module.scss' {
  const classes: { readonly [key: string]: string };
  export default classes;
}

// CSS global e SCSS global: imports side-effect only (ex.: `import './globals.css'`
// em app/layout.tsx). Nada é exportado — só registramos que o import é válido.
declare module '*.css';
declare module '*.scss';
