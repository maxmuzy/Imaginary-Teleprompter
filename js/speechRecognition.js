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

// Configurações
const CONFIG = {
    // Matching - tolerância aumentada para detecção inicial
    searchThreshold: 0.20,      // Threshold baixo para encontrar posição inicial (20%)
    lockedThreshold: 0.15,      // Threshold ainda mais relaxado quando já está LOCKED (15%)
    wordWindow: 15,             // Janela maior de palavras para matching (15 palavras)
    lookaheadElements: 5,       // Quantos elementos olhar à frente em LOCKED
    minWordsForMatch: 3,        // Mínimo de palavras para tentar match
    
    // Improvisação - pausa imediata
    maxConsecutiveMisses: 2,    // Menos misses antes de pausar (mais sensível)
    
    // Buffer
    maxBufferWords: 60,         // Buffer maior para capturar mais contexto
    
    // Debounce
    debounceMs: 200             // Debounce menor para resposta mais rápida
};

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

// Identificação de sessões de fala (para debug)
let currentSpeakerSession = 1;      // Sessão atual de fala (Pessoa 1, 2, 3...)
let lastSpeechTimestamp = 0;        // Timestamp do último resultado
const SPEAKER_PAUSE_THRESHOLD = 2000; // Pausa > 2s = nova sessão de fala

