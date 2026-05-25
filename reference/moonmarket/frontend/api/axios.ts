import axios, { AxiosError, AxiosInstance, AxiosRequestConfig, AxiosResponse } from 'axios';
import { toast } from 'sonner'; // Replaced react-toastify with sonner

interface ApiConfig extends AxiosRequestConfig {
  baseURL: string;
  withCredentials: boolean;
  headers: {
    'Content-Type': string;
  };
}

const apiConfig: ApiConfig = {
  baseURL: import.meta.env.VITE_BASE_URL,
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
};

const api: AxiosInstance = axios.create(apiConfig);
const API_ERROR_TOAST_ID = "api-error-toast";

export const authCheckApi: AxiosInstance = axios.create(apiConfig);

api.interceptors.response.use(
  (response: AxiosResponse) => response,
  async (error: AxiosError) => {
    if (error.response?.status !== 401) {
      const message = (error.response?.data as { detail?: string })?.detail || 'An API error occurred';
      
      // Use sonner's 'id' property in the options object to prevent duplicates
      toast.error(message, {
        id: API_ERROR_TOAST_ID,
      });
    }
    return Promise.reject(error);
  }
);

export default api;