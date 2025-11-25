/**
 * Módulo de Análise de Áudio para Detecção de Mudança de Speaker
 * 
 * Usa Web Audio API para monitorar características de voz:
 * - RMS (volume) para detectar pausas/silêncio
 * - Centroide espectral para detectar mudanças de timbre
 * 
 * Dispara callbacks quando detecta possível troca de speaker
 */

let audioContext = null;
let analyser = null;
let mediaStream = null;
let isAnalyzing = false;

// Configurações
const CONFIG = {
    // Detecção de silêncio/pausa
    silenceThreshold: 0.01,      // RMS abaixo disso = silêncio
    pauseDuration: 500,          // ms de silêncio para considerar pausa
    
    // Detecção de mudança de voz
    spectralChangeThreshold: 0.3, // Variação percentual no centroide espectral
    voiceChangeWindow: 10,        // Amostras para calcular média móvel
    
    // Análise
    fftSize: 2048,
    sampleInterval: 50           // ms entre análises
};

// Estado
let lastSpeechTime = Date.now();
let spectralHistory = [];
let onSpeakerChangeCallback = null;
let analysisInterval = null;

// Buffers para análise
let frequencyData = null;
let timeDomainData = null;

/**
 * Inicializa o analisador de áudio
 * @param {MediaStream} stream - Stream do microfone (pode ser obtido do getUserMedia)
 * @param {Function} onSpeakerChange - Callback chamado quando detecta mudança de speaker
 */
export async function iniciarAnalise(stream, onSpeakerChange) {
    if (isAnalyzing) {
        console.log('🔊 Analisador já está rodando');
        return;
    }
    
    try {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        analyser = audioContext.createAnalyser();
        analyser.fftSize = CONFIG.fftSize;
        
        const source = audioContext.createMediaStreamSource(stream);
        source.connect(analyser);
        
        // Não conecta ao destination para não criar feedback
        
        frequencyData = new Uint8Array(analyser.frequencyBinCount);
        timeDomainData = new Uint8Array(analyser.fftSize);
        
        mediaStream = stream;
        onSpeakerChangeCallback = onSpeakerChange;
        isAnalyzing = true;
        
        // Inicia loop de análise
        analysisInterval = setInterval(analisarAudio, CONFIG.sampleInterval);
        
        console.log('🔊 Analisador de áudio iniciado');
        console.log(`   - Threshold de silêncio: ${CONFIG.silenceThreshold}`);
        console.log(`   - Duração de pausa: ${CONFIG.pauseDuration}ms`);
        
    } catch (error) {
        console.error('❌ Erro ao iniciar analisador:', error);
        throw error;
    }
}

/**
 * Para a análise de áudio
 */
export function pararAnalise() {
    if (analysisInterval) {
        clearInterval(analysisInterval);
        analysisInterval = null;
    }
    
    if (audioContext) {
        audioContext.close();
        audioContext = null;
    }
    
    analyser = null;
    mediaStream = null;
    isAnalyzing = false;
    spectralHistory = [];
    
    console.log('🔊 Analisador de áudio parado');
}

/**
 * Calcula o RMS (Root Mean Square) do sinal - indica volume
 */
function calcularRMS() {
    analyser.getByteTimeDomainData(timeDomainData);
    
    let sum = 0;
    for (let i = 0; i < timeDomainData.length; i++) {
        const normalized = (timeDomainData[i] - 128) / 128; // -1 a 1
        sum += normalized * normalized;
    }
    
    return Math.sqrt(sum / timeDomainData.length);
}

/**
 * Calcula o centroide espectral - indica "brilho" da voz (timbre)
 * Vozes diferentes têm centróides diferentes
 */
function calcularCentroideEspectral() {
    analyser.getByteFrequencyData(frequencyData);
    
    let numerator = 0;
    let denominator = 0;
    
    for (let i = 0; i < frequencyData.length; i++) {
        const frequency = i * audioContext.sampleRate / analyser.fftSize;
        const magnitude = frequencyData[i];
        
        numerator += frequency * magnitude;
        denominator += magnitude;
    }
    
    if (denominator === 0) return 0;
    return numerator / denominator;
}

