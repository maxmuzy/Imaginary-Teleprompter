# Imaginary Teleprompter - Replit Setup

## Overview
This is the **Imaginary Teleprompter** application - a professional-grade, free, open-source teleprompter software. Originally designed as an Electron desktop application, this version runs as a web application in the browser.

## Project Information
- **Name**: Imaginary Teleprompter
- **Version**: 2.4.0
- **License**: GPL-3.0+
- **Authors**: Javier Cordero, Victor Ortiz
- **Contributors**: Rafael Sierra, Keyvan Pérez
- **Original Repository**: https://github.com/ImaginarySense/Imaginary-Teleprompter

## Architecture

### Application Type
This is a **dual-mode application** that can run:
1. As an Electron desktop application (with native features)
2. As a static web application (browser-based)

In Replit, it runs as a web application because Electron requires a desktop environment.

### Key Components
- **Frontend**: HTML/CSS/JavaScript with CKEditor for rich text editing
- **Server**: Simple Express.js static file server (server.js)
- **Port**: 5000 (required for Replit webview)
- **Host**: 0.0.0.0 (allows Replit's iframe proxy to work)

### Directory Structure
- `/ckeditor/` - Rich text editor library
- `/css/` - Stylesheets and themes
- `/js/` - Core JavaScript functionality
  - `editor.js` - Main editor and teleprompter logic
  - `teleprompter.js` - Teleprompter display logic
  - `data.manager.js` - Local storage management
- `/img/` - Images and assets
- `/fonts/` - Font files
- `index.html` - Main application entry point
- `teleprompter.html` - Teleprompter display view
- `server.js` - Web server for Replit deployment

## Features
- Professional teleprompter with speed control
- Rich text editing with CKEditor
- Multiple flip modes (mirror, vertical, horizontal)
- Adjustable speed, acceleration, font size
- Timer functionality
- Keyboard shortcuts for control
- Multiple prompter styles/themes
- Anchor shortcuts (jump to sections)
- Focus area modes (webcam, professional, screen)
- Hardware-accelerated scrolling

## Running in Replit

### Current Setup
The application runs via:
```bash
node server.js
```

This serves all static files on port 5000 and is accessible through the Replit webview.

### Electron Features Not Available
Since Replit runs in the browser (not Electron), these desktop-specific features are unavailable:
- Dual-window external prompter
- Offscreen rendering/canvas sync
- System tray integration
- Squirrel auto-updates
- Native menus

The core teleprompter functionality (editing, prompting, controls, themes) works fully in the browser.

## Recent Changes

### 2024-11-25: Reset Seletivo do Contador (v27)
- **Correção crítica**:
  - `parciaisSemMatchNoFim` agora SÓ reseta quando realmente avança para próximo elemento
  - Antes: resetava em qualquer match (palavras comuns como "boa", "tarde" causavam reset)
  - Agora: mantém contador se match é no elemento atual já em 100%
  - Isso garante que transição P1→P2 force SEARCHING após 5 parciais sem avanço real

### 2024-11-25: Lookahead Dinâmico + Detecção de Transição (v26)
- **Lookahead dinâmico**:
  - Quando progresso > 90%, expande de 5 para 20 elementos
  - Permite encontrar próximo parágrafo mesmo que esteja longe
  - Log: `🔭 Lookahead EXPANDIDO: 20`

- **Contador de parciais sem match**:
  - `parciaisSemMatchNoFim`: conta parciais sem match quando perto do fim
  - Após 5 parciais sem match, força volta para SEARCHING
  - Log: `⚠️ Sem match perto do fim! parciaisSemMatch=X/5`

- **Auto-volta para SEARCHING**:
  - Quando atingir limite de parciais sem match, re-localiza posição
  - Resolve problema de transição entre repórter/apresentadora
  - Log: `🔄 Muitos parciais sem match no fim, voltando para SEARCHING...`

### 2024-11-25: Scroll Suave + Identificação de Vozes (v25)
- **Jump inicial suave**:
  - `moveToOffset(offsetTop, smooth)` aceita parâmetro smooth
  - Quando smooth=true: `animate(300, jump, 'ease-out')` (300ms suave)
  - Jump inicial e avanço para novo elemento = SUAVE
  - Scroll de progresso = instantâneo (não atrasa)

- **Identificação de sessões de fala**:
  - Contador `currentSpeakerSession` (Pessoa 1, 2, 3...)
  - Pausa > 2 segundos = nova sessão de fala
  - Logs: `[P1] 🎤 parcial: "texto..."` 
  - Mensagem: `👤 ===== NOVA SESSÃO DE FALA: Pessoa N =====`

### 2024-11-25: Controle Exclusivo de Voz + Parciais (v24)
- **Correção do Conflito de Posicionamento**:
  - Problema: `moveToAnchor('overlayFocus')` sobrescrevia o scroll por voz
  - Solução: Flag `voiceControlActive` desabilita moveToAnchor quando voz está ativa
  - API `window.teleprompterVoiceControl.{acquire, release, isActive}` exposta

- **Resultados Parciais Agora Fazem Scroll**:
  - `calcularProgressoPorAlinhamento()` - encontra última palavra falada no elemento
  - Parciais calculam progresso por alinhamento de palavras
  - Finais usam buffer cumulativo como antes
  - Hysteresis de 5% evita jitter (só faz scroll se progresso > 5%)

- **Controle Exclusivo Integrado**:
  - `AutoScrollController.start()` chama `acquire()` - toma controle
  - `AutoScrollController.stop()` chama `release()` - libera controle
  - Enquanto voz ativa, teleprompter NÃO pode mover para âncoras

- **Fluxo Corrigido**:
  1. Detecção inicial → encontra posição → `acquire()` → scroll para elemento
  2. Leitura parcial → alinhamento de palavras → scroll progressivo
  3. Improvisação → pause → scroll para
  4. Retorno ao roteiro → resume → scroll continua
  5. Sai de LOCKED → `release()` → moveToAnchor volta a funcionar

### 2024-11-25: Sistema de Scroll Direto (v23)
- Thresholds ajustados: searchThreshold 20%, lockedThreshold 15%, wordWindow 15
- Scroll direto para posição do match (sem WPS)
- Pausa imediata no primeiro miss (improvisação)

### 2024-11-25: Arquitetura Simplificada com Máquina de Estados (v21)
- **Reescrito `js/speechRecognition.js`** com nova arquitetura baseada em estados:
  - Removido audioAnalyzer.js (causava loop infinito de restarts)
  - Máquina de estados: SEARCHING → LOCKED
  
- **Estado SEARCHING**:
  - Busca posição inicial no roteiro todo
  - Threshold de 35% para encontrar primeiro match
  - Transita para LOCKED quando encontra posição
  
- **Estado LOCKED**:
  - Verifica apenas elemento atual + próximos 5 (sequencial)
  - Threshold relaxado de 25%
  - Distingue "Confirmação" (mesmo elemento) vs "Avanço" (próximo elemento)
  - NÃO move se não encontrar match (pode ser improvisação)
  - Após 3 misses consecutivos → volta para SEARCHING
  
- **Comportamento de Teleprompter Real**:
  - Uma vez identificada posição inicial, scroll é sequencial
  - Se apresentador improvisar → teleprompter NÃO move
  - Quando voltar ao roteiro → continua de onde parou
  
- **Buffer Incremental**:
  - Máximo 50 palavras no buffer
  - Usa últimas 10 palavras para matching
  - Não acumula infinitamente

### 2024-11-25: Rastreamento por Índice (v19.1)
- Refatorado rastreamento de progresso para usar índice do elemento na lista
- Índice é resiliente a recriações do DOM (innerHTML) pelo teleprompter
- Funciona independentemente de transformações CSS, zoom, modos de espelho

### 2024-11-24: Sistema de Reconhecimento de Voz (v18.3 - MutationObserver Corrigido)
- **Implementação Completa do Sistema de Sincronização com Voz**:
  - Criado `js/speechRecognition.js` (módulo ES6) para reconhecimento de voz via Web Speech API
  - Criado `js/matchRecognition.js` com algoritmo de Levenshtein para fuzzy matching (mantido para compatibilidade)
  - Sistema detecta fala do apresentador e sincroniza automaticamente o scroll do teleprompter
  
- **Funcionalidades Principais**:
  - Reconhecimento de voz contínuo em português (pt-BR)
  - Resultados parciais (interim) para feedback em tempo real
  - Fuzzy matching baseado em similaridade de cobertura (palavras faladas presentes no texto)
  - Normalização completa: remove pontuação e acentos para matching robusto
  - Debounce (300ms) para evitar processamento excessivo
  - Scroll automático para posição da fala reconhecida
  - Âncoras temporárias (voice-sync-*) para movimento preciso no DOM
  - Rastreamento de progresso com ordem documental (compareDocumentPosition)
  - Suporte completo para frases repetidas - avança sequencialmente sem voltar
  - Feedback visual detalhado no console
  
- **Algoritmo de Matching (v18.3)**:
  - Janela móvel de 8 palavras (últimas reconhecidas)
  - Threshold mínimo: 25% de similaridade
  - Busca diretamente em elementos DOM (p, h1-h6, li, ol, ul, span, strong, em, b, i)
  - Calcula similaridade de cobertura: proporção de palavras faladas presentes no elemento
  - Normaliza palavras: lowercase + remove acentos (NFD) + remove pontuação
  - Rastreia último elemento validado para progressão sequencial
  - Filtra elementos anteriores, iguais, ou descendants do último validado
  - Em caso de empate, mantém o PRIMEIRO encontrado (mais próximo)
  - Usa compareDocumentPosition para ordem estável independente de CSS
  - Verifica conectividade DOM antes de usar ultimoElementoValidado
  
- **Rastreamento de Progresso**:
  - Variável global: `ultimoElementoValidado` (referência ao Node)
  - Atualizado SEMPRE em scrollParaElemento (antes do check de 3%)
  - Garante avanço sequencial em frases repetidas
  - Resetado quando: roteiro muda (hash diferente) OU elemento desconectado do DOM
  - Preservado durante scrolls (filtro de âncoras temporárias)
  
- **MutationObserver (v18.3)**:
  - Monitora mudanças no elemento .prompt
  - Filtra âncoras temporárias (voice-sync-*) em addedNodes E removedNodes
  - Usa hash do conteúdo para detectar mudanças REAIS do roteiro
  - Debounce de 1 segundo para evitar resets consecutivos
  - NÃO reseta em scroll normal (hash igual)
  - RESETA quando roteiro muda (hash diferente)
  - Fallback: verifica document.body.contains(ultimoElementoValidado) antes de cada match
  
- **Correções de Bugs (v1-v18.3)**:
  - v1-v3: Carregamento duplicado, funções não expostas, roteiro não carregado
  - v4-v9: Frases repetidas sempre faziam match com primeira ocorrência
  - v10-v11: Lógica de compareDocumentPosition invertida
  - v12: ultimoElementoValidado não era atualizado em scrolls pequenos
  - v13: Lógica de ordem documental corrigida
  - v14: Adicionado check de descendants (contains)
  - v15: Filtro de âncoras em addedNodes (incompleto)
  - v16: Filtro completo de âncoras em addedNodes E removedNodes
  - v17: Janela móvel de 8 palavras para matching (resolve acúmulo de texto longo)
  - v18: MutationObserver resetando constantemente (observer pausado durante operações)
  - v18.2: Hash para detectar mudanças reais (sem pausar observer)
  - v18.3: Verificação de conectividade DOM para ultimoElementoValidado ✅

- **Arquivos Criados/Modificados**:
  - `teleprompter.html`: Removido carregamento duplicado do script
  - `js/teleprompter.js`: Expostas funções globalmente
  - `js/speechRecognition.js`: Implementação completa v18.3
  - `js/matchRecognition.js`: Fuzzy matching com Levenshtein (mantido para compatibilidade)

### 2024-11-24: Initial Replit Setup
- Created `server.js` to serve static files on port 5000
- Installed Express.js dependency
- Configured workflow to run web server
- Documented project structure and setup

## Development Notes
- The JavaScript code uses feature detection (`inElectron()`) to gracefully skip Electron-specific features when running in a browser
- All data is stored locally using browser localStorage
- No backend API or database required
- The application is entirely client-side
