import { encontrarPosicaoNoRoteiroFuzzy } from "./matchRecognition.js";

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
var overlayFocus = document.getElementById('overlayFocus');
console.log(typeof window.increaseVelocity); // Deve ser "function"
console.log(typeof window.decreaseVelocity); // Deve ser "function"

if (SpeechRecognition) {
    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true; // Ativa resultados intermediários
    recognition.lang = 'pt-BR';

    recognition.onresult = function (event) {
        let interimTranscript = '';
        let finalTranscript = '';

        // Percorre os resultados para separar os finais dos intermediários
        for (let i = event.resultIndex; i < event.results.length; i++) {
            if (event.results[i].isFinal) {
                //console.log('Resultado final:', event.results[i][0].transcript);
                recognition.abort();
                //recognition.
                // Depois de um breve intervalo, reiniciar:
                setTimeout(() => {
                    recognition.start();
                }, 200);


                finalTranscript += event.results[i][0].transcript;
            } else {
                //console.log('Resultado intermediário:', event.results[i][0].transcript);
                interimTranscript += event.results[i][0].transcript;

                let lastResult = event.results[event.resultIndex];
                atualizarDebug(processarEntrada(lastResult));
            }
        }

        // Atualiza o debug (mostrando os resultados intermediários em negrito)
        //atualizarDebug(interimTranscript, finalTranscript);

        // Aqui você pode decidir se processa sempre o interimTranscript ou só quando há um final
        // Por exemplo, para sincronizar a rolagem, talvez use uma combinação dos dois.
        //sincronizarTeleprompter(interimTranscript || finalTranscript);
    };

    // Função auxiliar para escapar caracteres especiais que podem existir na string (útil para usar com regex)
    function escapeRegExp(string) {
        return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    function getVisibleText() {
        return new Promise((resolve) => {
            const observer = new MutationObserver((mutationsList) => {
                for (const mutation of mutationsList) {
                    if (mutation.type === "childList" || mutation.type === "subtree") {
                        const debugElements = document.getElementsByClassName('prompt move');
                        if (debugElements.length > 0) {
                            const texto = debugElements[0].innerText || debugElements[0].textContent || "";
                            observer.disconnect(); // Para de observar após encontrar
                            resolve(texto); // Retorna o texto via Promise
                            return;
                        }
                    }
                }
            });
    
            // Observar mudanças no corpo da página
            observer.observe(document.body, { childList: true, subtree: true });
        });
    }

    function atualizarDebug(interimText) {
        // Seleciona a primeira div com a classe "prompt move"
        const debugElements = document.getElementsByClassName('prompt move');
        if (debugElements.length === 0) return; // Se não encontrar nenhum, sai da função
        const debugElement = debugElements[0];

        // Se "finalText" representa o conteúdo completo que desejamos exibir,
        // vamos usá-lo como base. Caso contrário, você pode usar o debugElement.innerHTML.
        let novoConteudo = debugElement.innerHTML;

        // Se interimText estiver definido e não for apenas espaços, procedemos à substituição
        if (interimText && interimText.trim() !== "") {
            // Escapa os caracteres especiais para uso seguro em regex
            const interimTextEscapado = escapeRegExp(interimText);
            // Cria uma expressão regular que irá encontrar somente a primeira ocorrência
            const regex = new RegExp(interimTextEscapado);
            // Substitui a primeira ocorrência de interimText por ele mesmo envolto pela tag <strong>
            novoConteudo = novoConteudo.replace(regex, `<strong style="color: red;">${interimText}</strong>`);
        }

        // Atualiza o conteúdo da div com o novo conteúdo processado
        debugElement.innerHTML = novoConteudo;
    }

    let textoAcumulado = "";
    let roteiro = "";
    
    // Uso da função com await
    async function carregarRoteiro() {
        roteiro = await getVisibleText();
    }

    carregarRoteiro();

    function processarEntrada(entradaParcial) {
        textoAcumulado = entradaParcial;

        // Se o acumulado tiver um tamanho mínimo (ex.: 5 caracteres), tenta fazer o matching
        if (textoAcumulado.length >= 5) {
            //console.log('Procurando no roteiro:', roteiro);
            console.log('Texto acumulado:', textoAcumulado);

            // Aqui você pode chamar a função de fuzzy matching comparando textoAcumulado com o roteiro
            const posicaoRoteiro = encontrarPosicaoNoRoteiroFuzzy(textoAcumulado, roteiro);
            if (posicaoRoteiro !== -1) {
                console.log("Posição encontrada no roteiro: " + posicaoRoteiro);
                syncSpeechWithTeleprompter(textoAcumulado);
                // Limpa o acumulado após identificar a posição
                textoAcumulado = "";
            }
        }
    }

    function syncSpeechWithTeleprompter(recognizedText) {
        // Obtém o texto visível no teleprompter (na área de foco)
        var textoVisivel = getVisibleText();

        // Executa o fuzzy matching entre o texto reconhecido e o visível
        var resultadoFuzzy = encontrarPosicaoNoRoteiroFuzzy(recognizedText, textoVisivel);

        if (resultadoFuzzy.index !== -1) {
            // Encontrou uma correspondência. Por exemplo, podemos assumir que:
            // - Se a correspondência ocorrer em uma linha abaixo do meio do texto visível, o apresentador já avançou além do que é exibido,
            //   e a velocidade deve aumentar.
            // - Se a correspondência estiver acima do meio, a rolagem pode estar adiantada e a velocidade deve diminuir.
            var totalLinhas = resultadoFuzzy.linhas.length;

            console.log("Linha correspondente: " + resultadoFuzzy.linhas[resultadoFuzzy.index]);
            console.log("Similaridade: " + resultadoFuzzy.similaridade);

            if (resultadoFuzzy.index > totalLinhas / 2) {
                // O apresentador está "à frente" do que está sendo exibido: acelera para acompanhar
                window.increaseVelocity();
            } else {
                // O apresentador está "atrasado": diminui a velocidade para não ultrapassar
                window.decreaseVelocity();
            }

            // Opcional: para fins de debug/feedback, você pode realçar a linha correspondente.
            // Uma abordagem simples é atualizar o innerHTML da área de foco (overlayFocus) destacando a linha.
            // Veja o exemplo a seguir:
            var linhasHTML = resultadoFuzzy.linhas.map(function (linha, i) {
                if (i === resultadoFuzzy.index) {
                    return "<strong>" + linha + "</strong>";  // em negrito (ou com outro estilo)
                }
                return linha;
            }).join("<br>");
            overlayFocus.innerHTML = linhasHTML;

        } else {
            // Se não houver correspondência suficiente, pode-se optar por não alterar a velocidade ou adotar outra estratégia.
            console.log("Nenhuma correspondência suficientemente similar encontrada para: " + recognizedText);
        }
    }

    recognition.onerror = function (event) {
        console.error('Erro no reconhecimento de voz:', event.error);
    };

    recognition.start();
} else {
    console.warn('Seu navegador não suporta a API de reconhecimento de voz.');
}
