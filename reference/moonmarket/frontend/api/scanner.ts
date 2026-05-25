// scannerApi.ts

import api from "./axios";

export interface ScannerFilter {
  code: string;
  value: number;
}

export interface ScannerRequest {
  instrument: string;
  type: string;
  location: string;
  filter?: ScannerFilter[];
}

export interface Contract {
  server_id: string;
  symbol: string;
  conidex: string;
  con_id: number;
  company_name: string;
  scan_data: string;
  contract_description_1: string;
  listing_exchange: string;
  sec_type: string;
}

export interface ScannerResponse {
  contracts: Contract[];
  scan_data_column_name?: string;
}

export interface ScanType {
  display_name: string;
  code: string;
  instruments: string[];
}

export interface Instrument {
  display_name: string;
  type: string;
  filters: string[];
}

export interface Filter {
  group: string;
  display_name: string;
  code: string;
  type: string;
}

export interface Location {
  display_name: string;
  type: string;
  locations: Location[];
}

export interface ScannerParams {
  scan_type_list: ScanType[];
  instrument_list: Instrument[];
  filter_list: Filter[];
  location_tree: Location[];
}

export const scannerApi = {
  // Get all scanner parameters
  getScannerParams: async (): Promise<ScannerParams> => {
    const { data } = await api.get<ScannerParams>("/scanner/params");
    return data;
  },

  // Run a market scanner
  runScanner: async (request: ScannerRequest): Promise<ScannerResponse> => {
    const { data } = await api.post<ScannerResponse>("/scanner/run", request);
    return data;
  },

  // Get filters for specific instrument
  getInstrumentFilters: async (
    instrumentType: string
  ): Promise<{ filters: string[] }> => {
    const { data } = await api.get<{ filters: string[] }>(
      `/scanner/instruments/${instrumentType}`
    );
    return data;
  },

  // Get scan types for specific instrument
  getScanTypesForInstrument: async (
    instrumentType: string
  ): Promise<{ scan_types: ScanType[] }> => {
    const { data } = await api.get<{ scan_types: ScanType[] }>(
      `/scanner/scan-types/${instrumentType}`
    );
    return data;
  },
};
