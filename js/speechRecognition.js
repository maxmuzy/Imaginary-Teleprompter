/**
 * Sistema de Reconhecimento de Voz para Teleprompter
 * v21 - Arquitetura Simplificada com Máquina de Estados
 * 
 * Estados:
 * - SEARCHING: Buscando posição inicial no roteiro
 * - LOCKED: Posição encontrada, avançando sequencialmente
 * 
 * Comportamento:
 * - Em SEARCHING: busca no roteiro todo para encontrar onde o apresentador está
 * - Em LOCKED: só verifica próximos elementos (sequencial)
 * - Se não encontrar match em LOCKED: NÃO move (pode ser improvisação)
 * - Após N misses consecutivos: volta para SEARCHING
 */

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

// Estados da máquina
const STATE = {
    SEARCHING: 'SEARCHING',
    LOCKED: 'LOCKED'
};

// Estados de falante (quem está no ar)
const SPEAKER_MODE = {
    ANCHOR: 'ANCHOR',      // Âncora está falando - matching ATIVO
    EXTERNAL: 'EXTERNAL'   // Link/repórter externo - matching PAUSADO
};

// ========================================
// CONFIGURAÇÃO DE DETECÇÃO DE LINKS/FALANTES EXTERNOS
// ========================================
const LINK_CONFIG = {
    // Marcadores que indicam ENTRADA de link externo (texto do repórter/link)
    // Quando detectados, speakerMode muda para EXTERNAL
    entryMarkers: [
        /\(\s*ABRE\s+LINK\s*\)/i,
        /\(\s*LINK\s*\)/i,
        /\(\(\s*ABRE\s+LINK\s*\)\)/i,
        /\(\s*ABRE\s+SOM\s+DO\s+LINK\s*\)/i,
        /\(\s*ABRE\s+SOM\s+LINK\s*\)/i,
        /\(\(\s*LINK\s*\)\)/i,
        /\(LINK\s+LINK\s+LINK/i
    ],
    
    // Marcadores que indicam RETORNO do âncora
    // Quando detectados, speakerMode volta para ANCHOR
    exitMarkers: [
        /DEIXA\s*:/i,
        /\(\s*FIM\s+LINK\s*\)/i,
        /\(\s*VOLTA\s+\)/i,
        /\(\(\s*CAM\s*\d*\s*\)\)/i  // ((CAM 1)) geralmente indica volta pro estúdio
    ],
    
    // Cache de elementos analisados
    _elementCache: new Map(),
    
    // Contador de elementos EXTERNAL consecutivos (para auto-retorno)
    maxExternalElements: 50  // Após 50 elementos sem marcador de retorno, volta para ANCHOR
};

// Configurações
const CONFIG = {
    // Matching - tolerância aumentada para detecção inicial
    searchThreshold: 0.20,      // Threshold baixo para encontrar posição inicial (20%)
    lockedThreshold: 0.15,      // Threshold ainda mais relaxado quando já está LOCKED (15%)
    wordWindow: 15,             // Janela maior de palavras para matching (15 palavras)
    lookaheadElements: 5,       // Quantos elementos olhar à frente em LOCKED
    minWordsForMatch: 1,        // Mínimo de palavras para tentar match (1 para aceitar cues curtos)
    
    // Improvisação - pausa imediata
    maxConsecutiveMisses: 2,    // Menos misses antes de pausar (mais sensível)
    
    // Buffer
    maxBufferWords: 60,         // Buffer maior para capturar mais contexto
    
    // Debounce
    debounceMs: 200,            // Debounce menor para resposta mais rápida
    
    // Jump híbrido - threshold para fazer jump em vez de scroll contínuo
    hybridJumpThreshold: 500,   // Pixels de diferença para ativar jump híbrido
    hybridJumpMinProgress: 0.4  // Progresso mínimo no match para permitir jump
};

// ========================================
// CONFIGURAÇÃO DE TAGS TÉCNICAS (elementos a ignorar no matching)
// ========================================
const TAG_CONFIG = {
    // Padrões pré-definidos (usuário pode ativar/desativar)
    patterns: {
        parentesesSimples: {
            enabled: true,
            name: 'Parênteses simples',
            description: 'Texto entre ( )',
            regex: /^\s*\([^)]+\)\s*$/
        },
        parentesesDuplos: {
            enabled: true,
            name: 'Parênteses duplos',
            description: 'Texto entre (( ))',
            regex: /^\s*\(\([^)]+\)\)\s*$/
        },
        parentesesTriplos: {
            enabled: true,
            name: 'Parênteses triplos',
            description: 'Texto entre ((( )))',
            regex: /^\s*\(\(\([^)]+\)\)\)\s*$/
        },
        colchetes: {
            enabled: true,
            name: 'Colchetes',
            description: 'Texto entre [ ]',
            regex: /^\s*\[[^\]]+\]\s*$/
        },
        hashtagMaiusculo: {
            enabled: true,
            name: 'Hashtag maiúsculo',
            description: '#TAG ou #CAMERA',
            regex: /^\s*#[A-Z0-9]+\s*$/
        },
        indicadorCamera: {
            enabled: true,
            name: 'Indicador de câmera',
            description: 'CAM1, CAM2, CAMERA1...',
            regex: /^\s*CAM(ERA)?\s*\d+\s*$/i
        },
        textoEntreSetas: {
            enabled: false,
            name: 'Texto entre setas',
            description: 'Texto entre >>> <<<',
            regex: /^\s*>{2,}[^<]+<{2,}\s*$/
        },
        textoEntreAsteriscos: {
            enabled: false,
            name: 'Texto entre asteriscos',
            description: 'Texto entre *** ***',
            regex: /^\s*\*{2,}[^*]+\*{2,}\s*$/
        }
    },
    
    // Caracteres iniciais que indicam tag (configurável pelo usuário)
    customPrefixes: [],  // Ex: ['>>>', '###', '***']
    
    // Cache de elementos já verificados
    _cache: new Map()
};

// Verifica se um texto é uma tag técnica (deve ser ignorado)
// NOTA: NÃO considera textos curtos como tags - eles são legítimos (ex: "Oi", "Eu")
function isTagTecnica(texto) {
    // Apenas textos vazios são ignorados
    if (!texto || texto.trim().length === 0) return true;
    
    const textoLimpo = texto.trim();
    
    // Verifica cache
    if (TAG_CONFIG._cache.has(textoLimpo)) {
        return TAG_CONFIG._cache.get(textoLimpo);
    }
    
    let isTag = false;
    
    // Verifica padrões pré-definidos ativos
    for (const [key, pattern] of Object.entries(TAG_CONFIG.patterns)) {
        if (pattern.enabled && pattern.regex.test(textoLimpo)) {
            isTag = true;
            console.log(`   🏷️ TAG detectada (${pattern.name}): "${textoLimpo.substring(0, 30)}"`);
            break;
        }
    }
    
    // Verifica prefixos customizados
    if (!isTag && TAG_CONFIG.customPrefixes.length > 0) {
        for (const prefix of TAG_CONFIG.customPrefixes) {
            if (textoLimpo.startsWith(prefix)) {
                isTag = true;
                console.log(`   🏷️ TAG detectada (prefixo ${prefix}): "${textoLimpo.substring(0, 30)}"`);
                break;
            }
        }
    }
    
    // Armazena no cache
    TAG_CONFIG._cache.set(textoLimpo, isTag);
    
    return isTag;
}

// Verifica se um elemento DOM é uma tag técnica
function isElementoTag(elemento) {
    if (!elemento) return true;
    const texto = elemento.innerText || elemento.textContent || '';
    return isTagTecnica(texto);
}

