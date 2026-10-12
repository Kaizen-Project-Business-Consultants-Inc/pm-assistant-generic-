import { QueryClient } from '@tanstack/react-query';

/** The app's one query cache (its own module so stores can use it without importing main.tsx) */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 10,
      gcTime: 1000 * 60 * 15,
      refetchOnWindowFocus: false,
      refetchOnMount: false,
      refetchOnReconnect: true,
      retry: (failureCount, error: unknown) => {
        const axiosError = error as { response?: { status?: number } };
        // 401: signed out; 429: the server asked us to slow down — retrying only uses up the allowance
        if (axiosError?.response?.status === 401 || axiosError?.response?.status === 429) {
          return false;
        }
        return failureCount < 2;
      },
    },
  },
});
