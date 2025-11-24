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

## Recent Changes (Replit Setup)
- **2024-11-24**: Initial Replit setup
  - Created `server.js` to serve static files on port 5000
  - Installed Express.js dependency
  - Configured workflow to run web server
  - Documented project structure and setup

## Development Notes
- The JavaScript code uses feature detection (`inElectron()`) to gracefully skip Electron-specific features when running in a browser
- All data is stored locally using browser localStorage
- No backend API or database required
- The application is entirely client-side
