/**
 * URL of the Next.js app to load in the Electron BrowserWindow.
 * In development: point to the local dev server.
 * In production: point to the deployed Vercel URL or a local server.
 * Override via OMERO_POS_URL environment variable.
 */
export const POS_URL = process.env.OMERO_POS_URL ?? 'http://localhost:3000/pos'
