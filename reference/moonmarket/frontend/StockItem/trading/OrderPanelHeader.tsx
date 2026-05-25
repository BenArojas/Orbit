// src/components/trading/OrderPanelHeader.tsx

import React from "react";
import { Box, Typography, IconButton } from "@mui/material";
import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown";
import KeyboardArrowUpIcon from "@mui/icons-material/KeyboardArrowUp";

interface OrderPanelHeaderProps {
  isExpanded: boolean;
  toggleExpand: () => void;
}

export const OrderPanelHeader: React.FC<OrderPanelHeaderProps> = ({ isExpanded, toggleExpand }) => (
  <Box
    onClick={toggleExpand}
    sx={{
      p: 2,
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      cursor: "pointer",
      borderBottom: isExpanded ? "1px solid" : "none",
      borderColor: "divider",
      flexShrink: 0,
    }}
  >
    <Typography variant="h6">Place Order</Typography>
    <IconButton size="small">
      {isExpanded ? <KeyboardArrowUpIcon /> : <KeyboardArrowDownIcon />}
    </IconButton>
  </Box>
);