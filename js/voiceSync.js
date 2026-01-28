/**
 * VoiceSync - Sistema Modular de Sincronização Voz-Texto para Teleprompter
 * v1.0 - Arquitetura Redesenhada para Movimento Suave e Previsível
 * 
 * Princípios de Design:
 * 1. MOVIMENTO SUAVE: Velocidade sempre gradual, nunca saltos bruscos
 * 2. PREVISIBILIDADE: O texto deve se mover de forma consistente
 * 3. TOLERÂNCIA A ERROS: Reconhecimento imperfeito não deve causar problemas
 * 4. MODULARIDADE: Componentes independentes e reutilizáveis
 * 
 * Módulos:
 * - ASRModule: Abstração do reconhecimento de voz (online/offline)
 * - TextAligner: Alinhamento fuzzy entre fala e texto
 * - ScrollController: Controle suave de velocidade do teleprompter
 * - SpeakerIdentifier: Identificação de locutores (futuro)
 */

'use strict';

// ============================================================================
// CONFIGURAÇÃO GLOBAL
// ============================================================================
const VoiceSyncConfig = {
    // Alinhamento de texto
    alignment: {
        minSimilarity: 0.25,        // Similaridade mínima para match (25%)
        wordWindow: 12,             // Janela de palavras para matching
        lookaheadElements: 8,       // Elementos à frente para buscar
        lookbehindElements: 3,      // Elementos atrás para verificar
        fuzzyThreshold: 0.7,        // Threshold para fuzzy matching de palavras
    },
    
    // Controle de scroll
    scroll: {
        maxVelocity: 7,             // Velocidade máxima (ergonômica)
        minVelocity: 0,             // Velocidade mínima
        accelerationRate: 0.15,     // Taxa de aceleração por tick
        decelerationRate: 0.25,     // Taxa de desaceleração por tick
        smoothingFactor: 0.85,      // Fator de suavização exponencial
        targetLeadPixels: 50,       // Pixels de "lead" - texto um pouco à frente
        updateIntervalMs: 50,       // Intervalo de atualização (20 FPS)
        catchUpThreshold: 300,      // Pixels para ativar catch-up suave
        maxCatchUpVelocity: 5,      // Velocidade máxima durante catch-up
    },
    
    // Detecção de silêncio
    silence: {
        pauseThresholdMs: 1200,     // Tempo sem fala para começar desacelerar
        stopThresholdMs: 3000,      // Tempo sem fala para parar completamente
        resumeBoostMs: 500,         // Boost de velocidade ao retomar
    },
    
    // Buffer de palavras
    buffer: {
        maxWords: 80,               // Máximo de palavras no buffer
        confirmationWindow: 3,      // Palavras para confirmar posição
    },
    
    // Debug
    debug: {
        enabled: false,
        logMatching: false,
        logScroll: false,
        logASR: false,
    }
};

