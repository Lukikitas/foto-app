import { createOrderDetector } from './orderOcrPipeline.js';
import { recognize } from './ocrCoreEngine.js';

export const detectOrderFromPhoto = createOrderDetector(recognize);
