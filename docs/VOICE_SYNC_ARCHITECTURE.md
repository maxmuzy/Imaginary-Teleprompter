# Arquitetura do Sistema de Sincronização Voz-Texto

## Visão Geral

O sistema de sincronização voz-texto do Teleprompter foi redesenhado para resolver os problemas de **saltos bruscos** e **períodos sem movimento**. A nova arquitetura é modular, extensível e prioriza **movimento suave e previsível**.

## Diagnóstico dos Problemas Originais

### 1. Saltos Bruscos
**Causa**: O sistema original usava controle proporcional simples que causava oscilações:
- Quando a diferença entre posição atual e target era grande, acelerava rapidamente
- Quando era pequena, parava abruptamente (dead zone)
- Transições entre elementos causavam jumps instantâneos

**Solução**: Implementação de controle PID com suavização exponencial:
- Termo Proporcional (P): Resposta à diferença atual
- Termo Integral (I): Acumula erro ao longo do tempo
- Termo Derivativo (D): Suaviza mudanças bruscas

### 2. Períodos Sem Movimento
**Causa**: 
- Detecção de silêncio muito agressiva (800ms)
- Matching de palavras muito restritivo (exato)
- Estado PAUSED sem transição suave

**Solução**:
- Silêncio com desaceleração gradual (1s → 2.5s → 5s)
- Matching fuzzy com tolerância a erros de reconhecimento
- Transições suaves entre estados

### 3. Progresso Impreciso
**Causa**: 
- `calcularProgressoPorAlinhamento()` buscava apenas últimas 5 palavras
- Retornava 0 se não encontrasse match exato
- Não considerava ordem das palavras

**Solução**:
- Índice invertido para busca rápida
- Matching fuzzy com Levenshtein simplificado
- Cálculo de progresso baseado em posição média

## Arquitetura de Módulos

```
┌─────────────────────────────────────────────────────────────┐
│                    VoiceSyncManager                         │
│                  (Orquestrador Principal)                   │
└─────────────────────────────────────────────────────────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        │                     │                     │
        ▼                     ▼                     ▼
┌───────────────┐    ┌───────────────┐    ┌───────────────┐
│   ASRModule   │    │  TextAligner  │    │ ScrollControl │
│ (Reconhec.)   │    │ (Alinhamento) │    │   (Scroll)    │
└───────────────┘    └───────────────┘    └───────────────┘
        │                     │                     │
        ▼                     │                     │
┌───────────────┐             │                     │
│  OfflineASR   │             │                     │
│  (Fallback)   │             │                     │
└───────────────┘             │                     │
                              ▼                     │
                    ┌───────────────┐               │
                    │  WordIndex    │               │
                    │ (Índice Inv.) │               │
                    └───────────────┘               │
                                                   ▼
                                          ┌───────────────┐
                                          │ Teleprompter  │
                                          │    (API)      │
                                          └───────────────┘
```

## Módulos Implementados

### 1. VoiceSync (`js/voiceSync.js`)
Módulo principal com arquitetura limpa e modular.

**Componentes**:
- `VoiceSyncManager`: Orquestrador principal
- `ASRModule`: Abstração do reconhecimento de voz
- `TextAligner`: Alinhamento fuzzy com índice invertido
- `SmoothScrollController`: Controle suave de velocidade

**Uso**:
```javascript
// Iniciar sincronização
window.VoiceSync.start();

// Parar sincronização
window.VoiceSync.stop();

// Obter estado
window.VoiceSync.getState();

// Ativar debug
window.VoiceSync.setDebug(true, { matching: true, scroll: true });
```

### 2. SpeechRecognitionV2 (`js/speechRecognitionV2.js`)
Versão melhorada do reconhecimento com controle PID.

**Melhorias**:
- Controle de velocidade PID em vez de proporcional
- Índice invertido para busca O(1)
- Matching fuzzy com tolerância a erros
- Transições suaves entre estados

**Uso**:
```javascript
// Estado do sistema
window.voiceSyncV30.getState();

// Reconstruir índice (após mudança de roteiro)
window.voiceSyncV30.rebuildIndex();
```

### 3. OfflineASR (`js/offlineASR.js`)
Módulo de reconhecimento offline com fallback automático.

**Engines Suportadas**:
- **Vosk**: Modelo leve (~50MB), boa performance
- **Whisper**: Modelo mais preciso (~150MB), maior latência

**Funcionalidades**:
- Detecção automática de conectividade
- Fallback transparente online ↔ offline
- Cache de modelos em IndexedDB
- API unificada para ambos os modos

**Uso**:
```javascript
// Iniciar (escolhe automaticamente online/offline)
window.OfflineASR.start();

// Pré-carregar modelo offline
window.OfflineASR.preload();

// Forçar modo offline
window.OfflineASR.hybrid.forceOffline();

// Callback para resultados
window.OfflineASR.onResult((result) => {
    console.log(result.words, result.isFinal, result.isOffline);
});
```

## Algoritmos Chave

### Controle PID de Velocidade

```javascript
// Erro = diferença entre posição atual e target
const error = currentPos - targetScrollPos;

// Termo Proporcional
const pTerm = error * kP;

// Termo Integral (acumula erro)
integralError += error * dt;
const iTerm = integralError * kI;

// Termo Derivativo (taxa de mudança)
const dError = (error - lastError) / dt;
const dTerm = dError * kD;

// Velocidade alvo
targetVelocity = pTerm + iTerm + dTerm;

// Suavização exponencial
currentVelocity = currentVelocity * 0.88 + targetVelocity * 0.12;
```

