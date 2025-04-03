/**
 * Calcula a distância de Levenshtein entre duas strings.
 * Essa função cria uma matriz e a preenche de acordo com as operações necessárias (inserção, deleção, substituição).
 */
function calcularLevenshtein(a, b) {
    const rows = b.length + 1;
    const cols = a.length + 1;
    const matrix = [];
  
    // Inicializa a primeira coluna e a primeira linha
    for (let i = 0; i < rows; i++) {
      matrix[i] = [i];
    }
    for (let j = 0; j < cols; j++) {
      matrix[0][j] = j;
    }
  
    // Preenche o restante da matriz
    for (let i = 1; i < rows; i++) {
      for (let j = 1; j < cols; j++) {
        if (b.charAt(i - 1) === a.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1,  // substituição
            matrix[i][j - 1] + 1,      // inserção
            matrix[i - 1][j] + 1       // deleção
          );
        }
      }
    }
    return matrix[b.length][a.length];
  }
  
  /**
   * Calcula a similaridade entre duas strings com base na distância de Levenshtein.
   * A similaridade é definida como:
   *   similaridade = (tamanhoMáximo - distância) / tamanhoMáximo
   * Assim, o valor resultante varia de 0 (sem similaridade) a 1 (idênticas).
   */
  function calcularSimilaridade(s1, s2) {
    s1 = s1.toLowerCase().trim();
    s2 = s2.toLowerCase().trim();
    
    const distance = calcularLevenshtein(s1, s2);
    const maxLen = Math.max(s1.length, s2.length);
    
    if (maxLen === 0) return 1; // Evita divisão por zero se ambas as strings estiverem vazias.
    
    return (maxLen - distance) / maxLen;
  }
  
  /**
   * Percorre o roteiro (um array de strings) e tenta encontrar a posição
   * cuja frase seja mais similar ao texto reconhecido (mesmo que parcial).
   * Se a similaridade ultrapassar um limiar definido (por exemplo, 70%), retorna
   * o índice correspondente; caso contrário, retorna -1.
   */
  export function encontrarPosicaoNoRoteiroFuzzy(texto, roteiro) {
    const threshold = 0.7; // Limiar de similaridade (70%)
    let bestMatchIndex = -1;
    let bestSimilarity = 0;
  
    // Percorre cada linha ou trecho do roteiro
    for (let i = 0; i < roteiro.length; i++) {
      const similarity = calcularSimilaridade(texto, roteiro[i]);
      // Se a similaridade atual for melhor que a melhor encontrada até agora e
      // ultrapassar o limiar, atualiza o índice
      if (similarity > bestSimilarity && similarity >= threshold) {
        bestSimilarity = similarity;
        bestMatchIndex = i;
      }
    }
    
    return bestMatchIndex;
  }
  
  // Exemplo de uso:
  const roteiro = [
    "Welcome to Imaginary Teleprompter!",
    "Are you ready to tell a story?",
    "\"Teleprompter\" is the most complete, free software...",
    // ... outras linhas do roteiro
  ];
  
  // Suponha que o reconhecimento tenha retornado o trecho (mesmo que parcial):
  const textoReconhecido = "welcome to imagina"; // Exemplo de reconhecimento parcial
  
  const posicao = encontrarPosicaoNoRoteiroFuzzy(textoReconhecido, roteiro);
  if (posicao !== -1) {
    console.log("Trecho encontrado no roteiro na posição:", posicao);
  } else {
    console.log("Nenhuma correspondência suficientemente similar encontrada.");
  }
  