// ============================================================================
// MÓDULO: TextAligner - Alinhamento Fuzzy entre Fala e Texto
// ============================================================================
const TextAligner = {
    // Cache de elementos processados
    _elementCache: new Map(),
    _wordIndex: null,           // Índice invertido de palavras
    _elements: null,            // Array de elementos do prompt
    _currentIndex: -1,          // Índice atual no roteiro
    _wordProgress: 0,           // Progresso dentro do elemento atual (0-1)
    _lastMatchTimestamp: 0,     // Timestamp do último match
    
    /**
     * Inicializa o alinhador com o conteúdo do prompt
     */
    initialize: function() {
        const promptElement = document.querySelector('.prompt');
        if (!promptElement) {
            console.warn('⚠️ TextAligner: Elemento .prompt não encontrado');
            return false;
        }
        
        // Coleta todos os elementos de texto
        this._elements = Array.from(promptElement.querySelectorAll(
            'p, h1, h2, h3, h4, h5, h6, li, div, span, td, th'
        )).filter(el => {
            const text = (el.innerText || '').trim();
            return text.length > 0 && !this._isTagTecnica(text);
        });
        
        // Constrói índice invertido de palavras para busca rápida
        this._buildWordIndex();
        
        console.log(`📚 TextAligner inicializado: ${this._elements.length} elementos indexados`);
        return true;
    },
    
    /**
     * Constrói índice invertido: palavra -> [{elementIndex, wordPosition}]
     */
    _buildWordIndex: function() {
        this._wordIndex = new Map();
        
        this._elements.forEach((element, elementIndex) => {
            const text = this._normalizeText(element.innerText || '');
            const words = text.split(/\s+/).filter(w => w.length > 2);
            
            words.forEach((word, wordPosition) => {
                if (!this._wordIndex.has(word)) {
                    this._wordIndex.set(word, []);
                }
                this._wordIndex.get(word).push({ elementIndex, wordPosition });
            });
            
            // Cache do elemento processado
            this._elementCache.set(elementIndex, {
                text: text,
                words: words,
                element: element
            });
        });
    },
    
    /**
     * Encontra a melhor posição no texto para as palavras faladas
     * Retorna: { elementIndex, progress, confidence, element }
     */
    findPosition: function(spokenWords) {
        if (!this._wordIndex || spokenWords.length === 0) {
            return null;
        }
        
        const normalizedWords = spokenWords.map(w => this._normalizeWord(w)).filter(w => w.length > 2);
        if (normalizedWords.length === 0) return null;
        
        // Estratégia 1: Busca local (se já temos posição)
        if (this._currentIndex >= 0) {
            const localResult = this._searchLocal(normalizedWords);
            if (localResult && localResult.confidence >= VoiceSyncConfig.alignment.minSimilarity) {
                return localResult;
            }
        }
        
        // Estratégia 2: Busca global usando índice invertido
        const globalResult = this._searchGlobal(normalizedWords);
        return globalResult;
    },
    
    /**
     * Busca local: verifica elemento atual e adjacentes
     */
    _searchLocal: function(words) {
        const config = VoiceSyncConfig.alignment;
        const startIdx = Math.max(0, this._currentIndex - config.lookbehindElements);
        const endIdx = Math.min(this._elements.length, this._currentIndex + config.lookaheadElements + 1);
        
        let bestMatch = null;
        let bestScore = 0;
        
        for (let i = startIdx; i < endIdx; i++) {
            const cached = this._elementCache.get(i);
            if (!cached) continue;
            
            const result = this._matchWordsToElement(words, cached, i);
            if (result.score > bestScore) {
                bestScore = result.score;
                bestMatch = result;
            }
        }
        
        if (bestMatch && bestScore >= config.minSimilarity) {
            this._currentIndex = bestMatch.elementIndex;
            this._wordProgress = bestMatch.progress;
            this._lastMatchTimestamp = Date.now();
            
            if (VoiceSyncConfig.debug.logMatching) {
                console.log(`🎯 Local match: elem=${bestMatch.elementIndex}, prog=${(bestMatch.progress*100).toFixed(0)}%, conf=${(bestScore*100).toFixed(0)}%`);
            }
            
            return {
                elementIndex: bestMatch.elementIndex,
                progress: bestMatch.progress,
                confidence: bestScore,
                element: this._elements[bestMatch.elementIndex]
            };
        }
        
        return null;
    },
    
    /**
     * Busca global usando índice invertido
     */
    _searchGlobal: function(words) {
        // Conta ocorrências de cada elemento nas palavras faladas
        const elementScores = new Map();
        
        words.forEach(word => {
            // Busca exata
            const exactMatches = this._wordIndex.get(word) || [];
            exactMatches.forEach(match => {
                const current = elementScores.get(match.elementIndex) || { count: 0, positions: [] };
                current.count++;
                current.positions.push(match.wordPosition);
                elementScores.set(match.elementIndex, current);
            });
            
            // Busca fuzzy para palavras não encontradas
            if (exactMatches.length === 0) {
                this._wordIndex.forEach((positions, indexedWord) => {
                    if (this._fuzzyMatch(word, indexedWord)) {
                        positions.forEach(match => {
                            const current = elementScores.get(match.elementIndex) || { count: 0, positions: [] };
                            current.count += 0.7; // Peso menor para fuzzy
                            current.positions.push(match.wordPosition);
                            elementScores.set(match.elementIndex, current);
                        });
                    }
                });
            }
        });
        
        // Encontra elemento com maior score
        let bestElementIndex = -1;
        let bestScore = 0;
        let bestPositions = [];
        
        elementScores.forEach((data, elementIndex) => {
            const cached = this._elementCache.get(elementIndex);
            if (!cached) return;
            
            // Score = palavras encontradas / total de palavras faladas
            const score = data.count / words.length;
            
            if (score > bestScore && score >= VoiceSyncConfig.alignment.minSimilarity) {
                bestScore = score;
                bestElementIndex = elementIndex;
                bestPositions = data.positions;
            }
        });
        
        if (bestElementIndex >= 0) {
            const cached = this._elementCache.get(bestElementIndex);
            
            // Calcula progresso baseado na posição média das palavras encontradas
            const avgPosition = bestPositions.reduce((a, b) => a + b, 0) / bestPositions.length;
            const progress = Math.min(1, avgPosition / Math.max(1, cached.words.length));
            
            this._currentIndex = bestElementIndex;
            this._wordProgress = progress;
            this._lastMatchTimestamp = Date.now();
            
            if (VoiceSyncConfig.debug.logMatching) {
                console.log(`🌍 Global match: elem=${bestElementIndex}, prog=${(progress*100).toFixed(0)}%, conf=${(bestScore*100).toFixed(0)}%`);
            }
            
            return {
                elementIndex: bestElementIndex,
                progress: progress,
                confidence: bestScore,
                element: this._elements[bestElementIndex]
            };
        }
        
        return null;
    },
    
    /**
     * Calcula match de palavras contra um elemento específico
     */
    _matchWordsToElement: function(words, cached, elementIndex) {
        let matchedCount = 0;
        let lastMatchPosition = -1;
        
        words.forEach(word => {
            for (let i = 0; i < cached.words.length; i++) {
                if (cached.words[i] === word || this._fuzzyMatch(word, cached.words[i])) {
                    matchedCount++;
                    if (i > lastMatchPosition) {
                        lastMatchPosition = i;
                    }
                    break;
                }
            }
        });
        
        const score = matchedCount / Math.max(1, words.length);
        const progress = lastMatchPosition >= 0 ? 
            Math.min(1, (lastMatchPosition + 1) / Math.max(1, cached.words.length)) : 
            this._wordProgress;
        
        return {
            elementIndex: elementIndex,
            score: score,
            progress: progress,
            matchedWords: matchedCount
        };
    },
    
    /**
     * Fuzzy matching entre duas palavras (tolerância a erros de reconhecimento)
     */
    _fuzzyMatch: function(word1, word2) {
        if (word1 === word2) return true;
        if (Math.abs(word1.length - word2.length) > 2) return false;
        
        // Levenshtein simplificado para palavras curtas
        const maxLen = Math.max(word1.length, word2.length);
        if (maxLen <= 3) return word1 === word2;
        
        let differences = 0;
        const minLen = Math.min(word1.length, word2.length);
        
        for (let i = 0; i < minLen; i++) {
            if (word1[i] !== word2[i]) differences++;
        }
        differences += Math.abs(word1.length - word2.length);
        
        return (differences / maxLen) <= (1 - VoiceSyncConfig.alignment.fuzzyThreshold);
    },
    
    /**
     * Normaliza texto para comparação
     */
    _normalizeText: function(text) {
        return text
            .toLowerCase()
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            .replace(/[^\w\s]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    },
    
    /**
     * Normaliza uma palavra individual
     */
    _normalizeWord: function(word) {
        return word
            .toLowerCase()
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            .replace(/[^\w]/g, '');
    },
    
    /**
     * Verifica se texto é uma tag técnica (deve ser ignorado)
     */
    _isTagTecnica: function(text) {
        const trimmed = text.trim();
        if (!trimmed) return true;
        
        // Padrões de tags técnicas
        const patterns = [
            /^\s*\([^)]+\)\s*$/,           // (texto)
            /^\s*\(\([^)]+\)\)\s*$/,       // ((texto))
            /^\s*\[[^\]]+\]\s*$/,          // [texto]
            /^\s*#[A-Z0-9]+\s*$/,          // #TAG
            /^\s*CAM(ERA)?\s*\d+\s*$/i,    // CAM1, CAMERA2
            /^\s*\/[^/]+\/\s*$/,           // /VINHETA/
        ];
        
        return patterns.some(p => p.test(trimmed));
    },
    
    /**
     * Retorna estado atual
     */
    getState: function() {
        return {
            currentIndex: this._currentIndex,
            wordProgress: this._wordProgress,
            lastMatchTimestamp: this._lastMatchTimestamp,
            totalElements: this._elements ? this._elements.length : 0
        };
    },
    
    /**
     * Reseta o alinhador
     */
    reset: function() {
        this._currentIndex = -1;
        this._wordProgress = 0;
        this._lastMatchTimestamp = 0;
    },
    
    /**
     * Força posição específica
     */
    setPosition: function(elementIndex, progress = 0) {
        if (elementIndex >= 0 && elementIndex < this._elements.length) {
            this._currentIndex = elementIndex;
            this._wordProgress = progress;
        }
    }
};