// Limpa cache de tags (chamar quando roteiro muda)
function limparCacheTags() {
    TAG_CONFIG._cache.clear();
}

// Encontra o primeiro elemento legível (não é tag)
function findFirstReadableElement() {
    const promptElement = document.querySelector('.prompt');
    if (!promptElement) return null;
    
    const elementos = promptElement.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li, span, strong, em, b, i');
    
    for (let i = 0; i < elementos.length; i++) {
        const elem = elementos[i];
        const texto = (elem.innerText || elem.textContent || '').trim();
        
        // Ignora apenas elementos vazios (textos curtos como "Oi" são válidos)
        if (texto.length === 0) continue;
        
        // Ignora tags técnicas
        if (isTagTecnica(texto)) continue;
        
        // Encontrou elemento legível
        console.log(`📖 Primeiro elemento legível encontrado: índice ${i}`);
        console.log(`   "${texto.substring(0, 50)}..."`);
        return { element: elem, index: i };
    }
    
    return null;
}

// Encontra o próximo elemento legível após um índice
function findNextReadableElement(startIndex) {
    const promptElement = document.querySelector('.prompt');
    if (!promptElement) return null;
    
    const elementos = promptElement.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li, span, strong, em, b, i');
    
    for (let i = startIndex + 1; i < elementos.length; i++) {
        const elem = elementos[i];
        const texto = (elem.innerText || elem.textContent || '').trim();
        
        // Ignora apenas elementos vazios (textos curtos como "Oi" são válidos)
        if (texto.length === 0) continue;
        if (isTagTecnica(texto)) continue;
        
        return { element: elem, index: i };
    }
    
    return null;
}

// Posiciona o teleprompter no primeiro elemento legível
// O texto é posicionado no TOPO da área de foco (não centralizado)
// Isso permite que o apresentador veja o texto pronto para começar
function posicionarNoInicio() {
    const primeiro = findFirstReadableElement();
    if (!primeiro) {
        console.log('⚠️ Nenhum elemento legível encontrado');
        return;
    }
    
    console.log(`📍 Posicionando no primeiro elemento legível (índice ${primeiro.index})`);
    console.log(`   Texto: "${(primeiro.element.innerText || '').substring(0, 50)}..."`);
    
    // O offset do elemento no DOM
    const offsetElemento = primeiro.element.offsetTop;
    
    console.log(`   offsetElemento: ${offsetElemento}`);
    
    // Move o teleprompter para posicionar o elemento no TOPO da área de foco
    // O terceiro parâmetro (true) indica alignTop = posicionar no topo, não centralizado
    if (window.moveTeleprompterToOffset) {
        window.moveTeleprompterToOffset(offsetElemento, true, true); // smooth=true, alignTop=true
    }
    
    // Define como índice atual para o sistema de matching
    currentElementIndex = primeiro.index;
}

// Carrega prefixos customizados do localStorage ao iniciar
function loadCustomPrefixesFromStorage() {
    try {
        var stored = localStorage.getItem('voiceCustomPrefixes');
        if (stored) {
            var prefixes = JSON.parse(stored);
            TAG_CONFIG.customPrefixes = Array.isArray(prefixes) ? prefixes : [];
            console.log(`🏷️ Prefixos customizados carregados do localStorage:`, TAG_CONFIG.customPrefixes);
        }
    } catch(e) {
        console.error('Erro ao carregar prefixos do localStorage:', e);
    }
}

// Expõe configuração de tags globalmente para interface
window.voiceTagConfig = {
    getPatterns: function() {
        return TAG_CONFIG.patterns;
    },
    setPatternEnabled: function(patternKey, enabled) {
        if (TAG_CONFIG.patterns[patternKey]) {
            TAG_CONFIG.patterns[patternKey].enabled = enabled;
            limparCacheTags();
            console.log(`🏷️ Padrão "${patternKey}" ${enabled ? 'ativado' : 'desativado'}`);
        }
    },
    getCustomPrefixes: function() {
        return TAG_CONFIG.customPrefixes;
    },
    addCustomPrefix: function(prefix) {
        if (prefix && !TAG_CONFIG.customPrefixes.includes(prefix)) {
            TAG_CONFIG.customPrefixes.push(prefix);
            try {
                localStorage.setItem('voiceCustomPrefixes', JSON.stringify(TAG_CONFIG.customPrefixes));
            } catch(e) {}
            limparCacheTags();
            console.log(`🏷️ Prefixo customizado adicionado: "${prefix}"`);
        }
    },
    removeCustomPrefix: function(prefix) {
        const index = TAG_CONFIG.customPrefixes.indexOf(prefix);
        if (index > -1) {
            TAG_CONFIG.customPrefixes.splice(index, 1);
            try {
                localStorage.setItem('voiceCustomPrefixes', JSON.stringify(TAG_CONFIG.customPrefixes));
            } catch(e) {}
            limparCacheTags();
            console.log(`🏷️ Prefixo customizado removido: "${prefix}"`);
        }
    },
    isTag: isTagTecnica,
    posicionarNoInicio: posicionarNoInicio,
    customPrefixes: TAG_CONFIG.customPrefixes,
    
    // ========================================
    // SPEAKER MODE API - Controle de modo âncora/externo
    // ========================================
    getSpeakerMode: function() {
        return speakerMode;
    },
    setSpeakerMode: function(mode) {
        if (mode === SPEAKER_MODE.ANCHOR || mode === SPEAKER_MODE.EXTERNAL) {
            const anterior = speakerMode;
            speakerMode = mode;
            console.log(`🎙️ SpeakerMode alterado manualmente: ${anterior} → ${mode}`);
            if (mode === SPEAKER_MODE.ANCHOR) {
                AutoScrollController.softResume();
            } else {
                AutoScrollController.softStop();
            }
        }
    },
    forceAnchorMode: function() {
        speakerMode = SPEAKER_MODE.ANCHOR;
        externalElementCount = 0;
        AutoScrollController.softResume();
        console.log(`🟢 Forçado modo ANCHOR`);
    },
    forceExternalMode: function() {
        speakerMode = SPEAKER_MODE.EXTERNAL;
        externalElementCount = 0;
        AutoScrollController.softStop();
        console.log(`🔴 Forçado modo EXTERNAL`);
    },
    SPEAKER_MODE: SPEAKER_MODE,
    
    // Marcadores de LINK configuráveis
    getLinkConfig: function() {
        return LINK_CONFIG;
    }
};

// Carrega prefixos ao iniciar o módulo
loadCustomPrefixesFromStorage();

// Estado global
let currentState = STATE.SEARCHING;
let currentElementIndex = -1;       // Índice atual no roteiro
let consecutiveMisses = 0;          // Contador de misses para detectar improvisação
let wordBuffer = [];                // Buffer de palavras reconhecidas
let cumulativeFinalWords = [];      // Buffer cumulativo de palavras finalizadas CONFIRMADAS (não truncado)
let pendingFinalWords = [];         // Buffer temporário de palavras finais PENDENTES de confirmação
let lastProcessedFinalIndex = 0;    // Índice do último final processado
let debounceTimer = null;
let ultimoHashRoteiro = "";
let currentWordPointer = 0;         // Ponteiro monotônico: índice da palavra atual no elemento
let currentElementWords = [];       // Array de palavras normalizadas do elemento atual
let currentElementTotalWords = 0;   // Total de palavras no elemento atual

// Identificação de sessões de fala - DESABILITADO v29.4
// A detecção por pausa causava falsos positivos. 
// Será substituída por detecção baseada em cues do roteiro em versão futura.
let currentSpeakerSession = 1;      // Fixo em 1 - não muda mais automaticamente
let lastSpeechTimestamp = 0;        // Timestamp do último resultado (mantido para debug)
const SPEAKER_PAUSE_THRESHOLD = 999999; // Efetivamente desabilitado

