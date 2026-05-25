import api from "@/api/axios";
import { AccountDetailsDTO, AccountPermissions, BriefAccountInfo, LedgerDTO } from "@/types/user";
import "react-toastify/dist/ReactToastify.css";

export const fetchPerformance = async (
  accountId: string | null,
  period: string
) => {
  // Don't fetch if the ID is null (the 'enabled' option should prevent this anyway)
  if (!accountId) {
    return null;
  }

  // Add the accountId to the request as a query parameter
  const { data } = await api.get(`/account/performance`, {
    params: {
      accountId: accountId,
      period: period,
    },
  });
  return data;
};


/**
 * Fetches consolidated account details from the backend.
 */
export async function fetchAccountDetails(
  accountId: string | null
): Promise<AccountDetailsDTO | undefined> {
  if (!accountId) {
    return undefined;
  }
  const { data } = await api.get<AccountDetailsDTO>(
    `/account/account-details`,
    {
      params: {
        accountId: accountId,
      },
    }
  );
  return data;
}



export async function fetchAccountPermissions(accountId: string | null): Promise<AccountPermissions | null> {
  if (!accountId) return null;
  const { data } = await api.get<AccountPermissions>(`/account/${accountId}/permissions`);
  return data;
}

/* -------------------------------- LedgerDTO ----------------------------- */



/**
 * Fetches the detailed, multi-currency balance ledger.
 */
export async function fetchBalances(
  accountId: string | null
): Promise<LedgerDTO | undefined> {
  if (!accountId) {
    return undefined;
  }
  // Assuming your endpoint is /ledger and takes an 'acct' query param
  const { data } = await api.get<LedgerDTO>("/account/ledger", {
    params: {
      accountId: accountId,
    },
  });
  return data;
}

/**
 * Checks if the AI features are available on the server.
 * We'll use the market-report endpoint as a lightweight check.
 */
export const checkAiFeatures = async (): Promise<{ enabled: boolean }> => {
  try {
    // --- UPDATE THIS LINE ---
    // Point to the new, lightweight status endpoint instead of the market report.
    await api.get("/ai/status");
    
    // If the request succeeds (doesn't throw), features are enabled
    return { enabled: true };
  } catch (error: any) {
    // A 412 status means the API keys are not set, which is an expected state.
    if (error.response && error.response.status === 412) {
      console.log("AI features disabled on server (API keys missing).");
      return { enabled: false };
    }
    // For other errors, we can re-throw or handle them as needed
    throw error;
  }
};


/**
 * Fetches the AI-powered analysis for a given portfolio.
 * @param portfolioData - Array of objects like [{ ticker: "AAPL", value: 5000 }, ...]
 */
export const fetchPortfolioAnalysis = async (portfolioData: any[]) => {
  const { data } = await api.post("/ai/portfolio/analysis", portfolioData);
  return data; // { analysis: "..." }
};

/**
 * Fetches the general AI-powered market report.
 */
export const fetchMarketReport = async () => {
  const { data } = await api.get("/ai/market-report");
  return data; // { report: "..." }
};

export interface TweetInfo {
  url: string;
  text: string;
  score: number;
  likes: number;
  retweets: number;
}

export interface SentimentResponse {
  sentiment: "positive" | "negative" | "neutral"; 
  score: number;
  score_label: string;
  tweets_analyzed: number;
  top_positive_tweet: TweetInfo | null;
  top_negative_tweet: TweetInfo | null;
}

/**
 * Fetches the Twitter sentiment for a specific stock ticker.
 */
export const fetchStockSentiment = async (ticker: string): Promise<SentimentResponse> => {
  const { data } = await api.get(`/ai/stock/${ticker}/sentiment`);
  return data; 
};

export const fetchAvailableAccounts = async (): Promise<BriefAccountInfo[]> => {
  const { data } = await api.get("/account/accounts");
  return data;
};

export const fetchPnlSnapshot = async (accountId: string) => {
  const response = await api.get(`/account/pnl?accountId=${accountId}`);
  return response.data; 
};

export const fetchAccountSummary = async (accountId: string) => {
  const { data } = await api.get(`/account/accounts/${accountId}/summary`);
  return data;
};
