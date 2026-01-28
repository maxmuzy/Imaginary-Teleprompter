/**
 * Sistema de Reconhecimento de Voz para Teleprompter
 * v30 - Sincronização Suave e Previsível
 * 
 * MUDANÇAS PRINCIPAIS vs v29:
 * 1. Controle de velocidade PID em vez de proporcional simples
 * 2. Buffer de palavras com janela deslizante e confirmação
 * 3. Alinhamento fuzzy melhorado com índice invertido
 * 4. Transições suaves entre estados (sem saltos)
 * 5. Detecção de silêncio com desaceleração gradual
 * 
 * Estados:
 * - SEARCHING: Buscando posição inicial no roteiro
 * - LOCKED: Posição encontrada, avançando sequencialmente
 * - PAUSED: Silêncio detectado, desacelerando
 */

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

// Estados da máquina
const STATE = {
    SEARCHING: 'SEARCHING',
    LOCKED: 'LOCKED',
    PAUSED: 'PAUSED'
};

// Estados de falante
const SPEAKER_MODE = {
    ANCHOR: 'ANCHOR',
    EXTERNAL: 'EXTERNAL'
};

// ============================================================================
// CONFIGURAÇÃO v30 - Otimizada para movimento suave
// ============================================================================
const CONFIG = {
    // Matching - thresholds ajustados
    searchThreshold: 0.22,          // 22% para busca inicial
    lockedThreshold: 0.18,          // 18% quando já está LOCKED
    wordWindow: 12,                 // Janela de palavras para matching
    lookaheadElements: 8,           // Elementos à frente em LOCKED
    lookbehindElements: 2,          // Elementos atrás para verificar
    minWordsForMatch: 2,            // Mínimo de palavras para tentar match
    
    // Controle de velocidade PID
    velocity: {
        kP: 0.012,                  // Ganho proporcional (reduzido para suavidade)
        kI: 0.001,                  // Ganho integral (acumula erro)
        kD: 0.005,                  // Ganho derivativo (suaviza mudanças)
        maxVelocity: 7,             // Velocidade máxima
        minVelocity: 0,             // Velocidade mínima
        deadZone: 30,               // Pixels de tolerância
        smoothingFactor: 0.88,      // Suavização exponencial
        targetLead: 40,             // Pixels de "lead" (texto à frente)
    },
    
    // Silêncio e pausas
    silence: {
        decelerateMs: 1000,         // Começa desacelerar após 1s
        pauseMs: 2500,              // Pausa após 2.5s
        stopMs: 5000,               // Para completamente após 5s
        resumeBoostFactor: 1.3,     // Boost ao retomar (30% mais rápido)
    },
    
    // Buffer
    maxBufferWords: 80,
    confirmationWords: 3,           // Palavras para confirmar posição
    
    // Debounce
    debounceMs: 150,                // Debounce para interim results
    
    // Transições
    transitionDurationMs: 400,      // Duração de transições suaves
    maxJumpPixels: 200,             // Máximo de pixels para jump instantâneo
};

// ============================================================================
// CONFIGURAÇÃO DE TAGS TÉCNICAS
// ============================================================================
const TAG_CONFIG = {
    patterns: {
        parentesesSimples: { enabled: true, regex: /^\s*\([^)]+\)\s*$/ },
        parentesesDuplos: { enabled: true, regex: /^\s*\(\([^)]+\)\)\s*$/ },
        parentesesTriplos: { enabled: true, regex: /^\s*\(\(\([^)]+\)\)\)\s*$/ },
        colchetes: { enabled: true, regex: /^\s*\[[^\]]+\]\s*$/ },
        hashtagMaiusculo: { enabled: true, regex: /^\s*#[A-Z0-9]+\s*$/ },
        indicadorCamera: { enabled: true, regex: /^\s*CAM(ERA)?\s*\d+\s*$/i },
        barras: { enabled: true, regex: /^\s*\/[^/]+\/\s*$/ },
    },
    customPrefixes: [],
    _cache: new Map()
};