// ============================================================================
// MÓDULO: SmoothScrollController - Controle Suave de Velocidade
// ============================================================================
const SmoothScrollController = {
    _isActive: false,
    _targetOffset: 0,           // Posição alvo (onde o apresentador está)
    _currentVelocity: 0,        // Velocidade atual suavizada
    _updateInterval: null,      // Intervalo de atualização
    _lastUpdateTime: 0,         // Timestamp da última atualização
    _lastSpeechTime: 0,         // Timestamp da última fala detectada
    _isCatchingUp: false,       // Flag de catch-up mode
    
    /**
     * Inicia o controlador de scroll
     */
    start: function() {
        if (this._isActive) return;
        
        this._isActive = true;
        this._currentVelocity = 0;
        this._lastUpdateTime = Date.now();
        this._lastSpeechTime = Date.now();
        
        // Adquire controle exclusivo do teleprompter
        if (window.teleprompterVoiceControl) {
            window.teleprompterVoiceControl.acquire();
        }
        
        // Inicia loop de atualização
        this._startUpdateLoop();
        
        console.log('🚀 SmoothScrollController ATIVADO');
    },
    
    /**
     * Para o controlador
     */
    stop: function() {
        if (!this._isActive) return;
        
        this._isActive = false;
        this._stopUpdateLoop();
        
        // Para o scroll
        if (window.teleprompterAutoScroll) {
            window.teleprompterAutoScroll.setVelocity(0);
        }
        
        // Libera controle
        if (window.teleprompterVoiceControl) {
            window.teleprompterVoiceControl.release();
        }
        
        console.log('🛑 SmoothScrollController DESATIVADO');
    },
    
    /**
     * Atualiza o target de scroll baseado em elemento e progresso
     */
    setTarget: function(element, progress = 0) {
        if (!element) return;
        
        const offsetTop = element.offsetTop;
        const height = element.offsetHeight || 0;
        const config = VoiceSyncConfig.scroll;
        
        // Target = posição do elemento + progresso + lead
        this._targetOffset = offsetTop + (height * progress) - config.targetLeadPixels;
        this._lastSpeechTime = Date.now();
        
        if (VoiceSyncConfig.debug.logScroll) {
            console.log(`🎯 Target: offset=${this._targetOffset.toFixed(0)}, prog=${(progress*100).toFixed(0)}%`);
        }
    },
    
    /**
     * Notifica que houve fala (reseta timer de silêncio)
     */
    notifySpeech: function() {
        this._lastSpeechTime = Date.now();
    },
    
    /**
     * Inicia loop de atualização de velocidade
     */
    _startUpdateLoop: function() {
        if (this._updateInterval) return;
        
        const config = VoiceSyncConfig.scroll;
        this._updateInterval = setInterval(() => {
            this._updateVelocity();
        }, config.updateIntervalMs);
    },
    
    /**
     * Para loop de atualização
     */
    _stopUpdateLoop: function() {
        if (this._updateInterval) {
            clearInterval(this._updateInterval);
            this._updateInterval = null;
        }
    },
    
    /**
     * CORE: Atualiza velocidade de forma suave
     * Usa controle proporcional com suavização exponencial
     */
    _updateVelocity: function() {
        if (!this._isActive) return;
        
        const config = VoiceSyncConfig.scroll;
        const silenceConfig = VoiceSyncConfig.silence;
        const now = Date.now();
        
        // Calcula tempo desde última fala
        const silenceTime = now - this._lastSpeechTime;
        
        // Obtém posição atual do teleprompter
        const currentPos = window.getTeleprompterCurrentPos ? window.getTeleprompterCurrentPos() : 0;
        
        // Converte target para coordenada CSS
        const targetScrollPos = window.convertOffsetToScrollPos ? 
            window.convertOffsetToScrollPos(this._targetOffset) : -this._targetOffset;
        
        // Diferença: positivo = precisamos avançar (descer)
        const difference = currentPos - targetScrollPos;
        
        // Calcula velocidade alvo baseada na diferença e estado de silêncio
        let targetVelocity = 0;
        
        if (silenceTime > silenceConfig.stopThresholdMs) {
            // Silêncio longo: para completamente
            targetVelocity = 0;
            this._isCatchingUp = false;
        } else if (silenceTime > silenceConfig.pauseThresholdMs) {
            // Silêncio médio: desacelera gradualmente
            targetVelocity = Math.max(0, this._currentVelocity * 0.9);
            this._isCatchingUp = false;
        } else if (difference > config.catchUpThreshold) {
            // Muito atrasado: modo catch-up (velocidade limitada)
            this._isCatchingUp = true;
            targetVelocity = Math.min(config.maxCatchUpVelocity, difference * 0.02);
        } else if (difference > 20) {
            // Atrasado normal: acelera proporcionalmente
            this._isCatchingUp = false;
            targetVelocity = Math.min(config.maxVelocity, difference * 0.015);
        } else if (difference < -20) {
            // Adiantado: freia suavemente
            this._isCatchingUp = false;
            targetVelocity = 0;
        } else {
            // Na zona morta: mantém velocidade mínima
            this._isCatchingUp = false;
            targetVelocity = 1;
        }
        
        // Suavização exponencial da velocidade
        const smoothing = config.smoothingFactor;
        if (targetVelocity > this._currentVelocity) {
            // Acelerando: suavização normal
            this._currentVelocity = this._currentVelocity * smoothing + targetVelocity * (1 - smoothing);
        } else {
            // Desacelerando: mais rápido
            const decelSmoothing = smoothing * 0.7;
            this._currentVelocity = this._currentVelocity * decelSmoothing + targetVelocity * (1 - decelSmoothing);
        }
        
        // Aplica velocidade (arredondada para evitar jitter)
        const finalVelocity = Math.round(Math.max(config.minVelocity, Math.min(config.maxVelocity, this._currentVelocity)));
        
        if (window.teleprompterAutoScroll) {
            window.teleprompterAutoScroll.setVelocity(finalVelocity);
        }
        
        // Log ocasional
        if (VoiceSyncConfig.debug.logScroll && Math.random() < 0.05) {
            console.log(`📊 Scroll: v=${finalVelocity}, diff=${difference.toFixed(0)}px, silence=${silenceTime}ms, catchUp=${this._isCatchingUp}`);
        }
    },
    
    /**
     * Retorna estado atual
     */
    getState: function() {
        return {
            isActive: this._isActive,
            currentVelocity: this._currentVelocity,
            targetOffset: this._targetOffset,
            isCatchingUp: this._isCatchingUp,
            silenceTime: Date.now() - this._lastSpeechTime
        };
    }
};

