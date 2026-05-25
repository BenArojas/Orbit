// src/components/trading/OrderFormFields.tsx

import React from "react";
import { Box, TextField, Button, ButtonGroup, Select, MenuItem, FormControl, InputLabel, Tooltip, IconButton, Divider, FormControlLabel, Switch, Collapse } from "@mui/material";
import HelpOutlineIcon from "@mui/icons-material/HelpOutline";
import { orderTypeHelp, bracketOrderHelp } from "@/types/orderTypes";

// Props interface should include all state values and their change handlers
interface OrderFormFieldsProps {
  side: "BUY" | "SELL";
  setSide: (side: "BUY" | "SELL") => void;
  orderType: string;
  setOrderType: (type: string) => void;
  tif: string;
  setTif: (tif: string) => void;
  quantity: number;
  setQuantity: (qty: number) => void;
  price: string;
  setPrice: (price: string) => void;
  auxPrice: string;
  setAuxPrice: (price: string) => void;
  isBracketOrder: boolean;
  setIsBracketOrder: (isBracket: boolean) => void;
  profitTakerPrice: string;
  setProfitTakerPrice: (price: string) => void;
  stopLossPrice: string;
  setStopLossPrice: (price: string) => void;
}

export const OrderFormFields: React.FC<OrderFormFieldsProps> = (props) => {
  const { side, setSide, orderType, setOrderType, tif, setTif, quantity, setQuantity, price, setPrice, auxPrice, setAuxPrice, isBracketOrder, setIsBracketOrder, profitTakerPrice, setProfitTakerPrice, stopLossPrice, setStopLossPrice } = props;

  return (
    <Box sx={{ p: 2, display: "flex", flexDirection: "column", gap: 2 }}>
      {/* Side */}
      <ButtonGroup fullWidth>
        <Button variant={side === "BUY" ? "contained" : "outlined"} color="success" onClick={() => setSide("BUY")}>Buy</Button>
        <Button variant={side === "SELL" ? "contained" : "outlined"} color="error" onClick={() => setSide("SELL")}>Sell</Button>
      </ButtonGroup>

      {/* Order Type */}
      <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
        <FormControl fullWidth>
          <InputLabel>Order Type</InputLabel>
          <Select value={orderType} label="Order Type" onChange={(e) => setOrderType(e.target.value)}>
            <MenuItem value="MKT">Market</MenuItem>
            <MenuItem value="LMT">Limit</MenuItem>
            <MenuItem value="STP">Stop</MenuItem>
            <MenuItem value="STOP_LIMIT">Stop Limit</MenuItem>
          </Select>
        </FormControl>
        <Tooltip title={orderTypeHelp[orderType as keyof typeof orderTypeHelp] || ""}>
          <IconButton><HelpOutlineIcon color="action" /></IconButton>
        </Tooltip>
      </Box>

      {/* TIF and Quantity */}
      <FormControl fullWidth><InputLabel>Time in Force</InputLabel><Select value={tif} label="Time in Force" onChange={(e) => setTif(e.target.value)}><MenuItem value="DAY">Day</MenuItem><MenuItem value="GTC">Good-Til-Canceled</MenuItem></Select></FormControl>
      <TextField label="Quantity" type="number" value={quantity} onChange={(e) => setQuantity(Math.max(1, parseInt(e.target.value) || 1))} fullWidth />

      {/* Price Fields */}
      {orderType.includes("LMT") && <TextField label="Limit Price" type="number" value={price} onChange={(e) => setPrice(e.target.value)} fullWidth required />}
      {orderType === "STP" && <TextField label="Stop Price" type="number" value={price} onChange={(e) => setPrice(e.target.value)} fullWidth required />}
      {orderType === "STOP_LIMIT" && (
          <Box sx={{ display: 'flex', gap: 2 }}>
              <TextField label="Stop Price" type="number" value={auxPrice} onChange={(e) => setAuxPrice(e.target.value)} fullWidth required />
              <TextField label="Limit Price" type="number" value={price} onChange={(e) => setPrice(e.target.value)} fullWidth required />
          </Box>
      )}

      {/* Bracket Order */}
      <Divider />
      <Box>
        <FormControlLabel control={<Switch checked={isBracketOrder} onChange={(e) => setIsBracketOrder(e.target.checked)} />} label="Attach Bracket Order" />
        <Tooltip title={bracketOrderHelp}><IconButton size="small" sx={{ verticalAlign: 'middle' }}><HelpOutlineIcon fontSize="small" color="action" /></IconButton></Tooltip>
      </Box>
      <Collapse in={isBracketOrder}>
        <Box sx={{ display: "flex", gap: 2, mt: 1, p: 2, border: "1px dashed", borderColor: "divider", borderRadius: 1 }}>
          <TextField label="Profit Taker (Limit Price)" type="number" value={profitTakerPrice} onChange={(e) => setProfitTakerPrice(e.target.value)} fullWidth required={isBracketOrder} />
          <TextField label="Stop Loss (Stop Price)" type="number" value={stopLossPrice} onChange={(e) => setStopLossPrice(e.target.value)} fullWidth required={isBracketOrder} />
        </Box>
      </Collapse>
    </Box>
  );
};