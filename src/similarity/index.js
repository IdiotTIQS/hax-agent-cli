'use strict';

const {
  CloneDetector,
  sha256,
  stripComments,
  normalizeWhitespace,
  normalizeIdentifiers,
  tokenize,
  extractNGrams,
  jaccardSimilarity,
  structuralSignature,
  blockSignature,
  splitIntoBlocks,
} = require('./detector');

const {
  CodeFingerprint,
  keywordHistogram,
  tokenStats,
  walkDir,
  buildFeatureVector,
  cosineSimilarity,
} = require('./fingerprint');

module.exports = {
  CloneDetector,
  CodeFingerprint,
  sha256,
  stripComments,
  normalizeWhitespace,
  normalizeIdentifiers,
  tokenize,
  extractNGrams,
  jaccardSimilarity,
  structuralSignature,
  blockSignature,
  splitIntoBlocks,
  keywordHistogram,
  tokenStats,
  walkDir,
  buildFeatureVector,
  cosineSimilarity,
};