/**
 * Detecta mudança abrupta no centroide espectral
 */
function detectarMudancaEspectral(centroide) {
    spectralHistory.push(centroide);
    
    // Mantém janela limitada
    if (spectralHistory.length > CONFIG.voiceChangeWindow * 2) {
        spectralHistory.shift();
    }
    
    // Precisa de histórico suficiente
    if (spectralHistory.length < CONFIG.voiceChangeWindow) {
        return false;
    }
    
    // Calcula média das últimas N amostras
    const recentStart = spectralHistory.length - CONFIG.voiceChangeWindow;
    const recent = spectralHistory.slice(recentStart);
    const older = spectralHistory.slice(Math.max(0, recentStart - CONFIG.voiceChangeWindow), recentStart);
    
    if (older.length === 0) return false;
    
    const mediaRecent = recent.reduce((a, b) => a + b, 0) / recent.length;
    const mediaOlder = older.reduce((a, b) => a + b, 0) / older.length;
    
    // Variação percentual
    if (mediaOlder === 0) return false;
    const variacao = Math.abs(mediaRecent - mediaOlder) / mediaOlder;
    
    return variacao > CONFIG.spectralChangeThreshold;
}

/**
 * Loop principal de análise
 */
function analisarAudio() {
    if (!analyser || !isAnalyzing) return;
    
    const rms = calcularRMS();
    const centroide = calcularCentroideEspectral();
    const agora = Date.now();
    
    // Detecta silêncio (possível pausa entre speakers)
    const isSilence = rms < CONFIG.silenceThreshold;
    
    if (isSilence) {
        const pausaDuracao = agora - lastSpeechTime;
        
        // Pausa longa detectada - possível troca de speaker
        if (pausaDuracao >= CONFIG.pauseDuration) {
            console.log(`🔇 Pausa detectada: ${pausaDuracao}ms`);
            
            if (onSpeakerChangeCallback) {
                onSpeakerChangeCallback({
                    tipo: 'pausa',
                    duracao: pausaDuracao,
                    timestamp: agora
                });
            }
            
            // Reseta histórico espectral após pausa
            spectralHistory = [];
            lastSpeechTime = agora; // Evita disparar múltiplas vezes
        }
    } else {
        // Há fala - atualiza timestamp e verifica mudança de voz
        lastSpeechTime = agora;
        
        // Detecta mudança abrupta no timbre (mesmo sem pausa)
        if (detectarMudancaEspectral(centroide)) {
            console.log(`🎭 Mudança de timbre detectada (centroide: ${centroide.toFixed(0)}Hz)`);
            
            if (onSpeakerChangeCallback) {
                onSpeakerChangeCallback({
                    tipo: 'timbre',
                    centroide: centroide,
                    timestamp: agora
                });
            }
            
            // Reseta histórico para não disparar repetidamente
            spectralHistory = [];
        }
    }
}

/**
 * Obtém o stream do microfone
 * Reutiliza se já existir um ativo
 */
export async function obterStreamMicrofone() {
    if (mediaStream && mediaStream.active) {
        return mediaStream;
    }
    
    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true
            }
        });
        console.log('🎤 Stream do microfone obtido');
        return stream;
    } catch (error) {
        console.error('❌ Erro ao acessar microfone:', error);
        throw error;
    }
}

/**
 * Ajusta configurações em tempo real
 */
export function ajustarConfiguracao(novasConfigs) {
    Object.assign(CONFIG, novasConfigs);
    console.log('⚙️ Configurações do analisador atualizadas:', CONFIG);
}

/**
 * Retorna status atual do analisador
 */
export function getStatus() {
    return {
        isAnalyzing,
        config: { ...CONFIG },
        historyLength: spectralHistory.length
    };
}