// ========================================
// SPEAKER MODE - Detecção de falante (âncora vs link/externo)
// ========================================
let speakerMode = SPEAKER_MODE.ANCHOR;  // Começa assumindo que âncora está falando
let externalElementCount = 0;            // Contador de elementos em modo EXTERNAL
let lastLinkMarkerIndex = -1;            // Índice do último marcador de LINK detectado

// Detecta se um texto contém marcador de ENTRADA de link
function isLinkEntryMarker(texto) {
    if (!texto) return false;
    for (const regex of LINK_CONFIG.entryMarkers) {
        if (regex.test(texto)) {
            return true;
        }
    }
    return false;
}

// Detecta se um texto contém marcador de SAÍDA de link (retorno do âncora)
function isLinkExitMarker(texto) {
    if (!texto) return false;
    for (const regex of LINK_CONFIG.exitMarkers) {
        if (regex.test(texto)) {
            return true;
        }
    }
    return false;
}

// Analisa um elemento e retorna se deve mudar o speakerMode
// Retorna: 'ENTER_EXTERNAL' | 'EXIT_EXTERNAL' | null
function analisarMarcadorFalante(elemento) {
    if (!elemento) return null;
    
    const texto = (elemento.innerText || elemento.textContent || '').trim();
    if (!texto) return null;
    
    // Verifica cache
    if (LINK_CONFIG._elementCache.has(texto)) {
        return LINK_CONFIG._elementCache.get(texto);
    }
    
    let resultado = null;
    
    // Primeiro verifica saída (prioridade - retorno do âncora)
    if (isLinkExitMarker(texto)) {
        resultado = 'EXIT_EXTERNAL';
        console.log(`   📢 MARCADOR DE RETORNO detectado: "${texto.substring(0, 40)}..."`);
    }
    // Depois verifica entrada
    else if (isLinkEntryMarker(texto)) {
        resultado = 'ENTER_EXTERNAL';
        console.log(`   📡 MARCADOR DE LINK detectado: "${texto.substring(0, 40)}..."`);
    }
    
    // Cache
    LINK_CONFIG._elementCache.set(texto, resultado);
    
    return resultado;
}

// Atualiza speakerMode baseado no elemento atual
function atualizarSpeakerMode(elementoIndex, elementos) {
    if (!elementos || elementoIndex < 0) return;
    
    const elemento = elementos[elementoIndex];
    const marcador = analisarMarcadorFalante(elemento);
    
    if (marcador === 'ENTER_EXTERNAL' && speakerMode === SPEAKER_MODE.ANCHOR) {
        // Transição: ANCHOR -> EXTERNAL
        speakerMode = SPEAKER_MODE.EXTERNAL;
        externalElementCount = 0;
        lastLinkMarkerIndex = elementoIndex;
        
        console.log(`🔴 ========================================`);
        console.log(`🔴 SPEAKER MODE: ANCHOR → EXTERNAL (LINK)`);
        console.log(`🔴 Matching de voz PAUSADO`);
        console.log(`🔴 ========================================`);
        
        // Pausa suave o AutoScroll
        AutoScrollController.softStop();
    }
    else if (marcador === 'EXIT_EXTERNAL' && speakerMode === SPEAKER_MODE.EXTERNAL) {
        // Transição: EXTERNAL -> ANCHOR
        speakerMode = SPEAKER_MODE.ANCHOR;
        externalElementCount = 0;
        
        console.log(`🟢 ========================================`);
        console.log(`🟢 SPEAKER MODE: EXTERNAL → ANCHOR`);
        console.log(`🟢 Matching de voz RETOMADO`);
        console.log(`🟢 ========================================`);
        
        // Resume o AutoScroll
        AutoScrollController.softResume();
    }
    else if (speakerMode === SPEAKER_MODE.EXTERNAL) {
        // Conta elementos em modo EXTERNAL
        externalElementCount++;
        
        // Segurança: após muitos elementos, assume que perdeu o marcador de retorno
        if (externalElementCount > LINK_CONFIG.maxExternalElements) {
            console.log(`⚠️ Auto-retorno: ${externalElementCount} elementos em EXTERNAL sem marcador de saída`);
            
            // Reset completo do estado
            speakerMode = SPEAKER_MODE.ANCHOR;
            externalElementCount = 0;
            lastLinkMarkerIndex = -1;
            consecutiveMisses = 0;
            wordBuffer = [];
            pendingFinalWords = [];
            cumulativeFinalWords = [];
            
            // Só resume se tiver um índice válido
            if (elementoIndex >= 0) {
                currentElementIndex = elementoIndex;
            }
            currentState = STATE.SEARCHING; // Volta para busca para encontrar posição
            
            AutoScrollController.softResume();
        }
    }
}

// Verifica se deve processar matching (baseado em speakerMode)
function deveProcessarMatching() {
    return speakerMode === SPEAKER_MODE.ANCHOR;
}

// Limpa cache de marcadores (chamar quando roteiro muda)
function limparCacheMarcadores() {
    LINK_CONFIG._elementCache.clear();
}

