//import { encontrarPosicaoNoRoteiroFuzzy } from "./matchRecognition.js";
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

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
                console.log('Resultado final:', event.results[i][0].transcript);
                recognition.abort();
                //recognition.
                // Depois de um breve intervalo, reiniciar:
                setTimeout(() => {
                    recognition.start();
                }, 200); 


                finalTranscript += event.results[i][0].transcript;
            } else {
                console.log('Resultado intermediário:', event.results[i][0].transcript);
                interimTranscript += event.results[i][0].transcript;
                atualizarDebug(processarEntrada(interimTranscript));
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

    let textoAcumulado = document.getElementsByClassName('prompt move');
    let roteiro = "";

    function processarEntrada(entradaParcial) {
        // Concatena o novo fragmento com o acumulado
        textoAcumulado += entradaParcial;

        // Se o acumulado tiver um tamanho mínimo (ex.: 5 caracteres), tenta fazer o matching
        if (textoAcumulado.length >= 5) {
            // Aqui você pode chamar a função de fuzzy matching comparando textoAcumulado com o roteiro
            const posicaoRoteiro = encontrarPosicaoNoRoteiroFuzzy(textoAcumulado, roteiro);
            if (posicaoRoteiro !== -1) {
                ajustarVelocidade(posicaoRoteiro);
                // Se desejar, limpa o acumulado após identificar a posição
                textoAcumulado = "";
            }
        }
    }

    recognition.onerror = function (event) {
        console.error('Erro no reconhecimento de voz:', event.error);
    };

    recognition.start();
} else {
    console.warn('Seu navegador não suporta a API de reconhecimento de voz.');
}
