export type TwsOrderType = "MKT" | "LMT" | "STP" | "STP LMT";
export type TwsPriceField = "limit_price" | "stop_price";

export const TWS_ORDER_CAPABILITIES: Record<
  TwsOrderType,
  { canDraft: boolean; canModify: boolean; priceFields: TwsPriceField[] }
> = {
  MKT: { canDraft: true, canModify: true, priceFields: [] },
  LMT: { canDraft: true, canModify: true, priceFields: ["limit_price"] },
  STP: { canDraft: true, canModify: true, priceFields: ["stop_price"] },
  "STP LMT": { canDraft: true, canModify: true, priceFields: ["stop_price", "limit_price"] },
};

export function priceFieldsFor(orderType: TwsOrderType): TwsPriceField[] {
  return TWS_ORDER_CAPABILITIES[orderType].priceFields;
}

export function canModifyOrderType(orderType: string): orderType is TwsOrderType {
  return orderType in TWS_ORDER_CAPABILITIES && TWS_ORDER_CAPABILITIES[orderType as TwsOrderType].canModify;
}
