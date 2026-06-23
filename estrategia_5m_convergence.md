CONFIGURAR ESTRATÉGIA: LAST_MINUTE_5M_CONVERGENCE

OBJETIVO

Implementar uma estratégia automatizada baseada na metodologia apresentada no vídeo de referência, focada EXCLUSIVAMENTE em mercados de expiração de 5 minutos, buscando capturar a convergência do preço para US$1,00 nos segundos finais antes da resolução.

A estratégia não busca grandes retornos por operação. O objetivo é acumular pequenos ganhos recorrentes através de operações de alta probabilidade nos momentos finais do mercado.

=================================================
ESCOPO DA ESTRATÉGIA
====================

Esta estratégia deve operar SOMENTE em mercados com ciclo de resolução de 5 minutos.

Ignorar qualquer mercado que não possua expiração de 5 minutos.

=================================================
JANELA DE OPERAÇÃO
==================

Monitorar continuamente os mercados elegíveis.

A estratégia somente poderá considerar entradas quando faltarem entre 15 e 60 segundos para o encerramento do ciclo de 5 minutos.

Prioridade máxima para operações entre:

* 20 e 45 segundos restantes.

Não abrir posições antes dessa janela.

=================================================
SELEÇÃO DA DIREÇÃO
==================

Identificar automaticamente o lado dominante do mercado.

Exemplo:

YES = 0.86
NO = 0.14

Selecionar YES.

Exemplo:

YES = 0.08
NO = 0.92

Selecionar NO.

Sempre operar a direção que já está liderando.

Nunca tentar antecipar reversões.

Nunca operar contra a tendência dominante.

=================================================
FAIXA DE PREÇO OBRIGATÓRIA
==========================

Abrir posição apenas quando o lado dominante estiver cotado entre:

US$0.80 e US$0.90

Regras:

* Não entrar abaixo de US$0.80.
* Não entrar acima de US$0.90.
* Opcionalmente permitir até US$0.92 mediante configuração.

A faixa ideal é:

US$0.82 a US$0.89

=================================================
CONFIRMAÇÃO DE TENDÊNCIA
========================

Antes da entrada, verificar:

* Movimento dos últimos 5 minutos.
* Movimento dos últimos 3 minutos.
* Movimento do último minuto.

A direção escolhida deve estar:

* Estável.
* Mantendo liderança.
* Sem sinais claros de reversão.

Bloquear entrada quando houver:

* Oscilações violentas.
* Reversão recente.
* Movimento errático.
* Perda rápida de probabilidade.

=================================================
FILTROS DE QUALIDADE
====================

Executar apenas quando TODOS os critérios forem verdadeiros:

* Liquidez mínima atingida.
* Volume mínimo atingido.
* Spread dentro do limite configurado.
* Ordem pode ser executada integralmente.
* Sem gaps relevantes no livro de ofertas.

Ignorar mercados ilíquidos.

=================================================
SCORING DA OPORTUNIDADE
=======================

Calcular um score de qualidade entre 0 e 100.

Fatores:

* Probabilidade atual.
* Liquidez.
* Volume.
* Spread.
* Tempo restante.
* Estabilidade da tendência.
* Profundidade do livro.
* Consistência dos últimos minutos.

Executar apenas quando:

Score >= 85

=================================================
EXECUÇÃO
========

Quando todos os critérios forem atendidos:

1. Comprar imediatamente o lado dominante.
2. Registrar dados da operação.
3. Monitorar continuamente até a resolução.

A execução deve priorizar:

* Baixa latência.
* Menor slippage possível.
* Rapidez na confirmação da ordem.

=================================================
SAÍDA
=====

Estratégia principal:

Manter posição até a resolução do mercado.

Receber liquidação automática ao final.

Opcionalmente permitir saída antecipada quando:

* Lucro atingir valor configurado.
* O preço atingir nível próximo de US$1.00.
* Houver deterioração significativa da tendência.

=================================================
GERENCIAMENTO DE RISCO
======================

Definir:

* Valor máximo por operação.
* Valor máximo diário.
* Número máximo de operações simultâneas.
* Limite de perda diária.

Proibições:

* Não utilizar martingale.
* Não dobrar posição após perda.
* Não aumentar exposição em mercados instáveis.

=================================================
LOGS OBRIGATÓRIOS
=================

Registrar:

* Timestamp.
* Mercado.
* ID do mercado.
* Preço de entrada.
* Preço de saída.
* Tempo restante na entrada.
* Volume.
* Liquidez.
* Spread.
* Score calculado.
* Resultado.
* Lucro/prejuízo.
* ROI.

=================================================
BACKTEST
========

Criar mecanismo de backtest para validar a estratégia utilizando histórico dos mercados de 5 minutos.

Métricas obrigatórias:

* Taxa de acerto.
* ROI.
* Lucro líquido.
* Drawdown.
* Sharpe Ratio.
* Profit Factor.
* Expectativa matemática.

=================================================
COMPORTAMENTO ESPERADO
======================

A lógica central da estratégia é simples:

1. Identificar mercados de expiração de 5 minutos.
2. Aguardar os últimos 60 segundos.
3. Identificar o lado vencedor naquele momento.
4. Confirmar que está entre US$0.80 e US$0.90.
5. Comprar o lado dominante.
6. Manter a posição até a resolução.
7. Repetir continuamente em novos ciclos elegíveis.

O sistema deve reproduzir fielmente essa metodologia, adicionando apenas filtros de liquidez, volume, spread e estabilidade para reduzir entradas de baixa qualidade.
