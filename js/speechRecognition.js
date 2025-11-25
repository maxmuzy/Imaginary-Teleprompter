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
    // Matching
    searchThreshold: 0.35,      // Threshold para encontrar posição inicial (SEARCHING)
    lockedThreshold: 0.25,      // Threshold mais relaxado quando já está LOCKED
    wordWindow: 10,             // Janela de palavras para matching
    lookaheadElements: 5,       // Quantos elementos olhar à frente em LOCKED
    
    // Improvisação
    maxConsecutiveMisses: 3,    // Misses antes de voltar para SEARCHING
    
    // Buffer
    maxBufferWords: 50,         // Máximo de palavras no buffer
    
    // Debounce
    debounceMs: 300             // Debounce para resultados parciais
};

// Estado global
let currentState = STATE.SEARCHING;
let currentElementIndex = -1;       // Índice atual no roteiro
let consecutiveMisses = 0;          // Contador de misses para detectar improvisação
let wordBuffer = [];                // Buffer de palavras reconhecidas
let lastProcessedFinalIndex = 0;    // Índice do último final processado
let debounceTimer = null;
let ultimoHashRoteiro = "";

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
                // Adiciona palavras ao buffer
                wordBuffer.push(...words);
                
                // Limita tamanho do buffer
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

        console.log(`🎤 ${isFinal ? 'Final' : 'Parcial'}: "${textoFalado}"`);
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
            
            // Transição para LOCKED
            currentState = STATE.LOCKED;
            currentElementIndex = melhorIndice;
            consecutiveMisses = 0;
            
            // Move o teleprompter
            scrollParaElemento(melhorMatch);
        } else {
            console.log(`   ❌ Nenhum match encontrado (threshold: ${CONFIG.searchThreshold * 100}%)`);
        }
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
            // Verifica se é um AVANÇO (próximo elemento) ou CONFIRMAÇÃO (mesmo elemento)
            const avancou = melhorIndice > currentElementIndex;
            
            if (avancou) {
                console.log(`   ✅ Avançou! Índice ${currentElementIndex} → ${melhorIndice} (${(melhorSimilaridade * 100).toFixed(0)}%)`);
                currentElementIndex = melhorIndice;
                consecutiveMisses = 0;
                
                // Move o teleprompter apenas quando avança
                scrollParaElemento(melhorMatch);
            } else {
                // Ainda no mesmo elemento - OK, reseta misses mas não move
                console.log(`   ✓ Confirmado no índice ${melhorIndice} (${(melhorSimilaridade * 100).toFixed(0)}%)`);
                consecutiveMisses = 0;
            }
        } else {
            // NÃO encontrou match - pode ser improvisação
            if (isFinal) {
                consecutiveMisses++;
                console.log(`   ⏸️ Sem match (improvisação?). Misses: ${consecutiveMisses}/${CONFIG.maxConsecutiveMisses}`);
                
                // Se muitos misses, volta para SEARCHING
                if (consecutiveMisses >= CONFIG.maxConsecutiveMisses) {
                    console.log(`   🔄 Muitos misses, voltando para SEARCHING...`);
                    currentState = STATE.SEARCHING;
                    consecutiveMisses = 0;
                }
            } else {
                console.log(`   ⏳ Aguardando (parcial)...`);
            }
        }
    }

    // Move o teleprompter para um elemento
    function scrollParaElemento(elemento) {
        const promptElement = document.querySelector('.prompt');
        if (!promptElement) return;

        const offsetTop = elemento.offsetTop;
        const promptHeight = promptElement.scrollHeight;
        const progressoCalculado = offsetTop / promptHeight;
        const posicaoAtual = window.getTeleprompterProgress ? window.getTeleprompterProgress() : 0;
        
        const diferenca = Math.abs(progressoCalculado - posicaoAtual) * 100;
        
        console.log(`   📊 Progresso: ${(progressoCalculado * 100).toFixed(1)}% (atual: ${(posicaoAtual * 100).toFixed(1)}%)`);
        
        // Se já está muito próximo, não faz scroll
        if (diferenca < 3) {
            console.log(`   ⏭️ Já sincronizado`);
            return;
        }
        
        // Cria âncora temporária e move
        const anchorId = 'voice-sync-' + Date.now();
        const ancora = document.createElement('a');
        ancora.id = anchorId;
        ancora.name = anchorId;
        elemento.parentNode.insertBefore(ancora, elemento);
        
        setTimeout(() => {
            if (window.moveTeleprompterToAnchor) {
                window.moveTeleprompterToAnchor(anchorId);
                console.log(`   🎯 Teleprompter movido`);
            }
            
            setTimeout(() => {
                const ancoraRemover = document.getElementById(anchorId);
                if (ancoraRemover) ancoraRemover.remove();
            }, 2000);
        }, 50);
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
