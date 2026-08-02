// Screen context — TYPE ONLY.
//
// The OCR/vision implementation that used to live here (captureScreen,
// captureCropper, captureScreenFromPath, runOCR, plus the Tesseract provider
// chain and the vision fallback registry) was removed with the rest of the
// screenshot-solve path. Its own header had marked the OCR methods
// runtime-disabled since 2026-05-17, and nothing constructed the service.
//
// The shape survives because IntelligenceEngine, IntelligenceManager and
// WhatToAnswerLLM still thread an optional `screenContext` through their
// signatures, and PromptAssembler renders one when present. Nothing populates
// it today — images attached to a question go straight to a vision-capable
// provider via LLMHelper instead.
//
// ponytail: an interface, not a stub class. No caller ever needed an instance.

export interface ScreenContext {
    ocrText: string;
    imagePath: string;
    activeWindowTitle?: string;
    timestamp: number;
    hash: string;
    confidence?: number;
    provider?: string;
}
