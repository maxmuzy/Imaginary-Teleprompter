import { encontrarPosicaoNoRoteiroFuzzy } from "./matchRecognition.js";

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

// Estado global do reconhecimento
let roteiro = [];
let roteiroTextoCompleto = "";
let textoAcumulado = "";
let debounceTimer = null;
let isProcessing = false;
let ultimoElementoValidado = null; // Rastreia o último elemento validado (Node) para ordem documental

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

    // Observer para resetar progresso quando o prompt muda (ex: usuário carrega novo roteiro)
    function observarMudancasNoPrompt() {
        const promptElement = document.querySelector('.prompt');
        if (!promptElement) return;

        const observer = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                // Ignora mudanças causadas por âncoras temporárias de scroll (voice-sync-*)
                // Verifica TANTO addedNodes QUANTO removedNodes
                if (mutation.type === 'childList') {
                    let eAncoraTemporaria = false;
                    
                    // Verifica nós adicionados
                    for (const node of mutation.addedNodes) {
                        if (node.id && node.id.startsWith('voice-sync-')) {
                            eAncoraTemporaria = true;
                            break;
                        }
                    }
                    
                    // Verifica nós removidos também
                    if (!eAncoraTemporaria) {
                        for (const node of mutation.removedNodes) {
                            if (node.id && node.id.startsWith('voice-sync-')) {
                                eAncoraTemporaria = true;
                                break;
                            }
                        }
                    }
                    
                    if (eAncoraTemporaria) {
                        continue; // Ignora mutations de âncoras temporárias (add/remove)
                    }
                }
                
                // Se houve mudança real no conteúdo (não apenas âncoras temporárias)
                if (mutation.type === 'childList' || mutation.type === 'characterData') {
                    console.log('🔄 Prompt alterado (reload de roteiro), resetando rastreamento');
                    ultimoElementoValidado = null;
                    // Recarrega o roteiro também
                    carregarRoteiro();
                    break;
                }
            }
        });

        observer.observe(promptElement, {
            childList: true,
            subtree: true,
            characterData: true
        });

        console.log('👁️ Observer de mudanças no prompt ativado');
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

        console.log(`🎤 ${isFinal ? 'Final' : 'Parcial'}: "${textoAcumulado}"`);

        // Busca diretamente no DOM ao invés de usar o array de roteiro
        const elementoEncontrado = encontrarElementoDOMComTexto(textoAcumulado);
        
        if (elementoEncontrado) {
            console.log(`✅ Elemento encontrado: ${elementoEncontrado.tagName}`);
            scrollParaElemento(elementoEncontrado);
            
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
    // Considera a última posição de scroll para evitar voltar a frases repetidas anteriores
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
        let melhorSimilaridade = 0;
        const threshold = 0.3; // 30% mínimo
        
        const ultimoElemLog = ultimoElementoValidado ? `${ultimoElementoValidado.tagName}` : 'nenhum';
        console.log(`   🔍 Procurando em ${elementos.length} elementos (último validado: ${ultimoElemLog})...`);
        
        // Percorre todos os elementos e encontra o com melhor similaridade
        // Prioriza elementos APÓS o último validado na ordem do documento
        for (let elem of elementos) {
            const textoElemento = (elem.innerText || elem.textContent || '').trim();
            const textoElemNormalizado = textoElemento.toLowerCase().trim();
            
            // Calcula similaridade baseada em cobertura (melhor para frases parciais)
            const similaridade = calcularSimilaridadeCobertura(textoNormalizado, textoElemNormalizado);
            
            if (similaridade >= threshold) {
                // NUNCA seleciona o mesmo elemento, elementos anteriores, ou descendants
                // (evita voltar para trás ou ficar preso em frases repetidas)
                if (ultimoElementoValidado) {
                    const eMesmo = elem === ultimoElementoValidado;
                    
                    // Verifica se elem está contido dentro de ultimoElementoValidado (descendant)
                    const eDescendant = ultimoElementoValidado.contains(elem);
                    
                    if (eMesmo || eDescendant) {
                        continue; // Ignora o mesmo elemento ou seus descendants
                    }
                    
                    // Verifica se elem está DEPOIS de ultimoElementoValidado na ordem do documento
                    const comparacao = ultimoElementoValidado.compareDocumentPosition(elem);
                    const estaDepois = (comparacao & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
                    
                    // Ignora se NÃO está depois (está antes ou sem relação)
                    if (!estaDepois) {
                        continue;
                    }
                }
                
                // Atualiza se:
                // 1. É o primeiro candidato válido (após ultimoElementoValidado) OU
                // 2. Tem similaridade estritamente maior (match melhor)
                // Em caso de empate, mantém o PRIMEIRO encontrado (mais próximo na sequência)
                const primeiroValido = melhorElemento === null;
                const matchMelhor = similaridade > melhorSimilaridade;
                
                if (primeiroValido || matchMelhor) {
                    melhorSimilaridade = similaridade;
                    melhorElemento = elem;
                }
            }
        }
        
        if (melhorElemento) {
            const textoMatch = (melhorElemento.innerText || melhorElemento.textContent || '').substring(0, 50);
            console.log(`   ✓ Melhor match (${(melhorSimilaridade * 100).toFixed(0)}%) em ${melhorElemento.offsetTop}px: "${textoMatch}..."`);
        }
        
        return melhorElemento;
    }

    // Move o teleprompter para um elemento específico
    function scrollParaElemento(elemento) {
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
        
        // SEMPRE atualiza o rastreamento de progresso (crítico para frases repetidas)
        ultimoElementoValidado = elemento;
        console.log(`   ✅ Último elemento validado: ${elemento.tagName} (${offsetTop}px)`);
        
        // Se a diferença for muito pequena, não faz scroll (mas já atualizou o progresso)
        if (diferencaPercentual < 3) {
            console.log(`   ⏭️ Já sincronizado (diferença: ${diferencaPercentual.toFixed(1)}%), progresso atualizado`);
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
                    console.log(`   🗑️ Âncora removida`);
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