// Tenta detectar retorno do âncora durante modo EXTERNAL
// Busca match em elementos APÓS o último marcador de link
// Retorna true se detectou retorno e voltou para ANCHOR
function tentarDetectarRetornoAncora(textoFalado, isFinal) {
    const promptElement = document.querySelector('.prompt');
    if (!promptElement) return false;

    const elementos = promptElement.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li, span, strong, em, b, i');
    const textoNormalizado = normalizarTexto(textoFalado);
    
    // Busca a partir do último índice conhecido, procurando marcador de DEIXA ou texto do âncora
    const startIdx = Math.max(0, lastLinkMarkerIndex + 1);
    const endIdx = Math.min(startIdx + 30, elementos.length); // Olha até 30 elementos à frente
    
    let melhorMatch = null;
    let melhorSimilaridade = 0;
    let melhorIndice = -1;
    let encontrouMarcadorSaida = false;

    // Primeiro, verifica se há marcador de saída nos próximos elementos
    for (let i = startIdx; i < endIdx; i++) {
        const elem = elementos[i];
        const textoOriginal = elem.innerText || elem.textContent || '';
        
        // Verifica marcador de saída (DEIXA:, FIM LINK, etc.)
        if (isLinkExitMarker(textoOriginal)) {
            encontrouMarcadorSaida = true;
            console.log(`   📢 [EXTERNAL] Marcador de saída encontrado no índice ${i}`);
            
            // Encontra o próximo elemento legível após o marcador
            let proximoElementoIndex = i + 1;
            let proximoElemento = null;
            while (proximoElementoIndex < elementos.length) {
                const elem = elementos[proximoElementoIndex];
                const txt = (elem.innerText || elem.textContent || '').trim();
                if (txt.length > 0 && !isTagTecnica(txt) && !isLinkEntryMarker(txt) && !isLinkExitMarker(txt)) {
                    proximoElemento = elem;
                    break;
                }
                proximoElementoIndex++;
            }
            
            // Reset completo do estado
            speakerMode = SPEAKER_MODE.ANCHOR;
            externalElementCount = 0;
            lastLinkMarkerIndex = -1;
            consecutiveMisses = 0;
            wordBuffer = [];
            pendingFinalWords = [];
            cumulativeFinalWords = [];
            
            // Posiciona no próximo elemento legível (ou no marcador se não encontrar)
            currentElementIndex = proximoElemento ? proximoElementoIndex : i;
            currentState = STATE.SEARCHING; // Vai buscar o texto do âncora
            
            console.log(`🟢 ========================================`);
            console.log(`🟢 SPEAKER MODE: EXTERNAL → ANCHOR (via marcador)`);
            console.log(`🟢 Próximo elemento legível: índice ${currentElementIndex}`);
            console.log(`🟢 Matching de voz RETOMADO`);
            console.log(`🟢 ========================================`);
            
            AutoScrollController.softResume();
            return true;
        }
        
        // Se não é tag técnica, tenta match
        if (!isTagTecnica(textoOriginal)) {
            const textoElemento = normalizarTexto(textoOriginal);
            if (textoElemento.length === 0) continue;
            
            const similaridade = calcularSimilaridade(textoNormalizado, textoElemento);
            
            // Threshold mais alto para detectar retorno (evita falsos positivos)
            if (similaridade > melhorSimilaridade && similaridade >= 0.35) {
                melhorSimilaridade = similaridade;
                melhorMatch = elem;
                melhorIndice = i;
            }
        }
    }

    // Se encontrou match forte em elemento após o link, assume que âncora voltou
    // Threshold mais conservador (40%) para evitar falsos positivos com fala do repórter
    if (melhorMatch && melhorSimilaridade >= 0.40) {
        // Verifica se o elemento encontrado NÃO é um marcador de entrada de link
        const textoMatch = (melhorMatch.innerText || melhorMatch.textContent || '').trim();
        if (isLinkEntryMarker(textoMatch)) {
            console.log(`   ⚠️ [EXTERNAL] Match ignorado - é marcador de LINK`);
            return false;
        }
        
        console.log(`🟢 ========================================`);
        console.log(`🟢 RETORNO DETECTADO: Match ${(melhorSimilaridade * 100).toFixed(0)}% no índice ${melhorIndice}`);
        console.log(`🟢 Texto: "${textoMatch.substring(0, 50)}..."`);
        console.log(`🟢 SPEAKER MODE: EXTERNAL → ANCHOR`);
        console.log(`🟢 ========================================`);
        
        // Atualiza estado de forma consistente
        speakerMode = SPEAKER_MODE.ANCHOR;
        externalElementCount = 0;
        lastLinkMarkerIndex = -1; // Reseta marcador de link
        currentElementIndex = melhorIndice;
        currentState = STATE.LOCKED;
        consecutiveMisses = 0; // Reseta contador de misses
        
        // Inicializa tracking do elemento
        currentElementWords = normalizarTexto(textoMatch).split(/\s+/).filter(p => p.length > 1);
        currentElementTotalWords = currentElementWords.length;
        currentWordPointer = 0;
        cumulativeFinalWords = [];
        pendingFinalWords = [];
        wordBuffer = []; // Limpa buffer de palavras
        
        // Resume e reinicia AutoScroll
        AutoScrollController.start();
        AutoScrollController.reset();
        
        // Scroll suave para o elemento
        if (typeof scrollParaElemento === 'function') {
            scrollParaElemento(melhorMatch, 0, true);
        }
        
        return true;
    }

    return false;
}

// Contador de parciais sem match quando perto do fim do elemento
let parciaisSemMatchNoFim = 0;      // Quantos parciais sem match quando progresso > 90%
const MAX_PARCIAIS_SEM_MATCH = 5;   // Após 5 parciais sem match, força busca expandida