// ============================================================================
// MÓDULO: ASRModule - Abstração do Reconhecimento de Voz
// ============================================================================
const ASRModule = {
    _recognition: null,
    _isRunning: false,
    _wordBuffer: [],            // Buffer de palavras reconhecidas
    _onResultCallback: null,    // Callback para resultados
    _language: 'pt-BR',
    
    /**
     * Inicializa o módulo ASR
     */
    initialize: function(options = {}) {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        
        if (!SpeechRecognition) {
            console.error('❌ Web Speech API não suportada neste navegador');
            return false;
        }
        
        this._recognition = new SpeechRecognition();
        this._recognition.continuous = true;
        this._recognition.interimResults = true;
        this._recognition.lang = options.language || this._language;
        
        this._setupEventHandlers();
        
        console.log('🎤 ASRModule inicializado');
        return true;
    },
    
    /**
     * Configura handlers de eventos
     */
    _setupEventHandlers: function() {
        const self = this;
        
        this._recognition.onstart = function() {
            self._isRunning = true;
            console.log('🎤 Reconhecimento de voz iniciado');
        };
        
        this._recognition.onend = function() {
            console.log('🎤 Reconhecimento encerrado, reiniciando...');
            if (self._isRunning) {
                setTimeout(() => {
                    try {
                        self._recognition.start();
                    } catch (e) {
                        console.warn('⚠️ Erro ao reiniciar ASR:', e.message);
                    }
                }, 100);
            }
        };
        
        this._recognition.onerror = function(event) {
            if (event.error !== 'aborted' && event.error !== 'no-speech') {
                console.error('❌ Erro ASR:', event.error);
            }
        };
        
        this._recognition.onresult = function(event) {
            self._processResult(event);
        };
    },
    
    /**
     * Processa resultado do reconhecimento
     */
    _processResult: function(event) {
        const config = VoiceSyncConfig.buffer;
        let newWords = [];
        let isFinal = false;
        
        for (let i = event.resultIndex; i < event.results.length; i++) {
            const transcript = event.results[i][0].transcript.trim();
            const words = transcript.split(/\s+/).filter(w => w.length > 0);
            
            if (event.results[i].isFinal) {
                isFinal = true;
                // Adiciona ao buffer
                this._wordBuffer.push(...words);
                
                // Limita tamanho do buffer
                if (this._wordBuffer.length > config.maxWords) {
                    this._wordBuffer = this._wordBuffer.slice(-config.maxWords);
                }
            } else {
                newWords = words;
            }
        }
        
        // Notifica callback
        if (this._onResultCallback) {
            const wordsToProcess = isFinal ? 
                this._wordBuffer.slice(-VoiceSyncConfig.alignment.wordWindow) :
                newWords;
            
            this._onResultCallback({
                words: wordsToProcess,
                isFinal: isFinal,
                buffer: this._wordBuffer,
                transcript: wordsToProcess.join(' ')
            });
        }
        
        if (VoiceSyncConfig.debug.logASR) {
            console.log(`🎤 ${isFinal ? 'FINAL' : 'interim'}: "${(isFinal ? this._wordBuffer : newWords).slice(-5).join(' ')}"`);
        }
    },
    
    /**
     * Inicia reconhecimento
     */
    start: function() {
        if (!this._recognition) {
            console.error('❌ ASRModule não inicializado');
            return false;
        }
        
        try {
            this._recognition.start();
            return true;
        } catch (e) {
            console.error('❌ Erro ao iniciar ASR:', e.message);
            return false;
        }
    },
    
    /**
     * Para reconhecimento
     */
    stop: function() {
        this._isRunning = false;
        if (this._recognition) {
            this._recognition.stop();
        }
    },
    
    /**
     * Define callback para resultados
     */
    onResult: function(callback) {
        this._onResultCallback = callback;
    },
    
    /**
     * Limpa buffer de palavras
     */
    clearBuffer: function() {
        this._wordBuffer = [];
    },
    
    /**
     * Retorna estado atual
     */
    getState: function() {
        return {
            isRunning: this._isRunning,
            bufferSize: this._wordBuffer.length,
            language: this._language
        };
    }
};

