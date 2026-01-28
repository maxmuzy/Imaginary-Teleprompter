/**
 * Módulo de Reconhecimento de Voz Offline para Teleprompter
 * 
 * Este módulo fornece reconhecimento de voz básico offline usando:
 * 1. Vosk (WebAssembly) - Modelo leve para português
 * 2. Whisper.cpp (WebAssembly) - Alternativa mais precisa
 * 
 * Funcionalidades:
 * - Fallback automático quando online não está disponível
 * - Detecção de conectividade
 * - Cache de modelos para carregamento rápido
 * - API compatível com o módulo online
 * 
 * NOTA: Este módulo requer download de modelos (~50-200MB)
 * Os modelos são baixados uma vez e armazenados em IndexedDB
 */

'use strict';

// ============================================================================
// CONFIGURAÇÃO
// ============================================================================
const OfflineASRConfig = {
    // Modelo Vosk (mais leve, ~50MB)
    vosk: {
        modelUrl: 'https://alphacephei.com/vosk/models/vosk-model-small-pt-0.3.zip',
        modelName: 'vosk-model-small-pt-0.3',
        sampleRate: 16000,
    },
    
    // Modelo Whisper (mais preciso, ~150MB)
    whisper: {
        modelUrl: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin',
        modelName: 'whisper-tiny',
        sampleRate: 16000,
    },
    
    // Configurações gerais
    preferredEngine: 'vosk',        // 'vosk' ou 'whisper'
    autoFallback: true,             // Fallback automático para offline
    cacheModels: true,              // Cache modelos em IndexedDB
    
    // Detecção de conectividade
    connectivity: {
        checkInterval: 5000,        // Verifica a cada 5 segundos
        onlineTestUrl: 'https://www.google.com/generate_204',
        timeout: 3000,
    }
};

// ============================================================================
// GERENCIADOR DE CONECTIVIDADE
// ============================================================================
const ConnectivityManager = {
    _isOnline: navigator.onLine,
    _checkInterval: null,
    _listeners: [],
    
    /**
     * Inicia monitoramento de conectividade
     */
    start: function() {
        // Eventos nativos do navegador
        window.addEventListener('online', () => this._setOnline(true));
        window.addEventListener('offline', () => this._setOnline(false));
        
        // Verificação periódica (mais confiável)
        this._checkInterval = setInterval(() => {
            this._checkConnectivity();
        }, OfflineASRConfig.connectivity.checkInterval);
        
        // Verifica imediatamente
        this._checkConnectivity();
        
        console.log('🌐 ConnectivityManager iniciado');
    },
    
    /**
     * Para monitoramento
     */
    stop: function() {
        if (this._checkInterval) {
            clearInterval(this._checkInterval);
            this._checkInterval = null;
        }
    },
    
    /**
     * Verifica conectividade real (não apenas navigator.onLine)
     */
    _checkConnectivity: async function() {
        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), OfflineASRConfig.connectivity.timeout);
            
            const response = await fetch(OfflineASRConfig.connectivity.onlineTestUrl, {
                method: 'HEAD',
                mode: 'no-cors',
                signal: controller.signal
            });
            
            clearTimeout(timeout);
            this._setOnline(true);
        } catch (e) {
            this._setOnline(false);
        }
    },
    
    /**
     * Atualiza estado e notifica listeners
     */
    _setOnline: function(isOnline) {
        if (this._isOnline !== isOnline) {
            this._isOnline = isOnline;
            console.log(`🌐 Conectividade: ${isOnline ? 'ONLINE' : 'OFFLINE'}`);
            
            this._listeners.forEach(callback => {
                try {
                    callback(isOnline);
                } catch (e) {
                    console.error('Erro em listener de conectividade:', e);
                }
            });
        }
    },
    
    /**
     * Registra listener para mudanças de conectividade
     */
    onConnectivityChange: function(callback) {
        this._listeners.push(callback);
    },
    
    /**
     * Retorna estado atual
     */
    isOnline: function() {
        return this._isOnline;
    }
};