// ========================================
// AutoScrollController - Controle CONTÍNUO de scroll com velocidade variável
// Abordagem: mantém target offset e ajusta velocidade suavemente
// ========================================
const AutoScrollController = {
    isActive: false,
    isPaused: false,
    lastWordCount: 0,
    lastTimestamp: Date.now(),
    lastProgressoEnviado: 0,
    
    // NOVO: Sistema de scroll contínuo
    targetOffset: 0,           // Onde o apresentador está (target)
    currentElement: null,      // Elemento atual sendo lido
    updateInterval: null,      // Intervalo de atualização de velocidade
    UPDATE_RATE: 100,          // Atualiza velocidade a cada 100ms
    
    // Constantes de ajuste de velocidade - v29.4 ESTÁVEL
    VELOCITY_GAIN: 0.022,      // Ganho proporcional conservador
    MAX_VELOCITY: 9,           // Velocidade máxima segura (ergonômica)
    MIN_VELOCITY: 0,           // Velocidade mínima
    DEAD_ZONE: 25,             // Pixels de tolerância
    SMOOTH_FACTOR: 0.3,        // Fator de suavização original
    DECEL_FACTOR: 0.7,         // Fator de desaceleração rápida quando adiantado
    
    currentVelocity: 0,        // Velocidade atual suavizada
    
    // Inicializa o controlador e ADQUIRE controle exclusivo
    start: function() {
        const wasActive = this.isActive; // Lembra se já estava ativo (para transição suave)
        
        this.isActive = true;
        this.isPaused = false;
        this.lastWordCount = 0;
        this.lastProgressoEnviado = 0;
        this.targetOffset = 0;
        
        // Só reseta velocidade se estava parado completamente
        // Se estava em softStop, mantém velocidade para transição suave
        if (!wasActive) {
            this.currentVelocity = 0;
        }
        
        // ADQUIRE controle exclusivo do scroll
        if (window.teleprompterVoiceControl) {
            window.teleprompterVoiceControl.acquire();
        }
        
        // Inicia loop de atualização de velocidade
        this.startVelocityLoop();
        
        console.log('🚀 AutoScroll ATIVADO (modo contínuo com velocidade)');
    },
    
    // Para o controlador e LIBERA controle (parada total)
    stop: function() {
        this.isActive = false;
        this.isPaused = false;
        
        // Para o loop de velocidade
        this.stopVelocityLoop();
        
        // Para o scroll
        if (window.teleprompterAutoScroll) {
            window.teleprompterAutoScroll.setVelocity(0);
        }
        
        // LIBERA controle do scroll
        if (window.teleprompterVoiceControl) {
            window.teleprompterVoiceControl.release();
        }
        console.log('🛑 AutoScroll DESATIVADO');
    },
    
    // Para suavemente mas MANTÉM controle (para transição LOCKED -> SEARCHING)
    // O scroll desacelera mas o sistema permanece pronto para retomar rapidamente
    softStop: function() {
        // NÃO altera isActive - mantém controle
        this.isPaused = true;
        
        // NÃO para o loop de velocidade - deixa desacelerar naturalmente
        // updateVelocity() vai reduzir velocidade gradualmente quando isPaused=true
        
        console.log('⏸️ AutoScroll em PAUSA SUAVE (mantendo controle)');
    },
    
    // Retoma após softStop - reativa o scroll
    softResume: function() {
        if (this.isActive) {
            this.isPaused = false;
            console.log('▶️ AutoScroll RETOMADO');
        }
    },
    
    // Inicia loop de ajuste de velocidade
    startVelocityLoop: function() {
        if (this.updateInterval) return;
        
        this.updateInterval = setInterval(() => {
            this.updateVelocity();
        }, this.UPDATE_RATE);
    },
    
    // Para loop de velocidade
    stopVelocityLoop: function() {
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
            this.updateInterval = null;
        }
    },
    
    // CORE: Atualiza velocidade baseado na diferença entre posição atual e target
    updateVelocity: function() {
        if (!this.isActive || this.isPaused) {
            // Pausado: para suavemente
            if (this.currentVelocity > 0) {
                this.currentVelocity = Math.max(0, this.currentVelocity - 0.5);
                if (window.teleprompterAutoScroll) {
                    window.teleprompterAutoScroll.setVelocity(Math.round(this.currentVelocity));
                }
            }
            return;
        }
        
        // Obtém posição atual do teleprompter (CSS translateY)
        const currPos = window.getTeleprompterCurrentPos ? window.getTeleprompterCurrentPos() : 0;
        
        // Converte targetOffset (DOM) para coordenada CSS usando a mesma lógica do teleprompter
        // Isso garante alinhamento correto com focus area e flip
        const targetScrollPos = window.convertOffsetToScrollPos ? 
            window.convertOffsetToScrollPos(this.targetOffset) : -this.targetOffset;
        
        // Calcula diferença: negativo = precisamos avançar (target está abaixo, scroll mais negativo)
        // currPos é negativo e fica mais negativo conforme descemos
        // targetScrollPos também é negativo
        const diferenca = currPos - targetScrollPos; // positivo = precisamos descer mais
        
        // Dead zone: comando explícito de velocidade zero
        if (Math.abs(diferenca) < this.DEAD_ZONE) {
            // v29.4: Parada real - comando explícito de zero
            this.currentVelocity = 0;
        } else if (diferenca > 0) {
            // Precisamos avançar (target está abaixo)
            // Velocidade proporcional à diferença com ganho adequado
            const velocidadeAlvo = Math.min(this.MAX_VELOCITY, diferenca * this.VELOCITY_GAIN);
            
            // Suavização exponencial para aceleração suave
            this.currentVelocity = this.currentVelocity * (1 - this.SMOOTH_FACTOR) + velocidadeAlvo * this.SMOOTH_FACTOR;
        } else {
            // Estamos adiantados (overshoot) - FREIO PROPORCIONAL
            // v29.4: Desaceleração proporcional ao erro negativo (1-2 ticks)
            const brakeForce = Math.min(this.MAX_VELOCITY, Math.abs(diferenca) * 0.1); // Freio forte
            this.currentVelocity = Math.max(0, this.currentVelocity - brakeForce);
        }
        
        // Aplica velocidade
        const velocidadeX = Math.round(Math.max(0, Math.min(this.MAX_VELOCITY, this.currentVelocity)));
        
        if (window.teleprompterAutoScroll) {
            window.teleprompterAutoScroll.setVelocity(velocidadeX);
        }
        
        // Log ocasional (a cada 1 segundo aproximadamente)
        if (Math.random() < 0.1) {
            console.log(`   🎚️ Velocidade: x=${velocidadeX}, diff=${diferenca.toFixed(0)}px, targetScroll=${targetScrollPos.toFixed(0)}, currPos=${currPos.toFixed(0)}`);
        }
    },
    
    // NOVO: Atualiza o target offset (chamado pela detecção de voz)
    setTargetOffset: function(offset) {
        this.targetOffset = offset;
    },
    
    // NOVO: Atualiza target baseado em elemento + progresso
    // Com verificação de JUMP HÍBRIDO para diferenças grandes
    setTargetFromElement: function(elemento, progresso) {
        if (!elemento) return;
        
        const offsetTopBase = elemento.offsetTop;
        const alturaElemento = elemento.offsetHeight || 0;
        const offsetAdicional = alturaElemento * progresso;
        const offsetFinal = offsetTopBase + offsetAdicional;
        
        // Calcula diferença atual para decidir se faz jump híbrido
        const currPos = window.getTeleprompterCurrentPos ? window.getTeleprompterCurrentPos() : 0;
        const targetScrollPos = window.convertOffsetToScrollPos ? 
            window.convertOffsetToScrollPos(offsetFinal) : -offsetFinal;
        const diferenca = Math.abs(currPos - targetScrollPos);
        
        // JUMP HÍBRIDO: se diferença muito grande E progresso significativo, faz jump suave
        if (diferenca > CONFIG.hybridJumpThreshold && progresso >= CONFIG.hybridJumpMinProgress) {
            console.log(`   🚀 JUMP HÍBRIDO: diff=${diferenca.toFixed(0)}px > ${CONFIG.hybridJumpThreshold}px, prog=${(progresso*100).toFixed(0)}%`);
            
            // Faz jump suave direto para a posição
            if (window.moveTeleprompterToOffset) {
                window.moveTeleprompterToOffset(offsetFinal, true);
            }
        }
        
        this.targetOffset = offsetFinal;
        this.currentElement = elemento;
    },
    
    // Pausa durante improvisação
    pause: function() {
        if (this.isActive && !this.isPaused) {
            this.isPaused = true;
            console.log('⏸️ AutoScroll PAUSADO (improvisação detectada)');
        }
    },
    
    // Resume após voltar ao roteiro
    resume: function() {
        if (this.isActive && this.isPaused) {
            this.isPaused = false;
            console.log('▶️ AutoScroll RESUMIDO');
        }
    },
    
    // Reseta baselines (chamado ao mudar de elemento)
    reset: function() {
        this.lastWordCount = 0;
        this.lastTimestamp = Date.now();
        this.isPaused = false;
        this.lastProgressoEnviado = 0;
    },
    
    // Verifica se deve fazer scroll
    shouldScroll: function() {
        return this.isActive && !this.isPaused;
    },
    
    // Verifica se deve atualizar target (evita jitter)
    shouldScrollTo: function(novoProgresso) {
        const diferenca = novoProgresso - this.lastProgressoEnviado;
        const deveAtualizar = novoProgresso > this.lastProgressoEnviado + 0.02; // 2% para resposta mais rápida
        if (deveAtualizar) {
            this.lastProgressoEnviado = novoProgresso;
            return true;
        }
        return false;
    },
    
    // Atualiza contador
    update: function(wordCount) {
        this.lastWordCount = wordCount;
        this.lastTimestamp = Date.now();
    }
};

