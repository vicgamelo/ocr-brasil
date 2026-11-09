import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // The OCR test starts a real Tesseract worker; first run loads the model.
    testTimeout: 60_000,
  },
});
