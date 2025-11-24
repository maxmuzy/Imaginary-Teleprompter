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

### 2024-11-24: Sistema de Reconhecimento de Voz (v17 - Correção de Matching)
- **Implementação Completa do Sistema de Sincronização com Voz**:
  - Criado `js/speechRecognition.js` (módulo ES6) para reconhecimento de voz via Web Speech API
  - Criado `js/matchRecognition.js` com algoritmo de Levenshtein para fuzzy matching (mantido para compatibilidade, mas não utilizado)
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
  
- **Algoritmo de Matching (v16)**:
  - Busca diretamente em elementos DOM (p, h1-h6, li, ol, ul, span, strong, em, b, i)
  - Calcula similaridade de cobertura: proporção de palavras faladas presentes no elemento
  - Normaliza palavras: lowercase + remove acentos (NFD) + remove pontuação
  - Threshold mínimo: 30% de similaridade
  - Rastreia último elemento validado para progressão sequencial
  - Filtra elementos anteriores, iguais, ou descendants do último validado
  - Em caso de empate, mantém o PRIMEIRO encontrado (mais próximo)
  - Usa compareDocumentPosition para ordem estável independente de CSS
  
- **Rastreamento de Progresso**:
  - Variável global: `ultimoElementoValidado` (referência ao Node)
  - Atualizado SEMPRE em scrollParaElemento (antes do check de 3%)
  - Garante avanço sequencial em frases repetidas
  - Resetado automaticamente quando roteiro muda (MutationObserver)
  - Preservado durante scrolls (filtro de âncoras temporárias)
  
- **MutationObserver**:
  - Monitora mudanças no elemento .prompt
  - Filtra âncoras temporárias (voice-sync-*) em addedNodes E removedNodes
  - Reseta progresso apenas em mudanças reais do roteiro
  - Evita reset durante ciclo de scroll normal
  
- **Correções de Bugs (v1-v17)**:
  - v1-v3: Carregamento duplicado, funções não expostas, roteiro não carregado
  - v4-v9: Frases repetidas sempre faziam match com primeira ocorrência
  - v10-v11: Lógica de compareDocumentPosition invertida
  - v12: ultimoElementoValidado não era atualizado em scrolls pequenos
  - v13: Lógica de ordem documental corrigida
  - v14: Adicionado check de descendants (contains)
  - v15: Filtro de âncoras em addedNodes (incompleto)
  - v16: Filtro completo de âncoras em addedNodes E removedNodes
  - v17: Janela móvel de 8 palavras para matching (resolve acúmulo de texto longo) ✅

- **Arquivos Criados/Modificados**:
  - `teleprompter.html`: Removido carregamento duplicado do script
  - `js/teleprompter.js`: Expostas funções globalmente (increaseVelocity, decreaseVelocity, moveTeleprompterToAnchor, getTeleprompterProgress, animateTeleprompter)
  - `js/speechRecognition.js`: Implementação completa v16 (novo)
  - `js/matchRecognition.js`: Fuzzy matching com Levenshtein (novo, mantido para compatibilidade)

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