if (SpeechRecognition) {
    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'pt-BR';

    recognition.onstart = function() {
        console.log('🎤 Reconhecimento de voz iniciado');
        console.log(`📍 Estado inicial: ${currentState}`);
        
        // POSICIONA NO PRIMEIRO ELEMENTO LEGÍVEL
        setTimeout(() => {
            posicionarNoInicio();
        }, 500);
    };

    recognition.onend = function() {
        console.log('🎤 Reconhecimento encerrado, reiniciando...');
        setTimeout(() => {
            try {
                recognition.start();
            } catch (e) {
                console.log('⚠️ Erro ao reiniciar:', e.message);
            }
        }, 100);
    };

    recognition.onerror = function(event) {
        if (event.error !== 'aborted') {
            console.error('Erro no reconhecimento de voz:', event.error);
        }
    };

    recognition.onresult = function(event) {
        let newWords = [];
        let isFinal = false;

        // Extrai apenas palavras NOVAS desde o último processamento
        for (let i = event.resultIndex; i < event.results.length; i++) {
            const transcript = event.results[i][0].transcript.trim();
            const words = transcript.split(/\s+/).filter(w => w.length > 0);
            
            if (event.results[i].isFinal) {
                isFinal = true;
                // Adiciona palavras ao buffer normal (para matching)
                wordBuffer.push(...words);
                
                // Adiciona ao buffer PENDENTE (será movido para cumulativo só quando match confirmado)
                // IMPORTANTE: Usa o mesmo filtro que currentElementWords (palavras > 1 char)
                const palavrasFiltradas = words.filter(w => w.length > 1);
                pendingFinalWords.push(...palavrasFiltradas);
                
                // Limita tamanho do buffer de matching (mas não do pendente)
                if (wordBuffer.length > CONFIG.maxBufferWords) {
                    wordBuffer = wordBuffer.slice(-CONFIG.maxBufferWords);
                }
            } else {
                // Para interim, usa as palavras diretamente (não acumula)
                newWords = words;
            }
        }

        if (isFinal) {
            // Processa resultado final imediatamente
            processarReconhecimento(true);
        } else if (newWords.length > 0) {
            // Processa interim com debounce
            processarComDebounce(newWords, false);
        }
    };

    function processarComDebounce(words, isFinal) {
        if (debounceTimer) {
            clearTimeout(debounceTimer);
        }
        
        debounceTimer = setTimeout(() => {
            // Para interim, usa as palavras passadas diretamente
            const palavrasParaMatch = words.slice(-CONFIG.wordWindow).join(' ');
            executarMatching(palavrasParaMatch, isFinal);
        }, CONFIG.debounceMs);
    }

    function processarReconhecimento(isFinal) {
        // Usa as últimas N palavras do buffer para matching
        const palavrasParaMatch = wordBuffer.slice(-CONFIG.wordWindow).join(' ');
        executarMatching(palavrasParaMatch, isFinal);
    }

    function executarMatching(textoFalado, isFinal) {
        // Aceita textos curtos (até 1 caractere é válido para matching)
        if (textoFalado.length === 0) return;

        // Detecta mudança de sessão de fala (pausa longa = possível novo falante)
        const agora = Date.now();
        if (lastSpeechTimestamp > 0 && (agora - lastSpeechTimestamp) > SPEAKER_PAUSE_THRESHOLD) {
            currentSpeakerSession++;
            console.log(`👤 ===== NOVA SESSÃO DE FALA: Pessoa ${currentSpeakerSession} =====`);
        }
        lastSpeechTimestamp = agora;

        // ========================================
        // SPEAKER MODE CHECK - Comportamento especial durante EXTERNAL (link ao vivo)
        // ========================================
        if (speakerMode === SPEAKER_MODE.EXTERNAL) {
            // Durante EXTERNAL, ainda tenta detectar retorno do âncora
            // Busca match em elementos APÓS o marcador de link
            const retornoDetectado = tentarDetectarRetornoAncora(textoFalado, isFinal);
            
            if (!retornoDetectado) {
                // Ainda em EXTERNAL - limpa buffers e ignora
                if (isFinal) {
                    console.log(`🔇 [EXTERNAL] Ignorando fala (link ao vivo): "${textoFalado.substring(0, 30)}..."`);
                }
                wordBuffer = [];
                pendingFinalWords = [];
                return; // NÃO processa matching normal
            }
            // Se retornoDetectado, o speakerMode já foi alterado para ANCHOR
            // e podemos continuar com o matching normal
        }

        console.log(`[P${currentSpeakerSession}] 🎤 ${isFinal ? 'FINAL' : 'parcial'}: "${textoFalado}"`);
        console.log(`   Estado: ${currentState}, Índice: ${currentElementIndex}, Misses: ${consecutiveMisses}, SpeakerMode: ${speakerMode}`);

        if (currentState === STATE.SEARCHING) {
            buscarPosicaoInicial(textoFalado);
        } else {
            verificarProximoElemento(textoFalado, isFinal);
        }
    }

    // SEARCHING: Busca posição inicial no roteiro todo
    function buscarPosicaoInicial(textoFalado) {
        const promptElement = document.querySelector('.prompt');
        if (!promptElement) return;

        const elementos = promptElement.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li, span, strong, em, b, i');
        const textoNormalizado = normalizarTexto(textoFalado);
        
        let melhorMatch = null;
        let melhorSimilaridade = 0;
        let melhorIndice = -1;

        console.log(`   🔍 SEARCHING: Buscando em ${elementos.length} elementos...`);

        for (let i = 0; i < elementos.length; i++) {
            const elem = elementos[i];
            const textoOriginal = elem.innerText || elem.textContent || '';
            
            // IGNORA TAGS TÉCNICAS
            if (isTagTecnica(textoOriginal)) continue;
            
            const textoElemento = normalizarTexto(textoOriginal);
            
            // Ignora apenas elementos vazios (textos curtos como "Oi" são válidos)
            if (textoElemento.length === 0) continue;
            
            const similaridade = calcularSimilaridade(textoNormalizado, textoElemento);
            
            if (similaridade > melhorSimilaridade && similaridade >= CONFIG.searchThreshold) {
                melhorSimilaridade = similaridade;
                melhorMatch = elem;
                melhorIndice = i;
            }
        }

        if (melhorMatch) {
            console.log(`   ✅ FOUND! Índice ${melhorIndice} (${(melhorSimilaridade * 100).toFixed(0)}%)`);
            console.log(`   📝 "${(melhorMatch.innerText || '').substring(0, 50)}..."`);
            
            // MATCH CONFIRMADO: Move palavras pendentes para o cumulativo
            if (pendingFinalWords.length > 0) {
                cumulativeFinalWords.push(...pendingFinalWords);
                console.log(`   📝 Confirmadas ${pendingFinalWords.length} palavras pendentes`);
                pendingFinalWords = [];
            }
            
            // Transição para LOCKED
            currentState = STATE.LOCKED;
            currentElementIndex = melhorIndice;
            consecutiveMisses = 0;
            
            // ========================================
            // SPEAKER MODE: Verifica marcadores de LINK no elemento encontrado
            // ========================================
            atualizarSpeakerMode(melhorIndice, elementos);
            
            // Se entramos em EXTERNAL no primeiro match, aguarda retorno
            if (speakerMode === SPEAKER_MODE.EXTERNAL) {
                console.log(`   🔴 Primeiro match em região de LINK - aguardando retorno do âncora`);
                return;
            }
            
            // Inicializa tracking do elemento
            inicializarTrackingElemento(melhorMatch);
            
            // INICIA AUTO-SCROLL quando entra em LOCKED
            AutoScrollController.start();
            AutoScrollController.reset();
            
            // Move o teleprompter para o início do elemento (SUAVE - jump inicial)
            scrollParaElemento(melhorMatch, 0, true);
        } else {
            console.log(`   ❌ Nenhum match encontrado (threshold: ${CONFIG.searchThreshold * 100}%)`);
        }
    }

    // Inicializa tracking para um novo elemento
    function inicializarTrackingElemento(elemento) {
        const textoElemento = elemento.innerText || elemento.textContent || '';
        currentElementWords = normalizarTexto(textoElemento).split(/\s+/).filter(p => p.length > 1);
        currentElementTotalWords = currentElementWords.length;
        currentWordPointer = 0;
        cumulativeFinalWords = []; // Reseta buffer cumulativo ao trocar de elemento
        pendingFinalWords = []; // Limpa também palavras pendentes
        
        console.log(`   📊 Tracking iniciado: ${currentElementTotalWords} palavras no elemento`);
    }

    // LOCKED: Verifica elemento atual e próximos (sequencial)
    function verificarProximoElemento(textoFalado, isFinal) {
        const promptElement = document.querySelector('.prompt');
        if (!promptElement) return;

        const elementos = promptElement.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li, span, strong, em, b, i');
        const textoNormalizado = normalizarTexto(textoFalado);
        
        // Calcula progresso atual para decidir se expande lookahead
        const progressoAtual = currentElementTotalWords > 0 ? currentWordPointer / currentElementTotalWords : 0;
        
        // EXPANSÃO DINÂMICA: quando perto do fim (>90%) ou após muitos parciais sem match, expande busca
        let lookahead = CONFIG.lookaheadElements;
        if (progressoAtual > 0.90 || parciaisSemMatchNoFim >= MAX_PARCIAIS_SEM_MATCH) {
            lookahead = 20; // Expande de 5 para 20 elementos
            console.log(`   🔭 Lookahead EXPANDIDO: ${lookahead} (progresso=${(progressoAtual*100).toFixed(0)}%, parciaisSemMatch=${parciaisSemMatchNoFim})`);
        }
        
        // IMPORTANTE: Inclui o elemento ATUAL (apresentador pode ainda estar lendo ele)
        // Olha do atual até os próximos N elementos
        const startIdx = Math.max(0, currentElementIndex);
        const endIdx = Math.min(startIdx + lookahead + 1, elementos.length);
        
        let melhorMatch = null;
        let melhorSimilaridade = 0;
        let melhorIndice = -1;

        console.log(`   🔒 LOCKED: Verificando elementos ${startIdx} a ${endIdx - 1}...`);

        for (let i = startIdx; i < endIdx; i++) {
            const elem = elementos[i];
            const textoOriginal = elem.innerText || elem.textContent || '';
            
            // IGNORA TAGS TÉCNICAS
            if (isTagTecnica(textoOriginal)) continue;
            
            const textoElemento = normalizarTexto(textoOriginal);
            
            // Ignora apenas elementos vazios (textos curtos como "Oi" são válidos)
            if (textoElemento.length === 0) continue;
            
            const similaridade = calcularSimilaridade(textoNormalizado, textoElemento);
            
            if (similaridade > melhorSimilaridade && similaridade >= CONFIG.lockedThreshold) {
                melhorSimilaridade = similaridade;
                melhorMatch = elem;
                melhorIndice = i;
            }
        }

        if (melhorMatch) {
            // MATCH CONFIRMADO: Move palavras pendentes para o cumulativo (só para finais)
            if (isFinal && pendingFinalWords.length > 0) {
                cumulativeFinalWords.push(...pendingFinalWords);
                console.log(`   📝 Confirmadas ${pendingFinalWords.length} palavras pendentes`);
                pendingFinalWords = [];
            }
            
            // Verifica se é um AVANÇO (próximo elemento) ou CONFIRMAÇÃO (mesmo elemento)
            const avancou = melhorIndice > currentElementIndex;
            
            // Se estava pausado, resume quando volta ao roteiro
            if (AutoScrollController.isPaused) {
                console.log(`   ▶️ Retornando ao roteiro após improvisação`);
                AutoScrollController.resume();
            }
            
            // Reseta contador de misses (improvisação)
            consecutiveMisses = 0;
            // NÃO reseta parciaisSemMatchNoFim aqui - só quando realmente avançar!
            
            if (avancou) {
                // SÓ AQUI reseta o contador de parciais sem match (realmente avançou)
                parciaisSemMatchNoFim = 0;
                console.log(`   ✅ Avançou! Índice ${currentElementIndex} → ${melhorIndice} (${(melhorSimilaridade * 100).toFixed(0)}%)`);
                currentElementIndex = melhorIndice;
                
                // ========================================
                // SPEAKER MODE: Verifica marcadores de LINK ao avançar
                // Analisa elementos entre o anterior e o novo para detectar transições
                // ========================================
                for (let checkIdx = currentElementIndex; checkIdx <= melhorIndice; checkIdx++) {
                    atualizarSpeakerMode(checkIdx, elementos);
                }
                
                // Se entramos em EXTERNAL, não continua processando
                if (speakerMode === SPEAKER_MODE.EXTERNAL) {
                    console.log(`   🔴 Entrando em modo EXTERNAL - aguardando retorno do âncora`);
                    return;
                }
                
                // Inicializa tracking do novo elemento
                inicializarTrackingElemento(melhorMatch);
                
                // Reseta o controlador para novo elemento
                AutoScrollController.reset();
                
                // SCROLL para o novo elemento (SUAVE - jump para novo parágrafo)
                if (AutoScrollController.shouldScroll()) {
                    scrollParaElemento(melhorMatch, 0, true);
                }
            } else {
                // Ainda no mesmo elemento - calcula progresso por ALINHAMENTO
                // Para PARCIAIS: usa alinhamento direto das palavras faladas
                // Para FINAIS: usa buffer cumulativo como antes
                
                let progresso = 0;
                
                if (isFinal) {
                    // Final: usa buffer cumulativo
                    const palavrasAcumuladas = cumulativeFinalWords.length;
                    if (palavrasAcumuladas > currentWordPointer && currentElementTotalWords > 0) {
                        currentWordPointer = Math.min(palavrasAcumuladas, currentElementTotalWords);
                    }
                    progresso = currentWordPointer / currentElementTotalWords;
                    console.log(`   📊 FINAL: cumulativo=${palavrasAcumuladas}, pointer=${currentWordPointer}, total=${currentElementTotalWords}`);
                } else {
                    // PARCIAL: calcula progresso por alinhamento de palavras
                    progresso = calcularProgressoPorAlinhamento(textoNormalizado, melhorMatch);
                    // Garante monotonia: só avança, nunca volta
                    const progressoMinimo = currentWordPointer / currentElementTotalWords;
                    progresso = Math.max(progresso, progressoMinimo);
                    if (progresso > progressoMinimo) {
                        currentWordPointer = Math.round(progresso * currentElementTotalWords);
                    }
                    console.log(`   📊 PARCIAL: alinhado=${(calcularProgressoPorAlinhamento(textoNormalizado, melhorMatch)*100).toFixed(1)}% → monotônico=${(progresso*100).toFixed(1)}%`);
                }
                
                // Só faz scroll se progresso aumentou significativamente (evita jitter)
                const podeScroll = AutoScrollController.shouldScroll();
                console.log(`   🔍 shouldScroll()=${podeScroll} (isActive=${AutoScrollController.isActive}, isPaused=${AutoScrollController.isPaused})`);
                
                // Para PARCIAIS: scroll mesmo com pouca mudança (apenas atualiza lastProgressoEnviado)
                // Para FINAIS: respeita hysteresis de 5%
                let deveScroll = false;
                if (podeScroll) {
                    if (!isFinal) {
                        // PARCIAL: scroll mais liberal - mas ainda atualiza o lastProgressoEnviado
                        const diferenca = progresso - AutoScrollController.lastProgressoEnviado;
                        deveScroll = diferenca > 0.02; // Apenas 2% de mudança
                    } else {
                        // FINAL: respeita 5% de hysteresis
                        deveScroll = AutoScrollController.shouldScrollTo(progresso);
                    }
                }
                
                if (deveScroll) {
                    console.log(`   ✓✓ FAZENDO SCROLL para ${(progresso * 100).toFixed(1)}% (${isFinal ? 'FINAL' : 'parcial'})`);
                    scrollParaElemento(melhorMatch, progresso, false);
                    // Atualiza baseline mesmo se for parcial
                    if (!isFinal) {
                        AutoScrollController.lastProgressoEnviado = progresso;
                    }
                } else {
                    console.log(`   ℹ️ Sem scroll: podeScroll=${podeScroll}, progresso=${(progresso * 100).toFixed(1)}%`);
                }
            }
        } else {
            // NÃO encontrou match - pode ser improvisação OU transição para próximo elemento
            
            // Se estamos perto do fim do elemento (>90%), conta parciais sem match
            if (progressoAtual > 0.90) {
                parciaisSemMatchNoFim++;
                console.log(`   ⚠️ Sem match perto do fim! parciaisSemMatch=${parciaisSemMatchNoFim}/${MAX_PARCIAIS_SEM_MATCH}`);
                
                // Se atingiu limite, força volta para SEARCHING para re-localizar
                if (parciaisSemMatchNoFim >= MAX_PARCIAIS_SEM_MATCH) {
                    console.log(`   🔄 Muitos parciais sem match no fim, voltando para SEARCHING...`);
                    currentState = STATE.SEARCHING;
                    parciaisSemMatchNoFim = 0;
                    consecutiveMisses = 0;
                    // Usa softStop para manter controle enquanto busca nova posição
                    AutoScrollController.softStop();
                    return; // Sai da função para re-buscar na próxima chamada
                }
            }
            
            if (isFinal) {
                consecutiveMisses++;
                console.log(`   ⏸️ Sem match FINAL (improvisação?). Misses: ${consecutiveMisses}/${CONFIG.maxConsecutiveMisses}`);
                
                // DESCARTA palavras pendentes (eram improvisação)
                if (pendingFinalWords.length > 0) {
                    console.log(`   🗑️ Descartadas ${pendingFinalWords.length} palavras de improvisação`);
                    pendingFinalWords = [];
                }
                
                // PAUSA scroll durante improvisação
                AutoScrollController.pause();
                
                // Se muitos misses, volta para SEARCHING
                if (consecutiveMisses >= CONFIG.maxConsecutiveMisses) {
                    console.log(`   🔄 Muitos misses FINAL, voltando para SEARCHING...`);
                    currentState = STATE.SEARCHING;
                    consecutiveMisses = 0;
                    parciaisSemMatchNoFim = 0;
                    // Usa softStop para manter controle enquanto busca nova posição
                    AutoScrollController.softStop();
                }
            } else {
                console.log(`   ⏳ Aguardando (parcial)... progresso=${(progressoAtual*100).toFixed(0)}%`);
            }
        }
    }

    // Move o teleprompter para um elemento, com progresso opcional dentro do elemento
    // progresso: 0 = início do elemento, 1 = fim do elemento
    // isInitialJump: se true, faz jump suave para posição (mudança de elemento)
    //                se false, apenas atualiza target para scroll contínuo
    function scrollParaElemento(elemento, progresso = 0, isInitialJump = false) {
        if (!elemento) {
            console.log(`   ❌ Elemento inválido para scroll`);
            return;
        }

        // Calcula o offsetTop base do elemento
        const offsetTopBase = elemento.offsetTop;
        const alturaElemento = elemento.offsetHeight || 0;
        
        // Adiciona offset proporcional ao progresso dentro do elemento
        const offsetAdicional = alturaElemento * progresso;
        const offsetFinal = offsetTopBase + offsetAdicional;
        
        if (isInitialJump) {
            // JUMP INICIAL (mudança de elemento): faz salto suave direto
            console.log(`   📍 scrollParaElemento: JUMP SUAVE para offset=${offsetFinal.toFixed(0)}, prog=${(progresso*100).toFixed(0)}%`);
            
            // Primeiro atualiza o target
            AutoScrollController.setTargetOffset(offsetFinal);
            
            // Faz jump suave para a nova posição
            if (window.moveTeleprompterToOffset) {
                window.moveTeleprompterToOffset(offsetFinal, true);
            }
        } else {
            // SCROLL CONTÍNUO: apenas atualiza o target, deixa o loop de velocidade fazer o trabalho
            console.log(`   📍 scrollParaElemento: TARGET atualizado para offset=${offsetFinal.toFixed(0)}, prog=${(progresso*100).toFixed(0)}%`);
            
            // Atualiza o target - o loop de velocidade vai ajustar automaticamente
            AutoScrollController.setTargetFromElement(elemento, progresso);
        }
    }

    // Calcula progresso dentro do elemento baseado em alinhamento de palavras
    // Encontra a última palavra falada que aparece no elemento e retorna sua posição relativa
    function calcularProgressoPorAlinhamento(textoFalado, elemento) {
        if (currentElementTotalWords === 0) return 0;
        
        const palavrasFaladas = textoFalado.split(/\s+/).filter(p => p.length > 1);
        if (palavrasFaladas.length === 0) return 0;
        
        // Pega as últimas 5 palavras faladas para buscar no elemento
        const ultimasPalavras = palavrasFaladas.slice(-5);
        
        let ultimaPosicaoEncontrada = -1;
        
        // Busca cada palavra nas palavras do elemento
        for (const palavraFalada of ultimasPalavras) {
            for (let i = 0; i < currentElementWords.length; i++) {
                if (currentElementWords[i] === palavraFalada && i > ultimaPosicaoEncontrada) {
                    ultimaPosicaoEncontrada = i;
                }
            }
        }
        
        const progresso = ultimaPosicaoEncontrada < 0 ? 0 : (ultimaPosicaoEncontrada + 1) / currentElementTotalWords;
        console.log(`   📊 calcularProgressoPorAlinhamento: última palavra pos=${ultimaPosicaoEncontrada}, total=${currentElementTotalWords}, progresso=${(progresso*100).toFixed(1)}%`);
        
        // Retorna progresso baseado na posição da última palavra encontrada
        return progresso;
    }

    // Normaliza texto para comparação
    function normalizarTexto(texto) {
        return texto
            .toLowerCase()
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            .replace(/[^\w\s]/g, '')
            .trim();
    }

    // Calcula similaridade (cobertura de palavras)
    function calcularSimilaridade(textoFalado, textoElemento) {
        const palavrasFaladas = textoFalado.split(/\s+/).filter(p => p.length > 2);
        const palavrasElemento = new Set(textoElemento.split(/\s+/).filter(p => p.length > 2));
        
        if (palavrasFaladas.length === 0) return 0;
        
        let encontradas = 0;
        for (const palavra of palavrasFaladas) {
            if (palavrasElemento.has(palavra)) {
                encontradas++;
            }
        }
        
        return encontradas / palavrasFaladas.length;
    }

    // Calcula hash simples para detectar mudanças no roteiro
    function calcularHash(texto) {
        let hash = 0;
        for (let i = 0; i < Math.min(texto.length, 1000); i++) {
            const char = texto.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash;
        }
        return hash.toString();
    }

    // Verifica se o roteiro mudou
    function verificarMudancaRoteiro() {
        const promptElement = document.querySelector('.prompt');
        if (!promptElement) return;
        
        const textoAtual = (promptElement.innerText || promptElement.textContent || "").trim();
        const hashAtual = calcularHash(textoAtual);
        
        if (hashAtual !== ultimoHashRoteiro && ultimoHashRoteiro !== "") {
            console.log('🔄 Roteiro alterado, voltando para SEARCHING');
            currentState = STATE.SEARCHING;
            currentElementIndex = -1;
            consecutiveMisses = 0;
            wordBuffer = [];
        }
        
        ultimoHashRoteiro = hashAtual;
    }

    // Observer para detectar mudanças no roteiro
    function observarMudancasNoPrompt() {
        const promptElement = document.querySelector('.prompt');
        if (!promptElement) {
            setTimeout(observarMudancasNoPrompt, 1000);
            return;
        }

        const textoInicial = (promptElement.innerText || promptElement.textContent || "").trim();
        ultimoHashRoteiro = calcularHash(textoInicial);

        const observer = new MutationObserver((mutations) => {
            let temMutacaoReal = false;
            
            for (const mutation of mutations) {
                if (mutation.type === 'childList') {
                    let eAncoraTemporaria = false;
                    
                    for (const node of [...mutation.addedNodes, ...mutation.removedNodes]) {
                        if (node.nodeType === Node.ELEMENT_NODE && node.id && node.id.startsWith('voice-sync-')) {
                            eAncoraTemporaria = true;
                            break;
                        }
                    }
                    
                    if (!eAncoraTemporaria) {
                        temMutacaoReal = true;
                    }
                }
            }
            
            if (temMutacaoReal) {
                setTimeout(verificarMudancaRoteiro, 500);
            }
        });

        observer.observe(promptElement, {
            childList: true,
            subtree: true
        });

        console.log('👁️ Observer de roteiro ativado');
    }

    // Inicia após delay para garantir que prompt está carregado
    setTimeout(observarMudancasNoPrompt, 1000);

    // Inicia reconhecimento
    recognition.start();
    
} else {
    console.warn('Seu navegador não suporta a API de reconhecimento de voz.');
}
