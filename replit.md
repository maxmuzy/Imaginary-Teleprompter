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
- **Voice Control System**:
    - **Architecture**: Employs a state machine (`SEARCHING` -> `LOCKED`) for robust voice synchronization.
    - **Matching**: Uses a fuzzy matching algorithm (Levenshtein-based) with normalization (punctuation, accents) and a movable window of words for real-time progress tracking.
    - **Scroll Mechanism**: Features a continuous scroll with variable speed, adjusting based on the difference between current and target positions, rather than discrete jumps.
    - **Technical Tags**: Configurable system to ignore technical tags (e.g., `(CAM)`, `[PAUSE]`) during voice matching.
    - **Jump Hybrid**: Combines continuous scroll for small adjustments with smooth jumps for larger movements.
    - **Dynamic Lookahead**: Expands the search window for upcoming text when near the end of the current segment.
    - **Speaker Session Identification**: Tracks and logs distinct speaker sessions based on pauses in speech.
    - **Exclusive Voice Control**: A mechanism (`voiceControlActive`) prevents other scroll triggers from interfering when voice control is active.
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