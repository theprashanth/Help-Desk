/**
 * Where the dashboard and the Messenger find the server. Set VITE_API_URL when you build for production
 * (e.g. on Netlify: VITE_API_URL=https://api.yourcompany.com). Without it, the local server is used.
 */
export const API_URL: string = ((import.meta as any).env?.VITE_API_URL || 'http://localhost:3000').replace(/\/+$/, '');