// ============================================================================
// CACHE DE MODELOS (IndexedDB)
// ============================================================================
const ModelCache = {
    _db: null,
    _dbName: 'TeleprompterASRModels',
    _storeName: 'models',
    
    /**
     * Inicializa IndexedDB
     */
    init: async function() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this._dbName, 1);
            
            request.onerror = () => reject(request.error);
            
            request.onsuccess = () => {
                this._db = request.result;
                resolve();
            };
            
            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains(this._storeName)) {
                    db.createObjectStore(this._storeName, { keyPath: 'name' });
                }
            };
        });
    },
    
    /**
     * Salva modelo no cache
     */
    save: async function(name, data) {
        if (!this._db) await this.init();
        
        return new Promise((resolve, reject) => {
            const transaction = this._db.transaction([this._storeName], 'readwrite');
            const store = transaction.objectStore(this._storeName);
            
            const request = store.put({ name, data, timestamp: Date.now() });
            
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    },
    
    /**
     * Carrega modelo do cache
     */
    load: async function(name) {
        if (!this._db) await this.init();
        
        return new Promise((resolve, reject) => {
            const transaction = this._db.transaction([this._storeName], 'readonly');
            const store = transaction.objectStore(this._storeName);
            
            const request = store.get(name);
            
            request.onsuccess = () => {
                if (request.result) {
                    resolve(request.result.data);
                } else {
                    resolve(null);
                }
            };
            request.onerror = () => reject(request.error);
        });
    },
    
    /**
     * Verifica se modelo existe no cache
     */
    exists: async function(name) {
        const data = await this.load(name);
        return data !== null;
    },
    
    /**
     * Remove modelo do cache
     */
    remove: async function(name) {
        if (!this._db) await this.init();
        
        return new Promise((resolve, reject) => {
            const transaction = this._db.transaction([this._storeName], 'readwrite');
            const store = transaction.objectStore(this._storeName);
            
            const request = store.delete(name);
            
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }
};

// ============================================================================
// ENGINE VOSK (WebAssembly)
// ============================================================================
const VoskEngine = {
    _model: null,
    _recognizer: null,
    _isLoaded: false,
    _isLoading: false,
    _audioContext: null,
    _mediaStream: null,
    _processor: null,
    _onResultCallback: null,
    
    /**
     * Carrega o modelo Vosk
     */
    load: async function(onProgress) {
        if (this._isLoaded) return true;
        if (this._isLoading) return false;
        
        this._isLoading = true;
        
        try {
            console.log('📦 Carregando modelo Vosk...');
            
            // Verifica cache
            const cached = await ModelCache.load(OfflineASRConfig.vosk.modelName);
            
            if (cached) {
                console.log('📦 Modelo encontrado no cache');
                // Aqui carregaria o modelo do cache
                // this._model = await Vosk.createModel(cached);
            } else {
                console.log('📦 Baixando modelo...');
                // Aqui baixaria e carregaria o modelo
                // const response = await fetch(OfflineASRConfig.vosk.modelUrl);
                // const data = await response.arrayBuffer();
                // await ModelCache.save(OfflineASRConfig.vosk.modelName, data);
                // this._model = await Vosk.createModel(data);
            }
            
            // NOTA: Implementação real requer biblioteca Vosk WASM
            // Por enquanto, simula carregamento
            console.warn('⚠️ Vosk WASM não implementado - usando simulação');
            
            this._isLoaded = true;
            this._isLoading = false;
            
            return true;
        } catch (e) {
            console.error('❌ Erro ao carregar Vosk:', e);
            this._isLoading = false;
            return false;
        }
    },
    
    /**
     * Inicia reconhecimento
     */
    start: async function() {
        if (!this._isLoaded) {
            const loaded = await this.load();
            if (!loaded) return false;
        }
        
        try {
            // Obtém acesso ao microfone
            this._mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            
            // Cria contexto de áudio
            this._audioContext = new (window.AudioContext || window.webkitAudioContext)({
                sampleRate: OfflineASRConfig.vosk.sampleRate
            });
            
            const source = this._audioContext.createMediaStreamSource(this._mediaStream);
            
            // Cria processador de áudio
            // NOTA: ScriptProcessorNode está deprecated, usar AudioWorklet em produção
            this._processor = this._audioContext.createScriptProcessor(4096, 1, 1);
            
            this._processor.onaudioprocess = (event) => {
                const inputData = event.inputBuffer.getChannelData(0);
                this._processAudio(inputData);
            };
            
            source.connect(this._processor);
            this._processor.connect(this._audioContext.destination);
            
            console.log('🎤 Vosk reconhecimento iniciado');
            return true;
        } catch (e) {
            console.error('❌ Erro ao iniciar Vosk:', e);
            return false;
        }
    },
    
    /**
     * Para reconhecimento
     */
    stop: function() {
        if (this._processor) {
            this._processor.disconnect();
            this._processor = null;
        }
        
        if (this._audioContext) {
            this._audioContext.close();
            this._audioContext = null;
        }
        
        if (this._mediaStream) {
            this._mediaStream.getTracks().forEach(track => track.stop());
            this._mediaStream = null;
        }
        
        console.log('🛑 Vosk reconhecimento parado');
    },
    
    /**
     * Processa chunk de áudio
     */
    _processAudio: function(audioData) {
        // NOTA: Implementação real processaria com Vosk
        // Por enquanto, simula resultado ocasional
        
        if (Math.random() < 0.01 && this._onResultCallback) {
            this._onResultCallback({
                text: '[simulação offline]',
                isFinal: false
            });
        }
    },
    
    /**
     * Define callback para resultados
     */
    onResult: function(callback) {
        this._onResultCallback = callback;
    },
    
    /**
     * Retorna estado
     */
    getState: function() {
        return {
            isLoaded: this._isLoaded,
            isLoading: this._isLoading,
            isRunning: this._processor !== null
        };
    }
};

// ============================================================================
// ENGINE WHISPER (WebAssembly)
// ============================================================================
const WhisperEngine = {
    _model: null,
    _isLoaded: false,
    _isLoading: false,
    _audioContext: null,
    _mediaStream: null,
    _audioBuffer: [],
    _processInterval: null,
    _onResultCallback: null,
    
    /**
     * Carrega o modelo Whisper
     */
    load: async function(onProgress) {
        if (this._isLoaded) return true;
        if (this._isLoading) return false;
        
        this._isLoading = true;
        
        try {
            console.log('📦 Carregando modelo Whisper...');
            
            // Verifica cache
            const cached = await ModelCache.load(OfflineASRConfig.whisper.modelName);
            
            if (cached) {
                console.log('📦 Modelo encontrado no cache');
            } else {
                console.log('📦 Baixando modelo...');
                // Implementação real baixaria o modelo
            }
            
            // NOTA: Implementação real requer biblioteca Whisper.cpp WASM
            console.warn('⚠️ Whisper WASM não implementado - usando simulação');
            
            this._isLoaded = true;
            this._isLoading = false;
            
            return true;
        } catch (e) {
            console.error('❌ Erro ao carregar Whisper:', e);
            this._isLoading = false;
            return false;
        }
    },
    
    /**
     * Inicia reconhecimento
     */
    start: async function() {
        if (!this._isLoaded) {
            const loaded = await this.load();
            if (!loaded) return false;
        }
        
        try {
            this._mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            
            this._audioContext = new (window.AudioContext || window.webkitAudioContext)({
                sampleRate: OfflineASRConfig.whisper.sampleRate
            });
            
            const source = this._audioContext.createMediaStreamSource(this._mediaStream);
            const processor = this._audioContext.createScriptProcessor(4096, 1, 1);
            
            processor.onaudioprocess = (event) => {
                const inputData = event.inputBuffer.getChannelData(0);
                this._audioBuffer.push(...inputData);
            };
            
            source.connect(processor);
            processor.connect(this._audioContext.destination);
            
            // Processa buffer periodicamente
            this._processInterval = setInterval(() => {
                this._processBuffer();
            }, 2000); // A cada 2 segundos
            
            console.log('🎤 Whisper reconhecimento iniciado');
            return true;
        } catch (e) {
            console.error('❌ Erro ao iniciar Whisper:', e);
            return false;
        }
    },
    
    /**
     * Para reconhecimento
     */
    stop: function() {
        if (this._processInterval) {
            clearInterval(this._processInterval);
            this._processInterval = null;
        }
        
        if (this._audioContext) {
            this._audioContext.close();
            this._audioContext = null;
        }
        
        if (this._mediaStream) {
            this._mediaStream.getTracks().forEach(track => track.stop());
            this._mediaStream = null;
        }
        
        this._audioBuffer = [];
        
        console.log('🛑 Whisper reconhecimento parado');
    },
    
    /**
     * Processa buffer de áudio acumulado
     */
    _processBuffer: function() {
        if (this._audioBuffer.length < 16000) return; // Mínimo 1 segundo
        
        // NOTA: Implementação real processaria com Whisper
        // Por enquanto, simula resultado
        
        if (this._onResultCallback) {
            this._onResultCallback({
                text: '[simulação whisper offline]',
                isFinal: true
            });
        }
        
        // Limpa buffer
        this._audioBuffer = [];
    },
    
    /**
     * Define callback para resultados
     */
    onResult: function(callback) {
        this._onResultCallback = callback;
    },
    
    /**
     * Retorna estado
     */
    getState: function() {
        return {
            isLoaded: this._isLoaded,
            isLoading: this._isLoading,
            isRunning: this._processInterval !== null,
            bufferSize: this._audioBuffer.length
        };
    }
};

// ============================================================================
// GERENCIADOR DE ASR OFFLINE
// ============================================================================
const OfflineASRManager = {
    _currentEngine: null,
    _isInitialized: false,
    _onResultCallback: null,
    
    /**
     * Inicializa o gerenciador
     */
    initialize: async function() {
        if (this._isInitialized) return true;
        
        // Inicializa cache
        await ModelCache.init();
        
        // Inicia monitoramento de conectividade
        ConnectivityManager.start();
        
        // Seleciona engine preferida
        const engine = OfflineASRConfig.preferredEngine;
        this._currentEngine = engine === 'whisper' ? WhisperEngine : VoskEngine;
        
        this._isInitialized = true;
        console.log(`📦 OfflineASRManager inicializado (engine: ${engine})`);
        
        return true;
    },
    
    /**
     * Pré-carrega modelo (para uso posterior)
     */
    preloadModel: async function(onProgress) {
        if (!this._isInitialized) {
            await this.initialize();
        }
        
        return await this._currentEngine.load(onProgress);
    },
    
    /**
     * Inicia reconhecimento offline
     */
    start: async function() {
        if (!this._isInitialized) {
            await this.initialize();
        }
        
        // Configura callback
        this._currentEngine.onResult((result) => {
            if (this._onResultCallback) {
                this._onResultCallback(result);
            }
        });
        
        return await this._currentEngine.start();
    },
    
    /**
     * Para reconhecimento
     */
    stop: function() {
        if (this._currentEngine) {
            this._currentEngine.stop();
        }
    },
    
    /**
     * Define callback para resultados
     */
    onResult: function(callback) {
        this._onResultCallback = callback;
    },
    
    /**
     * Verifica se está online
     */
    isOnline: function() {
        return ConnectivityManager.isOnline();
    },
    
    /**
     * Registra listener para mudanças de conectividade
     */
    onConnectivityChange: function(callback) {
        ConnectivityManager.onConnectivityChange(callback);
    },
    
    /**
     * Retorna estado completo
     */
    getState: function() {
        return {
            isInitialized: this._isInitialized,
            isOnline: ConnectivityManager.isOnline(),
            engine: OfflineASRConfig.preferredEngine,
            engineState: this._currentEngine ? this._currentEngine.getState() : null
        };
    },
    
    /**
     * Alterna entre engines
     */
    setEngine: function(engine) {
        if (engine !== 'vosk' && engine !== 'whisper') {
            console.error('❌ Engine inválida:', engine);
            return false;
        }
        
        // Para engine atual se estiver rodando
        if (this._currentEngine) {
            this._currentEngine.stop();
        }
        
        // Seleciona nova engine
        this._currentEngine = engine === 'whisper' ? WhisperEngine : VoskEngine;
        OfflineASRConfig.preferredEngine = engine;
        
        console.log(`🔄 Engine alterada para: ${engine}`);
        return true;
    }
};

// ============================================================================
// GERENCIADOR HÍBRIDO (ONLINE + OFFLINE)
// ============================================================================
const HybridASRManager = {
    _isInitialized: false,
    _isRunning: false,
    _useOffline: false,
    _onlineRecognition: null,
    _onResultCallback: null,
    
    /**
     * Inicializa o gerenciador híbrido
     */
    initialize: async function() {
        if (this._isInitialized) return true;
        
        // Inicializa offline
        await OfflineASRManager.initialize();
        
        // Monitora conectividade para fallback automático
        if (OfflineASRConfig.autoFallback) {
            OfflineASRManager.onConnectivityChange((isOnline) => {
                if (this._isRunning) {
                    if (isOnline && this._useOffline) {
                        console.log('🌐 Conexão restaurada - voltando para online');
                        this._switchToOnline();
                    } else if (!isOnline && !this._useOffline) {
                        console.log('📴 Conexão perdida - ativando offline');
                        this._switchToOffline();
                    }
                }
            });
        }
        
        this._isInitialized = true;
        console.log('✅ HybridASRManager inicializado');
        
        return true;
    },
    
    /**
     * Inicia reconhecimento (escolhe automaticamente online/offline)
     */
    start: async function() {
        if (!this._isInitialized) {
            await this.initialize();
        }
        
        this._isRunning = true;
        
        if (OfflineASRManager.isOnline()) {
            return this._startOnline();
        } else {
            return this._startOffline();
        }
    },
    
    /**
     * Para reconhecimento
     */
    stop: function() {
        this._isRunning = false;
        
        if (this._useOffline) {
            OfflineASRManager.stop();
        } else {
            this._stopOnline();
        }
    },
    
    /**
     * Inicia reconhecimento online
     */
    _startOnline: function() {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        
        if (!SpeechRecognition) {
            console.warn('⚠️ Web Speech API não disponível, usando offline');
            return this._startOffline();
        }
        
        this._onlineRecognition = new SpeechRecognition();
        this._onlineRecognition.continuous = true;
        this._onlineRecognition.interimResults = true;
        this._onlineRecognition.lang = 'pt-BR';
        
        this._onlineRecognition.onresult = (event) => {
            this._processOnlineResult(event);
        };
        
        this._onlineRecognition.onerror = (event) => {
            if (event.error === 'network') {
                console.log('📴 Erro de rede - ativando offline');
                this._switchToOffline();
            }
        };
        
        this._onlineRecognition.onend = () => {
            if (this._isRunning && !this._useOffline) {
                setTimeout(() => {
                    try {
                        this._onlineRecognition.start();
                    } catch (e) {}
                }, 100);
            }
        };
        
        try {
            this._onlineRecognition.start();
            this._useOffline = false;
            console.log('🌐 Reconhecimento ONLINE iniciado');
            return true;
        } catch (e) {
            console.error('❌ Erro ao iniciar online:', e);
            return this._startOffline();
        }
    },
    
    /**
     * Para reconhecimento online
     */
    _stopOnline: function() {
        if (this._onlineRecognition) {
            try {
                this._onlineRecognition.stop();
            } catch (e) {}
            this._onlineRecognition = null;
        }
    },
    
    /**
     * Inicia reconhecimento offline
     */
    _startOffline: async function() {
        OfflineASRManager.onResult((result) => {
            if (this._onResultCallback) {
                this._onResultCallback({
                    words: result.text.split(/\s+/).filter(w => w.length > 0),
                    isFinal: result.isFinal,
                    isOffline: true
                });
            }
        });
        
        const started = await OfflineASRManager.start();
        
        if (started) {
            this._useOffline = true;
            console.log('📴 Reconhecimento OFFLINE iniciado');
        }
        
        return started;
    },
    
    /**
     * Alterna para online
     */
    _switchToOnline: function() {
        OfflineASRManager.stop();
        this._startOnline();
    },
    
    /**
     * Alterna para offline
     */
    _switchToOffline: async function() {
        this._stopOnline();
        await this._startOffline();
    },
    
    /**
     * Processa resultado online
     */
    _processOnlineResult: function(event) {
        let words = [];
        let isFinal = false;
        
        for (let i = event.resultIndex; i < event.results.length; i++) {
            const transcript = event.results[i][0].transcript.trim();
            words = transcript.split(/\s+/).filter(w => w.length > 0);
            
            if (event.results[i].isFinal) {
                isFinal = true;
            }
        }
        
        if (this._onResultCallback && words.length > 0) {
            this._onResultCallback({
                words: words,
                isFinal: isFinal,
                isOffline: false
            });
        }
    },
    
    /**
     * Define callback para resultados
     */
    onResult: function(callback) {
        this._onResultCallback = callback;
    },
    
    /**
     * Retorna estado
     */
    getState: function() {
        return {
            isInitialized: this._isInitialized,
            isRunning: this._isRunning,
            useOffline: this._useOffline,
            isOnline: OfflineASRManager.isOnline(),
            offlineState: OfflineASRManager.getState()
        };
    },
    
    /**
     * Força modo offline
     */
    forceOffline: async function() {
        if (this._isRunning && !this._useOffline) {
            await this._switchToOffline();
        }
    },
    
    /**
     * Força modo online
     */
    forceOnline: function() {
        if (this._isRunning && this._useOffline) {
            this._switchToOnline();
        }
    }
};

// ============================================================================
// EXPORTAÇÃO GLOBAL
// ============================================================================
window.OfflineASR = {
    // Gerenciadores
    offline: OfflineASRManager,
    hybrid: HybridASRManager,
    connectivity: ConnectivityManager,
    
    // Engines individuais
    engines: {
        vosk: VoskEngine,
        whisper: WhisperEngine
    },
    
    // Cache
    cache: ModelCache,
    
    // Configuração
    config: OfflineASRConfig,
    
    // Atalhos
    start: () => HybridASRManager.start(),
    stop: () => HybridASRManager.stop(),
    onResult: (cb) => HybridASRManager.onResult(cb),
    getState: () => HybridASRManager.getState(),
    preload: () => OfflineASRManager.preloadModel()
};

console.log('📦 OfflineASR v1.0 carregado. Use window.OfflineASR.start() para iniciar.');
console.log('⚠️ NOTA: Engines Vosk/Whisper WASM requerem implementação adicional.');