// ========================================
// AutoScrollController - Controle SIMPLIFICADO de scroll
// Abordagem: scroll direto para posição do match, sem velocidade calculada
// ========================================
const AutoScrollController = {
    isActive: false,
    isPaused: false,
    lastWordCount: 0,
    lastTimestamp: Date.now(),
    lastProgressoEnviado: 0,  // Último progresso enviado para evitar jitter
    
    // Inicializa o controlador e ADQUIRE controle exclusivo
    start: function() {
        this.isActive = true;
        this.isPaused = false;
        this.lastWordCount = 0;
        this.lastProgressoEnviado = 0;
        
        // ADQUIRE controle exclusivo do scroll
        if (window.teleprompterVoiceControl) {
            window.teleprompterVoiceControl.acquire();
        }
        console.log('🚀 AutoScroll ATIVADO (modo direto)');
    },
    
    // Para o controlador e LIBERA controle
    stop: function() {
        this.isActive = false;
        this.isPaused = false;
        
        // LIBERA controle do scroll
        if (window.teleprompterVoiceControl) {
            window.teleprompterVoiceControl.release();
        }
        console.log('🛑 AutoScroll DESATIVADO');
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
    
    // Verifica se deve fazer scroll para um novo progresso (evita jitter)
    shouldScrollTo: function(novoProgresso) {
        // Só faz scroll se o progresso aumentou significativamente (5%)
        if (novoProgresso > this.lastProgressoEnviado + 0.05) {
            this.lastProgressoEnviado = novoProgresso;
            return true;
        }
        return false;
    },
    
    // Atualiza contador (simplificado)
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
        if (textoFalado.length < 3) return;

        // Detecta mudança de sessão de fala (pausa longa = possível novo falante)
        const agora = Date.now();
        if (lastSpeechTimestamp > 0 && (agora - lastSpeechTimestamp) > SPEAKER_PAUSE_THRESHOLD) {
            currentSpeakerSession++;
            console.log(`👤 ===== NOVA SESSÃO DE FALA: Pessoa ${currentSpeakerSession} =====`);
        }
        lastSpeechTimestamp = agora;

        console.log(`[P${currentSpeakerSession}] 🎤 ${isFinal ? 'FINAL' : 'parcial'}: "${textoFalado}"`);
        console.log(`   Estado: ${currentState}, Índice: ${currentElementIndex}, Misses: ${consecutiveMisses}`);

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
            const textoElemento = normalizarTexto(elem.innerText || elem.textContent || '');
            
            if (textoElemento.length < 3) continue;
            
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
        
        // IMPORTANTE: Inclui o elemento ATUAL (apresentador pode ainda estar lendo ele)
        // Olha do atual até os próximos N elementos
        const startIdx = Math.max(0, currentElementIndex);
        const endIdx = Math.min(startIdx + CONFIG.lookaheadElements + 1, elementos.length);
        
        let melhorMatch = null;
        let melhorSimilaridade = 0;
        let melhorIndice = -1;

        console.log(`   🔒 LOCKED: Verificando elementos ${startIdx} a ${endIdx - 1}...`);

        for (let i = startIdx; i < endIdx; i++) {
            const elem = elementos[i];
            const textoElemento = normalizarTexto(elem.innerText || elem.textContent || '');
            
            if (textoElemento.length < 3) continue;
            
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
            
            // Reseta contador de misses
            consecutiveMisses = 0;
            
            if (avancou) {
                console.log(`   ✅ Avançou! Índice ${currentElementIndex} → ${melhorIndice} (${(melhorSimilaridade * 100).toFixed(0)}%)`);
                currentElementIndex = melhorIndice;
                
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
                } else {
                    // PARCIAL: calcula progresso por alinhamento de palavras
                    progresso = calcularProgressoPorAlinhamento(textoNormalizado, melhorMatch);
                    // Garante monotonia: só avança, nunca volta
                    progresso = Math.max(progresso, currentWordPointer / currentElementTotalWords);
                }
                
                // Só faz scroll se progresso aumentou significativamente (evita jitter)
                if (AutoScrollController.shouldScroll() && AutoScrollController.shouldScrollTo(progresso)) {
                    console.log(`   ✓ Scroll para progresso: ${(progresso * 100).toFixed(0)}% (${isFinal ? 'final' : 'parcial'})`);
                    scrollParaElemento(melhorMatch, progresso);
                } else {
                    console.log(`   ✓ Match no índice ${melhorIndice} (${(melhorSimilaridade * 100).toFixed(0)}%) - progresso=${(progresso * 100).toFixed(0)}%`);
                }
            }
        } else {
            // NÃO encontrou match - pode ser improvisação
            if (isFinal) {
                consecutiveMisses++;
                console.log(`   ⏸️ Sem match (improvisação?). Misses: ${consecutiveMisses}/${CONFIG.maxConsecutiveMisses}`);
                
                // DESCARTA palavras pendentes (eram improvisação)
                if (pendingFinalWords.length > 0) {
                    console.log(`   🗑️ Descartadas ${pendingFinalWords.length} palavras de improvisação`);
                    pendingFinalWords = [];
                }
                
                // PAUSA scroll durante improvisação
                AutoScrollController.pause();
                
                // Se muitos misses, volta para SEARCHING
                if (consecutiveMisses >= CONFIG.maxConsecutiveMisses) {
                    console.log(`   🔄 Muitos misses, voltando para SEARCHING...`);
                    currentState = STATE.SEARCHING;
                    consecutiveMisses = 0;
                    // Para o controlador ao sair de LOCKED
                    AutoScrollController.stop();
                }
            } else {
                console.log(`   ⏳ Aguardando (parcial)...`);
            }
        }
    }

    // Move o teleprompter para um elemento, com progresso opcional dentro do elemento
    // progresso: 0 = início do elemento, 1 = fim do elemento
    // isInitialJump: se true, usa animação suave (jump inicial)
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
        
        console.log(`   📍 Scroll: offset=${offsetFinal.toFixed(0)}, progresso=${(progresso*100).toFixed(0)}%${isInitialJump ? ' (SUAVE)' : ''}`);
        
        // Move usando a função que aceita offset diretamente
        // Passa smooth=true para jump inicial (animação suave de 300ms)
        if (window.moveTeleprompterToOffset) {
            window.moveTeleprompterToOffset(offsetFinal, isInitialJump);
        } else {
            console.log(`   ❌ moveTeleprompterToOffset não disponível!`);
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
        
        if (ultimaPosicaoEncontrada < 0) return 0;
        
        // Retorna progresso baseado na posição da última palavra encontrada
        return (ultimaPosicaoEncontrada + 1) / currentElementTotalWords;
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
