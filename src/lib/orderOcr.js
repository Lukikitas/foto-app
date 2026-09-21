import { createOrderDetector } from './orderOcrPipeline.js';
import { recognizeOcrData } from './ocrRecognize.js';

/** Reads a ticket close-up. Never used on the live camera feed. */
export const detectOrderFromPhoto = createOrderDetector(recognizeOcrData);
