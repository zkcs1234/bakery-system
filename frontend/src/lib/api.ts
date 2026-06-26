/// <reference types="vite/client" />
import axios from 'axios';

export const api = axios.create({
  baseURL: import.meta.env.DEV
    ? '/api'
    : import.meta.env.VITE_API_URL ?? '/api',
  withCredentials: true,          // send httpOnly cookies
  timeout: 30_000,
  headers: { 'Content-Type': 'application/json' },
});

// Response interceptor — redirect to login on 401
api.interceptors.response.use(
  (res) => res,
  (error) => {
    if (error.response?.status === 401) {
      // Avoid redirect loop
      if (!window.location.pathname.startsWith('/login')) {
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  }
);

export default api;
