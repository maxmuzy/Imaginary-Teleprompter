import { encontrarPosicaoNoRoteiroFuzzy } from "./matchRecognition.js";

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

// Estado global do reconhecimento
let roteiro = [];
let roteiroTextoCompleto = "";
let textoAcumulado = "";
let debounceTimer = null;
let isProcessing = false;
let ultimoIndiceValidado = -1; // Índice do último elemento validado na lista de elementos
let observerDebounceTimer = null; // Debounce para evitar resets consecutivos
let ultimoHashRoteiro = ""; // Hash do roteiro para detectar mudanças reais

if (SpeechRecognition) {
    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'pt-BR';

    recognition.onstart = function() {
        console.log('🎤 Reconhecimento de voz iniciado');
    };

    recognition.onresult = function (event) {
        let interimTranscript = '';
        let finalTranscript = '';

        // Percorre os resultados para separar os finais dos intermediários
        for (let i = event.resultIndex; i < event.results.length; i++) {
            if (event.results[i].isFinal) {
                finalTranscript += event.results[i][0].transcript;
                
                // Processa resultado final
                processarEntrada(finalTranscript, true);
                
                // Reinicia após breve pausa
                setTimeout(() => {
                    if (recognition) {
                        recognition.abort();
                        setTimeout(() => recognition.start(), 100);
                    }
                }, 200);
            } else {
                interimTranscript += event.results[i][0].transcript;
            }
        }

        // Processa resultados intermediários com debounce
        if (interimTranscript) {
            processarEntradaComDebounce(interimTranscript, false);
        }
    };

    // Função auxiliar para escapar caracteres especiais que podem existir na string (útil para usar com regex)
    function escapeRegExp(string) {
        return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    // Carrega o roteiro do teleprompter (elemento .prompt existe desde o início)
    function getVisibleText() {
        return new Promise((resolve) => {
            // Primeiro tenta pegar imediatamente do elemento .prompt
            const promptElements = document.querySelectorAll('.prompt');
            if (promptElements.length > 0) {
                const textoCompleto = promptElements[0].innerText || promptElements[0].textContent || "";
                if (textoCompleto.trim().length > 0) {
                    resolve(textoCompleto);
                    return;
                }
            }
            
            // Se não encontrou, aguarda aparecer com observer
            const observer = new MutationObserver((mutationsList) => {
                for (const mutation of mutationsList) {
                    if (mutation.type === "childList" || mutation.type === "subtree") {
                        const elements = document.querySelectorAll('.prompt');
                        if (elements.length > 0) {
                            const texto = elements[0].innerText || elements[0].textContent || "";
                            if (texto.trim().length > 0) {
                                observer.disconnect();
                                resolve(texto);
                                return;
                            }
                        }
                    }
                }
            });
    
            observer.observe(document.body, { childList: true, subtree: true });
        });
    }

    // Transforma texto em array de frases (separadas por ponto, quebra de linha ou parágrafo)
    function textoParaArrayDeFrases(texto) {
        if (!texto) return [];
        
        // Quebra por linhas e por pontos finais
        let frases = texto
            .split(/\n+/)
            .map(linha => linha.trim())
            .filter(linha => linha.length > 0);
        
        // Divide frases longas por pontos finais
        let frasesFinais = [];
        frases.forEach(linha => {
            const partes = linha.split(/\.+/).map(p => p.trim()).filter(p => p.length > 3);
            frasesFinais.push(...partes);
        });
        
        return frasesFinais;
    }

    // Debounce para evitar processamento excessivo
    function processarEntradaComDebounce(texto, isFinal) {
        if (debounceTimer) {
            clearTimeout(debounceTimer);
        }
        
        debounceTimer = setTimeout(() => {
            processarEntrada(texto, isFinal);
        }, isFinal ? 0 : 300); // Sem delay para finais, 300ms para parciais
    }
    
    // Carrega o roteiro quando o teleprompter estiver pronto
    async function carregarRoteiro() {
        try {
            roteiroTextoCompleto = await getVisibleText();
            roteiro = textoParaArrayDeFrases(roteiroTextoCompleto);
            console.log(`📄 Roteiro carregado: ${roteiro.length} frases`);
        } catch (error) {
            console.error('Erro ao carregar roteiro:', error);
        }
    }

    carregarRoteiro();

    // Calcula hash simples de uma string (para detectar mudanças reais no roteiro)
    function calcularHash(str) {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32bit integer
        }
        return hash.toString();
    }
    
    // Verifica se o roteiro mudou e reseta se necessário
    function verificarMudancaRoteiro() {
        const promptElement = document.querySelector('.prompt');
        if (!promptElement) return;
        
        const textoAtual = (promptElement.innerText || promptElement.textContent || "").trim();
        const hashAtual = calcularHash(textoAtual);
        
        // Só reseta se o hash for diferente (conteúdo realmente mudou)
        if (hashAtual !== ultimoHashRoteiro && ultimoHashRoteiro !== "") {
            console.log('🔄 Roteiro REALMENTE alterado, resetando rastreamento');
            ultimoIndiceValidado = -1; // Reseta para o início
            carregarRoteiro();
        }
        
        ultimoHashRoteiro = hashAtual;
    }
    
    // Observer para detectar quando o prompt muda (ex: usuário carrega novo roteiro)
    // Usa debounce + verificação de hash para evitar resets falsos
    function observarMudancasNoPrompt() {
        const promptElement = document.querySelector('.prompt');
        if (!promptElement) return;
        
        // Salva hash inicial
        const textoInicial = (promptElement.innerText || promptElement.textContent || "").trim();
        ultimoHashRoteiro = calcularHash(textoInicial);

        const observer = new MutationObserver((mutations) => {
            // Filtra mutations de âncoras temporárias
            let temMutacaoReal = false;
            
            for (const mutation of mutations) {
                if (mutation.type === 'childList') {
                    // Verifica se é âncora temporária
                    let eAncoraTemporaria = false;
                    
                    for (const node of mutation.addedNodes) {
                        if (node.nodeType === Node.ELEMENT_NODE && node.id && node.id.startsWith('voice-sync-')) {
                            eAncoraTemporaria = true;
                            break;
                        }
                    }
                    
                    if (!eAncoraTemporaria) {
                        for (const node of mutation.removedNodes) {
                            if (node.nodeType === Node.ELEMENT_NODE && node.id && node.id.startsWith('voice-sync-')) {
                                eAncoraTemporaria = true;
                                break;
                            }
                        }
                    }
                    
                    if (!eAncoraTemporaria) {
                        temMutacaoReal = true;
                    }
                } else if (mutation.type === 'characterData') {
                    temMutacaoReal = true;
                }
            }
            
            if (!temMutacaoReal) {
                return; // Ignora mutations de âncoras
            }
            
            // Agenda verificação de hash com debounce
            if (observerDebounceTimer) {
                clearTimeout(observerDebounceTimer);
            }
            
            observerDebounceTimer = setTimeout(() => {
                verificarMudancaRoteiro();
            }, 1000); // 1 segundo de debounce
        });

        observer.observe(promptElement, {
            childList: true,
            subtree: true,
            characterData: true
        });

        console.log('👁️ Observer ativado (usa hash para detectar mudanças reais)');
    }

    // Ativa observer após breve delay para garantir que prompt está carregado
    setTimeout(observarMudancasNoPrompt, 1000);

    // Processa a entrada de voz e sincroniza com o teleprompter
    function processarEntrada(texto, isFinal) {
        if (isProcessing) return;
        
        // Atualiza o texto acumulado
        textoAcumulado = texto.trim();

        // Precisa ter tamanho mínimo para processar
        if (textoAcumulado.length < 5) return;

        isProcessing = true;

        // IMPORTANTE: Usa apenas as ÚLTIMAS 8 palavras para matching
        // A Web Speech API acumula muito texto, tornando o matching impossível
        const palavras = textoAcumulado.split(/\s+/).filter(p => p.length > 0);
        const palavrasParaMatch = palavras.slice(-8).join(' '); // Últimas 8 palavras
        
        console.log(`🎤 ${isFinal ? 'Final' : 'Parcial'}: "${palavrasParaMatch}" (de ${palavras.length} palavras)`);

        // Busca diretamente no DOM ao invés de usar o array de roteiro
        const resultado = encontrarElementoDOMComTexto(palavrasParaMatch);
        
        if (resultado && resultado.elemento) {
            console.log(`✅ Elemento encontrado: ${resultado.elemento.tagName} (índice ${resultado.indice})`);
            scrollParaElemento(resultado.elemento, resultado.indice);
            
            // Limpa o acumulado se for resultado final
            if (isFinal) {
                textoAcumulado = "";
            }
        } else {
            console.log(`❌ Nenhum elemento encontrado para: "${textoAcumulado}"`);
        }

        isProcessing = false;
    }

    // Busca diretamente no DOM pelo elemento que melhor corresponde ao texto falado
    // Usa índice na lista de elementos - estável mesmo quando DOM é recriado
    function encontrarElementoDOMComTexto(textoFalado) {
        const promptElement = document.querySelector('.prompt');
        if (!promptElement) {
            console.warn('⚠️ Elemento .prompt não encontrado');
            return null;
        }

        const textoNormalizado = textoFalado.toLowerCase().trim();
        
        // Pega todos os elementos de texto (incluindo spans, strong, em para markup inline)
        const elementos = promptElement.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li, ol, ul, span, strong, em, b, i');
        
        let melhorElemento = null;
        let melhorIndice = -1;
        let melhorSimilaridade = 0;
        const threshold = 0.25; // 25% mínimo (mais permissivo para frases curtas)
        
        console.log(`   🔍 Procurando em ${elementos.length} elementos (último índice: ${ultimoIndiceValidado})...`);
        
        // Percorre todos os elementos a partir do índice seguinte ao último validado
        // Isso garante progressão mesmo quando o DOM é recriado
        const indiceInicio = ultimoIndiceValidado + 1;
        
        for (let i = indiceInicio; i < elementos.length; i++) {
            const elem = elementos[i];
            const textoElemento = (elem.innerText || elem.textContent || '').trim();
            const textoElemNormalizado = textoElemento.toLowerCase().trim();
            
            // Calcula similaridade baseada em cobertura (melhor para frases parciais)
            const similaridade = calcularSimilaridadeCobertura(textoNormalizado, textoElemNormalizado);
            
            if (similaridade >= threshold) {
                // Atualiza se:
                // 1. É o primeiro candidato válido OU
                // 2. Tem similaridade estritamente maior (match melhor)
                // Em caso de empate, mantém o PRIMEIRO encontrado (mais próximo)
                const primeiroValido = melhorElemento === null;
                const matchMelhor = similaridade > melhorSimilaridade;
                
                if (primeiroValido || matchMelhor) {
                    melhorSimilaridade = similaridade;
                    melhorElemento = elem;
                    melhorIndice = i;
                }
            }
        }
        
        if (melhorElemento) {
            const textoMatch = (melhorElemento.innerText || melhorElemento.textContent || '').substring(0, 50);
            console.log(`   ✓ Melhor match (${(melhorSimilaridade * 100).toFixed(0)}%) índice ${melhorIndice}: "${textoMatch}..."`);
        }
        
        return { elemento: melhorElemento, indice: melhorIndice };
    }

    // Move o teleprompter para um elemento específico
    function scrollParaElemento(elemento, indice) {
        const promptElement = document.querySelector('.prompt');
        if (!promptElement) {
            console.warn('⚠️ Elemento .prompt não encontrado');
            return;
        }

        // Calcula a posição vertical do elemento no prompt
        const offsetTop = elemento.offsetTop;
        const promptHeight = promptElement.scrollHeight;
        
        // Calcula o progresso baseado na posição real do elemento
        const progressoCalculado = offsetTop / promptHeight;
        const posicaoAtual = window.getTeleprompterProgress ? window.getTeleprompterProgress() : 0;
        
        console.log(`   📍 offsetTop: ${offsetTop}px / height: ${promptHeight}px`);
        console.log(`   📊 Progresso: ${(progressoCalculado * 100).toFixed(1)}% (atual: ${(posicaoAtual * 100).toFixed(1)}%)`);
        
        const diferenca = progressoCalculado - posicaoAtual;
        const diferencaPercentual = Math.abs(diferenca) * 100;
        
        // SEMPRE atualiza o índice validado (crítico para frases repetidas)
        // Usar índice é resiliente a recriações do DOM
        ultimoIndiceValidado = indice;
        console.log(`   ✅ Último índice validado: ${indice}`);
        
        // Se a diferença for muito pequena, não faz scroll (mas já atualizou o índice)
        if (diferencaPercentual < 3) {
            console.log(`   ⏭️ Já sincronizado (diferença: ${diferencaPercentual.toFixed(1)}%), índice atualizado`);
            return;
        }
        
        // Cria uma âncora temporária e move o teleprompter
        criarAncoraTemporariaEMover(elemento);
    }

    // Normaliza uma palavra: remove pontuação e acentos
    function normalizarPalavra(palavra) {
        return palavra
            .toLowerCase()
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // Remove acentos
            .replace(/[^\w\s]/g, '') // Remove pontuação
            .trim();
    }

    // Calcula similaridade baseada em cobertura (palavras faladas presentes no texto)
    // Mais adequada para frases curtas em parágrafos longos
    function calcularSimilaridadeCobertura(textoFalado, textoElemento) {
        // Normaliza e filtra palavras (> 2 chars)
        const palavrasFaladas = textoFalado
            .split(/\s+/)
            .map(p => normalizarPalavra(p))
            .filter(p => p.length > 2);
        
        const palavrasElemento = new Set(
            textoElemento
                .split(/\s+/)
                .map(p => normalizarPalavra(p))
                .filter(p => p.length > 2)
        );
        
        if (palavrasFaladas.length === 0) return 0;
        
        // Conta quantas palavras do texto falado aparecem no elemento
        let palavrasEncontradas = 0;
        for (let palavra of palavrasFaladas) {
            if (palavrasElemento.has(palavra)) {
                palavrasEncontradas++;
            }
        }
        
        // Retorna a proporção de palavras do texto falado que foram encontradas
        return palavrasEncontradas / palavrasFaladas.length;
    }

    // Cria uma âncora temporária e move o teleprompter
    function criarAncoraTemporariaEMover(elemento) {
        const anchorId = 'voice-sync-' + Date.now();
        
        // Cria uma âncora antes do elemento
        const ancora = document.createElement('a');
        ancora.id = anchorId;
        ancora.name = anchorId;
        elemento.parentNode.insertBefore(ancora, elemento);
        
        console.log(`   🎯 Criando âncora temporária: ${anchorId}`);
        
        // Aguarda um frame para o DOM atualizar
        setTimeout(() => {
            // Move o teleprompter usando sua API
            if (window.moveTeleprompterToAnchor) {
                window.moveTeleprompterToAnchor(anchorId);
                console.log(`   ✅ Teleprompter movido para a âncora`);
            }
            
            // Remove a âncora após 2 segundos
            setTimeout(() => {
                const ancoraRemover = document.getElementById(anchorId);
                if (ancoraRemover) {
                    ancoraRemover.remove();
                }
            }, 2000);
        }, 50);
    }

    recognition.onerror = function (event) {
        console.error('Erro no reconhecimento de voz:', event.error);
    };

    recognition.start();
} else {
    console.warn('Seu navegador não suporta a API de reconhecimento de voz.');
}
