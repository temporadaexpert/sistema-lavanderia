// Thresholds de priorização de divergências de lavanderia.
//
// Declarativo e simples de ajustar: se o cliente tem um SLA diferente com
// a lavanderia externa (ex.: "retorno garantido em 5 dias"), muda-se os
// números aqui sem tocar em código de service. Valor em reais usa a mesma
// referência de preço do sistema (snapshot quando existe, fallback atual).

export const REGRAS_DIVERGENCIA = {
  // Dias desde dataEnvio para considerar a pendência preocupante.
  // Ação recomendada: cobrar lavanderia.
  DIAS_ATENCAO: 7,
  // Dias para escalar a criticidade — passou deste ponto, aguardar mais
  // vira desperdício. Ação recomendada: encerrar com baixa.
  DIAS_CRITICO: 14,
  // Valor (R$) de pendência que por si só escala para atenção, mesmo que
  // a idade do lote ainda seja baixa.
  VALOR_ATENCAO_BRL: 200,
  // Valor crítico — acima disso o gestor precisa agir independente do tempo.
  VALOR_CRITICO_BRL: 500,
} as const;
