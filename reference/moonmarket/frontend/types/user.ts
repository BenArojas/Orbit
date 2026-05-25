export interface AccountPermissions {
    canTrade: boolean;
    allowOptionsTrading: boolean;
    allowCryptoTrading: boolean;
    isMarginAccount: boolean;
    supportsFractions: boolean;
  }

  export interface LedgerEntry {
    secondkey: string;    
    cashbalance: number;  
    settledcash: number;  
    unrealizedpnl: number; 
    dividends: number;
    exchangerate: number;  
    currency?: string;
  }
  
  export interface LedgerDTO {
    baseCurrency: string; 
    ledgers: LedgerEntry[];
  }


  /* --------------------------- PnL DTO --------------------------- */
export interface PnlRow {
    rowType: number; // always 1 (single account)
    dpl: number; // daily realised P&L
    nl: number; // net liquidity
    upl: number; // unrealised P&L
    uel: number; // excess liquidity
    el: number; // excess liquidity
    mv: number; // margin value
  }
  
  /* --------------------------- AccountSummary DTO --------------------------- */
  export interface BriefAccountInfo {
    accountId: string;
    accountTitle: string;
    displayName: string;
  }
  
  export interface OwnerInfoDTO {
    userName: string;
    entityName: string;
    roleId: string;
  }
  
  export interface AccountInfoDTO {
    accountId: string;
    accountTitle: string;
    accountType: string;
    tradingType: string;
    baseCurrency: string;
    ibEntity: string;
    clearingStatus: string;
    isPaper: boolean;
  }
  
  export interface PermissionsDTO {
    allowFXConv: boolean;
    allowCrypto: boolean;
    allowEventTrading: boolean;
    supportsFractions: boolean;
  }
  
  export interface AccountDetailsDTO {
    owner: OwnerInfoDTO;
    account: AccountInfoDTO;
    permissions: PermissionsDTO;
  }