### Índice Invertido para Busca

```javascript
// Construção do índice
palavras.forEach((palavra, posicao) => {
    if (!wordIndex.has(palavra)) {
        wordIndex.set(palavra, []);
    }
    wordIndex.get(palavra).push({ elementIndex, wordPosition: posicao });
});

// Busca O(1)
const matches = wordIndex.get(palavraFalada) || [];
```

### Matching Fuzzy

```javascript
function fuzzyMatch(word1, word2) {
    if (word1 === word2) return true;
    if (Math.abs(word1.length - word2.length) > 2) return false;
    
    let differences = 0;
    for (let i = 0; i < Math.min(word1.length, word2.length); i++) {
        if (word1[i] !== word2[i]) differences++;
    }
    differences += Math.abs(word1.length - word2.length);
    
    return (differences / Math.max(word1.length, word2.length)) <= 0.3;
}
```

## Configuração

### Parâmetros de Alinhamento
```javascript
alignment: {
    minSimilarity: 0.25,        // Similaridade mínima (25%)
    wordWindow: 12,             // Janela de palavras
    lookaheadElements: 8,       // Elementos à frente
    fuzzyThreshold: 0.7,        // Threshold fuzzy
}
```

### Parâmetros de Scroll
```javascript
scroll: {
    maxVelocity: 7,             // Velocidade máxima
    accelerationRate: 0.15,     // Taxa de aceleração
    smoothingFactor: 0.85,      // Suavização
    targetLeadPixels: 50,       // Lead (texto à frente)
}
```

### Parâmetros de Silêncio
```javascript
silence: {
    pauseThresholdMs: 1200,     // Começa desacelerar
    stopThresholdMs: 3000,      // Para completamente
    resumeBoostMs: 500,         // Boost ao retomar
}
```

## Integração com Teleprompter Existente

O sistema usa as APIs existentes do teleprompter:

```javascript
// Controle de voz (exclusivo)
window.teleprompterVoiceControl.acquire();
window.teleprompterVoiceControl.release();

// Controle de velocidade
window.teleprompterAutoScroll.setVelocity(x);

// Posicionamento
window.moveTeleprompterToOffset(offset, smooth, alignTop);

// Leitura de posição
window.getTeleprompterCurrentPos();
window.convertOffsetToScrollPos(offset);
```

## Identificação de Locutores (Futuro)

### Arquitetura Proposta

```
┌─────────────────────────────────────────────────────────────┐
│                  SpeakerIdentifier                          │
└─────────────────────────────────────────────────────────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        │                     │                     │
        ▼                     ▼                     ▼
┌───────────────┐    ┌───────────────┐    ┌───────────────┐
│ VoiceProfile  │    │ FeatureExtract│    │  Classifier   │
│   Storage     │    │    (MFCC)     │    │   (ML/DL)     │
└───────────────┘    └───────────────┘    └───────────────┘
```

### Funcionalidades Planejadas
1. **Extração de Features**: MFCC, pitch, formantes
2. **Perfis de Voz**: Armazenamento em IndexedDB
3. **Classificação**: Modelo leve para identificação
4. **Catalogação**: Interface para nomear/gerenciar perfis

### Marcadores de Roteiro
O sistema atual já detecta marcadores de LINK/EXTERNO:
- `(ABRE LINK)`, `((LINK))`: Entrada de link externo
- `DEIXA:`, `(FIM LINK)`: Retorno do âncora

## Testes e Debug

### Ativar Logs Detalhados
```javascript
// VoiceSync
window.VoiceSync.setDebug(true, {
    matching: true,  // Logs de matching
    scroll: true,    // Logs de scroll
    asr: true        // Logs de ASR
});

// SpeechRecognitionV2
// Logs são automáticos no console
```

### Verificar Estado
```javascript
// Estado completo
console.log(window.VoiceSync.getState());
console.log(window.voiceSyncV30.getState());
console.log(window.OfflineASR.getState());
```

## Migração

### Do Sistema Antigo para o Novo

1. **Backup**: Mantenha `speechRecognition.js` original
2. **Teste**: Use `speechRecognitionV2.js` em ambiente de teste
3. **Gradual**: Ative novo sistema via flag de configuração
4. **Rollback**: Mantenha capacidade de voltar ao antigo

### Arquivos Envolvidos
- `js/speechRecognition.js` → Original (manter)
- `js/speechRecognitionV2.js` → Nova versão (testar)
- `js/voiceSync.js` → Módulo modular (alternativa)
- `js/offlineASR.js` → Fallback offline (adicional)

## Conclusão

A nova arquitetura resolve os problemas identificados através de:

1. **Controle PID**: Movimento suave e previsível
2. **Índice Invertido**: Busca rápida e eficiente
3. **Matching Fuzzy**: Tolerância a erros de reconhecimento
4. **Transições Suaves**: Sem saltos bruscos
5. **Modularidade**: Componentes independentes e reutilizáveis
6. **Fallback Offline**: Continuidade mesmo sem internet

O sistema está pronto para extensões futuras como identificação de locutores e integração com modelos de IA mais avançados.