function isTagTecnica(texto) {
    if (!texto || texto.trim().length === 0) return true;
    const textoLimpo = texto.trim();
    
    if (TAG_CONFIG._cache.has(textoLimpo)) {
        return TAG_CONFIG._cache.get(textoLimpo);
    }
    
    let isTag = false;
    for (const [key, pattern] of Object.entries(TAG_CONFIG.patterns)) {
        if (pattern.enabled && pattern.regex.test(textoLimpo)) {
            isTag = true;
            break;
        }
    }
    
    TAG_CONFIG._cache.set(textoLimpo, isTag);
    return isTag;
}

window.isTagTecnica = isTagTecnica;

// ============================================================================
// ESTADO GLOBAL
// ============================================================================
let currentState = STATE.SEARCHING;
let currentElementIndex = -1;
let lastLockedIndex = -1;
let consecutiveMisses = 0;
let wordBuffer = [];
let speakerMode = SPEAKER_MODE.ANCHOR;
let lastSpeechTimestamp = 0;
let debounceTimer = null;

// Índice invertido para busca rápida
let wordIndex = new Map();
let elementCache = new Map();
let elementsArray = null;

// ============================================================================
// CONTROLADOR DE SCROLL SUAVE (PID)
// ============================================================================
const SmoothScroller = {
    isActive: false,
    targetOffset: 0,
    currentVelocity: 0,
    integralError: 0,           // Acumulador para termo I
    lastError: 0,               // Erro anterior para termo D
    updateInterval: null,
    lastUpdateTime: 0,
    
    start: function() {
        if (this.isActive) return;
        
        this.isActive = true;
        this.currentVelocity = 0;
        this.integralError = 0;
        this.lastError = 0;
        this.lastUpdateTime = Date.now();
        
        if (window.teleprompterVoiceControl) {
            window.teleprompterVoiceControl.acquire();
        }
        
        this._startLoop();
        console.log('🚀 SmoothScroller v30 ATIVADO');
    },
    
    stop: function() {
        if (!this.isActive) return;
        
        this.isActive = false;
        this._stopLoop();
        
        if (window.teleprompterAutoScroll) {
            window.teleprompterAutoScroll.setVelocity(0);
        }
        
        if (window.teleprompterVoiceControl) {
            window.teleprompterVoiceControl.release();
        }
        
        console.log('🛑 SmoothScroller DESATIVADO');
    },
    
    setTarget: function(offset) {
        this.targetOffset = offset;
    },
    
    setTargetFromElement: function(element, progress) {
        if (!element) return;
        
        const offsetTop = element.offsetTop;
        const height = element.offsetHeight || 0;
        const lead = CONFIG.velocity.targetLead;
        
        this.targetOffset = offsetTop + (height * progress) - lead;
    },
    
    _startLoop: function() {
        if (this.updateInterval) return;
        
        this.updateInterval = setInterval(() => {
            this._update();
        }, 50); // 20 FPS
    },
    
    _stopLoop: function() {
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
            this.updateInterval = null;
        }
    },
    
    _update: function() {
        if (!this.isActive) return;
        
        const cfg = CONFIG.velocity;
        const silenceCfg = CONFIG.silence;
        const now = Date.now();
        const dt = (now - this.lastUpdateTime) / 1000; // Delta time em segundos
        this.lastUpdateTime = now;
        
        // Tempo desde última fala
        const silenceTime = now - lastSpeechTimestamp;
        
        // Obtém posição atual
        const currentPos = window.getTeleprompterCurrentPos ? window.getTeleprompterCurrentPos() : 0;
        const targetScrollPos = window.convertOffsetToScrollPos ? 
            window.convertOffsetToScrollPos(this.targetOffset) : -this.targetOffset;
        
        // Erro = diferença entre posição atual e target
        // Positivo = precisamos avançar (descer)
        const error = currentPos - targetScrollPos;
        
        // Fator de silêncio (0-1, onde 1 = velocidade normal, 0 = parado)
        let silenceFactor = 1;
        if (silenceTime > silenceCfg.stopMs) {
            silenceFactor = 0;
        } else if (silenceTime > silenceCfg.pauseMs) {
            silenceFactor = 0.1;
        } else if (silenceTime > silenceCfg.decelerateMs) {
            const t = (silenceTime - silenceCfg.decelerateMs) / (silenceCfg.pauseMs - silenceCfg.decelerateMs);
            silenceFactor = 1 - (t * 0.7); // Reduz até 30%
        }
        
        // Calcula velocidade alvo usando PID
        let targetVelocity = 0;
        
        if (Math.abs(error) < cfg.deadZone) {
            // Na zona morta: mantém velocidade mínima
            targetVelocity = 1;
            this.integralError = 0; // Reset integral
        } else if (error > 0) {
            // Atrasado: precisa avançar
            
            // Termo Proporcional
            const pTerm = error * cfg.kP;
            
            // Termo Integral (acumula erro ao longo do tempo)
            this.integralError += error * dt;
            this.integralError = Math.max(-500, Math.min(500, this.integralError)); // Limita
            const iTerm = this.integralError * cfg.kI;
            
            // Termo Derivativo (taxa de mudança do erro)
            const dError = (error - this.lastError) / Math.max(dt, 0.01);
            const dTerm = dError * cfg.kD;
            
            targetVelocity = pTerm + iTerm + dTerm;
        } else {
            // Adiantado: freia
            targetVelocity = 0;
            this.integralError *= 0.9; // Decay do integral
        }
        
        this.lastError = error;
        
        // Aplica fator de silêncio
        targetVelocity *= silenceFactor;
        
        // Limita velocidade
        targetVelocity = Math.max(cfg.minVelocity, Math.min(cfg.maxVelocity, targetVelocity));
        
        // Suavização exponencial
        const smoothing = cfg.smoothingFactor;
        this.currentVelocity = this.currentVelocity * smoothing + targetVelocity * (1 - smoothing);
        
        // Aplica velocidade
        const finalVelocity = Math.round(Math.max(0, Math.min(cfg.maxVelocity, this.currentVelocity)));
        
        if (window.teleprompterAutoScroll) {
            window.teleprompterAutoScroll.setVelocity(finalVelocity);
        }
    },
    
    // Faz transição suave para nova posição (sem salto)
    smoothTransition: function(element, progress) {
        if (!element) return;
        
        const targetOffset = element.offsetTop + (element.offsetHeight * progress) - CONFIG.velocity.targetLead;
        const currentPos = window.getTeleprompterCurrentPos ? window.getTeleprompterCurrentPos() : 0;
        const targetScrollPos = window.convertOffsetToScrollPos ? 
            window.convertOffsetToScrollPos(targetOffset) : -targetOffset;
        
        const distance = Math.abs(currentPos - targetScrollPos);
        
        if (distance > CONFIG.maxJumpPixels) {
            // Distância grande: faz scroll suave animado
            console.log(`   📍 Transição suave: ${distance.toFixed(0)}px`);
            if (window.moveTeleprompterToOffset) {
                window.moveTeleprompterToOffset(targetOffset, true); // smooth=true
            }
        }
        
        // Atualiza target para o controlador continuar
        this.targetOffset = targetOffset;
    }
};

