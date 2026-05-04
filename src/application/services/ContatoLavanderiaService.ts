import type { ContatoLavanderia } from '@/domain/entities/ContatoLavanderia';
import { ContatoLavanderiaId, type LoteId } from '@/domain/types/ids';
import {
  TIPOS_CONTATO_LAVANDERIA,
  type TipoContatoLavanderia,
} from '@/domain/types/enums';
import { NotFoundError, ValidationError } from '@/domain/errors/DomainErrors';
import type { ContatoLavanderiaRepository } from '../ports/ContatoLavanderiaRepository';
import type { LoteRepository } from '../ports/LoteRepository';
import type { Clock, IdGenerator } from './MovimentacaoService';

export interface RegistrarContatoInput {
  readonly loteId: LoteId;
  readonly tipo: TipoContatoLavanderia;
  readonly responsavel: string;
  readonly observacao?: string | null;
  readonly proximaAcao?: string | null;
  // ISO date (YYYY-MM-DD) ou ISO datetime. Quando ausente, não houve promessa.
  readonly promessaRetornoData?: string | null;
  // Opcional: data/hora do contato real. Default = agora (clock do container).
  readonly dataHora?: string;
}

export interface EstatisticaContato {
  readonly ultimo: ContatoLavanderia | null;
  readonly diasDesdeUltimoContato: number | null;
  readonly nuncaCobrado: boolean;
  readonly promessaRetornoProxima: string | null;
  readonly totalContatos: number;
  // Promessa quebrada — considerada apenas quando o lote ainda tem
  // pendência (a informação "tem pendência" vem do consumidor via opts).
  // Pega a promessa passada mais RECENTE: se a lavanderia prometeu duas
  // vezes e descumpriu, o que interessa é a última quebra de compromisso.
  readonly promessaVencida: boolean;
  readonly diasAtrasoPromessa: number | null;
  readonly dataPromessaVencida: string | null;
}

export interface OpcoesEstatistica {
  readonly agoraMs?: number;
  // Default: true. Quando consumidor SABE que o lote não tem pendência
  // efetiva (ex.: já foi concluído ou encerrado), passa false para que
  // promessas passadas não virem "vencidas" — afinal, se não há o que
  // retornar, a promessa foi cumprida por outros meios.
  readonly temPendencia?: boolean;
}

const UM_DIA_MS = 24 * 60 * 60 * 1000;

export class ContatoLavanderiaService {
  constructor(
    private readonly contatos: ContatoLavanderiaRepository,
    private readonly lotes: LoteRepository,
    private readonly idGen: IdGenerator,
    private readonly clock: Clock,
  ) {}

  async registrar(input: RegistrarContatoInput): Promise<ContatoLavanderia> {
    if (!input.responsavel?.trim()) {
      throw new ValidationError('Responsável é obrigatório');
    }
    if (!(TIPOS_CONTATO_LAVANDERIA as readonly string[]).includes(input.tipo)) {
      throw new ValidationError(
        `Tipo de contato inválido. Valores aceitos: ${TIPOS_CONTATO_LAVANDERIA.join(', ')}`,
      );
    }
    if (input.dataHora && Number.isNaN(Date.parse(input.dataHora))) {
      throw new ValidationError('dataHora inválida (esperado ISO 8601)');
    }
    if (
      input.promessaRetornoData &&
      Number.isNaN(Date.parse(input.promessaRetornoData))
    ) {
      throw new ValidationError('promessaRetornoData inválida (esperado ISO)');
    }

    const lote = await this.lotes.porId(input.loteId);
    if (!lote) throw new NotFoundError('Lote', input.loteId);

    const agora = this.clock.agoraISO();
    const contato: ContatoLavanderia = {
      id: ContatoLavanderiaId(this.idGen.gerar()),
      loteId: input.loteId,
      dataHora: input.dataHora ?? agora,
      responsavel: input.responsavel.trim(),
      tipo: input.tipo,
      observacao: input.observacao?.trim() ? input.observacao.trim() : null,
      proximaAcao: input.proximaAcao?.trim() ? input.proximaAcao.trim() : null,
      promessaRetornoData: input.promessaRetornoData?.trim()
        ? input.promessaRetornoData.trim()
        : null,
      registradoEm: agora,
    };

    await this.contatos.registrar(contato);
    return contato;
  }

  // Retorna contatos de um lote em ordem cronológica decrescente — o mais
  // recente primeiro. Conveniente para exibir como timeline no detalhe.
  async porLoteId(loteId: LoteId): Promise<ContatoLavanderia[]> {
    const contatos = await this.contatos.listarPorLote(loteId);
    return contatos.slice().sort((a, b) => b.dataHora.localeCompare(a.dataHora));
  }

