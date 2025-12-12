# Imaginary Teleprompter - Replit Setup

## Overview
The Imaginary Teleprompter is a professional-grade, free, open-source teleprompter software. While originally an Electron desktop application, this Replit version runs as a static web application in the browser. Its purpose is to provide robust teleprompter functionality, including rich text editing, customizable display options, and advanced control features for various use cases.

## User Preferences
I prefer iterative development with clear communication on significant changes. Please ask before making major architectural shifts or adding new external dependencies. I value detailed explanations of complex logic, especially concerning the voice recognition and scrolling mechanisms. Ensure that the core teleprompter functionality remains highly responsive and accurate.

## System Architecture

### Application Type
This is a dual-mode application, primarily running as a static web application in Replit due to Electron's desktop environment requirement.

### UI/UX Decisions
- **Rich Text Editor**: CKEditor is integrated for comprehensive text editing capabilities.
- **Themes & Styles**: Supports multiple prompter styles and themes for customization.
- **Focus Area Modes**: Includes webcam, professional, and screen focus area modes.

### Technical Implementations
- **Frontend**: Utilizes HTML, CSS, and JavaScript.
- **Server (Replit)**: A simple Express.js server (`server.js`) serves static files on port 5000 (host 0.0.0.0).
- **Local Storage**: All application data is stored client-side using browser localStorage.
- **Voice Control System (v29.4)**:
    - **Architecture**: State machine (`SEARCHING` -> `LOCKED`) for robust voice synchronization.
    - **Matching**: Fuzzy matching algorithm (Levenshtein-based) with normalization (punctuation, accents) and movable window of words.
    - **Initial Positioning**: First readable element aligns with TOP of focus area using `positionFirstTextInFocus()`.
    - **Scroll Mechanism**: Continuous scroll with variable speed, adjusting based on position difference.
    - **Soft Transitions**: `softStop()`/`softResume()` preserve velocity during LOCKED→SEARCHING→LOCKED transitions without resetting speed.
    - **Technical Tags**: Configurable system to ignore tags (e.g., `(((CAM1)))`, `(?)`) with secure DOM-based UI.
    - **Jump Hybrid**: Combines continuous scroll for small adjustments with smooth jumps for larger movements.
    - **Dynamic Lookahead**: Expands search window when near end of current segment.
    - **Short Cue Detection**: Supports cues of any length (removed minimum word guards).
    - **Exclusive Voice Control**: `voiceControlActive` prevents other scroll triggers from interfering.
    - **Velocity Control (v29.4)**: Proportional controller with VELOCITY_GAIN=0.022, MAX_VELOCITY=9, dead zone 25px with true zero-velocity pause, proportional braking for overshoots.
    - **Speaker Detection (v29.5)**: Deterministic detection via script markers (NSML-based).
        - **Speaker Mode**: `ANCHOR` (matching active) vs `EXTERNAL` (matching paused during live links).
        - **Entry Markers**: `((ABRE LINK)`, `(LINK)`, `(ABRE SOM DO LINK)` trigger EXTERNAL mode.
        - **Exit Markers**: `DEIXA:`, `(FIM LINK)`, `((CAM X))` trigger return to ANCHOR mode.
        - **Auto-return**: Detects anchor voice matching text after link section.
        - **Safety**: Auto-returns to ANCHOR after 50 elements without exit marker.
        - **API**: `window.voiceTagConfig.getSpeakerMode()`, `forceAnchorMode()`, `forceExternalMode()`.
- **Customizable Focus Area (v29.3)**:
    - **Slider Control**: "Focus" slider (10-80%) allows positioning the reading area anywhere on screen.
    - **Default Position**: 37.5% (25% above center) as recommended for professional use.
    - **Persistence**: Focus position saved in localStorage and restored on reload.
    - **Auto-positioning**: First readable text automatically positioned in focus area on load.
    - **API**: `window.teleprompterFocus` exposes setPosition/getPosition for external control.
- **Hardware Acceleration**: Supports hardware-accelerated scrolling.
- **Feature Detection**: JavaScript code uses `inElectron()` to adapt functionality based on the environment (browser vs. Electron).

### Feature Specifications
- Professional teleprompter with adjustable speed, acceleration, and font size.
- Multiple flip modes (mirror, vertical, horizontal).
- Timer functionality.
- Customizable keyboard shortcuts.
- Anchor shortcuts for quick navigation.
- Progress tracking via element indexing for resilience against DOM changes.

## External Dependencies

-   **CKEditor**: For rich text editing functionality.
-   **Express.js**: Used as the static file server in the Replit environment.
-   **Web Speech API**: For real-time speech recognition.