// ============================================================================
// ÍNDICE INVERTIDO PARA BUSCA RÁPIDA
// ============================================================================
function buildWordIndex() {
    const promptElement = document.querySelector('.prompt');
    if (!promptElement) return;
    
    elementsArray = Array.from(promptElement.querySelectorAll(
        'p, h1, h2, h3, h4, h5, h6, li, span, strong, em, b, i'
    ));
    
    wordIndex.clear();
    elementCache.clear();
    
    elementsArray.forEach((element, index) => {
        const textoOriginal = element.innerText || element.textContent || '';
        if (isTagTecnica(textoOriginal)) return;
        
        const texto = normalizarTexto(textoOriginal);
        const palavras = texto.split(/\s+/).filter(p => p.length > 2);
        
        // Cache do elemento
        elementCache.set(index, {
            text: texto,
            words: palavras,
            element: element
        });
        
        // Índice invertido
        palavras.forEach((palavra, posicao) => {
            if (!wordIndex.has(palavra)) {
                wordIndex.set(palavra, []);
            }
            wordIndex.get(palavra).push({ elementIndex: index, wordPosition: posicao });
        });
    });
    
    console.log(`📚 Índice construído: ${elementsArray.length} elementos, ${wordIndex.size} palavras únicas`);
}

// ============================================================================
// FUNÇÕES DE NORMALIZAÇÃO E SIMILARIDADE
// ============================================================================
function normalizarTexto(texto) {
    return texto
        .toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^\w\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function calcularSimilaridade(textoFalado, textoElemento) {
    const palavrasFaladas = textoFalado.split(/\s+/).filter(p => p.length > 2);
    const palavrasElemento = new Set(textoElemento.split(/\s+/).filter(p => p.length > 2));
    
    if (palavrasFaladas.length === 0) return 0;
    
    let encontradas = 0;
    for (const palavra of palavrasFaladas) {
        if (palavrasElemento.has(palavra)) {
            encontradas++;
        } else {
            // Busca fuzzy
            for (const palavraElem of palavrasElemento) {
                if (fuzzyMatch(palavra, palavraElem)) {
                    encontradas += 0.7;
                    break;
                }
            }
        }
    }
    
    return encontradas / palavrasFaladas.length;
}

function fuzzyMatch(word1, word2) {
    if (word1 === word2) return true;
    if (Math.abs(word1.length - word2.length) > 2) return false;
    if (word1.length <= 3 || word2.length <= 3) return word1 === word2;
    
    // Levenshtein simplificado
    let differences = 0;
    const minLen = Math.min(word1.length, word2.length);
    
    for (let i = 0; i < minLen; i++) {
        if (word1[i] !== word2[i]) differences++;
    }
    differences += Math.abs(word1.length - word2.length);
    
    return (differences / Math.max(word1.length, word2.length)) <= 0.3;
}

// ============================================================================
// BUSCA DE POSIÇÃO
// ============================================================================
function buscarPosicao(palavras, isLocal = false) {
    if (!elementsArray || palavras.length < CONFIG.minWordsForMatch) return null;
    
    const palavrasNormalizadas = palavras.map(p => normalizarTexto(p)).filter(p => p.length > 2);
    if (palavrasNormalizadas.length === 0) return null;
    
    // Estratégia 1: Busca local (se já temos posição)
    if (isLocal && lastLockedIndex >= 0) {
        const localResult = buscarLocal(palavrasNormalizadas);
        if (localResult) return localResult;
    }
    
    // Estratégia 2: Busca global usando índice invertido
    return buscarGlobal(palavrasNormalizadas);
}

function buscarLocal(palavras) {
    const startIdx = Math.max(0, lastLockedIndex - CONFIG.lookbehindElements);
    const endIdx = Math.min(elementsArray.length, lastLockedIndex + CONFIG.lookaheadElements + 1);
    
    let melhorMatch = null;
    let melhorScore = 0;
    
    for (let i = startIdx; i < endIdx; i++) {
        const cached = elementCache.get(i);
        if (!cached) continue;
        
        const score = calcularSimilaridade(palavras.join(' '), cached.text);
        
        if (score > melhorScore && score >= CONFIG.lockedThreshold) {
            melhorScore = score;
            melhorMatch = {
                elementIndex: i,
                element: cached.element,
                confidence: score,
                progress: calcularProgresso(palavras, cached.words)
            };
        }
    }
    
    return melhorMatch;
}

function buscarGlobal(palavras) {
    // Conta ocorrências por elemento
    const elementScores = new Map();
    
    palavras.forEach(palavra => {
        const matches = wordIndex.get(palavra) || [];
        matches.forEach(match => {
            const current = elementScores.get(match.elementIndex) || { count: 0, positions: [] };
            current.count++;
            current.positions.push(match.wordPosition);
            elementScores.set(match.elementIndex, current);
        });
        
        // Busca fuzzy se não encontrou exato
        if (matches.length === 0) {
            wordIndex.forEach((positions, indexedWord) => {
                if (fuzzyMatch(palavra, indexedWord)) {
                    positions.forEach(match => {
                        const current = elementScores.get(match.elementIndex) || { count: 0, positions: [] };
                        current.count += 0.7;
                        current.positions.push(match.wordPosition);
                        elementScores.set(match.elementIndex, current);
                    });
                }
            });
        }
    });
    
    // Encontra melhor elemento
    let melhorIndex = -1;
    let melhorScore = 0;
    let melhorPositions = [];
    
    elementScores.forEach((data, elementIndex) => {
        const score = data.count / palavras.length;
        if (score > melhorScore && score >= CONFIG.searchThreshold) {
            melhorScore = score;
            melhorIndex = elementIndex;
            melhorPositions = data.positions;
        }
    });
    
    if (melhorIndex >= 0) {
        const cached = elementCache.get(melhorIndex);
        const avgPosition = melhorPositions.reduce((a, b) => a + b, 0) / melhorPositions.length;
        const progress = Math.min(1, avgPosition / Math.max(1, cached.words.length));
        
        return {
            elementIndex: melhorIndex,
            element: cached.element,
            confidence: melhorScore,
            progress: progress
        };
    }
    
    return null;
}

function calcularProgresso(palavrasFaladas, palavrasElemento) {
    if (palavrasElemento.length === 0) return 0;
    
    let ultimaPosicao = -1;
    
    // Encontra a última palavra falada que aparece no elemento
    for (const palavra of palavrasFaladas.slice(-5)) {
        for (let i = 0; i < palavrasElemento.length; i++) {
            if (palavrasElemento[i] === palavra || fuzzyMatch(palavra, palavrasElemento[i])) {
                if (i > ultimaPosicao) {
                    ultimaPosicao = i;
                }
            }
        }
    }
    
    return ultimaPosicao >= 0 ? (ultimaPosicao + 1) / palavrasElemento.length : 0;
}

// ============================================================================
// PROCESSAMENTO DE RECONHECIMENTO
// ============================================================================
function processarReconhecimento(palavras, isFinal) {
    if (palavras.length === 0) return;
    
    const agora = Date.now();
    lastSpeechTimestamp = agora;
    
    // Se estava em PAUSED, volta para LOCKED/SEARCHING
    if (currentState === STATE.PAUSED) {
        currentState = lastLockedIndex >= 0 ? STATE.LOCKED : STATE.SEARCHING;
        console.log(`▶️ Retomando: ${currentState}`);
    }
    
    console.log(`🎤 ${isFinal ? 'FINAL' : 'parcial'}: "${palavras.slice(-5).join(' ')}"`);
    console.log(`   Estado: ${currentState}, Índice: ${currentElementIndex}`);
    
    // Busca posição
    const isLocal = currentState === STATE.LOCKED;
    const resultado = buscarPosicao(palavras, isLocal);
    
    if (resultado) {
        const avancou = resultado.elementIndex > currentElementIndex;
        
        console.log(`   ✅ Match: elem=${resultado.elementIndex}, prog=${(resultado.progress*100).toFixed(0)}%, conf=${(resultado.confidence*100).toFixed(0)}%`);
        
        // Atualiza estado
        if (currentState === STATE.SEARCHING) {
            currentState = STATE.LOCKED;
            SmoothScroller.start();
        }
        
        currentElementIndex = resultado.elementIndex;
        lastLockedIndex = resultado.elementIndex;
        consecutiveMisses = 0;
        
        // Atualiza scroll
        if (avancou) {
            // Novo elemento: transição suave
            SmoothScroller.smoothTransition(resultado.element, resultado.progress);
        } else {
            // Mesmo elemento: atualiza target
            SmoothScroller.setTargetFromElement(resultado.element, resultado.progress);
        }
    } else {
        // Sem match
        if (isFinal) {
            consecutiveMisses++;
            console.log(`   ⏸️ Sem match (${consecutiveMisses})`);
            
            if (consecutiveMisses >= 3) {
                console.log(`   🔄 Voltando para SEARCHING`);
                currentState = STATE.SEARCHING;
                consecutiveMisses = 0;
            }
        }
    }
}

// ============================================================================
// INICIALIZAÇÃO
// ============================================================================
if (SpeechRecognition) {
    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'pt-BR';
    
    recognition.onstart = function() {
        console.log('🎤 Reconhecimento de voz v30 iniciado');
        
        // Constrói índice após delay
        setTimeout(() => {
            buildWordIndex();
            
            // Posiciona no primeiro elemento
            if (elementsArray && elementsArray.length > 0) {
                const primeiro = elementsArray.find((el, idx) => elementCache.has(idx));
                if (primeiro) {
                    const idx = elementsArray.indexOf(primeiro);
                    currentElementIndex = idx;
                    
                    if (window.moveTeleprompterToOffset) {
                        window.moveTeleprompterToOffset(primeiro.offsetTop, true, true);
                    }
                }
            }
        }, 500);
    };
    
    recognition.onend = function() {
        console.log('🎤 Reconhecimento encerrado, reiniciando...');
        setTimeout(() => {
            try {
                recognition.start();
            } catch (e) {
                console.warn('⚠️ Erro ao reiniciar:', e.message);
            }
        }, 100);
    };
    
    recognition.onerror = function(event) {
        if (event.error !== 'aborted' && event.error !== 'no-speech') {
            console.error('❌ Erro:', event.error);
        }
    };
    
    recognition.onresult = function(event) {
        let palavras = [];
        let isFinal = false;
        
        for (let i = event.resultIndex; i < event.results.length; i++) {
            const transcript = event.results[i][0].transcript.trim();
            const words = transcript.split(/\s+/).filter(w => w.length > 0);
            
            if (event.results[i].isFinal) {
                isFinal = true;
                wordBuffer.push(...words);
                
                if (wordBuffer.length > CONFIG.maxBufferWords) {
                    wordBuffer = wordBuffer.slice(-CONFIG.maxBufferWords);
                }
                
                palavras = wordBuffer.slice(-CONFIG.wordWindow);
            } else {
                palavras = words;
            }
        }
        
        if (palavras.length > 0) {
            if (isFinal) {
                processarReconhecimento(palavras, true);
            } else {
                // Debounce para interim
                if (debounceTimer) clearTimeout(debounceTimer);
                debounceTimer = setTimeout(() => {
                    processarReconhecimento(palavras, false);
                }, CONFIG.debounceMs);
            }
        }
    };
    
    // Observer para mudanças no roteiro
    function observarMudancas() {
        const promptElement = document.querySelector('.prompt');
        if (!promptElement) {
            setTimeout(observarMudancas, 1000);
            return;
        }
        
        const observer = new MutationObserver(() => {
            setTimeout(() => {
                console.log('🔄 Roteiro alterado, reconstruindo índice...');
                buildWordIndex();
                currentState = STATE.SEARCHING;
                currentElementIndex = -1;
                lastLockedIndex = -1;
            }, 500);
        });
        
        observer.observe(promptElement, { childList: true, subtree: true });
        console.log('👁️ Observer de roteiro ativado');
    }
    
    setTimeout(observarMudancas, 1000);
    
    // Inicia reconhecimento
    recognition.start();
    
} else {
    console.warn('❌ Web Speech API não suportada');
}

// ============================================================================
// API GLOBAL
// ============================================================================
window.voiceSyncV30 = {
    getState: function() {
        return {
            state: currentState,
            elementIndex: currentElementIndex,
            lastLockedIndex: lastLockedIndex,
            bufferSize: wordBuffer.length,
            scroller: {
                isActive: SmoothScroller.isActive,
                velocity: SmoothScroller.currentVelocity,
                targetOffset: SmoothScroller.targetOffset
            }
        };
    },
    
    rebuildIndex: buildWordIndex,
    
    setDebug: function(enabled) {
        // Implementar se necessário
    }
};

console.log('📦 VoiceSync v30 carregado');