  async estatisticaLote(
    loteId: LoteId,
    opts: OpcoesEstatistica = {},
  ): Promise<EstatisticaContato> {
    const contatos = await this.contatos.listarPorLote(loteId);
    return this.calcularEstatistica(contatos, opts.agoraMs ?? Date.now(), opts.temPendencia ?? true);
  }

  // Versão batch: uma chamada ao repo, depois agrupa em memória.
  // Aceita `pendenciaPorLote` para que o cálculo de "promessa vencida"
  // saiba quais lotes ainda têm pendência real. Lotes ausentes no mapa
  // são tratados como "temPendencia=true" (conservador — exibe alerta).
  async mapaEstatisticaTodos(opts: {
    agoraMs?: number;
    pendenciaPorLote?: ReadonlyMap<LoteId, number>;
  } = {}): Promise<Map<LoteId, EstatisticaContato>> {
    const agoraMs = opts.agoraMs ?? Date.now();
    const todos = await this.contatos.listar();
    const porLote = new Map<LoteId, ContatoLavanderia[]>();
    for (const c of todos) {
      const arr = porLote.get(c.loteId);
      if (arr) arr.push(c);
      else porLote.set(c.loteId, [c]);
    }
    const resultado = new Map<LoteId, EstatisticaContato>();
    for (const [loteId, contatos] of porLote) {
      const pendencia = opts.pendenciaPorLote?.get(loteId);
      const temPendencia = pendencia === undefined ? true : pendencia > 0;
      resultado.set(loteId, this.calcularEstatistica(contatos, agoraMs, temPendencia));
    }
    return resultado;
  }

  private calcularEstatistica(
    contatos: readonly ContatoLavanderia[],
    agoraMs: number,
    temPendencia: boolean,
  ): EstatisticaContato {
    if (contatos.length === 0) {
      return {
        ultimo: null,
        diasDesdeUltimoContato: null,
        nuncaCobrado: true,
        promessaRetornoProxima: null,
        totalContatos: 0,
        promessaVencida: false,
        diasAtrasoPromessa: null,
        dataPromessaVencida: null,
      };
    }

    // Mais recente = maior dataHora (ISO é lexicograficamente ordenável).
    const ordenados = contatos.slice().sort((a, b) => b.dataHora.localeCompare(a.dataHora));
    const ultimo = ordenados[0]!;
    const idade = Math.max(
      0,
      Math.floor((agoraMs - new Date(ultimo.dataHora).getTime()) / UM_DIA_MS),
    );

    const hojeISO = new Date(agoraMs).toISOString().slice(0, 10);

    const promessasRaw = contatos
      .map((c) => c.promessaRetornoData?.slice(0, 10) ?? null)
      .filter((p): p is string => p != null);

    const promessasFuturas = promessasRaw.filter((p) => p >= hojeISO).sort();
    const promessasPassadas = promessasRaw.filter((p) => p < hojeISO).sort();

    // Última promessa quebrada: a mais recente entre as passadas. Se a
    // lavanderia prometeu duas vezes e descumpriu, o que importa é a
    // última — ela é a referência de "quando deveria ter chegado".
    const dataPromessaVencida =
      promessasPassadas.length > 0 ? promessasPassadas[promessasPassadas.length - 1]! : null;

    let promessaVencida = false;
    let diasAtrasoPromessa: number | null = null;
    if (dataPromessaVencida && temPendencia) {
      promessaVencida = true;
      diasAtrasoPromessa = diasEntreISO(dataPromessaVencida, hojeISO);
    }

    return {
      ultimo,
      diasDesdeUltimoContato: idade,
      nuncaCobrado: false,
      promessaRetornoProxima: promessasFuturas[0] ?? null,
      totalContatos: contatos.length,
      promessaVencida,
      diasAtrasoPromessa,
      dataPromessaVencida,
    };
  }
}

// Diferença em dias-calendário entre duas datas ISO (YYYY-MM-DD).
// Usa UTC para evitar pulos de fuso. Resultado nunca negativo.
function diasEntreISO(dataPassada: string, hoje: string): number {
  const [ay, am, ad] = dataPassada.split('-').map(Number);
  const [hy, hm, hd] = hoje.split('-').map(Number);
  if (ay === undefined || am === undefined || ad === undefined) return 0;
  if (hy === undefined || hm === undefined || hd === undefined) return 0;
  const dataMs = Date.UTC(ay, am - 1, ad);
  const hojeMs = Date.UTC(hy, hm - 1, hd);
  return Math.max(0, Math.floor((hojeMs - dataMs) / UM_DIA_MS));
}