// ============================================================================
// MÓDULO: VoiceSyncManager - Orquestrador Principal
// ============================================================================
const VoiceSyncManager = {
    _isInitialized: false,
    _isActive: false,
    
    /**
     * Inicializa todo o sistema de sincronização
     */
    initialize: function() {
        if (this._isInitialized) {
            console.warn('⚠️ VoiceSyncManager já inicializado');
            return true;
        }
        
        // Inicializa ASR
        if (!ASRModule.initialize()) {
            console.error('❌ Falha ao inicializar ASRModule');
            return false;
        }
        
        // Configura callback de resultados
        ASRModule.onResult((result) => {
            this._handleSpeechResult(result);
        });
        
        // Aguarda prompt estar disponível para inicializar alinhador
        this._waitForPrompt();
        
        this._isInitialized = true;
        console.log('✅ VoiceSyncManager inicializado');
        return true;
    },
    
    /**
     * Aguarda elemento .prompt estar disponível
     */
    _waitForPrompt: function() {
        const promptElement = document.querySelector('.prompt');
        if (promptElement && promptElement.innerText.trim().length > 0) {
            TextAligner.initialize();
        } else {
            setTimeout(() => this._waitForPrompt(), 500);
        }
    },
    
    /**
     * Inicia sincronização de voz
     */
    start: function() {
        if (!this._isInitialized) {
            this.initialize();
        }
        
        // Reinicializa alinhador (pode ter mudado o conteúdo)
        TextAligner.initialize();
        TextAligner.reset();
        
        // Inicia controlador de scroll
        SmoothScrollController.start();
        
        // Inicia ASR
        ASRModule.start();
        
        this._isActive = true;
        console.log('▶️ VoiceSync ATIVADO');
    },
    
    /**
     * Para sincronização
     */
    stop: function() {
        ASRModule.stop();
        SmoothScrollController.stop();
        this._isActive = false;
        console.log('⏹️ VoiceSync DESATIVADO');
    },
    
    /**
     * Processa resultado de fala
     */
    _handleSpeechResult: function(result) {
        if (!this._isActive) return;
        
        // Notifica scroll controller que houve fala
        SmoothScrollController.notifySpeech();
        
        // Busca posição no texto
        const position = TextAligner.findPosition(result.words);
        
        if (position) {
            // Atualiza target do scroll
            SmoothScrollController.setTarget(position.element, position.progress);
        }
    },
    
    /**
     * Retorna estado completo do sistema
     */
    getState: function() {
        return {
            isInitialized: this._isInitialized,
            isActive: this._isActive,
            asr: ASRModule.getState(),
            aligner: TextAligner.getState(),
            scroll: SmoothScrollController.getState()
        };
    },
    
    /**
     * Ativa/desativa debug
     */
    setDebug: function(enabled, options = {}) {
        VoiceSyncConfig.debug.enabled = enabled;
        VoiceSyncConfig.debug.logMatching = options.matching || enabled;
        VoiceSyncConfig.debug.logScroll = options.scroll || enabled;
        VoiceSyncConfig.debug.logASR = options.asr || enabled;
    }
};

// ============================================================================
// EXPORTAÇÃO GLOBAL
// ============================================================================
window.VoiceSync = {
    // Manager principal
    manager: VoiceSyncManager,
    
    // Módulos individuais (para uso avançado)
    modules: {
        asr: ASRModule,
        aligner: TextAligner,
        scroll: SmoothScrollController
    },
    
    // Configuração
    config: VoiceSyncConfig,
    
    // Atalhos
    start: () => VoiceSyncManager.start(),
    stop: () => VoiceSyncManager.stop(),
    getState: () => VoiceSyncManager.getState(),
    setDebug: (enabled, options) => VoiceSyncManager.setDebug(enabled, options)
};

console.log('📦 VoiceSync v1.0 carregado. Use window.VoiceSync.start() para iniciar.');
